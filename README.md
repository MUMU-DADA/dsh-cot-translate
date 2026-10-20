# dsh-cot-translate

**简体中文** | [English](README.en.md) | [繁體中文](README.zh-Hant.md) | [日本語](README.ja.md)

在 **DeepSeek Harness（DSH）** 界面中，把模型的**思维链（reasoning / chain-of-thought）实时翻译成中文或多国语言**的显示层插件。默认优先使用**本地翻译模型**（基于 `llama.cpp` 的 `llama-server`，可选 Ollama），全部不可用时自动降级到免费在线翻译。

> **兼容环境**：DSH `0.2.0-rc.2` + Cordis `4.0.4`（DSH Desktop `0.5.23` 内置版本）

---

## 它解决什么问题？

很多模型即使在中文对话里也习惯用英文思考。这个插件只专注做好一件事：**在不改动任何对话数据的前提下，把模型的思考过程实时翻译给你看**。

- **展开即见双语对照**：点开任意一条 `Think` 思考块，左侧是原文、右侧是译文，按段落一一对齐；鼠标移到任意一段上，左右两边会同时高亮，方便逐句对照。
- **纯画面显示、零上下文污染**：译文只在你的屏幕上显示，**绝不写回会话记录**，也不会进入模型的上下文影响后续回答。
- **代码与技术内容原样保留**：代码块、行内代码、文件路径、终端命令、网址链接、函数调用（如 `fn()`）在翻译前会自动剥离保护，100% 保持原样，不会被误翻。
- **支持 33+ 种译文语言**：基于腾讯混元 **Hy-MT2** 专用翻译模型，支持简繁中文、英、日、韩、法、德、西、葡、俄、阿、泰、越、印尼、粤语等 30 余种语言互译。
- **9 种插件界面语言（i18n）**：设置页与双语面板内置 **简体中文、English、繁體中文、日本語、한국어、Français、Deutsch、Español、Русский**，跟随 DSH 界面语言即时切换。
- **安全兜底不报错**：当本地模型与在线翻译都不可用时，界面直接显示英文原文，不会弹窗报错或卡住对话。

---

## 实际效果

展开对话里的 `Think` 思考行后，思考区会变成**左原文 / 右译文**的双栏对照：

| 原文 | 译文 |
|---|---|
| I should check the repo layout first. | 我应该先看看仓库结构。 |
| Run `npm test` before touching the host routes. | 修改服务端路由前先运行 `npm test`。 |

- **悬停联动高亮**：鼠标移到任意一行，左右两栏对应段落同时高亮。
- **纯代码段落自动跳过**：只有代码或路径的段落，右栏会直接标示“技术内容，不翻译”。
- **窄窗口自适应**：当区域宽度小于 `520px` 时，自动切换为上下堆叠排版。
- **折叠自动还原**：收起 `Think` 行后，立即恢复为 DSH 原本的样式。

---

## 快速安装与卸载

```powershell
# 安装到 DSH 的 web profile（开发期可直接传入本仓库路径）
dsh plugin --profile web add <本仓库路径>

# 安装后请完整重启 DSH Desktop（HMR 热更新不监听 node_modules）
```

卸载插件：

```powershell
dsh plugin --profile web remove dsh-cot-translate
# 同样需要完整重启 DSH Desktop
```

---

## 设置页说明（设置 → 思维链翻译）

在 DSH 左下角打开「**设置 → 思维链翻译**」，所有改动都会保存在 `~/.dsh/cot-translate/settings.json` 并**立即生效**（无需重启）：

| 设置项 | 功能说明 |
|---|---|
| **启用翻译** | 总开关；关闭后思考块恢复只显示原文。 |
| **翻译时机** | **半自动**（手动点开思考块才开始翻）/ **自动**（思考刚生成完就在后台自动翻好，折叠状态也提前翻，点开秒出译文）。 |
| **译文语言** | 下拉选择要翻译成的语言（支持 Hy-MT2 的 33+ 种语言）；首次安装默认跟随 DSH 客户端语言。 |
| **本地翻译模型** | 默认使用插件自带的 **Hy-MT2 1.8B Q4_K_M**（保底模型，不可删除，占显存约 1.5GB、速度最快）；也可在页面上一键下载、更新或删除更高精度的 **1.8B Q8_0**（约 2.3GB 显存）和 **7B Q4_K_M**（约 4.5GB 显存，翻译质量最好）。 |
| **使用当前对话的 API 模型翻译** | 开启后直接借用当前聊天选中的 API 模型做翻译（速度更快、不占本机显卡显存，但会消耗 API 额度）；本地模型退居保底。 |
| **翻译缓存** | 译文缓存在本地磁盘 `~/.dsh/cot-translate/cache/`（**只存译文，原文不落盘**，上限 50MB，超限自动清理最旧条目）。重启后看过的思考 0ms 直接命中，支持一键清空。 |
| **本地服务端口** | `llama-server` 使用的本机端口（默认 **28457**，特意避开 8080 等常见冲突端口）。页面会实时显示端口状态（空闲 / 正在使用 / 被其他程序占用）。 |
| **本地模型速度测试** | 用一段固定测试文本跑一遍当前翻译链，测试每段平均耗时。 |

---

## 本地模型加速配置（推荐）

本地推理使用 `llama.cpp` 官方免安装二进制文件 `llama-server`——**无需安装器、没有系统托盘图标、不开机自启、删文件夹即卸载**：

