# Reference server

A small Go example serving an existing `manifest.json` and `packs/<sha256>.zip` files. It has no account database, session handling, application state, or third-party runtime.

Requires Go 1.25 or newer.

```sh
go test ./...
go run . -listen 127.0.0.1:18088 -root ./published
```

Optional HTTPS: supply `-cert` and `-key` together. Only files under the selected public-resource directory are served; directory listing is disabled.

This is a reference sample, not the full backend used by configured client sessions. The client does not require this example for local use.
