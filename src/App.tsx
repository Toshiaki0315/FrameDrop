import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseDuration } from "./lib/duration";
import { baseName, moveItem, sortByFileName } from "./lib/order";
import "./App.css";

type Progress = { status: "started" | "progress" | "completed"; current: number; total: number };

function statusText(p: Progress): string {
  switch (p.status) {
    case "started":
      return "変換を開始しました";
    case "progress":
      return `処理中 ${p.current}/${p.total}`;
    case "completed":
      return "完了しました";
  }
}

function defaultOutputPath(firstFile: string): string {
  const i = firstFile.lastIndexOf("/");
  return `${i >= 0 ? firstFile.slice(0, i) : "."}/output.mp4`;
}

function Thumbnail({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    invoke<string>("get_thumbnail", { path })
      .then((url) => live && setSrc(url))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [path]);

  const name = baseName(path);
  if (src) return <img src={src} alt={name} draggable={false} />;
  return <div className="placeholder">{failed ? name : ""}</div>;
}

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [durationInput, setDurationInput] = useState("1");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState<{ from: number; over: number | null } | null>(null);

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
    listen<Progress>("conversion-progress", (event) => setStatus(statusText(event.payload))).then(
      (fn) => (cancelled ? fn() : (unlisten = fn)),
    );
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const duration = parseDuration(durationInput);
  const canConvert = files.length > 0 && duration !== null && !busy;

  function startDrag(e: React.PointerEvent, from: number) {
    if (e.button > 0) return;
    let over: number | null = null;
    setDrag({ from, over });
    const onMove = (ev: PointerEvent) => {
      const el = document.elementFromPoint?.(ev.clientX, ev.clientY)?.closest("[data-index]");
      over = el ? Number(el.getAttribute("data-index")) : null;
      setDrag({ from, over });
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
    setStatus("保存先を選択中…");
    try {
      const outputPath = await save({
        defaultPath: defaultOutputPath(files[0]),
        filters: [{ name: "MP4 動画", extensions: ["mp4"] }],
      });
      if (outputPath === null) {
        setStatus("キャンセルしました");
        return;
      }
      setStatus("変換を準備中…");
      await invoke("generate_mp4", {
        filePaths: files,
        durationPerImage: duration,
        outputPath,
      });
    } catch (e) {
      setStatus(`エラー: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app">
      <header>
        <h1>FrameDrop</h1>
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
          {files.map((f, i) => (
            <li
              key={f}
              title={f}
              data-index={i}
              className={[
                drag?.from === i ? "dragging" : "",
                drag && drag.over === i && drag.from !== i ? "drop-target" : "",
              ].join(" ")}
              onPointerDown={(e) => startDrag(e, i)}
            >
              <Thumbnail path={f} />
              <span className="badge">{i + 1}</span>
            </li>
          ))}
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
      <p role="status">{status}</p>
    </main>
  );
}
