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

Updates can be checked in Client Settings. Startup checks can be disabled there. Downloads are verified before replacing the application; close the running client session first.

## Reference

`reference/server` contains a small static-resource server example. It is for reference and is not a complete session or application backend. It is not required for local use.

## Issues

Include the application version, Windows build, client channel, reproduction steps, and error text. Keep archives, connection Keys, and raw recordings private.

## Credits

Thanks to Shuiyin (水音), the original authors, and community contributors. Component licenses, notices, and corresponding third-party source are included with the client package. The reference example has its own license.
