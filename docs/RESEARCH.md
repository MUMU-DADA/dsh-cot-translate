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

## 3. 聊天 UI 的扩展点（2026-10-19 二轮核实）

### 3.1 先看哪里：运行时自带一份「插件 API 目录」

`@deepseek-ai/dsh-cordis-client-runner/lib/client.js` 里有一份由源码类型生成的
槽位目录（约 90 条），每条带 `kind` / `scope` / `summary` / `registerOptions` /
`ownerProps`（owner 接口源码）/ `standardProps` / `keyDomain` / `declaredBy` /
`occupants` / `replaceRisk` / `example`。**判断“某槽位能不能挂、挂了会怎样”，
先查这份目录，比读 bundle 猜快得多。** 仓库里的 `scripts/dump-slots.mjs` 就是它的
提取器（`npm run slots [关键词] [--json]`），DSH 升级后重跑即可刷新认知。

槽位名一览（与本项目相关的部分）：

| 槽位 | kind | scope | 用途 |
|---|---|---|---|
| `conversation.chat.node` | keyed | session | **按节点 kind** 渲染一条 Chat 流条目 |
| `conversation.chat.turnTail` | list | session | 已完成回合的操作行之前，产物扩展条目 |
| `conversation.chat.assistant-actions` | list | session | 已落定 assistant 消息的操作 |
| `conversation.view` | list | session | 会话视图（`chat` 就是其中一个） |
| `shell.overlay` | list | root | 全屏浮层 |
| `settings.general.item` | list | root | 设置页「通用」里的一行 |
| `sidebar.right.pane.tab` / `.title` | keyed | session | 右侧面板 Tab |
| `conversation.input.right` | list | session | 输入框工具行右侧按钮 |

### 3.2 `conversation.chat.node` 是 keyed，且键域被 shell 固定 —— 不能追加

- `kind: "keyed"`，`keyDomain` 原文：`fixed by the owner's key table { [Kind in ChatNodeKind]: { node: ChatNode<Kind> } }, already taken: assistant-step, command, …, user, …`。
- `registerOptions.key` 的说明：*“Registering an already-occupied key replaces that occupant”*；`replaceRisk: "shadows-shipped-ui"`。
- 派发点在 `ChatNodeSeat`：`renderSlot("conversation.chat.node", routedOwner, { entryKey: routedNode.kind, hookContext, fallback: JsonBlock })`。

**结论**：想“在 Think 行下面追加一行译文”就得注册 `assistant-step`，那会把官方
`AssistantNodeView`（reasoning 行 + markdown + 图片 + 折叠逻辑）整个换掉，属于
shadow shipped UI。**不做。** 除非将来官方提供 reasoning 级别的子槽位或装饰器。

### 3.3 拿 reasoning 文本的正路：`turnDataSource`

- `MutableChatNodeStore` 公开方法：`get(key)`、`source(key)`、`processSource(key)`、
  `turnDataSource(turn, kind)`、`turnKind(turn, kind)`、`replace(nodes)`、`upsert(nodes)`。
- `turnDataSource(turn, kind)` → `SnapshotSource<readonly ChatNodeData[]>`，即
  `{ getSnapshot(), subscribe(fn) }`；快照是该回合中该 kind 全部节点的 **`node.data`**
  数组，**含隐藏节点**，按 `anchorSeq` 排序（README 明确“source includes hidden Nodes
  and exposes their business data in anchor order”）。
- 官方用法（`ui-plan` 的 `PlanCards`，同款产物扩展）：

```js
ctx.slots.register({
  name: 'conversation.chat.turnTail', id: '@deepseek-ai/dsh-client-ui-plan', locale: NS,
  inject: (sessionId) => {
    const chat = ctx.uiConversation.binding(ctx.sessions.binding(sessionId)).target('chat')
    return { keyedHooks: { plans: (turn) => chat.getSnapshot().nodes.turnDataSource(Number(turn), 'submitted-plan') } }
  },
}, PlanCards)   // 组件里：const plans = usePlans(String(turn.turn))
```

- `turnTail` 的 owner props：`{ turn: TurnLocation, seq: number, openFile }`；标准 props
  含 `useChat` / `useConversation` / `sessionId` / `useProjection` 等；`inject` 返回的
  `hooks` 直接成为组件 props，`keyedHooks` 变成“先传 key 再拿值的钩子”。
