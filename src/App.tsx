import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { parseDuration } from "./lib/duration";

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

export default function App() {
  const [files, setFiles] = useState<string[]>([]);
  const [durationInput, setDurationInput] = useState("1");
  const [status, setStatus] = useState("");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const payload = event.payload;
        if (payload.type !== "drop") return;
        setFiles((prev) => [...prev, ...payload.paths.filter((p) => !prev.includes(p))]);
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
  const canConvert = files.length > 0 && duration !== null;

  async function convert() {
    if (!canConvert || duration === null) return;
    try {
      await invoke("generate_mp4", {
        filePaths: files,
        durationPerImage: duration,
        outputPath: defaultOutputPath(files[0]),
      });
    } catch (e) {
      setStatus(`エラー: ${String(e)}`);
    }
  }

  return (
    <main className="container">
      <h1>FrameDrop</h1>
      <p>画像ファイルをウィンドウにドロップしてください</p>
      <ul>
        {files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <label>
        1枚あたりの表示時間（秒）
        <input value={durationInput} onChange={(e) => setDurationInput(e.target.value)} />
      </label>
      {duration === null && (
        <p role="alert">1枚あたりの表示時間は0より大きい数値を入力してください</p>
      )}
      <button disabled={!canConvert} onClick={convert}>
        変換開始
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
