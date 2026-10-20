# 架构设计说明（Architecture Overview）

本文档用直白的语言介绍 `dsh-cot-translate` 的内部结构、数据流向以及隐私安全设计（文末附英文摘要 / English summary included below）。

---

## 1. 模块一览与完成状态

| 模块 | 状态 | 对应源码 | 作用 |
|---|---|---|---|
| **双语对照面板** | ✅ 已完成 | `src/client/{attach,bilingual,styles,text}.ts` | 监听展开的 `Think` 思考块，就地插入“左原文、右译文”双栏面板 |
| **代码保护与分批** | ✅ 已完成 | `src/client/{strip,translate}.ts` | 在浏览器端把代码块、路径、URL、函数名原样分离，只把自然语言分段送翻 |
| **设置页与模型管理** | ✅ 已完成 | `src/client/{settings-view,prefs}.ts`、`src/host/{control,settings,models}.ts` | 提供开关、时机、33+ 目标语言、模型下载/更新/删除、端口配置、缓存清理与速度自测 |
| **服务端翻译链与缓存** | ✅ 已完成 | `src/index.ts`、`src/host/{chain,providers,runtime,cache,persistent-cache,routes}.ts` | 按优先级调用会话模型 / 本地 `llama-server`；免费 Google 仅在显式开启在线翻译后作为兜底；提供内存 + 50MB 磁盘缓存 |
| **多语言界面（i18n）** | ✅ 已完成 | `src/client/locales/*.json`、`src/client/locales/index.ts` | 内置简中、英、繁中、日、韩、法、德、西、俄 9 种界面语言，随 DSH 语言设置实时切换 |

---

## 2. 整体工作流

插件分为两部分，运行在同一个 DSH Desktop 应用内：
- **浏览器端（Client）**：运行在 DSH 聊天界面里，负责监听思考块展开、保护代码片段、渲染双语对照面板和设置页。
- **服务端（Host）**：运行在 DSH 的本地 Node 进程里，负责管理本地 `llama-server` 进程、下载模型、读写设置与磁盘缓存、按顺序请求翻译源。

```text
浏览器界面（Client）                                本地服务端（Host，同源 HTTP）
┌──────────────────────────────────┐              ┌────────────────────────────────────┐
│ 1. MutationObserver 监听展开思考块 │              │ 同源路由 /_cotx/*（拒绝非本机请求） │
│ 2. 从 ChatNodeStore 读取原始文本  │ POST /_cotx/ │   ├─ POST /_cotx/translate         │
│ 3. 分离代码块/路径/URL（原样保留）│ ───────────▶ │   ├─ GET/POST /_cotx/state|settings│
│ 4. 按段落并发请求（最多 2 路并发）│              │   └─ POST /_cotx/models/* | cache/*│
│ 5. 谁先返回先填右栏 + 悬停联动高亮│ ◀─────────── │ 缓存与翻译链：                     │
│ 6. 设置页（settings.section 槽位）│  返回各段译文 │   内存 LRU (600条) → 磁盘缓存(50MB)│
└──────────────────────────────────┘              │   → [可选] 当前对话 API 模型       │
                                                   │   → 本地 llama-server (Hy-MT2)     │
                                                   │   → [显式开启] 免费 Google 兜底    │
                                                   └────────────────────────────────────┘
```

---

## 3. 核心设计细节（为什么这么做？）

