package main

import (
	"flag"
	"io/fs"
	"log"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

var bundleName = regexp.MustCompile(`^packs/[a-f0-9]{64}\.zip$`)

func handler(root *os.Root) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/healthz" {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if !fs.ValidPath(name) || name != "manifest.json" && !bundleName.MatchString(name) {
			http.NotFound(w, r)
			return
		}
		file, err := root.Open(name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
}

func main() {
	listen := flag.String("listen", "127.0.0.1:18088", "listener address")
	directory := flag.String("root", "published", "prepared public-resource directory")
	cert := flag.String("cert", "", "optional TLS certificate")
	key := flag.String("key", "", "optional TLS key")
	flag.Parse()
	if (*cert == "") != (*key == "") {
		log.Fatal("cert and key must be supplied together")
	}
	root, err := os.OpenRoot(*directory)
	if err != nil {
		log.Fatal(err)
	}
	defer root.Close()
	server := &http.Server{Addr: *listen, Handler: handler(root), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second}
	if *cert != "" {
		log.Fatal(server.ListenAndServeTLS(*cert, *key))
	}
	log.Fatal(server.ListenAndServe())
}
