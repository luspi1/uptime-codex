package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"uptime-app/backend/docs"
	"uptime-app/backend/internal/auth"

	httpSwagger "github.com/swaggo/http-swagger/v2"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

//go:generate go tool swag init -g main.go -d .,../../internal/auth,../../internal/monitors --parseInternal -o ../../docs
//go:generate go run ../openapi

// @title Uptime App API
// @version 1.0
// @description Authentication, profiles and website monitors. JSON errors use error.code and error.message. Browser requests must use the configured CLIENT_ORIGIN.
// @BasePath /
// @securityDefinitions.apikey BearerAuth
// @in header
// @name Authorization
// @description Enter Bearer followed by a space and the access JWT.
func main() {
	config, err := auth.LoadConfig()
	if err != nil {
		log.Fatal(err)
	}

	db, err := gorm.Open(postgres.Open(config.DatabaseURL), &gorm.Config{})
	if err != nil {
		log.Fatalf("connect to PostgreSQL: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		log.Fatalf("get database connection: %v", err)
	}
	defer sqlDB.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		log.Fatalf("ping PostgreSQL: %v", err)
	}
	if err := auth.Migrate(db); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	log.Printf("Backend listening on http://localhost:%s", config.Port)
	log.Fatal(http.ListenAndServe(":"+config.Port, newMux(db, config)))
}

func newMux(db *gorm.DB, config auth.Config) *http.ServeMux {
	mux := http.NewServeMux()
	mux.Handle("/api/", auth.NewHandler(db, config))
	mux.Handle("GET /swagger/", httpSwagger.Handler(httpSwagger.URL("/swagger/openapi.json")))
	mux.HandleFunc("GET /swagger/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(docs.OpenAPI)
	})
	mux.HandleFunc("GET /{$}", readiness)

	return mux
}

// readiness reports that the HTTP server is running.
// @Summary Backend readiness
// @Tags health
// @Produce plain
// @Success 200 {string} string "Backend is ready."
// @Router / [get]
func readiness(w http.ResponseWriter, r *http.Request) {
	_, _ = w.Write([]byte("Backend is ready.\n"))
}
