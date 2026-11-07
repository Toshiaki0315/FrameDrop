export const STAMP_MIN = 32;
export const STAMP_MAX = 64;
const STORAGE_KEY = "framedrop.settings";

export type Settings = { stampPath: string | null; stampSize: number };

export const DEFAULT_SETTINGS: Settings = { stampPath: null, stampSize: 48 };

/** Rounds to whole pixels and keeps the size within 32..64. */
export function clampStampSize(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.stampSize;
  return Math.min(STAMP_MAX, Math.max(STAMP_MIN, Math.round(n)));
}

export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      stampPath: typeof data.stampPath === "string" && data.stampPath !== "" ? data.stampPath : null,
      stampSize:
        typeof data.stampSize === "number" ? clampStampSize(data.stampSize) : DEFAULT_SETTINGS.stampSize,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: Pick<Storage, "setItem"> | undefined, settings: Settings): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}