1. **下载运行环境**：前往 [ggml-org/llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) 下载对应系统的压缩包（例如 Windows 显卡推荐下载 Vulkan 版 `llama-*-bin-win-vulkan-x64.zip`，仅约 35MB，无需安装庞大的 CUDA 工具包），解压到：
   - Windows：`%USERPROFILE%\tools\llama.cpp\`
   - macOS / Linux：`~/tools/llama.cpp/`
2. **准备模型文件**：
   - 默认保底模型位于 `<插件根目录>/models/Hy-MT2-1.8B-Q4_K_M.gguf`（约 1.08GB，来自 [tencent/Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)）；如果缺失，可以直接在插件设置页点击「下载」或「更新」。
   - 在设置页下载的其它可选模型（1.8B Q8 / 7B Q4）会自动存放在 `~/.dsh/cot-translate/models/`。
3. **全自动按需启动**：你**不需要**手动去跑命令行启动服务。当需要翻译时，插件会自动在后台无窗口拉起 `llama-server`（带 `--no-webui` 参数，默认监听 `127.0.0.1:28457`）。在主流 10GB 级独显上，1.8B 模型热调用仅需约 **50ms/段**。

如果本机还没配置本地模型，插件会自动使用免费的 Google 翻译兜底，开箱即用。

---

## 界面多语言（i18n）

插件界面会自动跟随 DSH 的语言设置（「设置 → 通用 → 语言」）：

- 已内置完整翻译：**简体中文（`zh`）**、**English（`en`）**、**繁體中文（`zh-Hant`）**、**日本語（`ja`）**、**한국어（`ko`）**、**Français（`fr`）**、**Deutsch（`de`）**、**Español（`es`）**、**Русский（`ru`）**。
- 切换语言后，设置页与思考块双语面板会立即刷新（首次安装插件后需重启一次 DSH 以加载新增语言项）。
- 如果想修改文案或新增其它语言，只需编辑 `src/client/locales/<语言>.json` 并运行 `npm run i18n:status` 查看进度，详见 [docs/I18N.md](docs/I18N.md)。

---

## 目录结构与开发指南

```text
dsh-cot-translate/
├── src/
│   ├── index.ts                 # 服务端（host）入口：注册 /_cotx/* 同源路由
│   ├── shared.ts                # 前后端共享数据类型
│   ├── host/
│   │   ├── control.ts           # 设置读写、模型下载管理、速度自测与服务重启编排
│   │   ├── settings.ts          # 用户设置持久化（~/.dsh/cot-translate/settings.json）
│   │   ├── models.ts            # 本地模型目录、HuggingFace 下载与状态查询
│   │   ├── languages.ts         # Hy-MT2 支持的 33+ 种目标语言映射表
│   │   ├── persistent-cache.ts  # 50MB 磁盘译文缓存（只存译文，SHA-256 哈希键）
│   │   ├── cache.ts             # 内存 LRU 缓存 + 30 秒失败冷却缓存
│   │   ├── providers.ts         # llamacpp / ollama / google 翻译适配器
│   │   ├── session-model.ts     # 借用当前对话 API 模型翻译的适配器
│   │   ├── runtime.ts           # 按需后台拉起与关闭 llama-server / ollama
│   │   ├── chain.ts             # 多翻译源按序尝试、超时控制与失败降级
│   │   └── routes.ts            # HTTP 路由参数校验与本机安全边界
│   └── client/
│       ├── index.ts             # 浏览器端（client）入口：注册多语言、样式、设置页与 DOM 观察器
│       ├── attach.ts            # 监听展开的思考块并就地挂载双语对照面板
│       ├── bilingual.ts         # 双语对照面板渲染、逐段并发请求与流式输出节流
│       ├── settings-view.ts     # 「设置 → 思维链翻译」完整设置页面
│       ├── strip.ts             # 代码、路径、URL、函数调用保护与句子分批
│       ├── text.ts              # 段落切分与行内代码高亮渲染
│       ├── translate.ts         # 前端翻译请求调度与客户端缓存
│       ├── prefs.ts             # 客户端设置同步与首次默认语言检测
│       ├── styles.ts            # 双栏排版、悬停联动高亮与设置页样式
│       └── locales/             # 9 种界面语言的 JSON 翻译字典与格式化工具
├── test/                        # 自动化测试（单元逻辑 + jsdom 渲染 + i18n + HTTP 端到端）
├── scripts/                     # 构建脚本、i18n 进度检查器与 DSH 槽位导出工具
├── docs/                        # 架构设计、决策记录与多语言贡献指南
└── THIRD_PARTY_LICENSES.md      # 第三方模型与运行时的版权及许可证说明
```

常用开发命令：

```powershell
npm install
npm run build        # 编译生成 lib/index.js（服务端）与 lib/client.js（浏览器端）
npm run typecheck    # TypeScript 类型检查
npm test             # 运行全部自动化测试（会自动先执行 build）
npm run i18n:status  # 检查所有界面语言 JSON 字典的翻译完成度
npm run slots chat   # 查看 DSH 运行时里可用的客户端 UI 槽位
```

### 深入了解文档

| 文档 | 说明 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构说明：前后端如何配合、为什么采用 DOM 注入、缓存与安全边界 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 决策记录（ADR-001 ~ ADR-022）：技术选型背后的原因与取舍 |
| [docs/I18N.md](docs/I18N.md) | 多语言（i18n）字典结构与翻译贡献指南 |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | 第三方组件（Hy-MT2 模型、llama.cpp）许可证详情 |

---

## 许可证与第三方组件

本插件本体基于 **[MIT 许可证](LICENSE)** 发布（`© 2026 dsh-cot-translate contributors`）。

插件运行过程中使用的第三方模型与工具遵循各自的开源许可证，完整说明见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)：

| 组件 | 版权归属 | 许可证 |
|---|---|---|
| **Hy-MT2 翻译模型**（自带保底 + 可选下载） | © Tencent Hunyuan（腾讯混元） | **Apache-2.0** |
| **llama.cpp / `llama-server`**（本地推理运行时） | © ggml-org contributors | **MIT** |
