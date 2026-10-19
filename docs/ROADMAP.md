# 路线图

> 每个里程碑都要能独立验收；完成一项就把状态改掉。

## M0 脚手架 + 决策记录 ✅（2026-10-19）

- 目录结构、`package.json`（`dsh.bundle.patch` + `dsh.client`）、`cordis.patch.yml`、esbuild 构建脚本
- `docs/` 下的决策、调研、架构、路线图
- 仓库初始化（git）

**验收**：`npm run build` 能产出 `lib/index.js` 与 `lib/client.js`（骨架代码可打包）。

## M1 可行性 spike：拿到 reasoning 文本 + 确定渲染位置

- 验证 `ChatNodeStore` / `turnDataSource` 的公开 API（读节点、订阅增量、hidden 节点）
- 验证 `conversation.chat.node` 同名 key 注册语义；不行就改用 `turnTail` / `shell.overlay`
- 写一个最小 client 插件：在 Think 行附近渲染固定中文假译文

**验收**：真实会话里，某条历史回合的思考块旁出现 `.cot-translation` 假译文；刷新后仍在。

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
