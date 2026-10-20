# dsh-cot-translate

在 DeepSeek Harness（DSH）Web 界面里，把模型的**思维链（reasoning / chain-of-thought）实时翻译成中文**的显示层插件，优先使用**本地模型**（llama.cpp 的 llama-server，可选 Ollama），全部失败时回退免费在线源。

> 状态：**M1b / M2 / M3 可用（待真机验收）** —— 展开思考块时**就地**显示双语对照：
> 左栏原文、右栏中文译文，逐段成行，鼠标移到某段左右两边一起高亮；代码 / 路径 / 链接保持原样。
> 本地 llama.cpp 优先，免费 Google 兜底，全失败显示原文。尚未做：设置页。详见 [docs/ROADMAP.md](docs/ROADMAP.md)。
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
│   │   ├── providers.ts      # llamacpp / ollama / google 适配器 + 模型发现
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

## 设置页

DSH 里打开「设置 → 思维链翻译」，可以：

| 项 | 说明 |
|---|---|
| 启用翻译 | 总开关；关掉后思考块恢复原文 |
| 翻译时机 | **半自动**（点开思考才翻）/ **自动**（思考生成完就翻，折叠着也翻，展开即有译文） |
| 本地翻译模型 | 插件自带的 **Hy-MT2 1.8B Q4_K_M**（兜底、不可删除）+ 预选模型（1.8B Q8_0、7B Q4_K_M，按需下载） |
| 更新 / 删除 | 自带模型可更新不可删；下载的模型可删 |
| 本地模型速度测试 | 用固定样本测当前翻译链，给出每段平均耗时 |
| 使用当前对话的 API 模型翻译 | 走当前会话选中的模型（`ctx.llm`，不碰密钥），本地模型降级为兜底 |
| 翻译缓存 | 译文缓存在 `~/.dsh/cot-translate/cache/`（只存译文，原文只做哈希键）；上限 50MB，超限自动清最旧；可一键清理，重启后已翻过的内容秒出 |

设置存在 `~/.dsh/cot-translate/settings.json`，改完立即生效（不等重启）。

## 本地模型（可选，但推荐）

本地推理**不需要装 GUI 软件、不需要安装器**：用 llama.cpp 的免安装二进制 + 官方 GGUF。

```powershell
# 1) llama.cpp（Vulkan 构建，zip 35MB；解压即用，无注册表 / 托盘 / 开机自启）
#    https://github.com/ggml-org/llama.cpp/releases → llama-b11750-bin-win-vulkan-x64.zip
#    解压到 %USERPROFILE%\tools\llama.cpp\

# 2) 模型（腾讯官方 GGUF，Q4_K_M 约 1.08GB）
curl -L -o "$env:USERPROFILE\models\Hy-MT2-1.8B-Q4_K_M.gguf" `
  "https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/main/Hy-MT2-1.8B-Q4_K_M.gguf"
```

插件默认用**自带**的模型（`<插件根>/models/Hy-MT2-1.8B-Q4_K_M.gguf`，随插件目录分发、
不随 npm 包发布，见 ADR-018），运行时在 `~/tools/llama.cpp/llama-server.exe`
（也支持 `llamacpp.bin` / `llamacpp.modelPath` 覆盖）。
其它预选模型在设置页里点「下载」即可（存到 `~/.dsh/cot-translate/models/`）。

**不用手动启动服务**：插件发现服务没跑，就会自动拉起 `llama-server`
（detached、无窗口、`--no-webui` 关掉它自带的网页界面），加载完直接翻译；
系统里没有常驻服务、没有托盘、没有开机自启，删目录即卸载。
插件也**不打包模型**（见 [ADR-016](docs/DECISIONS.md)）——换模型只改 `~/models` 里的文件。

实测（10GB 级 NVIDIA 独显，1.8B Q4_K_M）：热调用 **50ms/段**；服务停掉后插件拉起 + 加载 + 翻译 **1.66s**；
显存约 1.5GB。想换 7B：把 `tencent/Hy-MT2-7B-GGUF` 的 Q4_K_M（约 4.5GB）放进去即可，代码不用改。

没装本地模型时插件自动降级到免费 Google 接口；两者都不可用时显示原文（fail-open），
界面不会报错。`GET /_cotx/providers` 可以看到每一档的实际可用性与当前模型名。
## 参考

- 官方实验插件：`@deepseek-ai/dsh-experimental-client-ui-cot-translation`（peer 要求 0.2.1 运行时，当前不可用）
- 第三方同类：`dsh-think-translate`（UncleK，MIT，0.2.0-rc.2 兼容；仅作参考阅读，不 fork）
- 翻译模型：腾讯 **Hy-MT2**（Apache-2.0，33 语言）、Google **TranslateGemma**（Gemma 许可，55 语言）
- 本地推理：llama.cpp（llama-server，免安装）/ Ollama（可选）

## License

MIT
