import { useEffect } from "react";

type Props = { title: string; message: string; onClose: () => void };

/** A small "OK" dialog for telling the user that something was changed for them. */
export function NoticeDialog({ title, message, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => (e.key === "Escape" || e.key === "Enter") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay notice-overlay" onClick={onClose}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="dialog notice"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <footer>
          <button className="primary" autoFocus onClick={onClose}>
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}
