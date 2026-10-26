package auth

import (
	"bytes"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func avatarRequest(t *testing.T, data []byte, names ...string) *http.Request {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	name := "  Анна  "
	if len(names) > 0 {
		name = names[0]
	}
	if name != "" {
		if err := writer.WriteField("name", name); err != nil {
			t.Fatal(err)
		}
	}
	file, err := writer.CreateFormFile("avatar", "../../untrusted.html")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(data); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPatch, "/api/auth/me", &body)
	r.Header.Set("Content-Type", writer.FormDataContentType())
	return r
}

func testPNG(t *testing.T) []byte {
	t.Helper()
	var data bytes.Buffer
	if err := png.Encode(&data, image.NewRGBA(image.Rect(0, 0, 4, 4))); err != nil {
		t.Fatal(err)
	}
	return data.Bytes()
}

func TestAvatarUploadAndServing(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "avatars")
	h := &Handler{config: Config{AvatarDir: dir}}
	name, filename, ok := h.readProfile(httptest.NewRecorder(), avatarRequest(t, testPNG(t)), "")
	if !ok || name != "Анна" || !validAvatarFilename(filename) {
		t.Fatalf("upload = %q, %q, %v", name, filename, ok)
	}
	stored, err := os.ReadFile(filepath.Join(dir, filename))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := png.Decode(bytes.NewReader(stored)); err != nil {
		t.Fatal(err)
	}
	server := NewHandler(nil, h.config)
	w := httptest.NewRecorder()
	server.ServeHTTP(w, httptest.NewRequest(http.MethodGet, avatarPrefix+filename, nil))
	if w.Code != http.StatusOK || !bytes.Equal(w.Body.Bytes(), stored) || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("GET avatar: %d %v", w.Code, w.Header())
	}
	for _, path := range []string{avatarPrefix, avatarPrefix + "secret.txt", avatarPrefix + strings.Repeat("f", 32) + ".png"} {
		w := httptest.NewRecorder()
		server.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != http.StatusNotFound {
			t.Fatalf("GET %s: %d", path, w.Code)
		}
	}
}

func TestAvatarUploadPreservesNameWhenOmitted(t *testing.T) {
	for _, currentName := range []string{"", "Existing name"} {
		h := &Handler{config: Config{AvatarDir: t.TempDir()}}
		name, _, ok := h.readProfile(httptest.NewRecorder(), avatarRequest(t, testPNG(t), ""), currentName)
		if !ok || name != currentName {
			t.Fatalf("name = %q, ok = %v", name, ok)
		}
	}
}

func TestAvatarRejectsInvalidUploads(t *testing.T) {
	pngData := testPNG(t)
	for _, tc := range []struct {
		name   string
		data   []byte
		status int
	}{
		{"fake image", []byte("<svg onload='alert(1)'></svg>"), 400},
		{"truncated image", pngData[:len(pngData)/2], 400},
		{"empty", nil, 400},
		{"oversized file", bytes.Repeat([]byte("x"), maxAvatarSize+1), 413},
		{"oversized request", bytes.Repeat([]byte("x"), maxAvatarSize+(128<<10)), 413},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			h := &Handler{config: Config{AvatarDir: dir}}
			w := httptest.NewRecorder()
			if _, _, ok := h.readProfile(w, avatarRequest(t, tc.data), ""); ok || w.Code != tc.status {
				t.Fatalf("status = %d, ok = %v", w.Code, ok)
			}
			files, err := os.ReadDir(dir)
			if err != nil || len(files) != 0 {
				t.Fatalf("invalid upload left files: %v, %v", files, err)
			}
		})
	}
}

func TestAvatarUploadRequiresToken(t *testing.T) {
	h := NewHandler(nil, Config{JWTSecret: []byte("secret")})
	w := httptest.NewRecorder()
	h.ServeHTTP(w, avatarRequest(t, testPNG(t)))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", w.Code)
	}
}
