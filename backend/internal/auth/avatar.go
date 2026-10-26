package auth

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"image"
	_ "image/jpeg"
	"image/png"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const avatarPrefix = "/api/auth/avatars/"
const maxAvatarSize = 5 << 20

func (h *Handler) readProfile(w http.ResponseWriter, r *http.Request, currentName string) (string, string, bool) {
	mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if mediaType != "multipart/form-data" {
		name, ok := readProfileName(w, r)
		return name, "", ok
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarSize+(64<<10))
	err := r.ParseMultipartForm(maxAvatarSize + (64 << 10))
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	if err != nil {
		var limit *http.MaxBytesError
		if errors.As(err, &limit) {
			writeError(w, http.StatusRequestEntityTooLarge, "avatar_too_large", "Avatar must be at most 5 MiB")
		} else {
			writeError(w, http.StatusBadRequest, "invalid_request", "Invalid multipart body")
		}
		return "", "", false
	}
	name := currentName
	if values, present := r.MultipartForm.Value["name"]; present {
		name = strings.TrimSpace(values[0])
	}
	if !utf8.ValidString(name) || (name == "" && len(r.MultipartForm.Value["name"]) > 0) || utf8.RuneCountInString(name) > 100 {
		writeError(w, http.StatusBadRequest, "invalid_request", "Name must contain 1 to 100 characters")
		return "", "", false
	}
	if len(r.MultipartForm.File["avatar"]) != 1 {
		writeError(w, http.StatusBadRequest, "invalid_avatar", "Exactly one avatar is required")
		return "", "", false
	}
	file, header, err := r.FormFile("avatar")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_avatar", "Avatar is required")
		return "", "", false
	}
	defer file.Close()
	if header.Size > maxAvatarSize {
		writeError(w, http.StatusRequestEntityTooLarge, "avatar_too_large", "Avatar must be at most 5 MiB")
		return "", "", false
	}
	data, err := io.ReadAll(file)
	if err != nil {
		writeInternalError(w)
		return "", "", false
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || config.Width <= 0 || config.Height <= 0 || int64(config.Width)*int64(config.Height) > 16_000_000 {
		writeError(w, http.StatusBadRequest, "invalid_avatar", "Use a valid PNG or JPEG up to 16 megapixels")
		return "", "", false
	}
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_avatar", "Invalid image")
		return "", "", false
	}
	if err := os.MkdirAll(h.config.AvatarDir, 0755); err != nil {
		writeInternalError(w)
		return "", "", false
	}
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		writeInternalError(w)
		return "", "", false
	}
	filename := hex.EncodeToString(id[:]) + ".png"
	path := filepath.Join(h.config.AvatarDir, filename)
	output, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if err != nil {
		writeInternalError(w)
		return "", "", false
	}
	// Re-encode to avoid serving metadata or other content from the uploaded file.
	encodeErr := png.Encode(output, img)
	closeErr := output.Close()
	if encodeErr != nil || closeErr != nil {
		_ = os.Remove(path)
		writeInternalError(w)
		return "", "", false
	}
	return name, filename, true
}

func validAvatarFilename(filename string) bool {
	if len(filename) != 36 || !strings.HasSuffix(filename, ".png") {
		return false
	}
	_, err := hex.DecodeString(filename[:32])
	return err == nil
}

func (h *Handler) avatar(w http.ResponseWriter, r *http.Request) {
	filename := r.PathValue("filename")
	if !validAvatarFilename(filename) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeFile(w, r, filepath.Join(h.config.AvatarDir, filename))
}
