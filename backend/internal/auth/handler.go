package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"uptime-app/backend/internal/monitors"

	"github.com/jackc/pgx/v5/pgconn"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const refreshCookieName = "refresh_token"

var errInvalidRefresh = errors.New("invalid refresh token")

type Handler struct {
	db     *gorm.DB
	config Config
	mux    *http.ServeMux
}

type credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type userResponse struct {
	ID        uint64 `json:"id"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

type authResponse struct {
	User        userResponse `json:"user"`
	AccessToken string       `json:"access_token"`
	TokenType   string       `json:"token_type"`
	ExpiresIn   int          `json:"expires_in"`
}

type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

func NewHandler(db *gorm.DB, config Config) http.Handler {
	if config.AvatarDir == "" {
		config.AvatarDir = "uploads/avatars"
	}
	handler := &Handler{db: db, config: config, mux: http.NewServeMux()}
	handler.mux.HandleFunc("POST /api/auth/register", handler.register)
	handler.mux.HandleFunc("POST /api/auth/login", handler.login)
	handler.mux.HandleFunc("POST /api/auth/refresh", handler.refresh)
	handler.mux.HandleFunc("POST /api/auth/logout", handler.logout)
	handler.mux.HandleFunc("GET /api/auth/me", handler.me)
	handler.mux.HandleFunc("PATCH /api/auth/me", handler.updateProfile)
	handler.mux.HandleFunc("GET /api/auth/avatars/{filename}", handler.avatar)
	handler.mux.Handle("/api/monitors", monitors.NewHandler(db, func(w http.ResponseWriter, r *http.Request) (uint64, bool) {
		user, ok := handler.currentUser(w, r)
		return user.ID, ok
	}))
	return handler
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Add("Vary", "Origin")
		if origin != h.config.ClientOrigin {
			writeError(w, http.StatusForbidden, "origin_not_allowed", "Origin is not allowed")
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.WriteHeader(http.StatusNoContent)
		return
	}
	h.mux.ServeHTTP(w, r)
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	input, ok := readCredentials(w, r)
	if !ok {
		return
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		writeInternalError(w)
		return
	}
	refreshToken, refreshHash, err := newRefreshToken()
	if err != nil {
		writeInternalError(w)
		return
	}

	var user User
	var access string
	err = h.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		user = User{Email: input.Email, PasswordHash: string(passwordHash)}
		if err := tx.Create(&user).Error; err != nil {
			return err
		}
		var err error
		access, err = accessToken(user.ID, h.config.JWTSecret)
		if err != nil {
			return err
		}
		return tx.Create(&RefreshSession{
			UserID:    user.ID,
			TokenHash: refreshHash,
			ExpiresAt: time.Now().Add(refreshLifetime),
		}).Error
	})
	if err != nil {
		if isUniqueViolation(err) {
			writeError(w, http.StatusConflict, "email_taken", "Email is already registered")
			return
		}
		writeInternalError(w)
		return
	}
	h.setRefreshCookie(w, refreshToken)
	writeAuthResponse(w, http.StatusCreated, user, access)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	input, ok := readCredentials(w, r)
	if !ok {
		return
	}
	var user User
	err := h.db.WithContext(r.Context()).Where("email = ?", input.Email).First(&user).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password")
			return
		}
		writeInternalError(w)
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password")
		return
	}
	access, err := accessToken(user.ID, h.config.JWTSecret)
	if err != nil {
		writeInternalError(w)
		return
	}
	refreshToken, refreshHash, err := newRefreshToken()
	if err != nil {
		writeInternalError(w)
		return
	}
	err = h.db.WithContext(r.Context()).Create(&RefreshSession{
		UserID:    user.ID,
		TokenHash: refreshHash,
		ExpiresAt: time.Now().Add(refreshLifetime),
	}).Error
	if err != nil {
		writeInternalError(w)
		return
	}
	h.setRefreshCookie(w, refreshToken)
	writeAuthResponse(w, http.StatusOK, user, access)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookieName)
	if err != nil || cookie.Value == "" {
		writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid refresh token")
		return
	}
	nextToken, nextHash, err := newRefreshToken()
	if err != nil {
		writeInternalError(w)
		return
	}

	var user User
	var access string
	err = h.db.WithContext(r.Context()).Transaction(func(tx *gorm.DB) error {
		var session RefreshSession
		result := tx.Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("token_hash = ?", hashRefreshToken(cookie.Value)).First(&session)
		if errors.Is(result.Error, gorm.ErrRecordNotFound) {
			return errInvalidRefresh
		}
		if result.Error != nil {
			return result.Error
		}
		if !session.ExpiresAt.After(time.Now()) {
			return errInvalidRefresh
		}
		if err := tx.First(&user, session.UserID).Error; err != nil {
			return err
		}
		access, err = accessToken(user.ID, h.config.JWTSecret)
		if err != nil {
			return err
		}
		result = tx.Model(&session).Updates(map[string]any{
			"token_hash": nextHash,
			"expires_at": time.Now().Add(refreshLifetime),
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return errInvalidRefresh
		}
		return nil
	})
	if err != nil {
		if errors.Is(err, errInvalidRefresh) {
			writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid refresh token")
			return
		}
		writeInternalError(w)
		return
	}
	h.setRefreshCookie(w, nextToken)
	writeAuthResponse(w, http.StatusOK, user, access)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookieName)
	if err == nil && cookie.Value != "" {
		if err := h.db.WithContext(r.Context()).
			Where("token_hash = ?", hashRefreshToken(cookie.Value)).
			Delete(&RefreshSession{}).Error; err != nil {
			writeInternalError(w)
			return
		}
	}
	h.clearRefreshCookie(w)
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	user, ok := h.currentUser(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, profileResponse(user))
}

func (h *Handler) currentUser(w http.ResponseWriter, r *http.Request) (User, bool) {
	fields := strings.Fields(r.Header.Get("Authorization"))
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") {
		writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid access token")
		return User{}, false
	}
	userID, err := verifyAccessToken(fields[1], h.config.JWTSecret)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid access token")
		return User{}, false
	}
	var user User
	err = h.db.WithContext(r.Context()).First(&user, userID).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid access token")
			return User{}, false
		}
		writeInternalError(w)
		return User{}, false
	}
	return user, true
}

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := h.currentUser(w, r)
	if !ok {
		return
	}
	name, avatar, ok := h.readProfile(w, r, user.Name)
	if !ok {
		return
	}
	committed := false
	if avatar != "" {
		defer func() {
			if !committed {
				_ = os.Remove(filepath.Join(h.config.AvatarDir, avatar))
			}
		}()
	}
	updates := map[string]any{"name": name}
	if avatar != "" {
		updates["avatar_url"] = avatarPrefix + avatar
	}
	oldAvatar := user.AvatarURL
	result := h.db.WithContext(r.Context()).Model(&user).Updates(updates)
	if result.Error != nil {
		writeInternalError(w)
		return
	}
	if result.RowsAffected != 1 {
		writeError(w, http.StatusUnauthorized, "invalid_token", "Invalid access token")
		return
	}
	committed = true
	if avatar != "" && strings.HasPrefix(oldAvatar, avatarPrefix) {
		filename := strings.TrimPrefix(oldAvatar, avatarPrefix)
		if validAvatarFilename(filename) {
			_ = os.Remove(filepath.Join(h.config.AvatarDir, filename))
		}
	}
	writeJSON(w, http.StatusOK, profileResponse(user))
}

func profileResponse(user User) userResponse {
	return userResponse{ID: user.ID, Email: user.Email, Name: user.Name, AvatarURL: user.AvatarURL}
}

func readProfileName(w http.ResponseWriter, r *http.Request) (string, bool) {
	var input struct {
		Name *string `json:"name"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return "", false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_request", "Only one JSON object is allowed")
		return "", false
	}
	if input.Name != nil {
		name := strings.TrimSpace(*input.Name)
		if utf8.ValidString(name) && utf8.RuneCountInString(name) >= 1 && utf8.RuneCountInString(name) <= 100 {
			return name, true
		}
	}
	writeError(w, http.StatusBadRequest, "invalid_request", "Name must contain 1 to 100 characters")
	return "", false
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var input credentials
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", "Invalid JSON body")
		return input, false
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		writeError(w, http.StatusBadRequest, "invalid_request", "Only one JSON object is allowed")
		return input, false
	}
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 ||
		len(input.Password) < 8 || len(input.Password) > 72 {
		writeError(w, http.StatusBadRequest, "invalid_request", "Valid email and password of 8 to 72 bytes are required")
		return input, false
	}
	return input, true
}

func isUniqueViolation(err error) bool {
	var postgresError *pgconn.PgError
	return errors.As(err, &postgresError) && postgresError.Code == "23505"
}

func (h *Handler) setRefreshCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Value:    token,
		Path:     "/api/auth",
		MaxAge:   int(refreshLifetime.Seconds()),
		HttpOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (h *Handler) clearRefreshCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     refreshCookieName,
		Path:     "/api/auth",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
		HttpOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func writeAuthResponse(w http.ResponseWriter, status int, user User, access string) {
	writeJSON(w, status, authResponse{
		User:        profileResponse(user),
		AccessToken: access,
		TokenType:   "Bearer",
		ExpiresIn:   int(accessLifetime.Seconds()),
	})
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	var response apiError
	response.Error.Code = code
	response.Error.Message = message
	writeJSON(w, status, response)
}

func writeInternalError(w http.ResponseWriter) {
	writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
