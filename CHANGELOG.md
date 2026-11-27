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
