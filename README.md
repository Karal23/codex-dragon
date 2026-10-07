# Codex 龙娘

运行在 **Windows 桌面**、配合 **WSL 中的 Codex** 使用的透明悬浮挂件。通过已有 ChatGPT 订阅登录读取 Codex 额度和本机 Token，用龙娘表情与飘字反馈任务状态。当前版本：**0.2.2**。

## 原项目与致谢

**本项目基于 [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) 的 [For-Codex 分支](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/tree/For-Codex) 改造，保留上游代码、Git 历史、作者署名和许可证，不将原项目的工作声明为本项目原创。**

- 原挂件作者：[@MeteorNOX](https://github.com/MeteorNOX)。
- 上游 Codex 适配：[@Yang-huai406](https://github.com/Yang-huai406)；保留 [@1llysviel](https://github.com/1llysviel) 的 [macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128) 实现与署名。
- Token 跳动反馈参考并改编自 [wssfk12138/dsh-damage-pulse](https://github.com/wssfk12138/dsh-damage-pulse)，其 MIT 声明见 [第三方声明](THIRD_PARTY_NOTICES.md#dsh-damage-pulse)。
- 本派生版由 [@Karal23](https://github.com/Karal23) 维护，新增 Windows + WSL 采集桥接、订阅额度展示、龙娘素材、逐响应 Token 提示、历史统计及本机安装更新。

这是社区派生项目，与 OpenAI 没有官方隶属关系；龙娘是自定义形象，不是官方吉祥物。完整来源、改造范围和素材许可边界见 [PROVENANCE.md](PROVENANCE.md)。

<img src="assets/codex-dragon.png" width="180" alt="Codex 龙娘默认半身角色">

## 功能

- Windows 透明悬浮窗：拖动、位置记忆、角色切换、托盘控制和快捷键。
- WSL 中的 Codex 自动识别、连接恢复和休眠唤醒重连。
- 显示订阅剩余额度、重置时间、本轮与今日 Token；支持 Windows 低额度提醒。
- 每次模型响应写入用量后通常 1–2 秒弹出 `+XX Token`，无需等待工具执行完；连续响应依次显示，重复记录不重复弹。
- 待机、眨眼、专注、完成和受挫表情；菜单打开时状态卡暂时隐藏，关闭后恢复。
- 本机历史用量、可选登录自启、带校验和失败回滚的本机更新。

挂件只读取本机记录；不会把订阅额度换算成 API 费用，也不统计 ChatGPT 网页或其他设备的用量。长时间思考时等待真实用量，不能逐个 Token 实时计数。

## 构建与安装

运行环境：Windows + WSL，WSL 内已有通过 ChatGPT 账号登录的 Codex CLI、Node.js 24+、npm、Python 3 和 `unzip`。Windows 不需要另装 Node.js。

在 WSL 终端执行：

```sh
git clone --branch dragon https://github.com/Karal23/codex-dragon.git
cd codex-dragon
npm run build:windows
```

首次构建联网下载并校验 Electron。完成后，用 Windows 资源管理器打开 `dist/codex-dragon`，双击 **`Install-Dragon.cmd`**。也可将 `dist/releases/codex-dragon-0.2.2-windows.zip` 复制到 Windows 后解压安装。

安装后从桌面 **Codex 龙娘** 快捷方式启动；按 `Ctrl+Alt+W` 显示或隐藏。首次启动自动识别 WSL，可在“设置”中调整连接。代码安装在 `%LOCALAPPDATA%\CodexDragon\app`，个人数据单独保存在 `data`。

完整操作、快捷键、连接设置、更新方式和数据说明见 [Windows + WSL 使用说明](README-WSL.md)。本派生版的实际验证平台是 Windows + WSL；仓库保留的上游 macOS 实现不代表龙娘版本已完成 macOS 验证。

## 开发与隐私

```sh
node --test tests/wsl-companion.test.mjs tests/dragon-features.test.mjs
npm test
```

Windows 界面验证入口为 `tests/wsl-desktop-smoke.cjs`，需使用独立的测试数据目录。默认发布流程为 `npm run build:windows`；角色资源和生成提示词在 `assets/`。

认证信息留在 WSL；挂件不把访问令牌、邮箱或聊天正文转发给 Windows 界面。会话、运行日志、账本、认证文件、测试输出、个人连接设置和构建产物不应提交到仓库。报告问题前请脱敏，安全问题见 [SECURITY.md](SECURITY.md)。

## 许可

代码按 [MIT License](LICENSE) 分发，保留原作者版权。上游图片、动图和音频沿用上游素材条款，不能因为代码采用 MIT 就推断素材也可任意再许可。龙娘素材为 AI 生成的自定义角色，来源见 [素材记录](assets/codex-dragon.prompt.md) 和 [表情记录](assets/codex-dragon-expressions.prompt.md)。Electron、Chromium 和 vendored 依赖各自的声明仍然适用，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
