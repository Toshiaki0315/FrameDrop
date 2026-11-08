import { useEffect } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Thumbnail } from "./Thumbnail";
import { STAMP_SIZES, type Settings } from "./lib/settings";
import { VideoSizeSelect } from "./VideoSizeSelect";

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
    // choosing a stamp means the user wants it, so the main-screen checkbox is turned on
    if (typeof picked === "string") onChange({ ...settings, stampPath: picked, stampEnabled: true });
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
          <h3>動画サイズ</h3>
          <div className="size-row first">
            <VideoSizeSelect
              label="動画サイズ"
              className="video-size"
              value={settings.videoSize}
              onChange={(videoSize) => onChange({ ...settings, videoSize })}
            />
          </div>
          <p className="note">画像は縦横比を保って収め、余った部分は黒帯になります。</p>
          <p className="note">メイン画面の「今回の動画サイズ」で、一時的に変えられます（保存されず、再起動するとここの設定に戻ります）。</p>
        </section>
        <section>
          <h3>GIF アニメーション</h3>
          <div className="size-row first">
            <span>ループ</span>
            <div role="radiogroup" aria-label="GIF のループ" className="segmented">
              {[
                { value: true, label: "無限ループ" },
                { value: false, label: "ループなし" },
              ].map(({ value, label }) => (
                <label key={label} className={settings.gifLoop === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="gif-loop"
                    checked={settings.gifLoop === value}
                    onChange={() => onChange({ ...settings, gifLoop: value })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <p className="note">GIF は幅 720px までです。それより大きいサイズを選ぶと、確認のうえ 720px に縮めます。</p>
        </section>
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
            <div role="radiogroup" aria-label="スタンプのサイズ" className="segmented">
              {STAMP_SIZES.map(({ value, label }) => (
                <label key={value} className={settings.stampSize === value ? "selected" : ""}>
                  <input
                    type="radio"
                    name="stamp-size"
                    value={value}
                    checked={settings.stampSize === value}
                    onChange={() => onChange({ ...settings, stampSize: value })}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>
          <p className="note">画像の短辺の 1/30・1/20・1/10 の大きさで合成します。</p>
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
