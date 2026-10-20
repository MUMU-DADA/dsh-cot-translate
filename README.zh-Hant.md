# dsh-cot-translate

[简体中文](README.md) | [English](README.en.md) | **繁體中文** | [日本語](README.ja.md)

在 **DeepSeek Harness（DSH）** 介面中，將模型的**思維鏈（reasoning / chain-of-thought）即時翻譯為中文或多國語言**的顯示層插件。優先使用**本機模型**（`llama.cpp` 的 `llama-server`，或選用 Ollama），全部不可用時自動降級至免費線上翻譯。

> **相容環境**：DSH `0.2.0-rc.2` / `0.2.1-rc.2` + Cordis `4.0.4` / `4.0.5`（DSH Desktop 內建版本）

---

## 為什麼需要這個插件？

許多模型即使在中文對話中也會使用英文進行推理思考。本插件只專注做好一件事：**在不改動任何對話資料的前提下，讓你輕鬆讀懂模型的思考過程**。

- **展開即見雙語對照**：展開任一 `Think` 思考區塊，左側顯示原文、右側顯示譯文，逐段對齊；滑鼠移到任一段落時，左右兩欄同步高亮。
- **純顯示層、零上下文污染**：譯文僅在畫面顯示，絕不寫回對話紀錄，也不會進入模型上下文影響後續推理。
- **程式碼與技術內容原樣保留**：程式碼區塊、行內程式碼、檔案路徑、指令、網址與函式呼叫（`fn()`）在送翻前自動分離，100% 保持原樣不被誤翻。
- **支援 33+ 種譯文語言**：基於騰訊混元 **Hy-MT2** 翻譯模型，支援繁體中文、簡體中文、英、日、韓、法、德、西、葡、俄、阿、泰、越、印尼、粵語等 30 餘種語言。
- **9 種插件介面語言（i18n）**：設定頁與雙語面板內建 **繁體中文、简体中文、English、日本語、한국어、Français、Deutsch、Español、Русский**，隨 DSH 介面語言即時切換。
- **隱私優先的降級（Fail-open）**：預設只在本機推論；本機模型不可用時直接顯示原文，除非你在設定頁明確開啟 **「允許線上翻譯（Google）」**，否則不會把原文傳送給第三方。

---

## 畫面效果

展開對話中的 `Think` 思考行後，會就地呈現**左原文 / 右譯文**的雙欄對照：

| 原文 | 譯文 |
|---|---|
| I should check the repo layout first. | 我應該先檢查儲存庫結構。 |
| Run `npm test` before touching the host routes. | 修改伺服器路由前先執行 `npm test`。 |

- **懸停連動高亮**：滑鼠移至任意一行，左右兩側段落同步高亮，方便逐句對照。
- **純技術段落自動跳過**：僅含程式碼或路徑的段落，右欄會標示「技術內容，不翻譯」。
- **窄視窗自適應**：容器寬度小於 `520px` 時自動切換為上下堆疊排版。
- **摺疊自動還原**：收起 `Think` 思考區塊後，立即恢復 DSH 原始畫面。

---

## 快速安裝與移除

```powershell
# 安裝至 DSH web profile
dsh plugin --profile web add <本儲存庫路徑>

# 安裝後請完整重啟 DSH Desktop（HMR 不監聽 node_modules）
```

