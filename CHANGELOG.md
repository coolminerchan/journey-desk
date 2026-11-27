# 0.12.7

Windows x64 portable client. Test build.

- B-channel local sessions use the inspected resource version consistently during preparation and launch, while retaining the verified program fingerprint. The observed B-channel resource update is `2026-11-25-19-54-31` with program `2026-10-21-14-06-13`.
- Updated resource caches are copied into a new prepared game folder, preserving the previous copy and original installation.
- Version errors identify the installed and configured version rather than suggesting a disk-space problem.
- Saved-home owners can be found through UID search without creating accounts or friendships.

Extract `Journey-Desk-0.12.7-Windows-x64.zip` completely and run `游戏启动器.exe`. Keep `runtime`, `resources`, and `licenses` beside it. Existing local saves remain outside the installation directory.

For local sessions, update the launcher and select the existing installation. No account reimport is required. For remote sessions, the administrator must also update the server's resource mapping and issue a matching connection Key; updating the launcher alone does not update an old Key. A program build outside the verified channel fingerprints is still rejected.

Automated checks cover client regressions, resource-copy refresh, local startup, archive lookup and protocol-level visits. The latest B-channel update and the saved-home menu route still need player confirmation.

The `.sha256` file verifies the package download. `client-update.json` is signed application update metadata and does not need to be opened manually.

Account archives, connection Keys and private server data are not included. Existing saves and connection settings remain in the user profile. Please report issues with reproduction steps and redacted diagnostics.

---

# 0.12.6

Windows x64 portable client. Test build.

- Local archive import, saved-home collections and configured remote sessions.
- Connection Key import and signed application updates.
- Startup logs and warnings no longer open the developer error window.
- Critical errors show concise feedback information for this project.
- Session welcome messages point to the project and its issue tracker.

Validated with two supported Windows client channels, continuous bidirectional messaging, transfers, a short connection interruption, and exit/reentry with saved data.

Download `Journey-Desk-0.12.6-Windows-x64.zip`, extract it completely, and run `游戏启动器.exe`. Keep `runtime`, `resources`, and `licenses` beside the executable. An existing compatible installation is required and is not included.

The `.sha256` file verifies the package download. `client-update.json` is application update metadata and does not need to be opened manually.

Account archives, connection Keys and private server data are not included. This is a test build; please report issues with reproduction steps and redacted diagnostics.

---

# 0.12.5

Windows x64 portable client.

- Local archive import and local sessions.
- Saved-home collections for visiting archived layouts.
- Connection Key import for configured remote sessions.
- Signed application updates with optional startup checks.

Download `Journey-Desk-0.12.5-Windows-x64.zip`, extract it completely, and run `游戏启动器.exe`.

Keep `runtime`, `resources`, and `licenses` beside the executable. An existing compatible client installation is required. The reference server is not needed for local use.

The `.sha256` file verifies the package download. `client-update.json` is application update metadata and does not need to be opened manually.

Account archives and connection Keys are not included.
