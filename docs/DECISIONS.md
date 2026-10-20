# 决策记录

> 本文件记录 2026-10-19 会话中确定的方向。改任何决策前先改这里，再改代码。
> 每条：背景 → 决策 → 备选与放弃原因 → 后果。
> 事实依据见 [RESEARCH.md](RESEARCH.md)。

## ADR-001 只做显示层翻译，不让模型改用中文思考

**背景**：用户看不懂英文思维链，希望“看到我在想什么”。两条路：让模型用中文思考，或在界面上把思考翻成中文。

**决策**：本插件只做显示层翻译。原文、上下文、模型行为都不改变。

**备选与放弃原因**

- 在 `~/.dsh/AGENTS.md` 或 persona 里加“思考用简体中文”：零安装，但服从性弱——现有 AGENTS.md 整篇中文，模型思考仍是英文；强行切换还可能引入翻译腔、术语摇摆，并改变推理 token 与质量。不能作为可靠方案。
- 换成中文能力更强的模型：不可控（模型选择不属于本插件），且不解决既有会话。

**后果**

- 优点：零风险、可随时关闭；译文不占上下文、模型看不到，不会形成“翻译污染”。
- 缺点：多一次模型调用（成本与延迟），见 ADR-004 / ADR-006。

## ADR-002 自研插件，而不是直接安装第三方 `dsh-think-translate`

**背景**：生态里 `dsh-think-translate` 1.2.12（UncleK，MIT，43★）已实现同类功能，README 明示支持 DSH 0.2.0-rc.2；官方实验插件要 0.2.1 运行时，当前不可用。

**决策**：按用户要求自研本项目。第三方实现只作为参考阅读，不 fork、不依赖。

**备选与放弃原因**

- 直接装第三方：最快可用，但 UI、provider 策略、翻译时机不可控，也无法按本项目口味定制；用户明确要自己的项目。
- 等官方 0.2.1 插件：要等桌面端升级，时间不可控。

**后果**

- 自研需要重做 provider 适配、分批策略、UI，工作量大；第三方可作为“立即可用”的过渡（用户尚未安装）。
- 参考其架构（同源 HTTP 路由 + host provider 链 + client 分批）已被验证可行。

## ADR-003 兼容基线：DSH 0.2.0-rc.2 + cordis 4.0.4

**背景**：本机 DSH Desktop 内置运行时实测为 dsh `0.2.0-rc.2`、cordis `4.0.4`、ui-chat / ui-primitives `0.2.0-rc.2`。官方实验插件的 peer 是 `0.2.1-alpha.2` + `cordis ~4.0.5-alpha.1`，当前装不上。

**决策**：本项目以 0.2.0-rc.2 为首要目标；不采用只有 0.2.1 才有的 API。桌面端升级后重新验证并更新本文件与 peer 范围。

**后果**：peerDependencies 暂时精确锁 `0.2.0-rc.2`（prerelease 的 semver 范围表达受限），升级时再放宽。

## ADR-004 本地模型优先：Hy-MT2-7B Q4_K_M，1.8B 作为快速档

**背景**：需要中英互译质量好、许可干净、能在 10GB 级 NVIDIA 独显 上跑的本地模型。

**决策**

- 首选 **腾讯 Hy-MT2-7B**，Ollama 标签 `kaelri/hy-mt2:7b-q4_K_M`（约 4.5GB，Q4_K_M；默认 Q6_K 6.2GB 也可）。
- 快速档 **Hy-MT2-1.8B**（`kaelri/hy-mt2:1.8b-q8_0` 约 2GB），亚秒级，质量仍优于部分商用 API。
- 备选 **Google TranslateGemma 12B / 4B**（Ollama 官方库 `translategemma`，55 语言，Gemma 许可）。
- 不使用通用聊天模型（qwen2.5 等）做翻译：同尺寸下翻译质量不如专用 MT 模型。

**备选与放弃原因**

- Hy-MT2-30B-A3B：Q4 约 18GB，10GB 显存放不下。
- 官方 1.25bit 量化：依赖尚未合并的 llama.cpp PR #22836，见 ADR-009。
- 在线免费 Google/Bing：作为兜底保留，不作为首选（隐私、稳定性、代码安全处理都在本地可控）。

