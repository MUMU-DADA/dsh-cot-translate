# dsh-cot-translate

[简体中文](README.md) | [English](README.en.md) | [繁體中文](README.zh-Hant.md) | **日本語**

**DeepSeek Harness (DSH)** の Web インターフェース上で、モデルの**思考プロセス（reasoning / chain-of-thought）をリアルタイムで翻訳表示**する表示レイヤープラグインです。**ローカル翻訳モデル**（`llama.cpp` の `llama-server`、または任意の Ollama）を優先的に使用し、利用できない場合は無料の Google 翻訳へ自動的にフォールバックします。

> **対応環境**：DSH `0.2.0-rc.2` / `0.2.1-rc.2` + Cordis `4.0.4` / `4.0.5`（DSH Desktop 同梱バージョン）

---

## 主な特徴

モデルが英語で思考（Reasoning）していても、セッション履歴を一切汚さずに母国語でスムーズに読み進められます。

- **展開時に原文と訳文を並列表示**：`Think` ブロックを展開すると、左側に原文・右側に翻訳が段落ごとに並んで表示されます。行にマウスを重ねると左右の対応する段落が同時にハイライトされます。
- **表示専用・コンテキスト汚染なし**：翻訳結果は画面表示にのみ使われ、会話データへの書き戻しやモデルのコンテキストへの混入は一切ありません。
- **コードや技術要素をそのまま保持**：コードブロック、インラインコード、ファイルパス、コマンド、URL、関数呼び出し（`fn()`）は翻訳前に分離され、改変されずにそのまま残ります。
- **33 以上の翻訳先言語**：Tencent **Hy-MT2** により、日本語・簡体字/繁体字中国語・英語・韓国語・フランス語・ドイツ語・スペイン語・ロシア語・アラビア語・タイ語・ベトナム語など 30 言語以上に対応しています。
- **9 言語の UI ローカライズ（i18n）**：設定画面および対訳パネルは **日本語 / 简体中文 / 繁體中文 / English / 한국어 / Français / Deutsch / Español / Русский** に対応し、DSH 本体の言語設定に連動して即座に切り替わります。
- **プライバシー重視のフォールバック（Fail-open）**：既定ではローカル推論のみを使用します。ローカルモデルが利用できない場合は原文を表示し、設定画面で **「オンライン翻訳を許可（Google）」** を明示的に有効にしない限り、第三者へ原文を送信しません。

---

## 表示イメージ

`Think` 行を展開すると、その場に 2 カラムの対訳パネルが表示されます：

| 原文 | 翻訳 |
|---|---|
| I should check the repo layout first. | まずリポジトリの構成を確認しよう。 |
| Run `npm test` before touching the host routes. | ホスト側のルートを触る前に `npm test` を実行する。 |

- **ホバー連動ハイライト**：任意の段落にカーソルを合わせると、左右の段落が同時にハイライトされます。
- **レスポンシブ対応**：コンテナ幅が `520px` 未満の狭い画面では自動的に上下スタック表示に切り替わります。
- **折りたたみで元通り**：`Think` 行を閉じると通常の表示に戻ります。

---

## インストール・アンインストール

```powershell
# DSH の web プロファイルにインストール
dsh plugin --profile web add <このリポジトリのパス>

# インストール後は DSH Desktop を完全に再起動してください（HMR は node_modules を監視しません）
```

