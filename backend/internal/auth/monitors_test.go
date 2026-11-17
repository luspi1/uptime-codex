package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"uptime-app/backend/internal/monitors"
)

func TestMonitorsRequireAccessToken(t *testing.T) {
	h := NewHandler(nil, Config{JWTSecret: []byte("test-secret")})
	for _, method := range []string{"GET", "POST", "PUT", "DELETE"} {
		for _, token := range []string{"", "Bearer invalid"} {
			path := "/api/monitors"
			if method == "PUT" || method == "DELETE" {
				path += "/1"
			}
			r := httptest.NewRequest(method, path, strings.NewReader(`{"url":"https://example.com","interval_minutes":5}`))
			r.Header.Set("Authorization", token)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code != http.StatusUnauthorized {
				t.Fatalf("%s: %d", method, w.Code)
			}
		}
	}
}

func TestMonitorMutationOrigins(t *testing.T) {
	h := NewHandler(nil, Config{ClientOrigin: "http://localhost:3000"})
	for _, method := range []string{"PUT", "DELETE"} {
		r := httptest.NewRequest("OPTIONS", "/api/monitors/1", nil)
		r.Header.Set("Origin", "http://localhost:3000")
		r.Header.Set("Access-Control-Request-Method", method)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusNoContent || !strings.Contains(w.Header().Get("Access-Control-Allow-Methods"), method) {
			t.Fatalf("preflight %s: %d %v", method, w.Code, w.Header())
		}
		r = httptest.NewRequest(method, "/api/monitors/1", nil)
		r.Header.Set("Origin", "https://untrusted.example.com")
		w = httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusForbidden {
			t.Fatalf("untrusted origin %s: %d", method, w.Code)
		}
	}
}

// Use a dedicated test database: Migrate changes its schema outside the fixture
// transaction. Only fixture rows are rolled back.
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
	mutate := func(method, id, body, token string) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/monitors/"+id, strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		h.ServeHTTP(response, r)
		return response
	}
	id := strconv.FormatUint(created.ID, 10)
	updatedBody := `{"url":" https://updated.example.com ","interval_minutes":1440}`
	for _, method := range []string{"PUT", "DELETE"} {
		w = mutate(method, id, updatedBody, tokens[1])
		if w.Code != http.StatusNotFound {
			t.Fatalf("another user %s: %d %s", method, w.Code, w.Body.String())
		}
	}
	w = mutate("PUT", id, `{"url":"bad","interval_minutes":0}`, tokens[0])
	if w.Code != http.StatusBadRequest {
		t.Fatalf("invalid update: %d", w.Code)
	}
	stored = monitors.Monitor{}
	if err := tx.First(&stored, created.ID).Error; err != nil || stored.URL != created.URL {
		t.Fatalf("rejected mutations changed monitor: %+v, %v", stored, err)
	}
	for range 2 {
		w = mutate("PUT", id, updatedBody, tokens[0])
		var updated monitors.Monitor
		if err := json.Unmarshal(w.Body.Bytes(), &updated); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || updated.ID != created.ID || updated.URL != "https://updated.example.com" ||
			updated.IntervalMinutes != 1440 || !updated.CreatedAt.Equal(stored.CreatedAt) {
			t.Fatalf("update: %d %+v", w.Code, updated)
		}
	}
	stored = monitors.Monitor{}
	if err := tx.First(&stored, created.ID).Error; err != nil || stored.URL != "https://updated.example.com" ||
		stored.IntervalMinutes != 1440 || stored.UserID != users[0].ID {
		t.Fatalf("update not persisted: %+v, %v", stored, err)
	}
	w = mutate("DELETE", id, "", tokens[0])
	if w.Code != http.StatusNoContent || w.Body.Len() != 0 {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	if err := tx.Model(&monitors.Monitor{}).Where("id = ?", created.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("delete not persisted: count %d, %v", count, err)
	}
	for _, method := range []string{"PUT", "DELETE"} {
		w = mutate(method, id, updatedBody, tokens[0])
		if w.Code != http.StatusNotFound {
			t.Fatalf("deleted monitor %s: %d", method, w.Code)
		}
	}
}
