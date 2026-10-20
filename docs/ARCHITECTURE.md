# 架构（目标设计与实现进度）

## 实现进度（2026-10-19）

| 板块 | 状态 | 落地文件 |
|---|---|---|
| host 路由 + provider 链 + 缓存 | ✅ M2 | `src/index.ts`、`src/host/*` |
| client 取数 + 剔除/分批/拼回 + 请求 | ✅ M3 | `src/client/{strip,translate,text}.ts` |
| **展开思考时就地双栏对照（DOM 注入）** | ✅ M1b | `src/client/{attach,bilingual,styles}.ts` |
| 设置页 / provider 排序 UI | ⬜ M4 | — |

渲染落点（ADR-014）：**展开 Think 行时就地注入**双语面板 —— 槽位做不到这件事
（`conversation.chat.node` 是 keyed，注册 `assistant-step` 等于替换官方渲染器），
因此改为观察 shell 自己渲染的展开态思考块，往它的 DOM 里插面板。

## 总览

```
浏览器（client 半）                              DSH host（host 半，同进程）
┌──────────────────────────────┐                ┌────────────────────────────────┐
│ turnTail 槽位 + turnDataSource │                │ 路由（同源，无 CORS）           │
│ 取 assistant-step 的 reasoning│  POST /_cotx/  │   POST /_cotx/translate         │
│ 剔除代码/路径/URL             │ ─────────────▶ │   GET  /_cotx/providers         │
│ 段落→句子分批                 │                │   GET  /_cotx/models            │
│ 渲染译文（内联/浮层/尾部）    │ ◀───────────── │ provider 链（用户可排序）       │
│ 设置页 / localStorage 缓存    │  translations  │  1) 本地 llama.cpp（Hy-MT2）    │
└──────────────────────────────┘                │  2) OpenAI 兼容端点（可选）     │
                                                 │  3) 免费 Google / Bing          │
                                                 │ LRU 缓存 + 30s 负缓存 + 超时    │
                                                 └────────────────────────────────┘
```

## host 半（`src/index.ts`）

**职责**：provider 适配、排序与回退、缓存、超时；不关心 UI。

- **路由**（exact，同源）
  - `POST /_cotx/translate` `{ target?, segments }` → `{ translations, provider }`
  - `GET /_cotx/providers` → 当前链与各自可用性（不含密钥、不含原文）
  - `GET /_cotx/models` → 本地运行时里已有的模型名（llama.cpp `/v1/models` 或 Ollama `/api/tags`）
- `GET /_cotx/state` → 设置 + 模型目录状态 + 下载进度（设置页用）
- `POST /_cotx/settings` → 改设置，立即重建翻译链（改模型会停掉旧的 llama-server）
- `POST /_cotx/models/download | /models/delete` → 下载/更新/删除模型（自带模型不可删）
- `POST /_cotx/selftest` → 固定样本速度自测；`POST /_cotx/restart` → 重启本地服务
- 编排层：`control.ts`（设置、模型、自测），HTTP 只做校验与调度

设置持久化：`~/.dsh/cot-translate/settings.json`（`COTX_HOME` 可覆盖）；
模型：自带在 `<插件根>/models/`（gitignore），下载的在 `~/.dsh/cot-translate/models/`。
- **请求边界**：`connection.requestRejection` 做 trust fence；body ≤ 64KB；段数 1..64；
  单段 ≤ 4000 字符；单批 ≤ 16000 字符；空段/非字符串/坏 JSON 一律 400。
- **provider 统一接口**（`src/host/providers.ts`）
  - `translate(segments, target, signal, fetch) => string[]`：逐段翻译，段数与输入必须等长；
  - `probe(signal, fetch)`：可用性探测；`listModels?`：可选。
  - `llamacpp`（默认）：`POST {baseURL}/v1/chat/completions`（llama-server 的 OpenAI 兼容接口），
    探活 `/health`；服务未启动时按需拉起
    `llama-server -m <gguf> --host --port -c -ngl --jinja --no-webui`（免安装、无 GUI，`llamacpp.autostart` 可关）；
    模型从 `~/models/*.gguf` 自动发现（优先 hy-mt2 + Q4_K_M）。
  - `ollama`（可选，默认禁用）：`POST {baseURL}/api/chat`，模型名 `auto` 从 `/api/tags` 挑；
    采样参数按官方建议（temp 0.7 / top_p 0.6 / top_k 20 / repeat_penalty 1.05）。
  - `google`：`translate_a/single` 免费接口，最后兜底，可配置关闭。
  - `openai` / `anthropic`：暂未实现（M4 之后按需）。
- **配置**（`src/host/config.ts` 纯函数归一化，不引入 schemastery，见 ADR-012）
  - `enabled`、`target`（默认 `zh-Hans`）、`timeoutMs`、`cacheSize`、`negativeTtlMs`
  - `chain`：provider id 顺序（默认 `['llamacpp','google']`；可插入 `ollama`）
  - `llamacpp.{baseURL,bin,modelPath,gpuLayers,ctxSize,autostart,enabled}`
  - `ollama.{baseURL,model,keepAlive,autostart,bin,enabled}`（可选）、`google.{endpoint,enabled}`
  - 写错的值一律回退默认，插件不会因配置语法挂不上
