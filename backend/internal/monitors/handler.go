package monitors

import (
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

type Monitor struct {
	ID              uint64    `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID          uint64    `gorm:"not null;index" json:"-"`
	URL             string    `gorm:"type:varchar(2048);not null" json:"url"`
	IntervalMinutes int       `gorm:"not null" json:"interval_minutes"`
	CreatedAt       time.Time `json:"created_at"`
}

type Input struct {
	URL             string `json:"url" binding:"required" maxLength:"2048" example:"https://example.com"`
	IntervalMinutes int    `json:"interval_minutes" binding:"required" minimum:"1" maximum:"1440" example:"5"`
}

// Authenticate returns the owner ID or writes an error response and returns false.
// This lets monitor routes share auth without depending on the auth package.
type Authenticate func(http.ResponseWriter, *http.Request) (uint64, bool)

// NewHandler lists and creates monitors scoped to the authenticated user.
// The authenticate callback must write the response when authentication fails.
func NewHandler(db *gorm.DB, authenticate Authenticate) http.Handler {
	mux := http.NewServeMux()
	h := &handler{db: db, authenticate: authenticate}
	mux.HandleFunc("GET /api/monitors", h.list)
	mux.HandleFunc("POST /api/monitors", h.create)
	return mux
}

type handler struct {
	db           *gorm.DB
	authenticate Authenticate
}

// list handles monitors owned by the current user.
// @Summary List monitors
// @Tags monitors
// @Produce json
// @Security BearerAuth
// @Success 200 {array} Monitor
// @Failure 401 {object} apiError "invalid_token"
// @Failure 403 {object} apiError "origin_not_allowed"
// @Failure 500 {object} apiError "internal_error"
// @Router /api/monitors [get]
func (h *handler) list(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	// The API promises an array, including when the user has no monitors.
	items := []Monitor{}
	if err := h.db.WithContext(r.Context()).Where("user_id = ?", userID).Order("id DESC").Find(&items).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
		return
	}
	writeJSON(w, http.StatusOK, items)
}

// create handles monitors owned by the current user.
// @Summary Create monitor
// @Tags monitors
// @Produce json
// @Security BearerAuth
// @Accept json
// @Param body body Input true "HTTP/HTTPS URL without credentials or fragment; interval 1 to 1440 minutes; unknown fields rejected"
// @Failure 400 {object} apiError "invalid_request"
// @Success 201 {object} Monitor
// @Failure 401 {object} apiError "invalid_token"
// @Failure 403 {object} apiError "origin_not_allowed"
// @Failure 500 {object} apiError "internal_error"
// @Router /api/monitors [post]
func (h *handler) create(w http.ResponseWriter, r *http.Request) {
	userID, ok := h.authenticate(w, r)
	if !ok {
		return
	}
	input, ok := readInput(w, r)
	if !ok {
		return
	}
	item := Monitor{UserID: userID, URL: input.URL, IntervalMinutes: input.IntervalMinutes}
	if err := h.db.WithContext(r.Context()).Create(&item).Error; err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func readInput(w http.ResponseWriter, r *http.Request) (Input, bool) {
	var input Input
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10))
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
	input.URL = strings.TrimSpace(input.URL)
	u, err := url.Parse(input.URL)
	if err != nil || len(input.URL) > 2048 || u == nil ||
		(u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" ||
		u.User != nil || u.Fragment != "" || strings.ContainsAny(u.Host, " \\") {
		writeError(w, http.StatusBadRequest, "invalid_request", "A valid HTTP or HTTPS URL without credentials or fragment is required")
		return input, false
	}
	if input.IntervalMinutes < 1 || input.IntervalMinutes > 1440 {
		writeError(w, http.StatusBadRequest, "invalid_request", "Interval must be an integer from 1 to 1440 minutes")
		return input, false
	}
	return input, true
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

// apiError describes the shared JSON error envelope.
type apiError struct {
	Error struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}