- 注意 `turnTail` 只对**已完成回合**渲染（节点 kind 为 `turn-tail`），实时进行中的回合没有。

### 3.4 assistant-step 的业务数据形状

```ts
interface AssistantStepData {
  step?: number                 // 回合内第几次尝试
  status?: 'running' | 'complete' | 'interrupted' | …
  blocks?: Array<
    | { kind: 'reasoning'; text: string }
    | { kind: 'text'; text: string }
    | { kind: 'tool-call'; callId: string; name: string; argsRaw: string }
    | { kind: 'image'; attachment: unknown }
    | { kind: 'other'; block: unknown }
  >
}
```

来源：`toAssistantBlock()` / `emptyAssistantBlock()`；`AssistantNodeView` 的
`data.blocks` 再按 `groupPart`（`reasoning` / `response`）过滤后渲染。

### 3.5 客户端插件契约（实测归纳）

- 模块导出 `name` / `inject`（**cordis 服务名**数组）/ `apply(ctx)`；bundle 外壳仍是
  `window.__ModuleLoader__.load({ id: 包名, factory })`。
- `package.json` 的 `dsh.client`：`{ platform: 'web', inject: [包名…], external: [包名…],
  immediately?: boolean }`；`dsh.client.inject` 是**包名**（加载顺序），`immediately`
  让模块体在启动时执行（否则等到第一次被 import —— 纯槽位注册插件必须设为 `true`）。
- host 半的 Loader 条目扫描 profile 里已启用包的 `dsh.client`，把 `./client` 导出
  作为 `/plugins/<包名>/client.js` 提供给浏览器（`dsh-client-modules`），**插件不用自己造路由**。
- `ctx.effect(() => disposer, 'label')` 注册随卸载清理的副作用；`ctx.locale.register(ns, { zh, en })`；
  `ctx.locale.bind(ns)` 取 `t`；`ctx.slots.inject(name, () => ctx.slots.register(opts, Component))`
  等槽位声明后再注册（返回 disposer）。
- 样式没有构建期 CSS 通道：运行时 `document.createElement('style')` 注入，`ctx.effect` 里移除。

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

已核实（2026-10-19 二轮，见 §3）：

- ✅ `ChatNodeStore.turnDataSource(turn, kind)` 形状与语义；runner 内置槽位目录可查。
- ✅ `conversation.chat.node` 是 keyed 且**替换语义**（`replaceRisk: shadows-shipped-ui`）→ 不内联，见 ADR-011。

仍待确认：

1. `settings.general.item` 条目的注册参数与 `store: defineStore(...)` 用法（M4 设置页要用）。
2. `shell.overlay` 浮层的定位/层级约定（已不需要：渲染走 ADR-014 的 DOM 注入）。
3. ~~Ollama 在本机由插件拉起的可行性~~ → 已核实可行：`spawn(ollama.exe, ['serve'], {detached, stdio:'ignore'})`，
   等 `/api/tags` 就绪；实测（见 §9）。
4. 是否需要 `dsh.client.external`：目前 client bundle 只 require `react`（基线模块，其余零依赖），暂不需要。

---

## 9. 本地模型实测（2026-10-20，本机）

**安装形态**：不再用 Ollama（已卸载：安装器 + 托盘应用，用户不要 GUI 软件）。
改为 **llama.cpp 的 `llama-server.exe`**（官方 release 压缩包，免安装）：

