package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOnlyPreparedPublicResourcesAreServed(t *testing.T) {
	dir := t.TempDir()
	os.Mkdir(filepath.Join(dir, "packs"), 0700)
	name := "packs/" + strings.Repeat("a", 64) + ".zip"
	os.WriteFile(filepath.Join(dir, "manifest.json"), []byte(`{"example":true}`), 0600)
	os.WriteFile(filepath.Join(dir, name), []byte("example-resource"), 0600)
	os.WriteFile(filepath.Join(dir, "private.key"), []byte("must-not-be-served"), 0600)
	root, err := os.OpenRoot(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	for _, test := range []struct {
		method, path string
		status       int
	}{
		{"GET", "/healthz", 204}, {"GET", "/manifest.json", 200}, {"HEAD", "/" + name, 200},
		{"GET", "/private.key", 404}, {"GET", "/packs/", 404}, {"GET", "/../manifest.json", 404},
		{"GET", "/api/session", 404}, {"POST", "/manifest.json", 405},
	} {
		recorder := httptest.NewRecorder()
		handler(root).ServeHTTP(recorder, httptest.NewRequest(test.method, test.path, nil))
		if recorder.Code != test.status {
			t.Fatalf("%s %s: %d", test.method, test.path, recorder.Code)
		}
		if strings.Contains(recorder.Body.String(), "must-not-be-served") {
			t.Fatal("private file exposed")
		}
	}
}
