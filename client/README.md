# Client update implementation

Signed release checks, verified downloads, package validation, and in-place replacement with rollback. The public trust configuration contains no signing secret.

Run the regression suite with `node --test client/test/*.test.mjs` and `python -m unittest discover -s client/test -p test_client_update.py` from the repository root.

This directory contains the update implementation, not the complete application source. Runtime component notices and corresponding local-service source are included in the Windows release.