### 3.1 为什么用 DOM 注入，而不是替换 DSH 的聊天节点槽位？
DSH 的 `conversation.chat.node` 是一个“按键替换（keyed）”槽位：如果插件注册 `assistant-step`，就会把官方整个回答渲染器（包含 Markdown、图片、工具调用、折叠动画）全部顶掉，一旦 DSH 升级就会坏（详见 [ADR-011](DECISIONS.md)、[ADR-014](DECISIONS.md)）。
因此，插件选择**不替换官方渲染器**，而是用 `MutationObserver` 观察已经展开的思考块（`[data-variant="think"][data-expanded]`），把双语面板插进思考正文容器里：
- **原文取自数据层**：优先通过 `ChatNodeStore.source(key)` 读取原始 Markdown 文本（保留 ` ``` ` 代码围栏符号，确保代码剥离器准确识别），拿不到时才回退读 DOM 文本。
- **安全退化**：只有面板成功挂载时才通过 `data-cot-bilingual` 隐藏原纯文本；折叠或卸载时面板与标记同时移除，原文立刻恢复。

### 3.2 代码与技术内容是怎么做到“一字不改”的？
很多翻译工具把代码替换成 `<0>`、`⟦1⟧` 这样的占位符再送给模型，但小尺寸翻译模型很容易把占位符吞掉或改写，导致还原出来的代码损坏。
本插件在 `src/client/strip.ts` 中采用**分段原位保留**（[ADR-013](DECISIONS.md)）：
1. 先用正则识别围栏代码块、行内反引号代码、URL、Windows/POSIX 文件路径和 `fn()` 函数调用，标记为“原样保留片段”。
2. 只把中间的自然语言片段提取出来送去翻译。
3. 翻译回来后按原顺序直接拼回——技术片段从头到尾没有进过翻译模型，因此 100% 逐字不变。

### 3.3 逐段显示与流式防抖
- **逐段并发**：一篇思考往往有好几段。面板把每一段作为独立请求发出（同时最多 2 个并发），哪一段先翻好就先在右栏显示哪一段，不用干等整篇翻完。
- **流式尾巴稳定窗口（400ms）**：模型正在输出思考时，最后一段每个 token 都在变。面板会等最后一段停止增长满 `400ms` 后才送翻，避免每蹦一个词就打一次本地模型。

### 3.4 三层缓存与隐私保护
1. **浏览器内存缓存（500 条）**：同一会话内反复展开/折叠思考块，直接 0ms 渲染。
2. **服务端内存 LRU（600 条）** + **30 秒失败冷却缓存**：避免某个翻译源挂掉时疯狂重试。
3. **本地磁盘缓存（上限 50MB，`~/.dsh/cot-translate/cache/`）**：
   - 以 `sha256(目标语言 + "\0" + 原文)` 作为文件名，文件内**只存译文，不落盘原文**（防止思考中包含的敏感片段明文留在缓存目录里，见 [ADR-007](DECISIONS.md)、[ADR-019](DECISIONS.md)）。
   - 超出 50MB 时按修改时间自动清理最旧条目到 90% 水位，也可在设置页一键清空。

### 3.5 本地 `llama-server` 按需拉起与端口管理
- 默认监听 `127.0.0.1:28457`（避开 8080 等常用端口，可在设置页随时修改并探测端口占用状态，见 [ADR-021](DECISIONS.md)）。
- 当需要翻译且探测到本地端口未就绪时，插件自动以无窗口模式（detached、`--no-webui`、`--jinja`）启动 `llama-server`。
- 在设置页切换模型或修改端口时，插件会自动停掉自己之前拉起的 `llama-server` 实例，下次翻译时按新配置重新拉起。

---

## 4. English Architecture Summary

`dsh-cot-translate` is split into two halves running inside DSH Desktop:

1. **Client Half (`src/client/`)**:
   - Watches expanded `Think` blocks (`[data-variant="think"][data-expanded]`) via `MutationObserver` and injects a side-by-side bilingual DOM panel without replacing DSH's native `assistant-step` renderer ([ADR-014](DECISIONS.md)).
   - Reads raw Markdown from `ChatNodeStore.source(key)` so fenced code blocks retain backticks, then splits text into **kept technical spans** (code, paths, URLs, `fn()`) and **translatable natural-language spans** ([ADR-013](DECISIONS.md)).
   - Translates paragraph by paragraph (up to 2 concurrent requests) and debounces the active streaming tail by `400ms`.
   - Registers the `Settings → Chain-of-thought translation` page (`settings.section` slot) and 9 UI locales (`zh`, `en`, `zh-Hant`, `ja`, `ko`, `fr`, `de`, `es`, `ru`).
2. **Host Half (`src/host/`)**:
   - Exposes same-origin loopback routes under `/_cotx/*` protected by `connection.requestRejection`.
   - Orchestrates the translation provider chain: optional active conversation API model (`ctx.llm.stream`) → local `llama.cpp` `llama-server` (auto-started headlessly on port `28457` with Tencent **Hy-MT2** GGUF models) → optional Ollama → free Google Translate fallback.
   - Provides a two-tier host cache: in-memory LRU (600 entries, plus 30s negative cache) backed by a 50 MB disk cache (`~/.dsh/cot-translate/cache/`) keyed by `sha256(target + "\0" + source)` that **stores translations only, never source text**.
