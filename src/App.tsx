import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseDuration } from "./lib/duration";
import { baseName, moveItem, sortByFileName } from "./lib/order";
import {
  GIF_MAX_WIDTH,
  OUTPUT_FORMATS,
  gifSizeFor,
  isGifSize,
  loadSettings,
  saveSettings,
  videoSizeFor,
  videoSizeText,
  type OutputFormat,
  type Settings,
} from "./lib/settings";
import { FfmpegDialog } from "./FfmpegDialog";
import { NoticeDialog } from "./NoticeDialog";
import { SettingsDialog } from "./SettingsDialog";
import { Thumbnail } from "./Thumbnail";
import { VideoSizeSelect } from "./VideoSizeSelect";
import "./App.css";

type Progress = {
  status: "started" | "converting" | "stamping" | "encoding" | "completed";
  current: number;
  total: number;
  /** The actual output size, known from the encoding stage on. */
  width?: number | null;
  height?: number | null;
};

/** Progress bar state: `{}` is indeterminate, `{ value, max }` determinate, null hidden. */
type Bar = { value?: number; max?: number } | null;

function sizeSuffix(p: Progress, open: string, close: string): string {
  return p.width && p.height ? `${open}${p.width}×${p.height}${close}` : "";
}

function statusText(p: Progress, format: OutputFormat): string {
  switch (p.status) {
    case "started":
      return "変換を開始しました";
    case "converting":
      return `画像を変換中 (${p.current}/${p.total})`;
    case "stamping":
      return `スタンプを差し込み中 (${p.current}/${p.total})`;
    case "encoding":
      return `${format === "gif" ? "GIF" : "動画"}を書き出し中…${sizeSuffix(p, " ", "")}`;
    case "completed":
      return `完了しました${sizeSuffix(p, "（", "）")}`;
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

function defaultOutputPath(firstFile: string, format: OutputFormat): string {
  const i = firstFile.lastIndexOf("/");
  return `${i >= 0 ? firstFile.slice(0, i) : "."}/output.${format}`;
}

type Item = { id: number; path: string };
type Ghost = {
  src: string | null;
  w: number;
  h: number;
  offX: number;
  offY: number;
  x: number;
  y: number;
};
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
  // The size picked on this screen. It starts from the saved setting and is never saved itself,
  // so a restart goes back to the setting.
  const [size, setSize] = useState(settings.videoSize);
  const [notice, setNotice] = useState<{ title: string; message: string } | null>(null);
  const formatRef = useRef<OutputFormat>(settings.outputFormat);
  formatRef.current = settings.outputFormat;

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") return;
        const added = sortByFileName(payload.paths).map((path) => ({
          id: nextId.current++,
          path,
        }));
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
      setStatus(statusText(event.payload, formatRef.current));
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
    listen("open-settings", () => setSettingsOpen(true)).then((fn) => (cancelled ? fn() : (unlisten = fn)));
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

  /** The size to use for `format`: a GIF is limited in width, so a bigger one is shrunk (with a notice). */
  function fitSize(format: OutputFormat, id: string): string {
    if (format !== "gif" || isGifSize(id)) return id;
    const next = gifSizeFor(id);
    setNotice({
      title: "GIF のサイズ",
      message: `GIF は幅 ${GIF_MAX_WIDTH}px までです（大きいとファイルが重くなりすぎるため）。動画サイズを ${videoSizeText(next)} に変更しました。`,
    });
    return next;
  }

  // At startup the saved format and size may not go together (a GIF is limited in width):
  // say so and fall back to MP4, which takes any size.
  useEffect(() => {
    if (settings.outputFormat !== "gif" || isGifSize(size)) return;
    updateSettings({ ...settings, outputFormat: "mp4" });
    setNotice({
      title: "出力形式を変更しました",
      message: `保存されていた設定が GIF でしたが、動画サイズ ${videoSizeText(size)} は GIF の上限（幅 ${GIF_MAX_WIDTH}px）を超えています。出力形式を MP4 に変更しました。GIF にするときは、サイズを小さくしてください。`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseSize(id: string) {
    setSize(fitSize(settings.outputFormat, id));
  }

  function chooseFormat(format: OutputFormat) {
    updateSettings({ ...settings, outputFormat: format });
    setSize(fitSize(format, size));
  }

  /** Changes made in the settings dialog; a new default size also becomes this screen's size. */
  function changeSettings(next: Settings) {
    if (next.videoSize !== settings.videoSize) setSize(fitSize(next.outputFormat, next.videoSize));
    updateSettings(next);
  }

  useEffect(() => {
    document.body.classList.toggle("is-dragging", Boolean(drag?.ghost));
    return () => document.body.classList.remove("is-dragging");
  }, [drag?.ghost]);

  const duration = parseDuration(durationInput);
  const hasStamp = settings.stampPath !== null;
  const useStamp = hasStamp && settings.stampEnabled;
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
    if (settings.outputFormat === "gif" && !isGifSize(size)) {
      setSize(fitSize("gif", size)); // warn first; the user starts the conversion again
      return;
    }
    if (ffmpegMissing) {
      setFfmpegDialogOpen(true);
      return;
    }
    setBusy(true);
    setBar(null);
    setStatus("保存先を選択中…");
    const format = settings.outputFormat;
    try {
      const outputPath = await save(
        format === "gif"
          ? {
              title: "GIF の保存先を選択",
              defaultPath: defaultOutputPath(files[0].path, format),
              filters: [{ name: "GIF アニメーション", extensions: ["gif"] }],
            }
          : {
              title: "動画の保存先を選択",
              defaultPath: defaultOutputPath(files[0].path, format),
              filters: [{ name: "MP4 動画", extensions: ["mp4"] }],
            },
      );
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
        stamp: useStamp && settings.stampPath ? { path: settings.stampPath, size: settings.stampSize } : null,
        videoSize: videoSizeFor(size),
        outputFormat: format,
        gifLoop: settings.gifLoop,
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
        <button type="button" className="convert" disabled={!canConvert} onClick={convert}>
          変換開始
        </button>
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
        <div className="row">
          <label>
            1枚あたりの表示時間（秒）
            <input value={durationInput} onChange={(e) => setDurationInput(e.target.value)} />
          </label>
        </div>
        <div className="row">
          <label className="size-pick">
            <span aria-hidden="true">動画サイズ</span>
            <VideoSizeSelect label="今回の動画サイズ" value={size} onChange={chooseSize} disabled={busy} />
          </label>
          <label>
            出力形式
            <select
              aria-label="出力形式"
              value={settings.outputFormat}
              disabled={busy}
              onChange={(e) => chooseFormat(e.target.value as OutputFormat)}
            >
              {OUTPUT_FORMATS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="row">
          <label className="stamp-toggle">
            <input
              type="checkbox"
              checked={useStamp}
              disabled={!hasStamp || busy}
              onChange={(e) => updateSettings({ ...settings, stampEnabled: e.target.checked })}
            />
            スタンプを付ける
          </label>
          {!hasStamp && (
            <button type="button" className="link" onClick={() => setSettingsOpen(true)}>
              スタンプ画像を設定…
            </button>
          )}
        </div>
      </section>
      {duration === null && <p role="alert">1枚あたりの表示時間は0より大きい数値を入力してください</p>}
      <div className="status-row">
        <p role="status">{status}</p>
        {bar && <progress value={bar.value} max={bar.max} />}
      </div>
      {ffmpegDialogOpen && <FfmpegDialog onRecheck={recheckFfmpeg} onClose={closeFfmpegDialog} />}
      {settingsOpen && <SettingsDialog settings={settings} onChange={changeSettings} onClose={closeSettings} />}
      {notice && <NoticeDialog title={notice.title} message={notice.message} onClose={() => setNotice(null)} />}
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