發行套件：從 [GitHub Releases](https://github.com/MUMU-DADA/dsh-cot-translate/releases) 下載 `dsh-cot-translate-0.2.0.tgz`，執行 `dsh plugin --profile web add <下載的tgz路徑>`。套件已含編譯產物，不含模型權重與 llama.cpp，需另行下載。從原始碼安裝時，先在儲存庫根目錄執行 `npm ci`（自動編譯），再執行上方安裝指令。

移除插件：

```powershell
dsh plugin --profile web remove dsh-cot-translate
# 同樣需要完整重啟 DSH Desktop
```

---

## 設定頁說明（設定 → 思維鏈翻譯）

所有設定皆儲存於 `~/.dsh/cot-translate/settings.json`，修改後**立即生效**，無需重啟：

| 設定項目 | 說明 |
|---|---|
| **啟用翻譯** | 總開關；關閉後思考區塊僅顯示原文。 |
| **翻譯時機** | **半自動**（手動點開思考區塊才開始翻譯）/ **自動**（思考產生完畢立刻於背景翻譯，摺疊狀態也會先翻好，點開秒出）。 |
| **譯文語言** | 支援 Hy-MT2 的 33+ 種語言下拉切換；首次安裝預設跟隨 DSH 介面語言。 |
| **本機翻譯模型** | 預設使用內建的 **Hy-MT2 1.8B Q4_K_M**（保底模型，不可刪除，約佔 1.5GB 顯示卡記憶體），並可直接於介面下載、更新或刪除 **1.8B Q8_0**（約 2.3GB）與 **7B Q4_K_M**（約 4.5GB，品質最佳）。 |
| **使用目前對話的 API 模型翻譯** | 開啟後改用目前對話所選的 API 模型翻譯（更快、不佔本機顯示卡記憶體，但會消耗 API 額度）；本機模型作為保底。 |
| **允許線上翻譯（Google）** | **預設關閉。** 關閉時只在本機翻譯，本機模型失敗就顯示原文；開啟後，僅在本機模型不可用時才把這批思考原文送往 Google 免費介面。**涉及隱私，開啟前請自行確認。** |
| **翻譯快取** | 譯文快取於 `~/.dsh/cot-translate/cache/`（僅存譯文、原文不落盤，上限 50MB，超限自動淘汰最舊項目）。重啟後已翻內容 0ms 秒出，支援一鍵清除。 |
| **本機服務連接埠** | `llama-server` 監聽的本機連接埠（預設 **28457**，避開常見衝突連接埠），即時顯示連接埠狀態（空閒 / 使用中 / 被其他程式佔用）。 |
| **本機模型速度測試** | 使用固定樣本測試目前翻譯鏈，顯示平均每段耗時。 |

---

## 本機模型加速（推薦）

本機推理由 `llama.cpp` 的 `llama-server` 驅動——**免安裝、無常駐系統匣圖示、無開機自啟**：

1. 前往 [ggml-org/llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) 下載對應系統的壓縮包（例如 Windows Vulkan 版 `llama-*-bin-win-vulkan-x64.zip`，約 35MB），解壓縮至：
   - Windows：`%USERPROFILE%\tools\llama.cpp\`
   - macOS / Linux：`~/tools/llama.cpp/`
2. 將預設保底模型 `Hy-MT2-1.8B-Q4_K_M.gguf`（約 1.08GB，來自 [tencent/Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)）放入 `<插件根目錄>/models/`，或直接在設定頁點擊下載。
3. **無需手動啟動服務**：有翻譯需求時，插件會自動於背景拉起無視窗的 `llama-server`（預設監聽 `127.0.0.1:28457`）。主流獨顯熱呼叫僅需約 **50ms/段**。

預設**不會連網**：本機沒有可用模型時直接顯示原文。只有在設定頁明確開啟「允許線上翻譯（Google）」後，才會使用免費的 Google 翻譯作為備援。

---

## 開發與測試

```powershell
npm install
npm run build        # 建置 lib/index.js（host ESM）與 lib/client.js（瀏覽器 bundle）
npm run typecheck    # TypeScript 型別檢查
npm test             # 執行全套單元測試、DOM 注入測試、i18n 測試與 HTTP 端到端測試
npm run i18n:status  # 檢查多語言字典完成度
```

### 專案文件導覽

| 文件 | 內容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 系統架構、前後端分工、快取機制與隱私安全邊界 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 技術決策紀錄（ADR-001 至 ADR-022） |
| [docs/I18N.md](docs/I18N.md) | 多語言（i18n）架構與翻譯貢獻指南 |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | 第三方模型與執行階段元件授權聲明 |

---

## 授權條款（License）

本插件採用 **[MIT License](LICENSE)** 授權（`© 2026 dsh-cot-translate contributors`）。

執行階段使用的第三方元件各自遵循其原始授權條款，詳見 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)：

| 元件 | 版權歸屬 | 授權條款 |
|---|---|---|
| **Hy-MT2 翻譯模型** | © Tencent Hunyuan | **Apache-2.0** |
| **llama.cpp (`llama-server`)** | © ggml-org contributors | **MIT** |
