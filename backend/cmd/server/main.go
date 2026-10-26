package main

import (
	"context"
	"log"
	"net/http"
	"time"

	"uptime-app/backend/internal/auth"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

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

	mux := http.NewServeMux()
	mux.Handle("/api/auth/", auth.NewHandler(db, config))
	mux.HandleFunc("GET /{$}", func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("Backend is ready.\n"))
	})

	log.Printf("Backend listening on http://localhost:%s", config.Port)
	log.Fatal(http.ListenAndServe(":"+config.Port, mux))
}
