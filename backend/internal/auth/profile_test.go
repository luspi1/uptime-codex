package auth

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestReadProfileName(t *testing.T) {
	for _, tc := range []struct {
		body string
		want string
		ok   bool
	}{
		{`{"name":"  Анна Иванова  "}`, "Анна Иванова", true},
		{`{"name":"` + strings.Repeat("я", 100) + `"}`, strings.Repeat("я", 100), true},
		{`{"name":"` + strings.Repeat("я", 101) + `"}`, "", false},
		{`{"name":"   "}`, "", false},
		{`{"name":""}`, "", false},
		{`{}`, "", false},
		{`null`, "", false},
		{`{"name":null}`, "", false},
		{`{"name":123}`, "", false},
		{`{"name":"Anna","email":"other@example.com"}`, "", false},
		{`{"name":"Anna"} {}`, "", false},
		{`{`, "", false},
	} {
		t.Run(tc.body, func(t *testing.T) {
			w := httptest.NewRecorder()
			r := httptest.NewRequest(http.MethodPatch, "/api/auth/me", strings.NewReader(tc.body))
			got, ok := readProfileName(w, r)
			if got != tc.want || ok != tc.ok {
				t.Fatalf("got (%q, %v), want (%q, %v)", got, ok, tc.want, tc.ok)
			}
			if !ok && w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d", w.Code)
			}
		})
	}
}

func TestUpdateProfileRequiresAccessToken(t *testing.T) {
	h := NewHandler(nil, Config{JWTSecret: []byte("test-secret")})
	for _, token := range []string{"", "Bearer invalid"} {
		r := httptest.NewRequest(http.MethodPatch, "/api/auth/me", strings.NewReader(`{"name":"Anna"}`))
		r.Header.Set("Authorization", token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusUnauthorized {
			t.Fatalf("status = %d", w.Code)
		}
	}
}

// Use a dedicated test database: Migrate changes its schema outside the fixture
// transaction. Only fixture rows are rolled back.
func TestProfilePersistence(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := Migrate(db); err != nil {
		t.Fatal(err)
	}
	tx := db.Begin()
	if tx.Error != nil {
		t.Fatal(tx.Error)
	}
	t.Cleanup(func() { tx.Rollback() })
	user := User{Email: "profile-test@example.com", PasswordHash: "unchanged"}
	other := User{Email: "profile-other@example.com", PasswordHash: "unchanged", Name: "Other"}
	for _, u := range []*User{&user, &other} {
		if err := tx.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	config := Config{JWTSecret: []byte(strings.Repeat("s", 32)), AvatarDir: t.TempDir()}
	token, err := accessToken(user.ID, config.JWTSecret)
	if err != nil {
		t.Fatal(err)
	}
	h := NewHandler(tx, config)
	for _, method := range []string{http.MethodPatch, http.MethodGet} {
		r := httptest.NewRequest(method, "/api/auth/me", strings.NewReader(`{"name":"  Анна  "}`))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", method, w.Code, w.Body.String())
		}
		var got userResponse
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.Name != "Анна" || got.Email != user.Email || got.ID != user.ID {
			t.Fatalf("unexpected profile: %+v", got)
		}
	}
	if err := tx.First(&user, user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Name != "Анна" || user.PasswordHash != "unchanged" {
		t.Fatalf("unexpected stored user: %+v", user)
	}
	if err := tx.First(&other, other.ID).Error; err != nil {
		t.Fatal(err)
	}
	if other.Name != "Other" {
		t.Fatal("another user's profile changed")
	}
	var previousAvatar string
	for range 2 {
		r := avatarRequest(t, testPNG(t))
		r.Header.Set("Authorization", "Bearer "+token)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != http.StatusOK {
			t.Fatalf("upload: %d %s", w.Code, w.Body.String())
		}
		var got userResponse
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if got.AvatarURL == "" || got.AvatarURL == previousAvatar {
			t.Fatalf("expected new avatar URL: %+v", got)
		}
		if err := tx.First(&user, user.ID).Error; err != nil {
			t.Fatal(err)
		}
		if user.AvatarURL != got.AvatarURL || user.Name != "Анна" {
			t.Fatalf("avatar not persisted: %+v", user)
		}
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, got.AvatarURL, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("stored avatar unavailable: %d", w.Code)
		}
		if previousAvatar != "" {
			w = httptest.NewRecorder()
			h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, previousAvatar, nil))
			if w.Code != http.StatusNotFound {
				t.Fatal("old avatar was not removed")
			}
		}
		previousAvatar = got.AvatarURL
	}
}
