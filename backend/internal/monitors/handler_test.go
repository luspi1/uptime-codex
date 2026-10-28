package monitors

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadInput(t *testing.T) {
	for _, tc := range []struct {
		body string
		ok   bool
	}{
		{`{"url":" https://example.com/path?q=1 ","interval_minutes":5}`, true},
		{`{"url":"http://localhost:8080","interval_minutes":1}`, true},
		{`{"url":"https://example.com","interval_minutes":1440}`, true},
		{`{"url":"example.com","interval_minutes":5}`, false},
		{`{"url":"ftp://example.com","interval_minutes":5}`, false},
		{`{"url":"https://","interval_minutes":5}`, false},
		{`{"url":"https://user:pass@example.com","interval_minutes":5}`, false},
		{`{"url":"https://example.com/#section","interval_minutes":5}`, false},
		{`{"url":"https://example.com","interval_minutes":0}`, false},
		{`{"url":"https://example.com","interval_minutes":-1}`, false},
		{`{"url":"https://example.com","interval_minutes":1441}`, false},
		{`{"url":"https://example.com","interval_minutes":1.5}`, false},
		{`{"url":"https://example.com","interval_minutes":"5"}`, false},
		{`{"url":"https://example.com","interval_minutes":5,"user_id":2}`, false},
		{`{"url":"https://example.com","interval_minutes":5} {}`, false},
		{`{"url":"https://example.com/` + strings.Repeat("a", 2048) + `","interval_minutes":5}`, false},
		{`{}`, false}, {`null`, false}, {`{`, false},
	} {
		t.Run(tc.body, func(t *testing.T) {
			w := httptest.NewRecorder()
			input, ok := readInput(w, httptest.NewRequest("POST", "/api/monitors", strings.NewReader(tc.body)))
			if ok != tc.ok {
				t.Fatalf("ok = %v; response: %s", ok, w.Body.String())
			}
			if ok && input.URL != strings.TrimSpace(input.URL) {
				t.Fatal("URL was not trimmed")
			}
			if !ok && w.Code != http.StatusBadRequest {
				t.Fatalf("status = %d", w.Code)
			}
		})
	}
}
