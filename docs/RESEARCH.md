# 调研记录（2026-10-19）

> 已核实的事实，避免重复调研。数据来源：本机读包 / 读 bundle / 兼容性验证 / npm 与 HF 官方页面。

## 1. 本机 DSH 运行时

| 项 | 值 |
|---|---|
| Desktop 内置运行时 | `%LOCALAPPDATA%\Programs\DSH Desktop\resources\dsh-runtime` |
| dsh | `0.2.0-rc.2` |
| cordis | `4.0.4` |
| ui-chat / ui-primitives / ui-conversation | `0.2.0-rc.2` |
| profile | `~/.dsh/profiles/web`（`package.json` + `pnpm-lock.yaml` + `cordis.patch.yml`） |
| CLI | `~/.dsh/bin/dsh.cmd`；`dsh plugin ...` 可用，`dsh web` 被桌面端拦截 |
| 第三方插件安装位置 | profile 的 `node_modules`，`dsh plugin --profile web add <pkg>` |

**重要**：替换/新增包之后必须完整重启 DSH Desktop —— HMR 不监听 `node_modules`，只刷新页面可能仍引用旧 client 资源。

## 2. DSH 客户端插件机制（读官方 README 归纳）

- `package.json` 的 `dsh.client`：`platform: 'web'`、`inject`（依赖的客户端服务）、`external`（非基线的外部模块）、`immediately`。
- `dsh.bundle.patch`：安装时并入 profile 的 cordis patch，用来挂载 host 半。
- client 包导出 `./client` → `lib/client.js`，必须包在 `window.__ModuleLoader__.load({ id: '<package name>', factory })` 里；host 半在 `/plugins/<pkg>/client.js` 提供该 bundle。
- React / React DOM / cordis / 部分 UI 库由 shell 的 `PLATFORM_MODULES` 统一提供，不打进 bundle；额外的走 `dsh.client.external`。
- client bundle 只注册 factory，模块体在首次 materialize 时才执行（懒）。

## 3. 聊天 UI 的扩展点（从 client bundle 提取的槽位名）

| 槽位 | 用途 |
|---|---|
| `conversation.chat.node` | **按节点 kind 注册渲染器**：`user` / `steering` / `context` / `turn-trigger` / `system-prompt` / `assistant-step` … |
| `conversation.chat.turnTail` | 回合尾部（计划插件用它放“计划审阅”操作） |
| `conversation.view` / `conversation.content` / `conversation.session` / `conversation.session.header` / `main.conversation` | 会话容器/头部 |
| `conversation.composer.dock` / `conversation.composer.bar` / `conversation.input.dock` | 输入区扩展 |
| `shell.overlay` | 全屏浮层（浮窗方案的落点） |
| `settings.general.item` | 设置页条目（插件设置入口） |
| `sidebar.right.pane.tab` / `sidebar.right.pane.tab.title` | 右侧面板 Tab |

其它事实：

- 聊天渲染把 reasoning 与回答用 `groupPart`（`reasoning` / `response`）区分。
- 推理块由 `ReasoningRow` 渲染（可折叠，`text` 为思考全文），`AssistantMarkdown` 按 block.kind 分发。
- `ChatNodeStore.turnDataSource` 允许“artifact 扩展按回合 + 节点 kind 订阅”，源包含 hidden 节点并按 anchor 顺序暴露业务数据 —— 这是拿 reasoning 文本的正路。
- `conversation.chat.node` 的注册形如：`ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name, key, locale }, Component))`。
- **未确认**：同名 key 重复注册的语义（覆盖 / 叠加 / 报错），决定能否“内联在 Think 行下方”。ui-slots README 只提到 `ChainSelect` 按 priority 升序选第一个非 null。

## 4. 参考实现：`dsh-think-translate` 1.2.12

