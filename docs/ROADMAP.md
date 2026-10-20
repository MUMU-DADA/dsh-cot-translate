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
- ⬜ 装进 profile + 完整重启桌面端，在真实会话里验证

**验收**：真实会话里，已完成回合底部出现 `.cot-translation` 卡片，摘要显示 reasoning 段数与字数；刷新后仍在。

## M1b 实时形态：让进行中的回合也有译文

`turnTail` 只在回合完成后渲染。实时需要另一条订阅路径（`useChat` 快照或直接订阅节点源），落点二选一：

- `shell.overlay` 浮层：贴着当前回合显示，最接近“叠加显示”，但要处理定位与滚动
- `sidebar.right.pane.tab` 右侧译文面板：稳、可长时间阅读，但不是“旁边”

**验收**：模型流式输出途中，界面上的中文译文随之分批出现；关闭后无残留。

## M2 host 翻译接口 + 本地 Ollama provider

- `POST /_cotx/translate`：入参校验、超时、LRU、负缓存
- `ollama` 适配器：`/api/chat`，模型 `kaelri/hy-mt2:7b-q4_K_M`，官方采样参数
- `GET /_cotx/providers` 健康检查

**验收**：`curl` 一段英文 → 返回中文；停掉 Ollama 时返回空译文而不是 500；日志无原文。

## M3 client 翻译流水线

- 剔除器（代码/路径/URL/标识符）+ 还原
- 段落→句子分批；流式增量；内容哈希去重
- 懒加载时机：新思考实时翻，历史展开时翻
- 本地缓存（localStorage）

**验收**：真实长思考里逐批出现中文；滚动/刷新不重复请求；代码块保持原样。

## M4 设置页 + provider 链

- `settings.general.item` 条目：目标语言、provider 排序/开关、翻译时机、是否翻回答
- 免费 Google/Bing 适配器作为最后兜底
- 可选：OpenAI 兼容端点（本机聚合 API）

**验收**：改设置立即生效并持久化；禁用本地后自动走免费源；中文界面无英文残留。

## M5 打包与安装

- `dsh plugin --profile web add <本仓库>` 安装
- 卸载无残留；重启桌面端后生效
- README 补安装/卸载/回滚

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
