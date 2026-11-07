import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Thumbnail } from "./Thumbnail";
import { STAMP_MAX, STAMP_MIN, clampStampSize, type Settings } from "./lib/settings";

const STAMP_EXTENSIONS = ["jpg", "jpeg", "gif", "tif", "tiff", "bmp", "heic", "heif", "png", "webp"];

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
};

export function SettingsDialog({ settings, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function chooseStamp() {
    const picked = await open({
      title: "スタンプ画像を選択",
      multiple: false,
      directory: false,
      filters: [{ name: "画像", extensions: STAMP_EXTENSIONS }],
    });
    if (typeof picked === "string") onChange({ ...settings, stampPath: picked });
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="設定"
        className="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>設定</h2>
        <section>
          <h3>スタンプ</h3>
          <p className="note">変換する各画像の、ランダムな位置にスタンプを合成します。</p>
          <div className="stamp-row">
            <div className="stamp-preview">
              {settings.stampPath ? <Thumbnail path={settings.stampPath} /> : <span>未設定</span>}
            </div>
            <div className="stamp-actions">
              <button onClick={chooseStamp}>スタンプ画像を選択…</button>
              <button
                disabled={!settings.stampPath}
                onClick={() => onChange({ ...settings, stampPath: null })}
              >
                クリア
              </button>
            </div>
          </div>
          <div className="size-row">
            <span>サイズ</span>
            <input
              type="range"
              aria-label="スタンプのサイズ"
              min={STAMP_MIN}
              max={STAMP_MAX}
              step={1}
              value={settings.stampSize}
              onChange={(e) => onChange({ ...settings, stampSize: clampStampSize(Number(e.target.value)) })}
            />
            <output>{settings.stampSize} px</output>
          </div>
        </section>
        <footer>
          <button className="primary" onClick={onClose}>
            閉じる
          </button>
        </footer>
      </div>
    </div>
  );
}
