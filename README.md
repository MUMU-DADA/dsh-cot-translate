# dsh-cot-translate

在 DeepSeek Harness（DSH）Web 界面里，把模型的**思维链（reasoning / chain-of-thought）实时翻译成中文**的显示层插件，优先使用**本地模型**（Ollama / llama.cpp），全部失败时回退免费在线源。

> 状态：**M1a** —— 数据链路打通：客户端已能通过 `ChatNodeStore.turnDataSource`
> 读到含隐藏节点的 reasoning 文本，并以「回合译文卡片」形式渲染占位译文；
> 真实翻译（host 半 + 本地模型）从 M2 开始。详见 [docs/ROADMAP.md](docs/ROADMAP.md)。
> 目标运行时：DSH `0.2.0-rc.2` + cordis `4.0.4`（DSH Desktop 0.5.23 内置，实测读包版本）。

## 它要解决什么

模型常常用英文思考，而界面是中文。这个插件只做一件事：**把思考过程翻译给你看**。

- 原文一字不改，译文只是叠加显示；
- 译文**不进入模型上下文**，不改变模型行为，不额外污染会话；
- 代码、路径、命令、URL、标识符**不翻译**；
- 翻译来源可排序：本地模型优先，其次远程 OpenAI 兼容端点，最后免费 Google/Bing；
- 全挂了就显示原文（fail-open）。

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
│   ├── index.ts              # host 半：provider 适配 + 翻译 HTTP 接口（M2）
│   ├── shared.ts             # 两端共享类型
│   └── client/
│       ├── index.ts          # client 半：注册 turnTail 条目、取 reasoning 数据
│       ├── card.ts           # 回合译文卡片（M1 为占位文案）
│       ├── chat.ts           # assistant-step 数据类型 + reasoning 抽取（纯函数）
│       ├── cordis.ts         # 用到的 cordis 客户端契约（结构类型，不依赖运行时包）
│       ├── styles.ts         # 运行时注入的卡片样式
│       └── locales.ts        # 中英文案
├── test/                     # node --test：加载构建产物做冒烟（pretest 自动 build）
├── scripts/                  # esbuild 打包脚本（client 走 __ModuleLoader__ 包装）
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
npm test             # pretest 会先 build；加载 lib/client.js 在假 DOM 上冒烟
```

安装到 DSH profile（开发期）：

```powershell
dsh plugin --profile web add <本仓库路径>
# 然后完整重启 DSH Desktop —— HMR 不监听 node_modules
```

## 参考

- 官方实验插件：`@deepseek-ai/dsh-experimental-client-ui-cot-translation`（peer 要求 0.2.1 运行时，当前不可用）
- 第三方同类：`dsh-think-translate`（UncleK，MIT，0.2.0-rc.2 兼容；仅作参考阅读，不 fork）
- 翻译模型：腾讯 **Hy-MT2**（Apache-2.0，33 语言）、Google **TranslateGemma**（Gemma 许可，55 语言）
- 本地推理：Ollama / llama.cpp

## License

MIT
