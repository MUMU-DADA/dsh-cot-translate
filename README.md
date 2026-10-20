# dsh-cot-translate

在 DeepSeek Harness（DSH）Web 界面里，把模型的**思维链（reasoning / chain-of-thought）实时翻译成中文**的显示层插件，优先使用**本地模型**（Ollama / llama.cpp），全部失败时回退免费在线源。

> 状态：**M1b / M2 / M3 可用（待真机验收）** —— 展开思考块时**就地**显示双语对照：
> 左栏原文、右栏中文译文，逐段成行，鼠标移到某段左右两边一起高亮；代码 / 路径 / 链接保持原样。
> 本地 Ollama 优先，免费 Google 兜底，全失败显示原文。尚未做：设置页。详见 [docs/ROADMAP.md](docs/ROADMAP.md)。
> 目标运行时：DSH `0.2.0-rc.2` + cordis `4.0.4`（DSH Desktop 0.5.23 内置，实测读包版本）。

## 它要解决什么

模型常常用英文思考，而界面是中文。这个插件只做一件事：**把思考过程翻译给你看**。

- 原文一字不改，译文只是叠加显示；
- 译文**不进入模型上下文**，不改变模型行为，不额外污染会话；
- 代码、路径、命令、URL、标识符**不翻译**；
- 翻译来源可排序：本地模型优先，其次远程 OpenAI 兼容端点，最后免费 Google/Bing；
- 全挂了就显示原文（fail-open）。

## 长什么样

展开某个 Think 行后，展开区里是**左原文 / 右译文**的逐段对照：

| 原文 | 译文 |
|---|---|
| I should check the repo layout first. | 我应该先看看仓库结构。 |
| Run `npm test` before touching the host half. | 先跑 `npm test` 再改 host 半。 |

- 鼠标移到任意一行，**左右两边同时高亮**，方便逐句对读；
- 代码、路径、URL、`fn()` 保持等宽原样，右栏对这些段落直接标“技术内容，不翻译”；
- 窗口太窄（容器 < 520px）时自动变成上下堆叠；
- 折叠回 Think 行后，界面恢复成原来的纯英文内容。

## 非目标

- 不改变模型用什么语言思考 —— 那是提示词层面的事，效果不可靠且会影响 token 与推理质量（另作实验，不进本插件）
- 默认不翻译最终回答（可选项，默认关闭）
- 不做模型网关、不做账号体系、不接管模型选择

## 文档

| 文件 | 内容 |
|---|---|
| [docs/DECISIONS.md](docs/DECISIONS.md) | **决策记录**：为什么自研、为什么用本地模型、为什么不上路由器、模型怎么选 |
| [docs/RESEARCH.md](docs/RESEARCH.md) | 调研：DSH 客户端插件机制、聊天 UI 可用槽位、模型对比、本机与路由器实测数据 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 目标架构：host 半 / client 半、翻译流水线、失败与隐私策略 |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 里程碑与验收标准 |

## 目录结构

```
dsh-cot-translate/
├── src/
│   ├── index.ts              # host 半入口：name/inject/apply，注册 /_cotx/* 路由
│   ├── shared.ts             # 两端共享类型（请求/响应/provider 状态）
│   ├── host/
│   │   ├── config.ts         # 配置归一化（纯函数，不引 schemastery）
│   │   ├── cache.ts          # LRU + 失败负缓存
│   │   ├── providers.ts      # ollama / google 适配器 + 模型自动选择
│   │   ├── runtime.ts        # 本地服务按需拉起（headless，无 GUI）
│   │   ├── chain.ts          # provider 链编排、超时、fail-open
│   │   └── routes.ts         # HTTP 路由：校验、状态码、trust fence
│   └── client/
│       ├── index.ts          # client 半：注册 locale/样式，启动 DOM 挂载
│       ├── attach.ts         # MutationObserver：展开态思考块 → 注入面板
│       ├── bilingual.ts      # 双语面板：逐段两栏、三态回填、流式追加
│       ├── text.ts           # 分段、轻量去 Markdown、把片段渲染成 DOM
│       ├── strip.ts          # 分段保留技术片段 + 句子块 + 分批（纯函数）
│       ├── translate.ts      # 同源请求（多段合并成批）+ client 缓存 + 拼回
│       ├── chat.ts           # assistant-step / ChatNode 类型（纯函数）
│       ├── cordis.ts         # 用到的 cordis 客户端契约（结构类型，不依赖运行时包）
│       ├── styles.ts         # 运行时注入的双栏样式（含行悬停高亮）
│       └── locales.ts        # 中英文案
├── test/                     # node --test：加载构建产物做冒烟 / 真 HTTP 端到端
├── scripts/                  # esbuild 打包脚本 + dump-slots.mjs（槽位目录提取器）
├── docs/                     # 决策 / 调研 / 架构 / 路线图
├── cordis.patch.yml          # 作为 bundle 安装时挂载 host 半的 patch
├── package.json              # dsh.bundle.patch + dsh.client 声明
└── AGENTS.md                 # 本项目的开发约定（给 AI / 协作者）
```

## 开发

```powershell
npm install
npm run build        # 产出 lib/index.js（host ESM）与 lib/client.js（浏览器 bundle）
npm run typecheck
npm test             # pretest 会先 build；26 项：纯逻辑 + 假 DOM 渲染 + 真 HTTP 端到端
npm run slots chat   # 查 DSH 运行时里有哪些客户端槽位可用
```

## 安装 / 卸载

```powershell
# 安装到 web profile（开发期用本仓库路径，pnpm 会建 junction；重建 lib 即生效）
dsh plugin --profile web add <本仓库路径>
# 然后完整重启 DSH Desktop —— HMR 不监听 node_modules

# 卸载
dsh plugin --profile web remove dsh-cot-translate
# 同样需要完整重启
```

## 本地模型（可选，但推荐）

插件**只调用命令行服务**，不依赖任何 GUI 应用：

```powershell
# 1) 装 Ollama（只用它的命令行；托盘应用不用、已从开机自启移除）
winget install --id Ollama.Ollama -e

# 2) 拉一个 Hy-MT2（1.8B Q4 约 1.1GB，够快；想要更好质量可换 7B Q4 约 4.5GB）
ollama pull kaelri/hy-mt2:1.8b-q4_K_M
# ollama pull kaelri/hy-mt2:7b-q4_K_M
```

**不用手动启动服务**：插件发现本地服务没在跑，会自动 `ollama serve`（headless、无窗口、
无托盘），等它就绪后继续翻译；模型按 `keep_alive=5m` 空闲后自动卸载显存。
插件也**不打包模型**（见 [ADR-016](docs/DECISIONS.md)）——模型放 `~/.ollama`，换模型不用重装插件。

实测（10GB 级 NVIDIA 独显，1.8B Q4）：冷启动 2.2s、热调用 67–350ms；首次拉起服务 + 加载 + 翻译约 7s。

没装本地模型时插件自动降级到免费 Google 接口；两者都不可用时显示原文（fail-open），
界面不会报错。`GET /_cotx/providers` 可以看到每一档的实际可用性和当前选中的模型。

## 参考

- 官方实验插件：`@deepseek-ai/dsh-experimental-client-ui-cot-translation`（peer 要求 0.2.1 运行时，当前不可用）
- 第三方同类：`dsh-think-translate`（UncleK，MIT，0.2.0-rc.2 兼容；仅作参考阅读，不 fork）
- 翻译模型：腾讯 **Hy-MT2**（Apache-2.0，33 语言）、Google **TranslateGemma**（Gemma 许可，55 语言）
- 本地推理：Ollama / llama.cpp

## License

MIT
