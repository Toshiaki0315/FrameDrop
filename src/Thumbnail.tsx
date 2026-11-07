import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { baseName } from "./lib/order";

// One request per distinct image, even when the same image is listed several times.
const cache = new Map<string, Promise<string>>();

export function clearThumbnailCache(): void {
  cache.clear();
}

function fetchThumbnail(path: string): Promise<string> {
  let pending = cache.get(path);
  if (!pending) {
    pending = invoke<string>("get_thumbnail", { path });
    cache.set(path, pending);
    pending.catch(() => cache.delete(path)); // failures are retried next time
  }
  return pending;
}

export function Thumbnail({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    fetchThumbnail(path)
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
