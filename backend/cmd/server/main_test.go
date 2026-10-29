package main

import (
	"bytes"
	"net/http/httptest"
	"strings"
	"testing"

	"uptime-app/backend/docs"
	"uptime-app/backend/internal/auth"
)

func TestDocumentationRoutes(t *testing.T) {
	mux := newMux(nil, auth.Config{})
	for _, path := range []string{"/swagger/index.html", "/swagger/swagger-ui-bundle.js", "/swagger/openapi.json", "/"} {
		t.Run(path, func(t *testing.T) {
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
			if w.Code != 200 {
				t.Fatalf("status = %d", w.Code)
			}
			if path == "/swagger/index.html" && !strings.Contains(strings.ReplaceAll(w.Body.String(), `\/`, `/`), "/swagger/openapi.json") {
				t.Fatal("Swagger UI must load the OpenAPI 3 contract")
			}
			if path == "/swagger/openapi.json" && (!bytes.Equal(w.Body.Bytes(), docs.OpenAPI) || w.Header().Get("Content-Type") != "application/json") {
				t.Fatal("contract response differs from the embedded JSON")
			}
		})
	}
}
