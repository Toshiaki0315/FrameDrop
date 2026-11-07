.PHONY: dev app dmg test

BUNDLE_DIR := src-tauri/target/release/bundle

# リリースビルドに、ビルドした人のホームやプロジェクトの絶対パスが埋め込まれないようにする
# （Rust はエラー表示用にソースのパスをバイナリに持つ）。後ろの指定が優先される。
RELEASE_RUSTFLAGS := --remap-path-prefix=$(HOME)=~ --remap-path-prefix=$(CURDIR)=.

node_modules: package.json package-lock.json
	npm install
	@touch node_modules

# 開発モードで起動（ホットリロード）
dev: node_modules
	npm run tauri dev

# FrameDrop.app をビルド → $(BUNDLE_DIR)/macos/
app: node_modules
	RUSTFLAGS="$(RELEASE_RUSTFLAGS)" npm run tauri build -- --bundles app

# FrameDrop_*.dmg をビルド → $(BUNDLE_DIR)/dmg/
dmg: node_modules
	RUSTFLAGS="$(RELEASE_RUSTFLAGS)" npm run tauri build -- --bundles dmg

# 全テスト（Vitest + cargo test）
test: node_modules
	npm test
	npm run test:rust
