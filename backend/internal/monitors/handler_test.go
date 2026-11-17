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

func TestMutationValidation(t *testing.T) {
	h := NewHandler(nil, func(http.ResponseWriter, *http.Request) (uint64, bool) { return 1, true })
	for _, method := range []string{"PUT", "DELETE"} {
		for _, id := range []string{"0", "-1", "abc", "18446744073709551616"} {
			t.Run(method+"/"+id, func(t *testing.T) {
				w := httptest.NewRecorder()
				r := httptest.NewRequest(method, "/api/monitors/"+id, strings.NewReader(`{}`))
				h.ServeHTTP(w, r)
				if w.Code != http.StatusBadRequest {
					t.Fatalf("status = %d: %s", w.Code, w.Body.String())
				}
			})
		}
	}
	for _, body := range []string{`{}`, `null`, `{"url":"bad","interval_minutes":5}`, `{"url":"https://example.com","interval_minutes":5,"user_id":2}`} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("PUT", "/api/monitors/1", strings.NewReader(body)))
		if w.Code != http.StatusBadRequest {
			t.Fatalf("invalid update: %d %s", w.Code, w.Body.String())
		}
	}
}
