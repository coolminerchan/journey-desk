# Client update implementation

Signed release checks, file-delta downloads, verified local-file reuse, full-package fallback, and in-place replacement with rollback. The public trust configuration contains no signing secret.

Run the regression suite with `node --test client/test/*.test.mjs` and `python -m unittest discover -s client/test -p 'test_client_*.py'` from the repository root. Set `OVERFIELD_TEST_PYTHON` to test with a particular Python executable, including the embedded runtime from a release package.

`scripts/build_client_delta.py` constructs a delta from two complete, verified release ZIPs. `scripts/sign_client_update.mjs` signs the full release and optional delta descriptors with an external publisher key. Never commit that key. Delta files reconstruct an entire verified staging directory; they are not manual overlay patches.

This directory contains the update implementation, not the complete application source. Runtime component notices and corresponding local-service source are included in the Windows release.
