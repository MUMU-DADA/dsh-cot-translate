# 项目约定（给 AI / 协作者）

## 先读什么

1. `docs/DECISIONS.md` —— 已定事项，不要重复讨论；要改决策先改它，再改代码
2. `docs/RESEARCH.md` —— 已经查过的事实，避免重复调研
3. `docs/ROADMAP.md` —— 当前里程碑与验收标准

## 红线

- **只做显示层**：不把译文写回会话、不修改 reasoning 原文、不影响模型上下文
- **不默认翻译代码**：代码块、行内代码、路径、命令、URL、标识符必须在送翻前剔除，翻完原样还原
- **不落密钥**：provider key 只能从环境变量或 `~/.dsh/.credentials.yaml` 运行期解析，绝不写入插件配置
- **不引入 GUI 依赖**：本地推理只走 headless 命令行服务（llama.cpp 的 `llama-server`，
  可选 Ollama），不启动托盘/GUI、不要求用户点界面；模型文件放插件目录但不进 git（ADR-015 / ADR-017 / ADR-018）。
- **不引入原生依赖**：纯 JS/TS + 标准 Node API，避免 node-pty 这类带预编译产物的包
- **兼容基线是 DSH 0.2.0-rc.2 + cordis 4.0.4**：要用更高版本才有的 API，先在 DECISIONS 里记录并给出降级方案

## 开发命令

```powershell
npm run build      # host ESM + client bundle
npm run typecheck
npm test           # pretest 自动 build；直接加载 lib/client.js 做冒烟
```

## 关键约束（0.2.0-rc.2 实测，2026-10-19）

- `conversation.chat.node` 是 **keyed** 槽位，键域被 `ChatNodeKind` 固定；注册 `assistant-step`
  等于**替换**官方渲染器（shadow shipped ui）。译文因此走「观察展开态 + 就地注入 DOM」
  （DECISIONS ADR-014），不要为了“内联一行”去替换节点渲染器。
- DOM 注入只用 shell 自己的稳定信号：`[data-variant="think"][data-expanded]`、
  `[class*="_thinkBody"]`、`[data-chat-node-key]`、`[data-conversation-session]`；
  不要依赖 hash 类名（`lcKema_xxx` 这类每次构建都会变）。
- 原文优先从 `ChatNodeStore.source(key)` 数据层取（围栏代码才带反引号，剔除器才准）；
  DOM `textContent` 只作兜底。
- 注入失败必须是**安全退化**：面板与 `data-cot-bilingual` 标记同生同灭，绝不出现“原文被隐藏但面板没挂上”。
- 拿 reasoning 文本也可用 `ChatNodeStore.turnDataSource(turn, "assistant-step")`，返回
  `{ getSnapshot, subscribe }`，快照是含隐藏节点的节点业务数据数组。
- 运行时自带槽位目录（`dsh-cordis-client-runner/lib/client.js`）；查“某槽位能不能挂、
  挂了会怎样”先查它，提取方法见 `docs/RESEARCH.md` §3.1。
- 纯槽位注册插件必须写 `dsh.client.immediately: true`，否则模块体不会在启动时执行。

## 兼容性提醒

- client bundle 必须保持 `window.__ModuleLoader__.load({ id: "<package name>", factory })` 包装，id 必须等于包名
- React / react-dom 走 shell 的 PLATFORM_MODULES，不要打进 bundle
- 改完 profile 里的包之后必须**完整重启 DSH Desktop**（HMR 不监听 node_modules）
- 页面刷新可能会引用旧 client 资源，升级后以重启为准
