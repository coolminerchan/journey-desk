# 0.12.18 — invited playtest

- Restore nebula-tree pages, activated nodes, achievement counters, page rewards and claimed task rewards from account archives. Nebula trees and historical wish trees remain separate systems. Existing claims are restored without granting their rewards again.
- Preserve global collection IDs and verified personal challenge times independently of temporary scene snapshots. Unknown moon regions remain unassigned.
- Restore scenic, timed-challenge and world-riddle states only from scene snapshots whose original player ID and visible UID both match the captured account. Shared or unverified channel histories remain in the original archive and are reported as not restored; matching personal times do not establish ownership of unrelated completion states or stars. Existing saved progress is preserved.
- Support history-only supplements for an existing save of the same identity. The operation checks the archive digest, requires the game and local service to be stopped, and creates a backup before changing history. Equipment, balances, life progress, activities and home layouts remain intact.
- Reject isolated-game resource paths that exceed the supported managed-file path length, and detect missing cache manifests before launching. Real resource manifests are required; no replacement versions are synthesized.
- Keep imported friends usable in private conversations when both restored accounts have confirmed friendship evidence. Private sending and history use the same checks, including deletion and blacklist state, without creating accounts or inventing reciprocal friend entries.
- Correct updater path handling for Windows short names and canonical paths while retaining signature, member, link, overlap, cleanup, locking and rollback protections. Full-package installation remains available alongside verified file deltas.

## Scope

This client keeps single-player play and joins the administrator's private server by invitation. Each invited player receives their own connection Key privately. No independent server management tool, server deployment package, player archive, database or shared account credential is included.

The invited online playtest currently uses TapTap program `2026-10-21-14-05-50` with resource `2026-11-25-19-54-41`. Verified Bilibili single-player use remains available. Online Keys must match the actual installed channel and resource version; the current test server's older Bilibili resource profile does not establish support for newer Bilibili online installations. Version checks remain enabled.

The tested online scope covers two distinct accounts, movement and jumping, channel messages, existing-friend private messages, home round trips, and saved identity/signature after re-entry. Prior short-connection-interruption evidence is reused; this release does not claim a new disconnect test or uninterrupted survival across server restarts. Special activities and local gameplay algorithms retain the limitations described in the client guide.

## Installation and existing data

Fully extract the complete client package and keep `runtime`, `resources` and `licenses` beside `游戏启动器.exe`. Select your own original game installation. Close the running game and wait for saving before applying an update. Delta ZIPs are updater inputs, not standalone installations.

Existing archives and working connection Keys remain private and can be reused. To supplement a save, preview an archive for the same UID and select the history-only action. An omitted or unverified record does not mean that the original account had zero progress. No automatic cleanup of previously saved history is performed.

The local single-player engine, its complete corresponding source and dependency licenses accompany the client. Thanks to the original authors, Shuiyin (水音), and the community contributors acknowledged in the bundled notices.

---

# 0.12.17

Windows x64 portable client. Includes all changes since 0.12.12.

## Added

- Activity settings for individual local saves and administrator-managed sessions. Choose one active event and one of 20 battle-pass seasons; switching back preserves the previous season's experience, counters, and reward claims.
- Selectable plaza decorations, including Halloween, Christmas, cherry blossoms, and Ferris-wheel stages. Decorations and event tasks are configured separately. All clients connected to the same service receive the same selection.
- Cross-channel decoration matching by asset identity rather than internal IDs, supporting the different TapTap and Bilibili resource tables.
- An option to open all 63 historical wish-tree definitions available in the saved resources. Node prerequisites, currency costs, rewards, and unlock history remain enforced and persistent.
- Selection of 50 historical capsule-machine instances, including Select All and Disable All controls. Draw counts, remaining rewards, and history stay separate for each instance.
- Sign-in rewards, supported event tasks, battle-pass task experience and level rewards, local-currency experience purchases, machine draws, and paginated history.
- Activity counters for login, production, fishing, dungeon completion, combat, chests, gathering, collection, and draws. Imports restore recorded activity and tree progress without inventing missing completion records.

## Fixed

- Choice-pool draws returning success without an item, selected-target pity handling, wish-selection success responses, and incomplete draw-history page counts.
- Draw transactions now commit costs, items, counters, and records together. Insufficient balances, invalid rewards, or record-write failures preserve the previous inventory and draw state. Final inventory notifications include extra rewards.
- Large activity catalogs being truncated by the launcher, and outdated bundled inspection components rejecting otherwise compatible TapTap installations. Packaging now checks channel and fingerprint support.
- Tutorial suppression interrupting scene initialization, hiding the main interface, or preventing movement. Normal initialization is preserved; only the dedicated tutorial panel is closed.
- Activity timestamps using the wrong unit, which could hide entries or close activity pages immediately.
- Battle-pass Reward-page Claim All now collects unlocked items; Task-page Claim All collects experience from completed tasks. Previously claimed or incomplete entries are skipped.
- Login tasks being missed when changing seasons on the same day, received task states being reset by generic progress notifications, and empty claims being misreported as a weekly experience limit. Claimed states survive re-entry.
- Historical-tree startup hooks triggering AOT initialization errors, and invalid managed-string writes causing native crashes. Configuration changes use the client's original property setters with reference checks and preserve managed initialization order.
- Added bounded retries for temporary dispatch failures and local startup diagnostics.

## Updating

Close the game and allow saving to finish before updating. Existing local saves and working connection Keys can be reused.

