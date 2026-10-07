# Codex 龙娘

Windows 透明桌面悬浮窗，配合 WSL 中通过 ChatGPT 订阅账号登录的 Codex。自定义龙娘采用白发、紫瞳、大头半身构图，包含待机、眨眼、专注、完成、受挫五种状态。

## 安装

1. WSL 中需要 Node.js 24+ 和已登录的 Codex CLI。Windows 无需另装 Node。
2. 解压 `codex-dragon-0.2.2-windows.zip`，双击 `Install-Dragon.cmd`，无需管理员权限。
3. 之后使用桌面 **Codex 龙娘** 快捷方式。首次启动自动查找 WSL；可在设置中重新识别或展开高级连接路径。

程序位于 `%LOCALAPPDATA%\CodexDragon\app`，设置和角色位于 `data`。采集程序随安装包保存，不依赖源码目录。首次安装迁移旧 `CodexWslWhale\data`，保留位置、角色和任务记录；旧数据保留备份。

“登录 Windows 时启动龙娘”默认关闭，可在设置中开启。`Ctrl+Alt+W` 显示或隐藏，托盘菜单可恢复显示、打开设置、查看历史或退出。

## 功能

- 显示 WSL 状态、本轮和今日 Token、官方剩余额度与重置时间。
- 断线自动重连，重试间隔从 2 秒逐步增加至 60 秒；休眠唤醒自动恢复。额度查询子进程退出后也自动恢复。
- 待机眨眼、工作专注、成功或失败切换表情，Token 增量触发跳动与飘字。自定义角色继续使用原图片。系统减少动态效果时关闭眨眼和位移动画。
- 新版 Codex 每次模型响应结束、写入用量后通常 1–2 秒显示一次 `+XX Token`，无需等待工具执行或整个任务结束。连续响应依次显示，重复记录不重复弹；长时间思考时等待真实用量，旧日志仍按 Token 增量提示。
- 剩余额度默认不高于 20% 时提醒，阈值可设 1–99% 或关闭。相同账号、额度窗口及阈值只提醒一次，重启不会重复。过期额度不提醒。Windows 勿扰和通知权限会影响显示，可点击“测试通知”检查。
- “历史统计”显示近 7 天、30 天或全部历史的每日用量，悬停查看输入、输出、缓存与推理明细。
- 保留拖动、位置记忆、换角色、音效、气泡等交互。

## 本机自动更新

默认目录为 `%LOCALAPPDATA%\CodexDragon\updates`，可在设置中更改。把构建生成的 `release.json` 和对应 ZIP 放入该目录。程序启动时及每 15 分钟检查；发现新版本、WSL 连接正常且没有进行中的任务时自动安装。也可手动检查及安装。

更新验证产品、版本、SHA-256 和 ZIP 路径，关闭自身后替换程序并重启，保留数据。新版本不能启动时恢复 `previous`，同一个失败包不会反复自动安装；结果在 `data/last-update.json`。本版本按用户选择使用本机更新目录，不连接上游 Releases。

制作后续版本时提高 `dragon.json` 的三段式版本号，再运行（将示例路径替换为自己的更新目录）：

```sh
npm run build:windows -- --feed=/path/to/update-feed
```

## 统计与隐私

额度通过 WSL 内 `codex app-server` 的 `account/read`、`account/rateLimits/read` 获取，60 秒刷新，可手动刷新；不创建或恢复推理任务。额度窗口长度使用实际返回值，不预设为 5 小时。

任务状态约 0.75 秒刷新，新会话约 3 秒发现。历史首次扫描所选 Codex 目录全部 `sessions` 和 `archived_sessions`，没有旧版文件数及扫描字节总量上限；以后每 30 秒增量读取。索引在 WSL 用户的 `~/.local/share/codex-dragon`，仅保存文件游标、会话标识、时间及 Token 计数。界面显示首次索引进度；日志无法读取或缺少计数基线时明确标记不完整。已索引记录在原日志删除后仍保留。

日期使用 WSL 时区。总 Token 为输入加输出，缓存与推理不重复相加。中途接入的本轮数值标 `*`，重连和重启保留观察起点。历史统计与本轮部分观察独立。

统计仅包含本机可用日志，不含 ChatGPT 网页聊天、其他设备 Token 或无法恢复的已删除记录；订阅百分比不会转换为 Token 或 API 费用。凭据留在 WSL，界面不接收访问令牌、邮箱、聊天正文。退出只关闭挂件自身子进程，不结束用户的 Codex。

## 开发与来源

```sh
node --test tests/dragon-features.test.mjs tests/wsl-companion.test.mjs
npm test
npm run build:windows
```

输出为 `dist/codex-dragon` 和 `dist/releases`，`--no-archive` 只生成便携目录。在 WSL 构建需要 Python 3（仅用于 ZIP 打包）和 `unzip`（解压 Electron）；首次构建下载并校验固定版本 Electron。Windows UI 验证入口为 `tests/wsl-desktop-smoke.cjs`。独立数据目录可通过 `scripts/start-wsl.ps1 -DataDir <Windows 路径>` 指定。

基于 [DeepSeek-Balance-Whale-Widget / For-Codex](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/tree/For-Codex)，跳动参考 [dsh-damage-pulse](https://github.com/wssfk12138/dsh-damage-pulse)。界面与安装入口改用龙娘；内部资源路径、历史数据键保留以兼容已有资源，上游署名及真实服务商标识保留。

图片使用内置 imagegen 生成，素材及最终提示词见 [默认角色](assets/codex-dragon.prompt.md)、[状态表情](assets/codex-dragon-expressions.prompt.md)。许可见 `LICENSE`、`PROVENANCE.md`、`THIRD_PARTY_NOTICES.md` 及运行时声明。
