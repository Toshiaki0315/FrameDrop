import { useEffect, useState } from "react";

export const INSTALL_COMMAND = "brew install ffmpeg";

type Props = {
  /** Re-checks for FFmpeg; resolves to true when it was found. */
  onRecheck: () => Promise<boolean>;
  onClose: () => void;
};

export function FfmpegDialog({ onRecheck, onClose }: Props) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function copyCommand() {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  }

  async function recheck() {
    setNotFound(!(await onRecheck()));
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="FFmpeg が見つかりません"
        className="dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>FFmpeg が見つかりません</h2>
        <p className="body-text">
          動画の書き出しに FFmpeg が必要です。ターミナルを開いて、次のコマンドでインストールしてください。
        </p>
        <div className="code-row">
          <code>{INSTALL_COMMAND}</code>
          <button type="button" onClick={copyCommand}>
            コピー
          </button>
        </div>
        {copy === "done" && <p className="hint-line">コピーしました</p>}
        {copy === "failed" && <p className="hint-line error">コピーできませんでした。手動でコピーしてください</p>}
        <p className="note">
          Homebrew が入っていない場合は、先に https://brew.sh の手順で Homebrew をインストールしてください。
          インストールが終わったら「再確認」を押します。
        </p>
        {notFound && <p className="hint-line error">まだ FFmpeg が見つかりません</p>}
        <footer>
          <button type="button" onClick={onClose}>
            閉じる
          </button>
          <button type="button" className="primary" onClick={recheck}>
            再確認
          </button>
        </footer>
      </div>
    </div>
  );
}