**后果**

- 许可：Hy-MT2 在 HF 标注 Apache-2.0（Ollama 包装页提到腾讯 HY 社区许可），个人使用无碍。
- 质量预期：专用 MT 模型对“只输出译文”的简单指令表现好，但复杂指令遵循一般；插件发送的提示词要短、明确。
- 成本：本地推理 0 token 费用，只有电费/显存。

## ADR-005 不部署到路由器

**决策**：翻译模型随 DSH 在桌面运行，不部署到路由器等共享基础设施。

**理由**：缺少 AVX / AVX2 / F16C 的低功耗设备推理速度不足；持续推理会争用基础服务的计算资源。

**备选**：不将此类设备用作推理兜底，收益不足以抵消维护成本。

## ADR-006 模型按需加载，不常驻显存

**背景**：用户担心“GPU 跑本地模型，不翻译时就是空转”。

**决策**：通过 Ollama 的空闲卸载机制按需加载：默认 `OLLAMA_KEEP_ALIVE=5m`（5 分钟无请求卸载模型），可设为 `0` 每次用完立即释放；插件自身也只在有翻译需求时触达 provider。

**事实依据**

- GPU 空闲基线取决于设备及其他应用；卸载模型后释放其占用的显存。
- 加载 7B Q4 时额外约 4.5GB 显存；不推理时不增加功耗；卸载后回到基线。
- 常驻 Ollama 后台进程约 100MB 内存、0% GPU。

**后果**：首次翻译有 2–4 秒模型加载延迟；懒加载模式下可接受。

## ADR-007 隐私与安全边界

**决策**

- 只翻译自然语言：代码块、行内代码、路径、命令、URL、标识符在送翻前剔除，翻完原样还原。
- 译文只进浏览器显示，不写会话、不进上下文、不落盘原文（服务端只做 LRU 缓存）。
- provider 密钥只从环境变量或 `~/.dsh/.credentials.yaml` 运行期解析，绝不写入插件配置；日志只记长度/耗时，不记原文。
- 只接受同源/本机请求；不监听 0.0.0.0；不做局域网共享服务。

**理由**：思考文本可能包含代码、路径、内部信息，泄漏面必须最小化；运行期读取的 provider 凭据不能被插件复制或持久化。

## ADR-008 失败策略：fail-open + 负缓存

**决策**

- provider 链按用户排序尝试；单个失败自动降级到下一个；全部失败时返回空译文，UI 显示原文。
- 失败结果做 30 秒负缓存，避免重试风暴；成功结果进 LRU（约 600 条）。
- 每批请求带超时，本地模型加载慢时给足余量（首 token 允许数秒）。

**后果**：翻译不可用时界面退化为纯英文原文，功能不阻塞使用。

## ADR-009 不使用官方 1.25bit GGUF

**背景**：Hy-MT2 提供 1.25bit（Sherry/STQ）极端量化，1.8B 可压到约 440MB，很适合端侧。

**决策**：本项目只用普通量化（Q4_K_M / Q6_K / Q8_0）。

**原因**：官方 GGUF 模型卡注明该格式依赖 STQ 内核（llama.cpp PR #22836）；2026-10-19 查证该 PR 仍为 **open**（`mergeable: false`），标准 Ollama/llama.cpp 跑不了。

**后果**：体积大一些，但兼容所有现成运行时。

## ADR-010 默认只翻思考，不翻回答

**决策**：翻译目标是 Think 行（reasoning）。最终回答默认不翻，作为可选项（默认关闭）。

**理由**：用户的痛点是“看不懂英文思考”；回答通常已经是中文，重复翻译反而增加成本与噪音。

## ADR-011 译文落在「回合尾部卡片」，不替换 assistant-step 渲染器

**背景**：M1 要确定译文画在哪。原计划「内联在 Think 行下方」（ROADMAP M1），前提是 `conversation.chat.node` 允许同名 key 叠加。

**决策**：用 `conversation.chat.turnTail`（list 槽位）注册「回合译文卡片」；**不**替换 `conversation.chat.node` 的 `assistant-step`。

**事实依据**（0.2.0-rc.2 实测，见 RESEARCH §3.2 / §3.3）

