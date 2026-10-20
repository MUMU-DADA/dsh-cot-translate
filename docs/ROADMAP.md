# 路线图

> 每个里程碑都要能独立验收；完成一项就把状态改掉。

## M0 脚手架 + 决策记录 ✅（2026-10-19）

- 目录结构、`package.json`（`dsh.bundle.patch` + `dsh.client`）、`cordis.patch.yml`、esbuild 构建脚本
- `docs/` 下的决策、调研、架构、路线图
- 仓库初始化（git）

**验收**：`npm run build` 能产出 `lib/index.js` 与 `lib/client.js`（骨架代码可打包）。

## M1a 可行性 spike：拿到 reasoning 文本 + 定下渲染位置 🟡（代码完成，待真机验收）

- ✅ 核实 `ChatNodeStore.turnDataSource(turn, kind)`：返回可订阅源，含隐藏节点，按 anchor 顺序给业务数据
- ✅ 核实 `conversation.chat.node` 同名 key 语义 = **替换**（keyed，`shadows-shipped-ui`）→ 不内联，见 DECISIONS ADR-011
- ✅ 改用 `conversation.chat.turnTail` 注册回合译文卡片（`lib/client.js`，占位文案）
- ✅ `test/client-card.test.mjs` 冒烟：bundle 外壳、apply 注册、hook 取数、卡片渲染 4 项全绿
- ✅ 装进 web profile（`dsh plugin --profile web add <本仓库>`，pnpm link）
- ⬜ **完整重启桌面端**后在真实会话里验收（重启会中断当前会话，留给用户操作）

**验收**：真实会话里，已完成回合底部出现 `.cot-translation` 卡片，摘要显示 reasoning 段数与字数；
展开后显示中文译文（本地模型不可用时显示“翻译不可用，先看原文”）；刷新后仍在。

## M1b 实时形态：让进行中的回合也有译文

`turnTail` 只在回合完成后渲染。实时需要另一条订阅路径（`useChat` 快照或直接订阅节点源），落点二选一：

- `shell.overlay` 浮层：贴着当前回合显示，最接近“叠加显示”，但要处理定位与滚动
- `sidebar.right.pane.tab` 右侧译文面板：稳、可长时间阅读，但不是“旁边”

**验收**：模型流式输出途中，界面上的中文译文随之分批出现；关闭后无残留。

## M2 host 翻译接口 + 本地 Ollama provider ✅（2026-10-19，代码与测试完成）

- ✅ `POST /_cotx/translate`：入参校验（≤64 段 / ≤4000 字/段 / ≤16000 字总量 / 64KB body）、
  单 provider 超时、LRU 600、30 秒负缓存、fail-open（全挂 → 空译文 + 200，不 5xx）
- ✅ `ollama` 适配器：`/api/chat`，`kaelri/hy-mt2:7b-q4_K_M`，官方采样参数，可选 `keep_alive`
- ✅ `GET /_cotx/providers`（链 + 各档可用性，探测 `/api/tags`）、`GET /_cotx/models`
- ✅ `google` 免费接口兜底（可在配置里关掉）
- ✅ trust fence：`connection.requestRejection`，同源/本机之外的请求直接拒
- ✅ 日志只记 provider / 段数 / 字符数 / 耗时，不记原文
- ✅ 测试：provider 请求体、链降级、负缓存、校验、路由状态码、**真 HTTP + 假 Ollama 端到端**

**验收方式**：`npm test`（26 项全绿）。真机验证要等重启桌面端后 `curl 127.0.0.1:<port>/_cotx/providers`。
**注意**：本机目前**没有安装 Ollama**，所以现在只有 google 兜底或 fail-open；装好 Ollama 并
`ollama pull kaelri/hy-mt2:7b-q4_K_M` 后才会走本地模型。

## M3 client 翻译流水线 🟡（核心已可用，实时增量未做）

- ✅ 剔除器：围栏/行内代码、URL、Windows/POSIX 路径、`fn()` 调用 —— **分段保留**而非占位符，
  拼回时逐字还原（`src/client/strip.ts`）
- ✅ 段落→句子分批：≤240 字符/块、≤8 块/请求、≤1200 字符/请求
- ✅ client 进程内缓存（500 条）+ host LRU 双层；同文本重渲染不重复请求
- ✅ fail-open：任一请求失败整段退回原文，不出现半中半英
- ⬜ 流式增量：只送“新增且已稳定”的前缀（等 M1b 的实时形态一起做）
- ⬜ localStorage 持久缓存（刷新后仍免请求）

**验收**：已由 `test/client-pipeline.test.mjs` 覆盖切分/分批/拼回/失败退化；真实长思考的
逐批出现要等 M1b 的实时形态。

## M4 设置页 + provider 链

- `settings.general.item` 条目：目标语言、provider 排序/开关、翻译时机、是否翻回答
- 免费 Google/Bing 适配器作为最后兜底
- 可选：OpenAI 兼容端点（本机聚合 API）

**验收**：改设置立即生效并持久化；禁用本地后自动走免费源；中文界面无英文残留。

## M5 打包与安装 🟡（开发安装已跑通，发布流程未做）

- ✅ `dsh plugin --profile web add <本仓库>` 可用：自动写入 `dependencies` 的 `link:` 与
  `dsh.profile.bundles`，并在 profile `node_modules` 建 junction（改完代码重建即生效）
- ✅ 卸载方式已验证记录：`dsh plugin --profile web remove dsh-cot-translate` + 重启
- ⬜ README 补完整的安装/卸载/回滚
- ⬜ 全新 profile 的干净验证

**验收**：全新 profile 上安装 → 重启 → 功能可用 → 卸载 → 重启 → 界面恢复原样。

## M6 质量与发布

- 单元测试：剔除器、分批器、缓存、回退链
- 双语 README、版本兼容矩阵
- 评估是否发布 npm（`dsh-cot-translate` 名称可用性）

**验收**：`npm test` 全绿；README 有截图；发布流程文档化。

## 暂不做

- 让模型用中文思考（提示词实验，另开）
- 翻译最终回答（作为可选开关，M4 之后再评估）
- 路由器部署（DECISIONS ADR-005）
- 官方 1.25bit 量化（ADR-009）
