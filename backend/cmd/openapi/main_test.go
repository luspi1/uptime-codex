package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/getkin/kin-openapi/openapi3"
)

func TestGeneratedContract(t *testing.T) {
	target := filepath.Join(t.TempDir(), "openapi.json")
	if err := generate("../../docs/swagger.json", target); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("../../docs/openapi.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, want) {
		t.Fatal("OpenAPI contract is stale; run go generate ./cmd/server")
	}
	doc, err := openapi3.NewLoader().LoadFromData(got)
	if err != nil {
		t.Fatal(err)
	}
	if err := doc.Validate(context.Background()); err != nil {
		t.Fatal(err)
	}
	for path, methods := range map[string][]string{
		"/":                            {"GET"},
		"/api/auth/register":           {"POST"},
		"/api/auth/login":              {"POST"},
		"/api/auth/refresh":            {"POST"},
		"/api/auth/logout":             {"POST"},
		"/api/auth/me":                 {"GET", "PATCH"},
		"/api/auth/avatars/{filename}": {"GET"},
		"/api/monitors":                {"GET", "POST"},
	} {
		item := doc.Paths.Value(path)
		if item == nil {
			t.Fatalf("missing path %s", path)
		}
		for _, method := range methods {
			if item.GetOperation(method) == nil {
				t.Errorf("missing operation %s %s", method, path)
			}
		}
	}
	profile := doc.Paths.Value("/api/auth/me").Patch.RequestBody.Value
	if profile.Content["application/json"].Schema.Value.Properties["name"] == nil {
		t.Fatal("missing JSON profile name")
	}
	avatar := profile.Content["multipart/form-data"].Schema.Value.Properties["avatar"].Value
	if avatar.Format != "binary" {
		t.Fatal("multipart avatar must be a binary file")
	}
}