- `conversation.chat.node` 是 keyed，键域被 `ChatNodeKind` 固定，`assistant-step` 已被 ui-chat 的 `AssistantNodeView` 占用；注册同名 key 是**替换**，目录里标 `replaceRisk: "shadows-shipped-ui"`。
- 没有 reasoning 级别的子槽位或装饰器；`turnTail` 是官方留给产物扩展的位置（ui-plan / ui-deliverables / ui-schedule 都在用），且能通过 `ChatNodeStore.turnDataSource(turn, "assistant-step")` 读到**含隐藏节点**的 reasoning 数据。

**备选与放弃原因**

- 替换 `assistant-step`：要重写 reasoning 行、markdown、图片、折叠与 turnProcess 投影 —— 等于分叉 shell 渲染器，DSH 一升级就碎。
- `shell.overlay` 浮层跟随 Think 行：视觉上最接近“叠加”，但依赖 DOM 定位与观察，脆弱；留作 M1b 的实时形态单独评估。
- `sidebar.right.pane.tab` 右侧面板：适合“整段会话译文视图”，不适合“每条思考旁边”；留到 M4 之后再评估。

**后果**

- 优点：零侵入、升级安全；能拿到完整 reasoning（含隐藏节点）；list 槽位条目返回 null 即不占位，没有推理的回合什么都不显示。
- 缺点：**`turnTail` 只在回合完成后渲染**，进行中的回合没有译文 —— “实时”要等 M1b 的浮层/面板形态。

> **本 ADR 的落点选择已被 ADR-014 取代**（2026-10-19 用户明确要求：展开思考时就地双栏对照，
> 不要回合底部的卡片）。ADR-011 里“不替换 assistant-step”的判断仍然成立，继续有效。

## ADR-012 配置自己归一化，不引入 schemastery

**背景**：host 插件的配置来自 profile patch。cordis 4 支持 standard-schema 校验（`runtime.Config`），仓库里官方插件都用 `@deepseek-ai/schemastery`。

**决策**：不声明 `Config` schema，改在 `src/host/config.ts` 里用纯函数归一化：未知字段忽略、非法值回退默认、数值夹取、链去重，**永不抛错**。

**备选与放弃原因**

- 引入 schemastery：多一个运行时依赖，且把配置形状绑在一个版本上；桌面端升级时 schema 行为可能变化。本项目 host 半目前**零 `@deepseek-ai/*` 依赖**（bundle 自包含，能在 node 里直接单测），这个性质值钱。
- 不校验直接透传：配置写错会在运行期炸，或者静默产生怪行为。

**后果**

- 优点：配置永远不会让插件挂不上；归一化逻辑可单测（`test/host.test.mjs` 覆盖了夹取/去重/默认）。
- 缺点：profile 里写错的 key 不会报错、不会被 UI 提示，只能靠日志/测试兜。

## ADR-013 剔除技术片段用「分段保留」，不用占位符

**背景**：AGENTS 红线要求代码/路径/URL/标识符送翻前剔除、翻完原样还原。常见做法是替换成占位符再还原。

**决策**：不替换占位符，而是把文本切成「要翻的自然语言片段」与「原样保留片段」，只翻前者，按原顺序拼回（`src/client/strip.ts`）。

**备选与放弃原因**

- 占位符（`<x1>`、`⟦1⟧`）：翻译专用模型可能改写、翻译甚至吞掉占位符，还原时对不上就是代码被破坏 —— 这是最不能接受的失败模式。
- 整段不翻：太保守，等于没有功能。

**后果**

- 优点：技术片段**逐字**不变（有 `join === 原文` 的测试）；不需要处理占位符被模型改写的兜底逻辑。
- 缺点：句子可能被技术片段切成几段分别翻译，译文语序在极端情况下会略生硬；`functionName()` 这类写法会被当成技术片段（可接受，避免误伤代码）。

## ADR-014 展开思考时“就地注入”双语对照面板（观察 DOM）

**背景**：用户要的形态是——展开 Think 行后，**展开的内容本身**左边原文、右边译文，鼠标移到某一段时
两边一起高亮；不要回合底部的卡片。ADR-011 已经证明槽位做不到：`conversation.chat.node` 是 keyed，
注册 `assistant-step` 等于替换官方 Assistant 渲染器。

