import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseDuration } from "./lib/duration";
import { moveItem, sortByFileName } from "./lib/order";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { SettingsDialog } from "./SettingsDialog";
import { Thumbnail } from "./Thumbnail";
import "./App.css";

type Progress = {
  status: "started" | "converting" | "stamping" | "encoding" | "completed";
  current: number;
  total: number;
};

/** Progress bar state: `{}` is indeterminate, `{ value, max }` determinate, null hidden. */
type Bar = { value?: number; max?: number } | null;

function statusText(p: Progress): string {
  switch (p.status) {
    case "started":
      return "変換を開始しました";
    case "converting":
      return `画像を変換中 (${p.current}/${p.total})`;
    case "stamping":
      return `スタンプを差し込み中 (${p.current}/${p.total})`;
    case "encoding":
      return "動画を書き出し中…";
    case "completed":
      return "完了しました";
  }
}

function barFor(p: Progress): Bar {
  switch (p.status) {
    case "converting":
    case "stamping":
      // `current` is the image being processed (1-based), so `current - 1` are done.
      return { value: p.current - 1, max: p.total };
    case "completed":
      return null;
    default:
      return {};
  }
}

function defaultOutputPath(firstFile: string): string {
  const i = firstFile.lastIndexOf("/");
  return `${i >= 0 ? firstFile.slice(0, i) : "."}/output.mp4`;
}

type Ghost = { src: string | null; w: number; h: number; offX: number; offY: number; x: number; y: number };
type DragState = { from: number; over: number | null; ghost: Ghost | null };

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [durationInput, setDurationInput] = useState("1");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [bar, setBar] = useState<Bar>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(globalThis.localStorage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") return;
        setFiles((prev) => [
          ...prev,
          ...sortByFileName(payload.paths.filter((p, i, all) => !prev.includes(p) && all.indexOf(p) === i)),
        ]);
      })
      .then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen<Progress>("conversion-progress", (event) => {
      setStatus(statusText(event.payload));
      setBar(barFor(event.payload));
    }).then((fn) => (cancelled ? fn() : (unlisten = fn)));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    listen("open-settings", () => setSettingsOpen(true)).then((fn) =>
      cancelled ? fn() : (unlisten = fn),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  function updateSettings(next: Settings) {
    setSettings(next);
    saveSettings(globalThis.localStorage, next);
  }

  useEffect(() => {
    document.body.classList.toggle("is-dragging", Boolean(drag?.ghost));
    return () => document.body.classList.remove("is-dragging");
  }, [drag?.ghost]);

  const duration = parseDuration(durationInput);
  const canConvert = files.length > 0 && duration !== null && !busy;

  function startDrag(e: React.PointerEvent<HTMLElement>, from: number) {
    if (e.button > 0) return;
    let over: number | null = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const grab = {
      src: e.currentTarget.querySelector("img")?.getAttribute("src") ?? null,
      w: rect.width,
      h: rect.height,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
    };
    setDrag({ from, over, ghost: null });
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest("[data-index]");
      over = el ? Number(el.getAttribute("data-index")) : null;
      setDrag({ from, over, ghost: { ...grab, x: ev.clientX, y: ev.clientY } });
    };
    const stop = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", cancel);
    };
    const end = () => {
      stop();
      const target = over;
      if (target !== null && target !== from) setFiles((prev) => moveItem(prev, from, target));
      setDrag(null);
    };
    const cancel = () => {
      stop();
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", cancel);
  }

  async function convert() {
    if (!canConvert || duration === null) return;
    setBusy(true);
    setBar(null);
    setStatus("保存先を選択中…");
    try {
      const outputPath = await save({
        title: "動画の保存先を選択",
        defaultPath: defaultOutputPath(files[0]),
        filters: [{ name: "MP4 動画", extensions: ["mp4"] }],
      });
      if (outputPath === null) {
        setStatus("キャンセルしました");
        return;
      }
      setStatus("変換を準備中…");
      setBar({});
      await invoke("generate_mp4", {
        filePaths: files,
        durationPerImage: duration,
        outputPath,
        stamp: settings.stampPath ? { path: settings.stampPath, size: settings.stampSize } : null,
      });
    } catch (e) {
      setStatus(`エラー: ${String(e)}`);
    } finally {
      setBusy(false);
      setBar(null);
    }
  }

  return (
    <main className="app">
      <header>
        <p className="hint">
          {files.length === 0
            ? "画像ファイルをウィンドウにドロップしてください"
            : "ドラッグして順番を入れ替えられます"}
        </p>
      </header>
      {files.length === 0 ? (
        <div className="empty" aria-hidden="true">
          🖼️
        </div>
      ) : (
        <ul className="thumbs">
          {files.map((f, i) => {
            const marker =
              drag && drag.over !== null && drag.over === i && drag.from !== i
                ? drag.over > drag.from
                  ? "after"
                  : "before"
                : undefined;
            return (
              <li
                key={f}
                title={f}
                data-index={i}
                data-insert={marker}
                className={drag?.ghost && drag.from === i ? "dragging" : ""}
                onPointerDown={(e) => startDrag(e, i)}
              >
                <div className="frame">
                  <Thumbnail path={f} />
                </div>
                <span className="badge">{i + 1}</span>
                <span className="insert-bar" aria-hidden="true" />
              </li>
            );
          })}
        </ul>
      )}
      <section className="controls">
        <label>
          1枚あたりの表示時間（秒）
          <input value={durationInput} onChange={(e) => setDurationInput(e.target.value)} />
        </label>
        <button disabled={!canConvert} onClick={convert}>
          変換開始
        </button>
      </section>
      {duration === null && (
        <p role="alert">1枚あたりの表示時間は0より大きい数値を入力してください</p>
      )}
      <div className="status-row">
        <p role="status">{status}</p>
        {bar && <progress value={bar.value} max={bar.max} />}
      </div>
      {settingsOpen && (
        <SettingsDialog settings={settings} onChange={updateSettings} onClose={closeSettings} />
      )}
      {drag?.ghost && (
        <div
          data-testid="drag-ghost"
          className="ghost"
          style={{
            left: drag.ghost.x - drag.ghost.offX,
            top: drag.ghost.y - drag.ghost.offY,
            width: drag.ghost.w,
            height: drag.ghost.h,
          }}
        >
          {drag.ghost.src && <img src={drag.ghost.src} alt="" draggable={false} />}
        </div>
      )}
    </main>
  );
}