| 项 | 值 |
|---|---|
| 运行时 | llama.cpp `b11750`，**win-vulkan-x64** 构建（zip 35MB / 解压 98.6MB） |
| 位置 | `%USERPROFILE%\tools\llama.cpp\`（解压即用，无注册表、无托盘、无自启） |
| 模型 | `tencent/Hy-MT2-1.8B-GGUF` 的 `Hy-MT2-1.8B-Q4_K_M.gguf`，1080.6MB |
| 模型位置 | `%USERPROFILE%\models\` |
| 启动参数 | `-m <gguf> --host 127.0.0.1 --port 8080 -c 4096 -ngl 99 --jinja --no-webui` |
| 显存 | 约 1.5GB（含 DSH 共 3.6GB / 10.2GB） |
| 接口 | OpenAI 兼容 `POST /v1/chat/completions`；探活 `GET /health` |
| chat 模板 | 模型自带 jinja 模板（`<｜hy_User｜>` / `<｜hy_Assistant｜>`），`--jinja` 直接生效 |

**延迟实测**：

| 场景 | 值 |
|---|---|
| 热调用（单段 ≤100 字符） | **50 ms** |
| 3 段 / 223 字符（服务已加载，首次请求） | 2179 ms（含 Vulkan 管线初始化） |
| 插件拉起服务 + 加载 + 翻译（服务停掉后） | **1661 ms** |

**译文质量（1.8B Q4_K_M）**：

| 原文 | 译文 |
|---|---|
| I should check the repository layout first, then look at the docs before editing anything. | 我应该先检查仓库结构，然后查看文档，再编辑任何内容。 |
| The failing test is caused by a stale lockfile, so regenerating it should fix the issue. | 失败的测试是由过期的锁文件引起的，重新生成它应该可以解决问题。 |
| Run `npm test` before touching the host half. | 在接触主机之前运行 `npm test`。 |

观察：流畅、术语基本正确，`host half` 这类自造词会被直译（可接受）；
行内代码被完整保留（剔除器的分段保留生效）。

**坑**

- `llama-server` 默认端口是 **9931**，不是 8080；默认还会起自带 Web UI，无 GUI 需求下必须加 `--no-webui`。
- Vulkan 构建不需要 CUDA 运行时（比 CUDA 构建省 632MB 下载），10GB 级 NVIDIA 独显 实测够快。
- 首次把 1GB 模型从磁盘读进来可能要几十秒（页缓存冷 + Defender 实时扫描），之后就正常。

**换更大模型**：`tencent/Hy-MT2-7B-GGUF` 的 Q4_K_M 约 4.5GB，放 `~/models` 即可，
插件按文件名偏好（hy-mt2 → Q4_K_M）自动选，不用改代码。
## 10. 设置页与「用对话模型翻译」的宿主事实（2026-10-20 实测）

| 事实 | 取值/结论 |
|---|---|
| 设置页槽位 | `settings.section`（**list**，root 作用域）；注册项 `{ name, id, order, label: () => t(...), locale }` |
| 设置页组件 props | 宿主给 `close()`；注册时 `inject: () => ({...})` 的返回值合并进 props（客户端本地化用 `locale` + `ctx.locale.bind(ns)`） |
| 设置页入口 | `settings.section` 由 `client-ui-settings-general` 的 `sidebar.settings` 条目声明；插件用 `ctx.slots.inject('settings.section', ...)` 注册 |
| 宿主 LLM 入口 | `ctx.llm.stream({ provider, model, messages, system, maxTokens, sessionId?, purpose?, signal })`，逐块产出 `text-delta`（`chunk.text`）与 `finish`（`chunk.reason.kind`） |
| 消息构造 | `@deepseek-ai/dsh-llm` 的 `createUserMessage({ content: [{type:'text', text}], source })`；宿主包在运行时解析，插件里用**变量**做动态 import，构建期不绑死 |
| 会话当前模型 | `sessions` 服务的 `get(sessionId)` → `session.requestHeader()?.config` 里有上一次请求的 `{ provider, model }`（会话不存在/未请求过时为 undefined） |
| 服务访问 | cordis 服务同时可通过 `ctx.<name>` 或 `ctx.get('<name>')` 拿到（本插件两个入口都试） |
| 插件数据目录 | `~/.dsh/cot-translate/`（`COTX_HOME` 可覆盖，测试用） |

**踩坑**

- `llama-server` 默认端口 9931、默认开 Web UI，自启必须显式 `--port` + `--no-webui`。
- 停本地服务只能停**本进程 spawn 的** pid；用户手动起的实例不跟踪（重启/换模型后靠探活复用）。
- 设置页里 React 由 shell 的 PLATFORM_MODULES 提供，bundle 必须 external `react` / `react/jsx-runtime`。
**服务就绪时机**：host 插件加载时 `llm` / `sessions` 可能还没就绪（按 profile 里插件顺序）。正确姿势是 `ctx.inject(['llm','sessions'], (services) => ...)` 回调里再取；直接读 `ctx.llm` 在未 inject 时可能抛错，读取要包 try/catch（本插件两个入口都试）。
