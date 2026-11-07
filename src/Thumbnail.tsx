import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { baseName } from "./lib/order";

export function Thumbnail({ path }: { path: string }) {
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