- **i18n**（ADR-022）
  - 字典：`src/client/locales/<locale>.json`，`zh.json` 权威、`en.json` 必须一致；
  - shell 只自带 zh/en，其余语言用 `ctx.locale.addLanguage()` 注册（fallback 链到 en）；
  - host 只返回 `labelKey` / `noteKey` / `errorCode`，客户端渲染；切换语言即时刷新
    （订阅 `locale/change`，面板重建、设置页重渲染）；
  - 数字/容量用 `Intl.NumberFormat(当前语言)`；`npm run i18n:status` 看翻译进度。
- **缓存**（三层：磁盘 → 内存 → provider）
  - 磁盘：`~/.dsh/cot-translate/cache/`，键 `sha256(target+原文)`，文件只存译文；
    上限 50MB，超限按 mtime 淘汰最旧；启动扫目录建索引（ADR-019）
  - 内存 LRU ≈ 600 条：`target + 原文 → translation`
  - 失败负缓存 30 秒（避免重试风暴）
- **失败语义**：逐个 provider 尝试；单个失败降级；全失败 → `translations` 全空串，
  由 client 端显示原文（fail-open），并暴露 `provider: ""` 便于 UI 提示。
  日志只记 provider / 段数 / 字符数 / 耗时。

## client 半（`src/client/index.ts`）

**职责**：取文本、剔除、分批、发请求、渲染。

- **数据源**：展开态思考块由 `MutationObserver` 发现（`[data-variant="think"][data-expanded]`）；
  原文优先从数据层取 —— `[data-chat-node-key]` + `[data-conversation-session]` 定位节点，
  再用 `ChatNodeStore.source(key)` 取第 N 个 reasoning 块的 `text`；拿不到才退回 DOM `textContent`。
- **剔除规则**（`src/client/strip.ts`，ADR-013）：围栏代码块、行内代码、URL、Windows/POSIX
  路径、`fn()` 调用。**分段保留**而不是占位符 —— 技术片段整段留在原位，只把自然语言片段送翻。
- **分批**：句子块 ≤ 240 字符；每请求 ≤ 8 块、≤ 1200 字符；失败整段退回原文（不做半成功）。
- **渲染方案**（ADR-014）：把双语面板**插进 shell 的思考正文容器**，再给容器打
  `data-cot-bilingual` 由 CSS 隐藏原来的纯文本渲染。
  - 每行两列：左原文（代码 `<pre>` / 行内代码 `<code>` 等宽）、右译文；
  - 行悬停/聚焦整行高亮 —— 纯 CSS，左右天然同时亮；
  - 窄容器（`@container max-width: 520px`）退化为上下堆叠；
  - 折叠/重渲染时面板与标记一起移除，shell 原文自动恢复。
  - **逐段出译文**：每个段落单独发一次翻译请求（最多 2 个并发），谁先回来谁先填右栏，
    不等整段思考全部翻完；host 侧对一次请求内的多段也并发（2 路）。
  - **流式节流**：进行中的思考块最后一段还在增长，面板等它 400ms 没再变化才送翻
    （`tailSettleMs`），否则每个 token 都会打一次模型；流式结束后新段落立即送翻。
- **缓存**：client 进程内 500 条 + host LRU 双层；`localStorage` 持久化留到 M3 收尾。
- **设置入口**：`settings.general.item`（M4）。

## 翻译流水线

```
节点变化 → 取 reasoning 文本 → 计算内容哈希
  → 命中本地缓存？→ 直接渲染
  → 否则剔除 + 分批 → POST /_cotx/translate
  → 成功：渲染译文并写缓存
  → 失败：渲染原文 + 30s 后重试标记
```

## 版本与兼容

- 目标：dsh `0.2.0-rc.2` + cordis `4.0.4`；用到的槽位名与节点 kind 都来自该版本 bundle 的实测提取。
- 升级桌面端时：重新提取槽位表、验证 `ChatNodeStore` API、更新 `peerDependencies`。
- 若官方 0.2.1 的 `dsh-experimental-client-ui-cot-translation` 可用，优先评估替换自研（见 DECISIONS ADR-003）。

## 失败模式

| 场景 | 行为 |
|---|---|
| Ollama 未安装 / 未启动 | 插件按链尝试下一档；UI 提示“本地模型不可用” |
| 模型加载慢（首次 2–4s） | 请求超时放宽；加载期间 UI 显示“翻译中” |
| 本地推理卡死 | 单批超时后该 provider 记为失败，本批走下一档 |
| 全部 provider 失败 | 显示原文，30 秒后自动重试 |
| reasoning 含大量代码 | 剔除后可能只剩短句或空 → 不送翻，直接显示原文 |
| 会话切换/滚动 | 已翻内容走缓存，不重复请求；未展开的历史按懒加载处理 |

## 隐私

- 译文只在浏览器内显示，不写回会话、不进模型上下文。
- 服务端不记录原文（日志只记批次大小/耗时/provider）。
- 密钥运行期从环境变量或 `~/.dsh/.credentials.yaml` 解析，配置里只有引用名。