リリース版： [GitHub Releases](https://github.com/MUMU-DADA/dsh-cot-translate/releases) から `dsh-cot-translate-0.1.0.tgz` をダウンロードし、`dsh plugin --profile web add <ダウンロードしたtgzのパス>` を実行してください。ビルド済みコードを含みますが、モデルの重みと llama.cpp は別途ダウンロードが必要です。ソースからインストールする場合は、先にリポジトリのルートで `npm ci` を実行すると自動ビルドされます。

アンインストール：

```powershell
dsh plugin --profile web remove dsh-cot-translate
# 同様に DSH Desktop の完全再起動が必要です
```

---

## 設定画面（設定 → 思考プロセス（CoT）翻訳）

設定は `~/.dsh/cot-translate/settings.json` に保存され、変更すると**再起動なしで即時反映**されます：

| 設定項目 | 説明 |
|---|---|
| **翻訳を有効にする** | 全体のオン/オフ切り替え。オフにすると原文のみを表示します。 |
| **翻訳のタイミング** | **セミオート**（思考ブロックを展開したときに翻訳開始）/ **オート**（思考完了時に折りたたみ状態でもバックグラウンドで事前翻訳）。 |
| **翻訳先の言語** | Hy-MT2 が対応する 33 以上の言語から選択可能。初期状態では DSH の UI 言語に自動追従します。 |
| **ローカル翻訳モデル** | 同梱の標準モデル **Hy-MT2 1.8B Q4_K_M**（削除不可、VRAM 約 1.5GB・最速）のほか、より高精度な **1.8B Q8_0**（VRAM 約 2.3GB）や **7B Q4_K_M**（VRAM 約 4.5GB・最高品質）を設定画面から直接ダウンロード・更新・削除できます。 |
| **現在のチャットの API モデルで翻訳する** | 現在選択中のチャットモデルを使って翻訳します（高速で VRAM を消費しませんが API 利用料が発生します。ローカルモデルは予備として機能します）。 |
| **オンライン翻訳を許可（Google）** | **既定はオフ。** オフの場合はローカル翻訳のみで、ローカルモデル失敗時は原文を表示します。オンの場合、ローカルモデルが利用できないときだけ思考の原文を Google の無料エンドポイントへ送信します。**プライバシーに関わるため、有効化前に確認してください。** |
| **翻訳キャッシュ** | 翻訳結果を `~/.dsh/cot-translate/cache/` に保存します（訳文のみ保存し、原文はディスクに書き込みません。上限 50MB）。再起動後も翻訳済みテキストを即座に表示し、ワンクリックで消去可能です。 |
| **ローカルサービスポート** | `llama-server` の待受ポート（標準 **28457**）。ポートの空き状況や競合をリアルタイムに表示します。 |
| **ローカルモデル速度テスト** | 定型サンプルを現在の翻訳チェーンで実行し、1 セグメントあたりの平均所要時間を計測します。 |

---

## ローカルモデル推論のセットアップ（推奨）

ローカル推論は `llama.cpp` の `llama-server` をヘッドレスで実行します（**インストーラー不要・タスクトレイ常駐なし・自動起動登録なし**）：

1. [ggml-org/llama.cpp Releases](https://github.com/ggml-org/llama.cpp/releases) から実行バイナリ（Windows Vulkan 版 `llama-*-bin-win-vulkan-x64.zip` など、約 35MB）をダウンロードし、以下に展開します：
   - Windows：`%USERPROFILE%\tools\llama.cpp\`
   - macOS / Linux：`~/tools/llama.cpp/`
2. 標準モデル `Hy-MT2-1.8B-Q4_K_M.gguf`（約 1.08GB、[tencent/Hy-MT2-1.8B-GGUF](https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF)）を `<プラグインルート>/models/` に配置するか、設定画面からダウンロードします。
3. **手動起動は不要**：翻訳が必要になったタイミングでプラグインが自動的にバックグラウンドで `llama-server`（`--no-webui`）を起動します。

既定では**外部送信しません**。ローカルモデルが使えない場合は原文を表示し、設定画面で「オンライン翻訳を許可（Google）」を有効にした場合のみ、無料の Google 翻訳をフォールバックとして使用します。

---

## 開発コマンド

```powershell
npm install
npm run build        # lib/index.js（ホスト ESM）と lib/client.js（ブラウザバンドル）をビルド
npm run typecheck    # TypeScript 型チェック
npm test             # ユニット・DOM・i18n・HTTP E2E テストを実行
npm run i18n:status  # 多言語辞書の翻訳状況を確認
```

### ドキュメント一覧

| ファイル | 内容 |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | アーキテクチャ概要、データフロー、キャッシュ、プライバシー境界 |
| [docs/DECISIONS.md](docs/DECISIONS.md) | 設計判断の記録（ADR-001 〜 ADR-022） |
| [docs/I18N.md](docs/I18N.md) | 多言語対応（i18n）ガイドライン |
| [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) | サードパーティ製モデル・ランタイムのライセンス表記 |

---

## ライセンス

本プラグインは **[MIT License](LICENSE)** の下で公開されています（`© 2026 dsh-cot-translate contributors`）。

利用するサードパーティ製コンポーネントのライセンス詳細は [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) を参照してください：

| コンポーネント | 著作権 | ライセンス |
|---|---|---|
| **Hy-MT2 翻訳モデル** | © Tencent Hunyuan | **Apache-2.0** |
| **llama.cpp (`llama-server`)** | © ggml-org contributors | **MIT** |
