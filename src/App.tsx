import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseDuration } from "./lib/duration";
import { baseName, moveItem, sortByFileName } from "./lib/order";
import { loadSettings, saveSettings, type Settings } from "./lib/settings";
import { FfmpegDialog } from "./FfmpegDialog";
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

type Item = { id: number; path: string };
type Ghost = { src: string | null; w: number; h: number; offX: number; offY: number; x: number; y: number };
type DragState = { from: number; over: number | null; ghost: Ghost | null };

export default function App() {
  // The same image may be listed several times, so entries get their own ids.
  const [files, setFiles] = useState<Item[]>([]);
  const nextId = useRef(0);
  const [durationInput, setDurationInput] = useState("1");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [bar, setBar] = useState<Bar>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(globalThis.localStorage));
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [ffmpegMissing, setFfmpegMissing] = useState(false);
  const [ffmpegDialogOpen, setFfmpegDialogOpen] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") return;
        const added = sortByFileName(payload.paths).map((path) => ({ id: nextId.current++, path }));
        setFiles((prev) => [...prev, ...added]);
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

  /** Asks the backend whether FFmpeg runs. Returns false only when it is missing. */
  const checkFfmpeg = useCallback(async (): Promise<boolean | null> => {
    try {
      const ok = (await invoke<boolean>("check_ffmpeg")) !== false;
      setFfmpegMissing(!ok);
      return ok;
    } catch {
      return null; // couldn't check: don't claim it is missing
    }
  }, []);

  useEffect(() => {
    void checkFfmpeg();
  }, [checkFfmpeg]);

  // Returning from the Terminal after installing: pick the change up without a restart.
  useEffect(() => {
    if (!ffmpegMissing) return;
    const onFocus = () => void checkFfmpeg();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ffmpegMissing, checkFfmpeg]);

  const closeFfmpegDialog = useCallback(() => setFfmpegDialogOpen(false), []);

  async function recheckFfmpeg(): Promise<boolean> {
    const ok = await checkFfmpeg();
    if (ok === true) setFfmpegDialogOpen(false);
    return ok === true;
  }

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

  function duplicateItem(id: number) {
    const copyId = nextId.current++;
    setFiles((prev) => {
      const i = prev.findIndex((f) => f.id === id);
      if (i < 0) return prev;
      return [...prev.slice(0, i + 1), { id: copyId, path: prev[i].path }, ...prev.slice(i + 1)];
    });
  }

  function removeItem(id: number) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  function startDrag(e: React.PointerEvent<HTMLElement>, from: number) {
    if (e.button > 0 || (e.target as HTMLElement).closest("button")) return;
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
    if (ffmpegMissing) {
      setFfmpegDialogOpen(true);
      return;
    }
    setBusy(true);
    setBar(null);
    setStatus("保存先を選択中…");
    try {
      const outputPath = await save({
        title: "動画の保存先を選択",
        defaultPath: defaultOutputPath(files[0].path),
        filters: [{ name: "MP4 動画", extensions: ["mp4"] }],
      });
      if (outputPath === null) {
        setStatus("キャンセルしました");
        return;
      }
      setStatus("変換を準備中…");
      setBar({});
      await invoke("generate_mp4", {
        filePaths: files.map((f) => f.path),
        durationPerImage: duration,
        outputPath,
        stamp: settings.stampPath ? { path: settings.stampPath, size: settings.stampSize } : null,
      });
    } catch (e) {
      setStatus(`エラー: ${String(e)}`);
      if ((await checkFfmpeg()) === false) setFfmpegDialogOpen(true);
    } finally {
      setBusy(false);
      setBar(null);
    }
  }

  return (
    <main className="app">
      {ffmpegMissing && (
        <section role="region" aria-label="FFmpeg の警告" className="banner">
          <span>FFmpeg が見つかりません。動画を作るには、FFmpeg のインストールが必要です。</span>
          <button type="button" onClick={() => setFfmpegDialogOpen(true)}>
            インストール方法
          </button>
        </section>
      )}
      <header>
        <p className="hint">
          {files.length === 0
            ? "画像ファイルをウィンドウにドロップしてください"
            : "ドラッグで並べ替え ・ ＋で同じ画像を複製 ・ ×でリストから外す"}
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
                key={f.id}
                title={f.path}
                data-index={i}
                data-insert={marker}
                className={drag?.ghost && drag.from === i ? "dragging" : ""}
                onPointerDown={(e) => startDrag(e, i)}
              >
                <div className="frame">
                  <Thumbnail path={f.path} />
                </div>
                <span className="badge">{i + 1}</span>
                <div className="item-actions">
                  <button
                    type="button"
                    aria-label={`${baseName(f.path)} を複製`}
                    title="同じ画像をもう1枚追加"
                    disabled={busy}
                    onClick={() => duplicateItem(f.id)}
                  >
                    ＋
                  </button>
                  <button
                    type="button"
                    aria-label={`${baseName(f.path)} を削除`}
                    title="リストから外す"
                    disabled={busy}
                    onClick={() => removeItem(f.id)}
                  >
                    ×
                  </button>
                </div>
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
      {ffmpegDialogOpen && <FfmpegDialog onRecheck={recheckFfmpeg} onClose={closeFfmpegDialog} />}
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