For manual installation, download and fully extract **Journey-Desk-0.12.17-Windows-x64.zip**, then run **游戏启动器.exe**. Keep `runtime`, `resources`, and `licenses` beside the executable.

The built-in updater can use signed deltas from **0.12.12** and **0.12.15**. Delta ZIPs are updater inputs, not manual overlay patches. Other versions can use the complete package.

Online administrators must update the corresponding service component and save their activity selections. After changing plaza decorations or wish-tree availability, players must fully exit and restart the game through the launcher; returning to the title screen alone is insufficient. Local settings apply only to the selected save.

Activities requiring top-ups, paid event bundles, invitations, or returning-player recruitment remain disabled. Bundled component licenses and corresponding source are included. The repository's small server example remains reference code; only the client download is needed for local use.

---

# 0.12.12

Windows x64 便携客户端 · 测试版。本次合并 0.12.7 之后的全部更新。

手动安装请下载 **Journey-Desk-0.12.12-Windows-x64.zip**，完整解压后运行「游戏启动器.exe」。已有客户端可在退出游戏并等待保存完成后，进入「客户端设置 → 版本更新」升级。

## 收藏家园与频道

- 修复拜访同一地图的其他家园时，仍显示上一家园家具或空白的问题；进入、返回和空家园都会刷新完整家具布局。
- 无指定坐标时从家园入口进入，避免沿用上一张地图的位置。刷新只发给进入者，不改保存的布局。
- 修复收藏家园频道编号超出客户端 Int32 范围导致的整数溢出，以及底部频道号、屋主信息更新延迟。已有收藏自动使用兼容编号，家具和屋主 UID 保留。

## 好友恢复与单机导入

- 恢复有明确采集分类的好友列表、头像昵称、备注、亲密度及资料查询；收藏家园可以通过屋主资料拜访。
- 未迁入的好友以离线资料显示，收藏屋主不会被自动添加为好友或创建登录账号。
- 已有单机存档导入带好友分类的账号包时，可选择「仅补充好友资料」。补充前自动备份，保留装备、生活、家园和其他角色进度。

## 补给、烟花与引导

- 恢复头像菜单星形挂坠的补给领取、奖励弹窗、背包刷新及领取冷却；重复点击、重连和服务重启不会重复发奖。
- 默认补给为金币 1000、星石 10、染色剂 1，以及碎布、胶带、铁片、木块、罐子、酒精中随机一种 2–5 个。间隔为 10–30 分钟，管理员可配置固定奖励和随机材料池。
- 主广场烟花改为北京时间每天 20:00、22:00 各一场，一次播放至自然结束。到点游戏仍为白天时等待入夜，下一场到点旧场失效；不积压多场、不追补程序长时间休眠错过的场次，进入家园或频道不重播。
- 关闭隔离游戏副本中的新手教学遮罩、箭头和强制引导入口，保留普通界面、任务、物品处理和已有存档进度。

## 更新与稳定性

- 新增按文件增量更新：只下载变化文件，核对并复用本机未改动文件，界面显示下载大小及完整／增量状态。
- 更新包、增量描述和文件清单均校验签名或摘要；本机文件被修改、增量缺失或校验失败时自动回退完整更新。
- 沿用原目录替换、旧版备份与失败回滚，保留个人文件、单机存档、Key 和连接设置。
- 修复解包后取消或准备失败时遗留暂存目录的问题；取消下载不会继续尝试完整包，较早准备的版本和原程序保留。
- 修复 Windows 公告请求间歇出现 HTTP 502：只读调度接口先读完受限大小的 POST 请求体，再发送响应，避免返回 200 后正文传输被连接重置。

## 升级说明

- 旧更新器首次升级仍需下载完整包；升级后，后续版本提供匹配增量时自动优先使用。大文件本身变化时仍需下载该整个文件。
- **Delta ZIP 是更新器使用的文件，请勿手动覆盖解压。** 手动安装只需完整客户端 ZIP；`.sha256` 用于核对下载，`client-update.json` 是签名更新元数据。
- 原有单机存档、收藏家园和联机 Key 继续使用，无需重新采集或导入。独立部署的联机服务器也需更新服务组件，客户端更新不会替换远程服务。
- 仓库中的 `reference/server` 继续保留最小静态资源服务示例；游戏本体、账号包、Key 和私人服务器数据不包含在发布文件中。

反馈问题请提供程序版本、系统版本、复现步骤和错误文字，勿附上账号包、Key 或含票据的原始日志。致谢与依赖许可见 README、licenses 及对应组件源码。

---

# 0.12.7

Windows x64 portable client. Test build.

- B-channel local sessions use the inspected resource version consistently during preparation and launch, while retaining the verified program fingerprint. The observed B-channel resource update is `2026-11-25-19-54-31` with program `2026-10-21-14-06-13`.
- Updated resource caches are copied into a new prepared game folder, preserving the previous copy and original installation.
- Version errors identify the installed and configured version rather than suggesting a disk-space problem.
- Saved-home owners can be found through UID search without creating accounts or friendships.

Extract `Journey-Desk-0.12.7-Windows-x64.zip` completely and run `游戏启动器.exe`. Keep `runtime`, `resources`, and `licenses` beside it. Existing local saves remain outside the installation directory.

For local sessions, update the launcher and select the existing installation. No account reimport is required. For remote sessions, the administrator must also update the server's resource mapping and issue a matching connection Key; updating the launcher alone does not update an old Key. A program build outside the verified channel fingerprints is still rejected.

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