**决策**：用 `MutationObserver` 盯 shell 自己渲染的展开态思考块，拿到思考正文容器后把双语面板
**插入它的 DOM 里**，并给容器打 `data-cot-bilingual` 由 CSS 隐藏原来的纯文本渲染（原文仍完整显示在左栏）。

- 选择器只用 shell 的稳定信号：`[data-variant="think"][data-expanded]`（ReasoningRow 的 data 属性）、
  `[class*="_thinkBody"]`（CSS Module 名字保留 `thinkBody` 后缀）、`[data-chat-node-key]`、
  `[data-conversation-session]`。
- 原文优先从 **ChatNodeStore 数据层**取（`[data-chat-node-key]` + 第几个 reasoning 行 → 块的 `text`），
  这样围栏代码带反引号进入剔除器，不会被当自然语言送翻；数据层拿不到时才退回 `textContent`。
- 悬停高亮用纯 CSS：每行是一个包含左右两栏的 grid 行，`:hover` 整行变色，天然“两边一起高亮”。
- 面板是纯 DOM（不用 React），不参与 shell 的 React 树，避免互相踩。

**备选与放弃原因**

- 回合底部卡片（ADR-011）：用户明确否掉。
- `shell.overlay` 浮层贴边：不侵入 shell DOM，但要自己算位置、处理滚动/宽度，且**不是**“展开内容本身”，放弃。
- 替换 `assistant-step` 渲染器：要重写 markdown/图片/工具/折叠，升级即碎，放弃。

**后果与风险（必须记住）**

- 侵入 shell 渲染出的 DOM：DSH 升级后 `data-variant`/`_thinkBody` 一变，注入就会失效 —— 失效时**只是不显示面板**，
  不隐藏原文（隐藏标记和面板同时创建/移除），所以是安全退化。
- MutationObserver 覆盖整棵文档树（`childList/subtree/attributes/characterData`，节流 120ms）：
  流式输出期间会频繁触发，但每次只做一次 `querySelectorAll`，成本可控。
- CSS 隐藏原文渲染是“显示层替换”：只要面板移除，`data-cot-bilingual` 同时移除，原文自动恢复。
- 测试用 jsdom 覆盖了注入/回填/清理/数据层优先/流式追加（`test/client-attach.test.mjs`）。

## ADR-015 本地推理只用 headless 服务，不装 GUI 应用

**背景**：用户明确「不要用 GUI 软件」。Ollama 的 Windows 安装包会装一个托盘应用
（`ollama app.exe`）并注册开机自启；真正干活的推理服务是命令行 `ollama.exe serve`。

**决策**：

- 只用 `ollama.exe serve` 这个 headless 服务，托盘应用不启动、开机自启已移除；
- 插件在本地服务连不上时**按需拉起**一次（`spawn(bin, ['serve'], { detached, stdio: 'ignore' })`），
  等 `/api/tags` 就绪后继续；拉起后长期复用，DSH 退出不会杀掉它；
- 模型名默认 `auto`：从 `/api/tags` 里按偏好（7B Q4 → 7B → 1.8B Q8 → 1.8B Q4）挑一个已拉取的，
  用户的模型名/量化档不同也不会失效；
- `ollama.autostart` / `ollama.bin` 可配置，关掉就不动进程。

**备选与放弃原因**

- 保留托盘 GUI：用户明确否掉。
- 让用户手动 `ollama serve`：能用但每次重启电脑后插件会静默降级到免费接口，体验差。
- 注册 Windows 计划任务：可行但改系统状态；插件自启更内聚、可配置、可卸载。

**后果**

- 后台会多一个 `ollama` 进程（空闲约 30–50MB，模型 5 分钟空闲自动卸载显存）。
- 首次翻译要等拉起服务 + 加载模型：实测 1.8B 冷启动约 2–7 秒（含进程拉起轮询），热调用 67–350ms。
- 进程由插件发起，日志会记一行拉起结果（不含原文）。

> **2026-10-20 修订：具体运行时已换成 llama.cpp（ADR-017）**，因为用户要求卸载 Ollama。
> 本 ADR 的原则（只用 headless 命令行服务、不装 GUI、插件按需拉起、`model auto`）全部保留；
> Ollama 相关代码保留但默认禁用（`ollama.enabled: false`）。

