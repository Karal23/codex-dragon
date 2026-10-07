# 来源、改编范围与许可

本仓库是 [Karal23/codex-dragon](https://github.com/Karal23/codex-dragon)，维护者为 [@Karal23](https://github.com/Karal23)。当前派生版本为 **Codex 龙娘 0.2.2**，面向 Windows 桌面和 WSL 中的 Codex。它不是 OpenAI 官方产品，也不代表上游仓库所有权或维护关系发生变化。

## 原项目与作者

| 来源 | 作者与改编范围 |
| --- | --- |
| [DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | 原作者 [@MeteorNOX](https://github.com/MeteorNOX)；保留角色框架、资源管理、交互和上游素材 |
| [For-Codex 分支](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/tree/For-Codex) | Codex 适配协作者 [@Yang-huai406](https://github.com/Yang-huai406)；保留 Electron 桌面宿主、本地 IPC、用量账本等实现 |
| [macOS PR #128](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/pull/128) | 保留 [@1llysviel](https://github.com/1llysviel) 的 macOS 实现与署名；本派生版未完成 macOS 实机验证 |
| [dsh-damage-pulse](https://github.com/wssfk12138/dsh-damage-pulse) | 改编其 BalanceWidget 的跳动反馈，用于 Token 增量提示；没有从该项目复制角色素材 |

本派生版的 For-Codex 基线为提交 [`7fa4596`](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/commit/7fa4596)，dsh-damage-pulse 参考提交为 [`472a1c1`](https://github.com/wssfk12138/dsh-damage-pulse/commit/472a1c17d69d8b842062b7143c761e695be6e766)。上游 Codex 历史 0.2.4 见 [原始提交](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget/tree/8de181abf5593247f32d57995567dd9f4063e049)。旧版文档、归档、插件标识和版本信息为上游历史，不是龙娘当前版本或安装入口。

## 本派生版的改造

新增 Windows + WSL 采集桥接、ChatGPT 订阅额度读取、自动重连、持久化增量历史、Windows 额度提醒、逐模型响应的 Token 飘字、龙娘表情、独立安装器和本机更新回滚。主安装入口为 `Install-Dragon.cmd`，构建入口为 `scripts/build-windows.mjs`，版本以 `dragon.json` 为准。

界面与安装入口使用龙娘命名；内部历史资源键与部分上游插件标识沿用，兼容已有代码和用户资源。上游贡献不会被改称为本项目原创，也不会覆盖上游发布。

## 默认角色素材

`assets/codex-dragon.png` 于 2026-10-07 根据用户提供的白发龙角角色设定，使用内置 imagegen 生成。构图参考上游 `assets/DSniang1.png` 的大头半身比例；龙娘不是上游 DeepSeek 角色，也不是 OpenAI 官方吉祥物。

`assets/codex-dragon-{blink,working,success,failed}.png` 由同一龙娘图生成四种表情。提示词和素材记录见 [默认角色](assets/codex-dragon.prompt.md) 与 [状态表情](assets/codex-dragon-expressions.prompt.md)。保留生成工具写入的来源信息。

## 许可边界

| 范围 | 许可与分发方式 |
| --- | --- |
| 代码和文档 | MIT，保留 [LICENSE](LICENSE) 中的上游版权及第三方声明 |
| assets 中的上游图片、动图、音频 | 按上游条款 as-is 随挂件分发；不声明为本项目原创，不因代码 MIT 而扩大素材权利 |
| 龙娘生成素材 | 保留上述参考与生成来源；不声称取得角色、商标或参考图的排他权利 |
| vendor/smol-toml | BSD-3-Clause，保留原包许可证 |
| Electron 与 Chromium | 构建时下载，保留其自带许可证和第三方声明 |

完整第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 隐私与反馈

个人认证、连接设置、账本、会话、运行日志、测试输出和本机备份不进入提交。Fork 保留上游公开历史和署名；新增提交使用 GitHub 隐私邮箱。使用说明见 [README](README.md)，安全问题按 [SECURITY.md](SECURITY.md) 私下报告，不公开凭据、聊天或完整日志。
