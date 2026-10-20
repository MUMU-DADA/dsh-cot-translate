# 第三方组件与许可证

本插件（`dsh-cot-translate`）本体以 **MIT** 许可证发布，版权归
`dsh-cot-translate contributors`，全文见 [LICENSE](./LICENSE)。

插件运行时会用到以下第三方组件/服务。它们**不包含在本仓库的源码里**（模型与二进制
体积大，均由用户按需下载或由插件按需拉起），各自的版权与许可证如下。

## 1. Hy-MT2 翻译模型（自带兜底 + 可选下载）

| 项 | 内容 |
|---|---|
| 组件 | Hy-MT2-1.8B（GGUF Q4_K_M / Q8_0）、Hy-MT2-7B（GGUF Q4_K_M） |
| 版权 | © Tencent Hunyuan（腾讯混元） |
| 许可证 | **Apache License 2.0** |
| 来源 | <https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF>、<https://huggingface.co/tencent/Hy-MT2-7B-GGUF> |
| 许可证全文 | <http://www.apache.org/licenses/LICENSE-2.0>（模型仓库内另有 `LICENSE.txt`） |

模型文件的放置位置：自带模型在 `<插件根>/models/`（不随 npm 包发布），
下载的预选模型在 `~/.dsh/cot-translate/models/`。设置页每个模型条目都会显示
许可证、版权与来源。

## 2. llama.cpp（本地推理运行时）

| 项 | 内容 |
|---|---|
| 组件 | `llama-server.exe` 及随附动态库（用户自行下载的官方 release 压缩包） |
| 版权 | © ggml-org contributors |
| 许可证 | **MIT** |
| 来源 | <https://github.com/ggml-org/llama.cpp> |

运行时不由本插件分发，也不进入本仓库；插件只负责在需要时以 headless 方式启动它。

## 3. 免费在线翻译兜底（Google 翻译公开接口）

本地模型不可用时，插件可选择性地把**已剔除代码/路径/URL 的自然语言片段**
发往 Google 翻译的公开接口（`translate.googleapis.com`）。该服务不随插件分发，
也不复制其代码；插件不存储其返回的译文（仅在本地缓存译文，可一键清空）。
是否使用由用户设置里的 provider 链决定。

## 4. 其他

- Node.js 标准库与运行时依赖（esbuild、jsdom、react 等）均为开发期依赖或宿主环境提供，
  各自许可证见对应包的 `LICENSE`。
- 插件不收集、不上传任何用户数据；译文只用于显示，不写回会话（见 README 与 `docs/DECISIONS.md`）。
