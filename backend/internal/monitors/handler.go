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
	URL             string `json:"url"`
	IntervalMinutes int    `json:"interval_minutes"`
}

type Authenticate func(http.ResponseWriter, *http.Request) (uint64, bool)

func NewHandler(db *gorm.DB, authenticate Authenticate) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/monitors", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticate(w, r)
		if !ok {
			return
		}
		items := []Monitor{}
		if err := db.WithContext(r.Context()).Where("user_id = ?", userID).Order("id DESC").Find(&items).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
			return
		}
		writeJSON(w, http.StatusOK, items)
	})
	mux.HandleFunc("POST /api/monitors", func(w http.ResponseWriter, r *http.Request) {
		userID, ok := authenticate(w, r)
		if !ok {
			return
		}
		input, ok := readInput(w, r)
		if !ok {
			return
		}
		item := Monitor{UserID: userID, URL: input.URL, IntervalMinutes: input.IntervalMinutes}
		if err := db.WithContext(r.Context()).Create(&item).Error; err != nil {
			writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
			return
		}
		writeJSON(w, http.StatusCreated, item)
	})
	return mux
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