- 包声明：`dsh.bundle.patch` + `dsh.client`（`platform: web`、`external: ['@deepseek-ai/dsh-client-ui-primitives']`、`immediately: true`）；不注入 cordis 服务，只绑 `slots`。
- 架构：浏览器 → 同源 `POST /_xlate/translate` → host provider 链（google / bing / ollama / openai / anthropic，可拖拽排序）→ 失败返回原文。
- client 侧：段落→句子分批、代码段剔除、LRU + localStorage、设置页 provider 管理、8 语言 UI。
- 兼容：README 明示 DSH 0.2.0-rc.2 需 ≥ 1.2.5；1.2.6 修 reasoning/response 分组重复；1.2.10 起自动发现 DSH 已配 provider（从 profile 的 `cordis.patch.yml` 读 `llm-pi-ai.providers`，密钥从 `~/.dsh/.credentials.yaml` 运行期解析）。
- 启示：先做 host 路由 + 最小 UI，再补设置页；剔除与分批是质量关键。

## 5. 官方实验插件（当前不可用）

- 包名：`@deepseek-ai/dsh-experimental-client-ui-cot-translation`
- 描述：*Optional machine translation of expanded reasoning, preserving original Session text*
- dist-tags：`latest 0.2.1-alpha.2`、`alpha 0.2.1-alpha.5`、`next 0.2.1-rc.2`
- peer：`@deepseek-ai/dsh-session 0.2.1-alpha.2`、`@deepseek-ai/dsh-experimental-translator 0.2.1-alpha.2`、`cordis ~4.0.5-alpha.1`
- 结论：需要 0.2.1 运行时；等桌面端升级后再评估，届时可对比自研实现。

## 6. 本地翻译模型（2026-10 现状）

| 模型 | 参数 | 语言 | 许可 | 备注 |
|---|---|---|---|---|
| **腾讯 Hy-MT2** | 1.8B / 7B / 30B-A3B(MoE) | 33（含简繁、粤语） | HF 标 Apache-2.0 | 2026-05 开源；宣称 7B/30B 快思考模式超过 DeepSeek-V4-Pro、Kimi K2.6；1.8B 超过微软/豆包商用 API；有 IFMTBench 指令遵循评测 |
| 腾讯 HY-MT1.5 | 1.8B / 7B | 33 | — | 2025-12 发布，上一代 |
| Google TranslateGemma | 4B / 12B / 27B | 55 | Gemma 许可 | 2026-01 发布；Ollama 官方库收录（2.7M 下载） |
| 通用模型（Qwen / Gemma 等） | — | — | — | 同尺寸翻译质量低于专用 MT 模型 |

Ollama 现成标签（已核实）：

- `kaelri/hy-mt2:1.8b`（1.5GB Q6_K）、`kaelri/hy-mt2:7b`（6.2GB Q6_K）
- 另有 `:1.8b-q4_K_M`、`:7b-q4_K_M`、`:1.8b-q8_0`、`:7b-q8_0`
- 包装者说明了模板选择，并对 1.8B 做过 FLORES 中英 COMET 0.8954 的模板对比

**坑**

- 官方 1.25bit GGUF 依赖 llama.cpp PR #22836（STQ 内核），2026-10-19 仍 open → 不要用。
- Hy-MT2 是翻译专用模型，**复杂指令遵循一般**；提示词要短而明确（“只输出译文，不要解释”）。
- 官方推荐采样参数：temperature 0.7 / top_p 0.6 / top_k 20 / repeat_penalty 1.05（1.8B 与 7B）；模型没有默认 system prompt。

## 7. 硬件兼容建议

本地推理需要根据模型体积、可用显存及指令集选择配置。缺少 AVX / AVX2 / F16C 的低功耗设备不适合作为本插件的推理后端。性能与实际负载有关，应在目标设备自行验证。

## 8. 待办调研

1. `ChatNodeStore` / `turnDataSource` 的公开 API 形状（读节点、订阅增量、hidden 节点）。
2. `conversation.chat.node` 同名 key 的注册语义 → 决定内联还是浮层。
3. 0.2.0-rc.2 下 client 插件能否注册 `settings.general.item`（设置页条目）。
4. Ollama 在本机由插件拉起的可行性（第三方 README 称支持 Windows 自动安装），以及 `OLLAMA_KEEP_ALIVE` 的暴露方式。
5. 是否需要 `dsh.client.external`（若用到 ui-primitives 之外的非基线模块）。
