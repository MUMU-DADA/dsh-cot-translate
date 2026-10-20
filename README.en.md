# dsh-cot-translate

[简体中文](README.md) | **English** | [繁體中文](README.zh-Hant.md) | [日本語](README.ja.md)

A display-only plugin for **DeepSeek Harness (DSH)** that translates model **reasoning (chain-of-thought)** in real time right next to the original text. It prioritizes a **local translation model** (`llama.cpp` `llama-server`, or optional Ollama) and falls back to free Google Translate if local inference is unavailable.

> **Compatible with**: DSH `0.2.0-rc.2` + Cordis `4.0.4` (built into DSH Desktop `0.5.23`)

---

## Why Use This Plugin?

Models frequently think in English even when you chat in another language. This plugin does one thing well: **it makes the model's thought process effortless to read without touching your conversation data**.

- **Side-by-side bilingual view**: Expand any `Think` block to see the original text on the left and the translation on the right, aligned paragraph by paragraph. Hover over any row to highlight both sides together.
- **Display-only & zero context pollution**: Translations only exist on screen. They are never written back to session logs and never fed into the model context.
- **Code & technical tokens stay intact**: Fenced code blocks, inline code, file paths, commands, URLs, and function calls (`fn()`) are preserved verbatim and never mangled by the translator.
- **33+ target languages**: Powered by **Tencent Hy-MT2**, supporting Simplified/Traditional Chinese, English, Japanese, Korean, French, German, Spanish, Portuguese, Russian, Arabic, Hindi, Thai, Vietnamese, Indonesian, and more.
- **9 UI languages**: The plugin interface (Settings page and bilingual panel) supports **简体中文, English, 繁體中文, 日本語, 한국어, Français, Deutsch, Español, and Русский**, switching live with DSH's language setting.
- **Safe fallback**: If all translation providers are offline, the original reasoning text remains cleanly readable without errors.

---

## How It Looks

When you expand a `Think` row in a conversation, you get a two-column view:

| Source | Translation |
|---|---|
| I should check the repo layout first. | 我应该先看看仓库结构。 |
| Run `npm test` before touching the host routes. | 修改服务端路由前先运行 `npm test`。 |

- **Hover sync**: Moving your cursor over any paragraph highlights both the original and translated paragraphs simultaneously.
- **Responsive layout**: Automatically stacks vertically when the panel width is narrower than `520px`.
- **Clean collapse**: Collapsing the `Think` row restores the standard DSH view.

---

## Quick Start

### 1. Install the Plugin

```powershell
# Install into the DSH web profile
dsh plugin --profile web add <path-to-this-repo>

# Restart DSH Desktop completely after installation (HMR does not watch node_modules)
```

Release package: download `dsh-cot-translate-0.1.0.tgz` from [GitHub Releases](https://github.com/MUMU-DADA/dsh-cot-translate/releases), then run `dsh plugin --profile web add <path-to-downloaded-tgz>`. The package includes compiled code, but no model weights or llama.cpp binaries. For a source checkout, first run `npm ci` in the repository root (builds automatically), then install using the command above.

To uninstall:

```powershell
dsh plugin --profile web remove dsh-cot-translate
# Restart DSH Desktop completely
```

### 2. Set Up Local Model Acceleration (Recommended)

Local inference runs headlessly via `llama.cpp`'s `llama-server` — **no installer, no system tray app, and no manual server startup**.

1. Download the official `llama.cpp` release archive (e.g., the Windows Vulkan build `llama-*-bin-win-vulkan-x64.zip`, ~35 MB) from [ggml-org/llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) and extract it to:
   - Windows: `%USERPROFILE%\tools\llama.cpp\`
   - macOS / Linux: `~/tools/llama.cpp/`
2. Place the default fallback model `Hy-MT2-1.8B-Q4_K_M.gguf` (~1.08 GB, from [tencent/Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)) into `<plugin-root>/models/` (or download models directly from the plugin settings page).

You **do not** need to start `llama-server` manually. Whenever a translation is requested, the plugin automatically launches `llama-server` in the background (`--no-webui`, listening on `127.0.0.1:28457` by default). If no local runtime is installed, the plugin automatically falls back to Google Translate.

---

## Settings (`Settings → Chain-of-thought translation`)

All settings are saved to `~/.dsh/cot-translate/settings.json` and take effect immediately without restarting DSH:

| Setting | Description |
|---|---|
| **Enable translation** | Master toggle. Turn off to show original reasoning text only. |
| **Translation timing** | **Semi-auto** (translates only when you expand a thought block) or **Auto** (translates in the background as soon as thinking finishes, even while collapsed). |
| **Target language** | Choose from 33+ languages supported by Hy-MT2. Defaults to your DSH client language on first run. |
| **Local translation model** | Switch between the bundled **Hy-MT2 1.8B Q4_K_M** fallback (~1.5 GB VRAM, fastest), **1.8B Q8_0** (~2.3 GB VRAM), or **7B Q4_K_M** (~4.5 GB VRAM, highest quality). Download, update, or delete optional models right from the UI. |
| **Translate with conversation model** | Use the API model selected in your current chat session instead of local VRAM (incurs API token costs; local model remains as fallback). |
| **Translation cache** | Caches translations on disk (`~/.dsh/cot-translate/cache/`, up to 50 MB, storing **translations only** and never source text). Instant 0 ms hits across restarts; one-click clear. |
| **Local service port** | Loopback port for `llama-server` (default `28457` to avoid common port conflicts). Shows live port status (free / used by our service / busy). |
| **Local model speed test** | Runs a standard sample through your active translation chain and reports average latency per segment. |

---

## UI Localization (i18n)

The plugin UI automatically follows DSH's interface language (`Settings → General → Language`):

- Built-in complete dictionaries: **简体中文 (`zh`)**, **English (`en`)**, **繁體中文 (`zh-Hant`)**, **日本語 (`ja`)**, **한국어 (`ko`)**, **Français (`fr`)**, **Deutsch (`de`)**, **Español (`es`)**, **Русский (`ru`)**.
- To check translation coverage or contribute a new language, edit `src/client/locales/<locale>.json` and run:
  ```powershell
  npm run i18n:status
  ```
  See [docs/I18N.md](docs/I18N.md) for details.

---

## Development

```powershell
npm install
npm run build        # Builds lib/index.js (host ESM) and lib/client.js (browser bundle)
npm run typecheck    # TypeScript type checking
npm test             # Runs unit, jsdom, i18n, and end-to-end HTTP tests
npm run i18n:status  # Checks locale dictionary completeness
npm run slots chat   # Inspects available DSH client UI slots
```

### Project Documentation

| Document | Purpose |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Architecture overview, host/client data flow, caching, and privacy boundaries |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architectural Decision Records (ADR-001 to ADR-022) |
| [docs/I18N.md](docs/I18N.md) | Localization guide for contributors |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | Licenses and attributions for third-party models and runtimes |

---

## License & Third-Party Notices

This plugin is licensed under the **[MIT License](LICENSE)** (`© 2026 dsh-cot-translate contributors`).

Third-party components used at runtime are governed by their respective licenses (see [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)):

| Component | Copyright | License |
|---|---|---|
| **Hy-MT2 Translation Models** | © Tencent Hunyuan | **Apache-2.0** |
| **llama.cpp (`llama-server`)** | © ggml-org contributors | **MIT** |
