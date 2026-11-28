# 当服务器即将熄灭，愿这片小小世界永远留在你的硬盘里
“空间要关服了。”

“嗯，我知道。”

“那还能玩吗？”

“能。我把它带回家了。”
# journey-desk

A desktop companion for local archives and configured client sessions.

## Setup

1. Download the Windows x64 client package from [Releases](https://github.com/coolminerchan/journey-desk/releases).
2. Extract the complete package into a writable directory.
3. Run `游戏启动器.exe`, keeping `runtime` and `resources` beside it.
4. Install [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/consumer/) if it is missing.

Only the client package is needed. An existing compatible client installation is required and is not included.

## Usage

Import an account archive for local use, or import a connection Key supplied by your administrator. Select the existing installation when prompted.

Saved-home archives can be added to a local save's collection and visited using their owner UID. This keeps the player's own home unchanged.

Wait for saving to finish before closing the application. Existing archives and connection Keys remain private.

Updates can be checked in Client Settings. Startup checks can be disabled there. Supported versions prefer signed file deltas and reuse verified local files; a full package remains available when needed. Older updaters use one complete upgrade before incremental support becomes available. Close the running client session before updating.

## Invited online playtest

Online access is by invitation to the administrator's private server. Each player imports their own privately issued connection Key; no server deployment or shared account credential is distributed here. The current online test uses the verified TapTap program/resource combination documented in the client guide. Bilibili single-player support remains available; online version compatibility is checked separately.

Single-player play remains included, together with its local engine, corresponding source and dependency licenses. Shared-channel scene histories without consistent account ownership are retained as raw archive evidence, rather than promoted to personal completion states.

## Reference

`reference/server` contains a small static-resource server example. It is for reference and is not a complete session or application backend. It is not required for local use.

## Issues

Include the application version, Windows build, client channel, reproduction steps, and error text. Keep archives, connection Keys, and raw recordings private.

## Credits

The original capture utilities were created by **Shuiyin (水音)**. An archived version can be found in [backup-tool](https://github.com/inori-dream/miaomiao-launcher/tree/main/backup-tool).

- [inori-dream/miaomiao-launcher](https://github.com/inori-dream/miaomiao-launcher) — client integration and archive utilities.
- [BanterSR/Lolo](https://github.com/BanterSR/Lolo) — local service component and protocol identifiers.
- [byzp/of-ps](https://github.com/byzp/of-ps) — protocol definitions and mappings.

We also acknowledge the authors of the bundled runtime, decoding, and interface dependencies. Their notices, licenses, and corresponding component source accompany the client package. The reference example is licensed separately.
