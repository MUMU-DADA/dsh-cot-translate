# 架构（目标设计与实现进度）

## 实现进度（2026-10-19）

| 板块 | 状态 | 落地文件 |
|---|---|---|
| host 路由 + provider 链 + 缓存 | ✅ M2 | `src/index.ts`、`src/host/*` |
| client 取数 + 剔除/分批/拼回 + 回合卡片 | ✅ M1a/M3 | `src/client/*` |
| 实时形态（进行中的回合） | ⬜ M1b | — |
| 设置页 / provider 排序 UI | ⬜ M4 | — |

渲染落点已由 ADR-011 定为 `conversation.chat.turnTail`（回合底部卡片），**不是**下面的
“内联在 Think 行下方”—— 内联需要替换官方 `assistant-step` 渲染器，已否决。

## 总览

```
浏览器（client 半）                              DSH host（host 半，同进程）
┌──────────────────────────────┐                ┌────────────────────────────────┐
│ turnTail 槽位 + turnDataSource │                │ 路由（同源，无 CORS）           │
│ 取 assistant-step 的 reasoning│  POST /_cotx/  │   POST /_cotx/translate         │
│ 剔除代码/路径/URL             │ ─────────────▶ │   GET  /_cotx/providers         │
│ 段落→句子分批                 │                │   GET  /_cotx/models            │
│ 渲染译文（内联/浮层/尾部）    │ ◀───────────── │ provider 链（用户可排序）       │
│ 设置页 / localStorage 缓存    │  translations  │  1) 本地 Ollama（Hy-MT2）       │
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
  - `GET /_cotx/models` → 本地 Ollama 模型列表
- **请求边界**：`connection.requestRejection` 做 trust fence；body ≤ 64KB；段数 1..64；
  单段 ≤ 4000 字符；单批 ≤ 16000 字符；空段/非字符串/坏 JSON 一律 400。
- **provider 统一接口**（`src/host/providers.ts`）
  - `translate(segments, target, signal, fetch) => string[]`：逐段翻译，段数与输入必须等长；
  - `probe(signal, fetch)`：可用性探测；`listModels?`：可选。
  - `ollama`：`POST {baseURL}/api/chat`，`stream: false`，模型如 `kaelri/hy-mt2:7b-q4_K_M`；
    采样参数按官方建议（temp 0.7 / top_p 0.6 / top_k 20 / repeat_penalty 1.05）；
    可选 `keep_alive` 透传给 Ollama。
  - `google`：`translate_a/single` 免费接口，最后兜底，可配置关闭。
  - `openai` / `anthropic`：暂未实现（M4 之后按需）。
- **配置**（`src/host/config.ts` 纯函数归一化，不引入 schemastery，见 ADR-012）
  - `enabled`、`target`（默认 `zh-Hans`）、`timeoutMs`、`cacheSize`、`negativeTtlMs`
  - `chain`：provider id 顺序（默认 `['ollama','google']`）
  - `ollama.{baseURL,model,keepAlive,enabled}`、`google.{endpoint,enabled}`
  - 写错的值一律回退默认，插件不会因配置语法挂不上
- **缓存**
  - LRU ≈ 600 条：`hash(target + text) → translation`（进程内，不落盘）
  - 失败负缓存 30 秒（避免重试风暴）
- **失败语义**：逐个 provider 尝试；单个失败降级；全失败 → `translations` 全空串，
  由 client 端显示原文（fail-open），并暴露 `provider: ""` 便于 UI 提示。
  日志只记 provider / 段数 / 字符数 / 耗时。

## client 半（`src/client/index.ts`）

**职责**：取文本、剔除、分批、发请求、渲染。

- **数据源**：`conversation.chat.turnTail` 槽位（list，session 作用域）+ `inject` 里的
  `keyedHooks.cotSteps(turnKey)` → `ChatNodeStore.turnDataSource(turn, "assistant-step")`，
  含隐藏节点、按 anchor 顺序。见 RESEARCH §3.3。
- **剔除规则**（`src/client/strip.ts`，ADR-013）：围栏代码块、行内代码、URL、Windows/POSIX
  路径、`fn()` 调用。**分段保留**而不是占位符 —— 技术片段整段留在原位，只把自然语言片段送翻。
- **分批**：句子块 ≤ 240 字符；每请求 ≤ 8 块、≤ 1200 字符；失败整段退回原文（不做半成功）。
- **渲染方案**（ADR-011）
  1. ✅ 回合尾部 `conversation.chat.turnTail` 折叠卡片（已实现，默认折叠 2 段，可展开）；
  2. ⬜ `shell.overlay` 浮窗 → 实时形态（M1b）；
  3. ⬜ 右侧面板 `sidebar.right.pane.tab`（整段会话译文视图，M4 之后）。
  内联在 Think 行下方**不可行**：`conversation.chat.node` 是 keyed，换 key 等于换掉官方渲染器。
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
