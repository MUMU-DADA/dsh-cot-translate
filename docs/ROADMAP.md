# 路线图

> 每个里程碑都要能独立验收；完成一项就把状态改掉。

## M0 脚手架 + 决策记录 ✅（2026-10-19）

- 目录结构、`package.json`（`dsh.bundle.patch` + `dsh.client`）、`cordis.patch.yml`、esbuild 构建脚本
- `docs/` 下的决策、调研、架构、路线图
- 仓库初始化（git）

**验收**：`npm run build` 能产出 `lib/index.js` 与 `lib/client.js`（骨架代码可打包）。

## M1 可行性 + 渲染位置 ✅（2026-10-19）

- ✅ 核实 `ChatNodeStore.turnDataSource(turn, kind)` / `source(key)`：可订阅源，含隐藏节点
- ✅ 核实 `conversation.chat.node` 是 keyed、注册同名 key = **替换**官方渲染器（`shadows-shipped-ui`）
- ✅ 回合底部卡片方案（`turnTail`）实现后**被用户否掉** → ADR-014
- ✅ 定案：**展开思考时就地注入双语对照面板**（左原文 / 右译文 / 行悬停联动高亮）

**验收**：见 M1b。

## M1b 就地双语对照面板 🟡（代码与 jsdom 测试完成，待真机验收）

- ✅ `MutationObserver` 盯 `[data-variant="think"][data-expanded]`，把面板插进 `_thinkBody`
- ✅ 原文优先从 ChatNodeStore 数据层取（围栏代码带反引号进入剔除器）；拿不到退回 `textContent`
- ✅ 逐段成行：左栏原文（代码 `<pre>`/`<code>` 等宽）、右栏译文；窄容器自动上下堆叠
- ✅ 行悬停整行高亮（纯 CSS，左右两栏天然同时亮）
- ✅ 三态回填：译文 / “技术内容，不翻译” / “翻译不可用”；流式追加只翻新增段落，
  运行中的尾巴等 400ms 稳定窗口再送翻（避免每 token 一次请求）
- ✅ **逐段显示**：每段独立请求、并发 2，先回来的先显示（实测 5 段：首段 0.37s、
  全部 0.51s；旧实现要等整批一次性出现）
- ✅ 折叠或重渲染时移除面板与隐藏标记，shell 原文自动恢复
- ✅ `test/client-attach.test.mjs` 8 项（jsdom：注入、回填、清理、数据层优先、流式追加、
  尾巴稳定窗口、文案、切段）
- ⬜ **完整重启桌面端**后在真实会话里验收（重启会中断当前会话，留给用户操作）

**验收**：展开任意 Think 行 → 出现双栏对照；鼠标移到某段，左右两边同时高亮；代码/路径/链接保持原样；
翻译不可用时右栏提示、左栏仍可读；折叠后恢复成原来的纯文本。

## M2 host 翻译接口 + 本地 provider（llama.cpp / Ollama）✅（2026-10-19，代码与测试完成）

- ✅ `POST /_cotx/translate`：入参校验（≤64 段 / ≤4000 字/段 / ≤16000 字总量 / 64KB body）、
  单 provider 超时、LRU 600、30 秒负缓存、fail-open（全挂 → 空译文 + 200，不 5xx）
- ✅ `llamacpp` 适配器：OpenAI 兼容 `/v1/chat/completions`，按需拉起 llama-server（`--jinja --no-webui`）
- ✅ `ollama` 适配器（可选）：`/api/chat`，`model: auto` 自动挑已拉取模型，可选 `keep_alive`
- ✅ `GET /_cotx/providers`（链 + 各档可用性，探测 `/api/tags`）、`GET /_cotx/models`
- ✅ `google` 免费接口兜底（可在配置里关掉）
- ✅ trust fence：`connection.requestRejection`，同源/本机之外的请求直接拒
- ✅ 日志只记 provider / 段数 / 字符数 / 耗时，不记原文
- ✅ 测试：provider 请求体、链降级、负缓存、校验、路由状态码、**真 HTTP + 假 Ollama 端到端**

**验收方式**：`npm test`（37 项全绿）。真机验证要等重启桌面端后 `curl 127.0.0.1:<port>/_cotx/providers`。

### M2 附：本地模型就绪 ✅（2026-10-20，本机实测）

- ✅ 卸载 Ollama（安装器 + 托盘 GUI，用户不要）；改用 **llama.cpp `llama-server`**
  （官方 release 压缩包，**免安装、无注册表、无托盘、无开机自启**，见 ADR-017）
- ✅ 运行时：llama.cpp b11750 win-vulkan-x64（35MB zip），解压到 `~/tools/llama.cpp`
- ✅ 模型：`tencent/Hy-MT2-1.8B-GGUF` Q4_K_M（1080.6MB），放 `~/models`
- ✅ 插件按需拉起 `llama-server`（`-ngl 99 --jinja --no-webui`），实测：停服后
  拉起 + 加载 + 翻译 **1.66s**；热调用 **50ms/段**；显存约 1.5GB
- ✅ 走 OpenAI 兼容 `/v1/chat/completions`，探活 `/health`；模型自动发现（`~/models` 里
  优先 hy-mt2 + Q4_K_M）
- ✅ Ollama provider 保留但默认禁用（`ollama.enabled: false`），老配置仍可用
- ⬜ 7B Q4（约 4.5GB）未下载；放进去即可自动被选，无需改代码
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

## M4 设置页 + 模型管理 ✅（2026-10-20）

- ✅ `settings.section` 页面「思维链翻译」：翻译总开关、半自动/自动切换
- ✅ 本地模型选择：自带 1.8B Q4_K_M（兜底、不可删）+ 预选 1.8B Q8_0 / 7B Q4_K_M（按需下载）
- ✅ 模型下载/更新/删除（异步 + 进度轮询；自带模型可更新不可删）
- ✅ 本地模型速度自测（固定样本，返回 provider 与每段耗时）
- ✅ 「使用当前对话的 API 模型翻译」开关（`ctx.llm.stream` + sessions 路由，不落密钥）
- ✅ 设置持久化在 `~/.dsh/cot-translate/settings.json`，改完立即重建翻译链
- ✅ 换模型时停掉插件自己拉起的 llama-server，下次请求按新模型重新拉起
- ✅ 自动模式：折叠的思考块也提前翻译（按面板同样切分预热缓存，展开即出译文）
- ✅ 磁盘译文缓存：`~/.dsh/cot-translate/cache/`，只存译文（原文做哈希键），上限 50MB，
  超限按最旧淘汰；设置页显示用量 + 清理按钮；重启后命中缓存（实测 0ms、provider=cache）
- ✅ 多语言：设置页「译文语言」下拉，覆盖 Hy-MT2 支持的 33+ 种语言；提示词用完整英文语言名；
  默认跟随客户端语言（`<html lang>`）
- ✅ 默认本地端口 8080 → 18099（实测 8080 被其他应用占用会导致静默降级到 Google）

**验收**：改设置立即生效并持久化；切换模型后第一次翻译用新模型；自带模型不可删除。✅
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