## ADR-016 不把翻译模型打包进插件

**背景**：用户提出「如果不大的话可以放在插件里面」。

**结论**：**不打包**。理由是体积与运行时的双重不划算：

| 方案 | 体积 | 运行时 | 质量 | 结论 |
|---|---|---|---|---|
| Hy-MT2 1.8B Q4_K_M（当前用） | 1.1 GB | 需 llama.cpp/Ollama | 好（实测可用） | 插件装不下（npm/git 不现实） |
| Hy-MT2 7B Q4_K_M | 4.5 GB | 同上 | 更好 | 同上 |
| opus-mt-en-zh（Marian 76M）ONNX 量化 | ≈121 MB（encoder 52.9 + decoder 60.2 + tokenizer 7.5） | transformers.js（纯 JS/WASM，可无原生依赖） | 明显差于 Hy-MT2 | 勉强能塞，但要在渲染进程跑推理 + host 加静态路由 + 没 GPU 加速时每句几百 ms～数秒 |

**决策**：模型不进插件仓库；插件只负责「发现 / 拉起 / 调用」本机 headless 服务，
模型文件放在 `~/.ollama`（或将来 llama.cpp 的模型目录），用户可随时换模型。

**后果**

- 插件保持小身材（host bundle 十几 KB + client bundle 十几 KB），安装/升级/回滚都快。
- 换模型只改配置或 `ollama pull`，不需要重装插件。
- 想完全离线自带模型，需要另开一个「内置小模型」里程碑（transformers.js + 量化 ONNX），
  属于可选增强，不进主线。

---

## ADR-017 本地运行时改用 llama.cpp 的 llama-server（单文件、无安装器、无 GUI）

**背景**：用户明确「不要用 GUI 软件」，随后要求把 Ollama 卸载。Ollama 的 Windows 分发是
安装器 + 托盘应用，卸载后本地翻译就没有运行时了。

**决策**：

- 运行时换成 **llama.cpp 的 `llama-server.exe`**（官方 Windows release 压缩包，免安装：
  解压即用、不写注册表、没有托盘、没有开机自启、删目录即卸载）；
- 用 **Vulkan** 构建（35MB zip / 解压 99MB），不装 632MB 的 CUDA 运行时；10GB 级 NVIDIA 独显 上
  Vulkan 后端实测够快（见 RESEARCH §9）；
- 模型用腾讯官方 GGUF：`tencent/Hy-MT2-1.8B-GGUF` 的 `Hy-MT2-1.8B-Q4_K_M.gguf`（1080.6MB）；
- 插件通过 OpenAI 兼容接口 `POST {baseURL}/v1/chat/completions` 调用，`/health` 探活；
- 服务没起来时插件按需拉起（`-m <gguf> --host --port -c -ngl --jinja --no-webui`），
  detached、无窗口，DSH 退出不杀；
- 默认发现路径：二进制 `~/tools/llama.cpp/llama-server.exe`，模型 `~/models/*.gguf`；
  都可用 `llamacpp.bin` / `llamacpp.modelPath` 覆盖；
- Ollama provider 保留但默认禁用（`ollama.enabled: false`），老用户仍可改配置启用。

**备选与放弃原因**

- 继续用 Ollama：用户明确要求卸载。
- CUDA 构建：多 632MB 运行时下载，收益只有一点速度；Vulkan 已够（热调用 50ms/段）。
- 模型内置（transformers.js + ONNX）：ADR-016 已论证质量与体积不划算。

**后果**

- 系统里没有安装器产物、没有常驻服务、没有托盘；只有 `~/tools/llama.cpp` 与 `~/models` 两个目录。
- 首次使用要下载 ~1.1GB 模型 + 35MB 二进制（用户手动放好；插件不改网络策略）。
- 端口：llama-server 默认 9931，本项目显式 `--port 8080`（与默认 baseURL 一致）。
- 模型自带 chat 模板（`<｜hy_User｜>` 等），`--jinja` 直接用它，不需要自己拼提示词模板。

---

## ADR-018 设置页 + 自带兜底模型 + 自动/半自动两种翻译时机

