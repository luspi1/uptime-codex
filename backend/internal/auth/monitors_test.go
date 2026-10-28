package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"uptime-app/backend/internal/monitors"
)

func TestMonitorsRequireAccessToken(t *testing.T) {
	h := NewHandler(nil, Config{JWTSecret: []byte("test-secret")})
	for _, method := range []string{"GET", "POST"} {
		for _, token := range []string{"", "Bearer invalid"} {
			r := httptest.NewRequest(method, "/api/monitors", strings.NewReader(`{"url":"https://example.com","interval_minutes":5}`))
			r.Header.Set("Authorization", token)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s: %d", method, w.Code)
			}
		}
	}
}

// Test against PostgreSQL with all fixtures rolled back.
func TestMonitorCreationPersistenceAndOwnership(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqlDB.Close() })
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	h := NewHandler(tx, Config{JWTSecret: []byte("test-secret")})
	users := []User{
		{Email: "monitor-owner-" + time.Now().Format("150405.000000000") + "@example.com", PasswordHash: "test"},
		{Email: "monitor-other-" + time.Now().Format("150405.000000000") + "@example.com", PasswordHash: "test"},
	}
	tokens := make([]string, len(users))
	for i := range users {
		if err := tx.Create(&users[i]).Error; err != nil {
			t.Fatal(err)
		}
		tokens[i], err = accessToken(users[i].ID, []byte("test-secret"))
		if err != nil {
			t.Fatal(err)
		}
	}
	call := func(method, body, token string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/monitors", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	w := call("GET", "", tokens[0])
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" {
		t.Fatalf("empty list: %d %s", w.Code, w.Body.String())
	}
	w = call("POST", `{"url":" https://example.com/health ","interval_minutes":7}`, tokens[0])
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created monitors.Monitor
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created.ID == 0 || created.URL != "https://example.com/health" || created.IntervalMinutes != 7 || created.CreatedAt.IsZero() {
		t.Fatalf("unexpected created monitor: %+v", created)
	}
	var stored monitors.Monitor
	if err := tx.First(&stored, created.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.UserID != users[0].ID || stored.URL != created.URL || stored.IntervalMinutes != 7 {
		t.Fatalf("not persisted: %+v", stored)
	}
	for i, token := range tokens {
		w = call("GET", "", token)
		if w.Code != 200 {
			t.Fatalf("list: %d %s", w.Code, w.Body.String())
		}
		var items []monitors.Monitor
		if err := json.Unmarshal(w.Body.Bytes(), &items); err != nil {
			t.Fatal(err)
		}
		if i == 0 && (len(items) != 1 || items[0].ID != created.ID) {
			t.Fatalf("owner list: %+v", items)
		}
		if i == 1 && len(items) != 0 {
			t.Fatal("another user can see the monitor")
		}
	}
	w = call("POST", `{"url":"bad","interval_minutes":0}`, tokens[0])
	if w.Code != 400 {
		t.Fatalf("invalid request: %d", w.Code)
	}
	var count int64
	if err := tx.Model(&monitors.Monitor{}).Where("user_id = ?", users[0].ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("invalid request changed data: %d, %v", count, err)
	}
}
