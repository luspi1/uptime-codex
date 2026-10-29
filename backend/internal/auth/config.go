package auth

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL  string
	JWTSecret    []byte
	ClientOrigin string
	CookieSecure bool
	Port         string
	AvatarDir    string
}

// LoadConfig reads environment settings and rejects a missing database URL
// or a JWT secret shorter than 32 bytes before the server starts.
func LoadConfig() (Config, error) {
	var config Config
	config.AvatarDir = strings.TrimSpace(os.Getenv("AVATAR_DIR"))
	if config.AvatarDir == "" {
		config.AvatarDir = "uploads/avatars"
	}
	config.DatabaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if config.DatabaseURL == "" {
		return config, errors.New("DATABASE_URL is required")
	}

	secret := os.Getenv("JWT_SECRET")
	if len(secret) < 32 {
		return config, errors.New("JWT_SECRET must be at least 32 bytes")
	}
	config.JWTSecret = []byte(secret)

	config.ClientOrigin = strings.TrimSpace(os.Getenv("CLIENT_ORIGIN"))
	if config.ClientOrigin == "" {
		config.ClientOrigin = "http://localhost:3000"
	}
	if strings.HasSuffix(config.ClientOrigin, "/") {
		config.ClientOrigin = strings.TrimSuffix(config.ClientOrigin, "/")
	}

	secure := strings.TrimSpace(os.Getenv("COOKIE_SECURE"))
	if secure != "" {
		value, err := strconv.ParseBool(secure)
		if err != nil {
			return config, fmt.Errorf("invalid COOKIE_SECURE: %w", err)
		}
		config.CookieSecure = value
	}

	config.Port = strings.TrimSpace(os.Getenv("PORT"))
	if config.Port == "" {
		config.Port = "8080"
	}
	if _, err := strconv.Atoi(config.Port); err != nil {
		return config, fmt.Errorf("invalid PORT: %w", err)
	}
	return config, nil
}
