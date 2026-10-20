# 第三方组件与许可证 / Third-Party Licenses & Notices

本插件（`dsh-cot-translate`）本体以 **MIT** 许可证发布，版权归 `dsh-cot-translate contributors` 所有，许可证全文见 [LICENSE](./LICENSE)。

插件在运行过程中会使用以下第三方模型或组件。它们**不包含在本仓库的源码提交中**（模型与二进制体积较大，均按需下载或按需调用），各自的版权归属与许可证声明如下。

This plugin (`dsh-cot-translate`) is released under the **MIT License** (`© 2026 dsh-cot-translate contributors`, see [LICENSE](./LICENSE)). At runtime, it interacts with the following third-party components, which are governed by their respective licenses:

---

## 1. Hy-MT2 翻译模型 / Hy-MT2 Translation Models

| 项目 / Item | 内容 / Details |
|---|---|
| **组件 / Models** | `Hy-MT2-1.8B`（GGUF `Q4_K_M` / `Q8_0`）、`Hy-MT2-7B`（GGUF `Q4_K_M`） |
| **版权 / Copyright** | © Tencent Hunyuan（腾讯混元） |
| **许可证 / License** | **Apache License 2.0** |
| **来源 / Source** | <https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF> · <https://huggingface.co/tencent/Hy-MT2-7B-GGUF> |
| **许可证全文 / License Text** | <http://www.apache.org/licenses/LICENSE-2.0> |

- **放置位置 / Storage locations**：默认兜底模型位于 `<插件根目录>/models/`（通过 `.gitignore` 排除，不随 npm 源码包发布）；用户在设置页下载的可选模型存放在 `~/.dsh/cot-translate/models/`。
- **界面声明 / UI attribution**：插件设置页中的每个模型条目均直接展示其许可证、版权方与来源仓库。

---

## 2. llama.cpp（本地推理运行时 / Local Inference Runtime）

| 项目 / Item | 内容 / Details |
|---|---|
| **组件 / Component** | `llama-server` 及随附动态库（官方 Release 免安装压缩包 / Official release binaries） |
| **版权 / Copyright** | © ggml-org contributors |
| **许可证 / License** | **MIT License** |
| **来源 / Source** | <https://github.com/ggml-org/llama.cpp> |

- 运行时二进制文件不由本仓库分发，插件仅在需要本地翻译时以无窗口（headless）方式按需启动它。

---

## 3. 在线翻译兜底 / Online Translation Fallback (Google Translate)

- 当本地模型不可用且未禁用在线兜底时，插件会将**已剔除代码、路径与链接的自然语言片段**发送至 Google 翻译公开接口（`translate.googleapis.com`）。
- 该服务不随本插件分发，本插件亦不复制其任何代码；返回的译文仅用于界面显示与本地译文缓存（可随时在设置页一键清空）。

---

## 4. 开发与宿主依赖 / Development & Host Dependencies

- Node.js 标准库及开发期依赖（`esbuild`、`jsdom`、`typescript`、`react` 等）均遵循各自软件包的开源许可证。
- **隐私承诺 / Privacy commitment**：本插件不收集、不上传任何用户遥测数据；译文仅在本地界面展示，绝不写回会话记录，且磁盘缓存只保存译文、不保存原文。
