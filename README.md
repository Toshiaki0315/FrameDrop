# FrameDrop

複数の静止画をドラッグ＆ドロップして、**音声なしの MP4 動画**にまとめる macOS 向けデスクトップアプリです。
Tauri v2（Rust + React/TypeScript）と FFmpeg で動きます。

- 画像のサムネイル表示と、ドラッグ操作による並べ替え
- 1枚あたりの表示時間を秒単位で指定
- サイズの違う画像は、黒帯（レターボックス）で同じ解像度にそろえて出力
- 各画像のランダムな位置に「スタンプ」画像を合成（任意）
- H.264（libx264, yuv420p）・音声なしで書き出し

## 動作環境

- macOS（Apple Silicon で動作確認。HEIC の読み込みに macOS 標準の `sips` を使うため、macOS 専用です）
- [FFmpeg](https://ffmpeg.org/)（実行時に必要。下記参照）

## インストール（配布版）

1. [Releases](https://github.com/Toshiaki0315/FrameDrop/releases) から `FrameDrop_x.y.z_aarch64.dmg` をダウンロードします。
2. DMG を開き、`FrameDrop.app` を「アプリケーション」フォルダにドラッグします。
3. FFmpeg を入れます。

   ```bash
   brew install ffmpeg
   ```

4. 初回起動のとき、下記「初回起動の注意」を行ってください。

### 初回起動の注意（アドホック署名）

配布版は Apple の開発者証明書ではなく**アドホック署名**です（公証はしていません）。
ダウンロードしたアプリを開くと、macOS が「開発元を検証できません」などと警告することがあります。次のいずれかで開けます。

- `FrameDrop.app` を **右クリック → 開く** → ダイアログで「開く」
- または、ターミナルで隔離属性を外す

  ```bash
  xattr -dr com.apple.quarantine /Applications/FrameDrop.app
  ```

## 使い方

1. FrameDrop を起動し、画像ファイルをウィンドウにドロップします（複数枚まとめて可）。
   - 対応形式: JPEG, PNG, GIF, BMP, TIFF, HEIC/HEIF, WebP
   - ドロップした分は、ファイル名順（数字は自然順: `img2` → `img10`）で並びます。追加でドロップすると末尾に足されます（すでにある画像でも追加されます）。
2. サムネイルを**ドラッグして順番を入れ替え**ます。移動先には縦の棒が表示され、離した位置に入ります。
   - **同じ画像を何回でも使えます。** もう一度ドロップするか、サムネイルにカーソルを重ねて出る **＋**（複製）を押すと、同じ画像がもう1枚追加されます。**×** でリストから外せます。
   - 同じ画像を複数回使っても、HEIC などの変換は1回だけです。スタンプは、使うたびに別の位置に付きます。
3. 「1枚あたりの表示時間（秒）」を入力します（0より大きい数値）。
4. 「変換開始」を押し、保存先を選びます（初期値は1枚目と同じフォルダの `output.mp4`）。
5. 画面下に進み具合が表示されます。「完了しました」と出れば完成です。

### スタンプの設定（任意）

メニューバーの **FrameDrop → 設定…**（`⌘,`）を開きます。

- **スタンプ画像**: JPEG, GIF, TIFF, BMP, HEIF（HEIC）、PNG, WebP から選べます。透過のある画像は透過を保って重なります。
- **サイズ**: 小・中・大から選びます。各画像の**短辺**に対して、小は 1/30、中は 1/20、大は 1/10 の大きさです。
- 変換時に、各画像のランダムな位置（画像の内側）へスタンプを合成します。画像ごとに位置は変わります。元の画像ファイルは変更されません。
- 設定は保存され、次回起動時にも引き継がれます。

## ビルド環境の作り方

### 必要なもの

| ツール | 目安 | 入れ方 |
|---|---|---|
| Xcode Command Line Tools | — | `xcode-select --install` |
| Rust | 1.85 以上（edition 2024。1.96 で動作確認） | [rustup](https://rustup.rs/) |
| Node.js | 22 以上（25.2 で動作確認） | `brew install node` など |
| FFmpeg | 実行・結合テストに必要 | `brew install ffmpeg` |

```bash
xcode-select --install
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
brew install node ffmpeg
```

### 取得と依存関係のインストール

```bash
git clone https://github.com/Toshiaki0315/FrameDrop.git
cd FrameDrop
npm install
```

## ビルドの仕方

`Makefile` に用意してあります。

| コマンド | 内容 | 出力先 |
|---|---|---|
| `make dev` | 開発モードで起動（ホットリロード） | — |
| `make app` | `FrameDrop.app` をビルド | `src-tauri/target/release/bundle/macos/` |
| `make dmg` | DMG をビルド | `src-tauri/target/release/bundle/dmg/` |
| `make test` | 全テスト（Vitest + `cargo test`） | — |

- 初回のビルドは Rust の依存クレートのコンパイルで数分かかります。
- `.app` はアドホック署名で署名されます（`src-tauri/tauri.conf.json` の `bundle.macOS.signingIdentity` が `"-"`）。署名の確認:

  ```bash
  codesign -dv --verbose=2 src-tauri/target/release/bundle/macos/FrameDrop.app
  codesign --verify --deep --strict src-tauri/target/release/bundle/macos/FrameDrop.app
  ```

- Apple Developer ID で署名・公証したい場合は、`signingIdentity` を証明書名に変え、Tauri の公証用の環境変数を設定してください（[Tauri のドキュメント](https://v2.tauri.app/distribute/sign/macos/)）。

## テスト

```bash
npm test                      # フロントエンド（Vitest + Testing Library）
npm run test:rust             # Rust のユニットテスト
cd src-tauri && cargo test --test e2e_ffmpeg -- --ignored   # 実機の結合テスト（ffmpeg と macOS の sips/qlmanage が必要）
```

開発は TDD（テストを先に書く）で進めています。

### テスト用の画像（`sample/`）

手で動作を試すための画像を作るスクリプトがあります。各形式（JPEG, PNG, GIF, BMP, TIFF, WebP, HEIC）の画像と、スタンプ用の画像（透過ありのものを含む）が `sample/images/` と `sample/stamps/` にできます。`sample/` は Git の管理対象外です。

```bash
swiftc design/make_samples.swift -o /tmp/make_samples && /tmp/make_samples sample
```

macOS の `sips` と、WebP 用の `cwebp`（`brew install webp`）が必要です。GIF は半透明を持てないので、GIF のスタンプには影を付けていません。

## 構成

```
src/                    フロントエンド（React + TypeScript）
  App.tsx               メイン画面（ドロップ、サムネイル、並べ替え、変換）
  SettingsDialog.tsx    設定ダイアログ（スタンプ）
  lib/                  純粋なロジック（並び順、表示時間、設定の保存）
src-tauri/src/
  lib.rs                Tauri コマンド（generate_mp4, get_thumbnail）とメニュー
  core/                 コアロジック（検証、FFmpeg 引数、前処理、スタンプ、サムネイル）
src-tauri/tests/        FFmpeg を使う結合テスト
design/                 アプリアイコンの原画と生成スクリプト
```

処理の流れ: 入力検証 → PNG 以外を PNG に統一（HEIC は `sips`）→（スタンプ合成）→ 解像度の決定（最大幅・最大高さ、偶数に切り上げ）→ FFmpeg の concat で H.264 に書き出し。

## 注意

- FFmpeg は Homebrew の既定の場所（`/opt/homebrew/bin`, `/usr/local/bin`）と `PATH` から探します。見つからないときは、起動時にウィンドウの上へ警告バナーを出し、「インストール方法」（`brew install ffmpeg` のコピー、再確認）を案内します。「変換開始」を押しても変換は始まらず、同じ案内を出します。
- 環境変数 `FRAMEDROP_FFMPEG` で FFmpeg の場所を指定できます。存在しない場所を指定すると、未インストールの状態を再現できます（例: `FRAMEDROP_FFMPEG=/none make dev`）。
- 出力の解像度は、入力画像の最大幅 × 最大高さです。大きな写真（数千px）を多数まとめると、書き出しに時間がかかります。

## 技術スタック

Tauri v2 / Rust / React / TypeScript / Vite / Vitest / FFmpeg / `image` クレート