**背景**：用户要求把插件做成可配置的：翻译总开关、自动/半自动切换、本地模型选择与更新、
速度自测、以及「用当前对话的 API 模型翻译」。并明确要求：插件要**自带**当前这个
1.8B 翻译模型，作为**不可删除的兜底模型**；其它预选模型按需下载。

**决策**

- **设置页走 `settings.section` 槽位**（list）：注册一个 id 为 `cot-translate` 的页面，
  在 DSH「设置」里多一栏。控件用原生 DOM + 插件自己的 CSS，不依赖 ui-primitives。
- **设置存在插件自己的文件**（`~/.dsh/cot-translate/settings.json`），而不是 DSH 的
  settings/schemastery：这样设置能立刻生效（改模型要重启本地服务），也不用把
  schema 依赖拉进插件（延续 ADR-012）。`COTX_HOME` 环境变量可覆盖数据目录（测试用）。
- **翻译时机**
  - 半自动（默认）：只在用户展开思考块时翻（原来的行为）；
  - 自动：思考生成完成后就翻，折叠着的也翻 —— 用数据层取原文、按面板同样的段落切分
    预热客户端缓存，展开时直接命中缓存。
- **模型来源**分两类：
  - `bundled`：放在插件目录 `<插件根>/models/`，**不可删除**，作为兜底；
  - `preset`：HF 官方 GGUF（1.8B Q8_0 / 7B Q4_K_M），下载到 `~/.dsh/cot-translate/models/`，
    可下载/更新/删除。
  - 换模型时停掉插件自己拉起的 llama-server，下次请求按新 `--model` 重新拉起。
- **「用当前对话的 API 模型翻译」**：host 半用 `ctx.llm.stream()`（宿主统一模型入口，
  不复制密钥、不自己发 HTTP）；provider/model 从 `sessions.get(sessionId).requestHeader()`
  的上一次请求配置里读。client 半把 `[data-conversation-session]` 里的会话 id 带进
  `/_cotx/translate` 请求。
- **更新**：对 bundled 模型也允许「更新」（重新下载覆盖），但**不允许删除** —— 保证兜底永远在。

**与 ADR-016 的关系（重要）**

ADR-016 说「不把模型打包进插件」针对的是 **npm 包体积**（1.1GB 进版本库不可接受）。
本次「插件自带」实现为：模型文件放在插件**目录**的 `models/` 下（本地部署形态），
并在 `.gitignore` 里排除，**不进入 git / npm 产物**；`npm pack` 的 `files` 也不含它。
这样既满足「自带、不可删除、离线可用」，又不污染版本库。发布到 npm 时需要通过
安装脚本/文档下载到该目录（设置页会显示「未下载」并提供下载按钮）。

**后果**

- 新增路由：`GET /_cotx/state`、`POST /_cotx/settings`、`POST /_cotx/models/download`、
  `POST /_cotx/models/delete`、`POST /_cotx/selftest`、`POST /_cotx/restart`。
- 模型下载走 HF 直链（用户在墙内时速度取决于代理），进度通过 `/_cotx/state` 轮询；
  下载先写 `.part` 再 rename，避免半截文件被当成可用模型。
- 「用对话模型翻译」会产生 API 费用，设置页里明确标注。

---

## 开放问题

1. ~~**内联渲染是否可行**~~ → 已答：不可行（keyed + 替换语义），见 ADR-011；最终用 DOM 注入，见 ADR-014。
2. ~~**ChatNodeStore / turnDataSource 的公开 API 形状**~~ → 已答：`turnDataSource(turn, kind) => { getSnapshot, subscribe }`，含隐藏节点，见 RESEARCH §3.3。
3. ~~**实时形态（M1b）**~~ → 已答：展开思考时就地注入双语面板，见 ADR-014。
4. ~~**默认本地推理后端**~~ → 已答：llama.cpp 的 `llama-server`（单文件、无 GUI），插件按需拉起，见 ADR-015 / ADR-017。
5. ~~**模型是否打包进插件**~~ → 已答：不打包，见 ADR-016。
6. **是否支持远程 provider 作为中间档**：例如本机局域网内的聚合 API 网关里挑便宜模型，作为本地不可用时的第二档（`openai` 兼容适配器）。
7. **许可证**：暂定 MIT（与参考项目一致），发布前确认。
