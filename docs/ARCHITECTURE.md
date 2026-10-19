# 架构（目标设计，当前未实现）

## 总览

```
浏览器（client 半）                              DSH host（host 半，同进程）
┌──────────────────────────────┐                ┌────────────────────────────────┐
│ 订阅 conversation.chat.node   │                │ 路由（同源，无 CORS）           │
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

- **路由**
  - `POST /_cotx/translate` `{ target, segments }` → `{ translations, provider }`
  - `GET /_cotx/providers` → 当前链与各自可用性（不含密钥）
  - `GET /_cotx/models` → 本地 Ollama 模型列表（M2 起）
- **provider 统一接口**（每个适配器实现 `translate(segments, target) => string[]`）
  - `ollama`：`POST {baseURL}/api/chat`，`stream: false`，模型如 `kaelri/hy-mt2:7b-q4_K_M`；
    采样参数按官方建议（temp 0.7 / top_p 0.6 / top_k 20 / repeat_penalty 1.05）
  - `openai`：任意 `/v1/chat/completions`（含本机聚合 API）
  - `anthropic`：`/v1/messages`（可选，M4 之后）
  - `google` / `bing`：免费接口，作为最后一档
- **配置**（schemastery 定义，设置在 profile 里持久化）
  - `target`（默认 `zh-Hans`）、`enabled`、`timing`
  - `chain`：provider id 顺序
  - `providers[]`：`kind` / `baseURL` / `model` / `apiKeyRef`（只存引用名，不存密钥）
  - `timeoutMs`、`keepAlive`（透传给 Ollama 的驻留时间）
- **缓存**
  - LRU ≈ 600 条：`hash(target + text) → translation`
  - 失败负缓存 30 秒（避免重试风暴）
  - 服务端不落盘原文
- **失败语义**：逐个 provider 尝试；单个失败降级；全失败 → `translations` 全空串，
  由 client 端显示原文（fail-open），并暴露 `provider: ""` 便于 UI 提示。

## client 半（`src/client/index.ts`）

**职责**：取文本、剔除、分批、发请求、渲染、设置与本地缓存。

- **数据源**：`conversation.chat.node` 的 `assistant-step` 节点（或 `ChatNodeStore.turnDataSource`
  按回合订阅），取 `groupPart === 'reasoning'` 的块；展开折叠状态由 `ReasoningRow` 管理。
- **剔除规则**（送翻前）：围栏代码块、缩进代码块、行内代码、绝对/相对路径、URL、
  命令行、类/函数/变量标识符、常见 diff/日志块。剔除时记录占位符，翻完按原位置还原。
- **分批**：先按空行切段，再按句号/问号/换行切句；单批目标 ≤ 240 字符；
  流式期间只送“已稳定”的段落（避免反复重送）。
- **渲染方案（按可行性递降）**
  1. Think 行下方内联（若槽位允许同名 key 追加）；
  2. 回合尾部 `conversation.chat.turnTail` 的折叠面板；
  3. `shell.overlay` 浮窗（点 Think 行打开）；
  4. 右侧面板 `sidebar.right.pane.tab`（整段会话翻译视图）。
- **设置入口**：`settings.general.item`，含目标语言、provider 排序/开关、翻译时机、翻译回答开关。
- **本地缓存**：`localStorage` 存偏好与最近 N 条译文；页面重载不重复请求。

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
