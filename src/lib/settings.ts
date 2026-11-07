const STORAGE_KEY = "framedrop.settings";

export type StampSize = "small" | "medium" | "large";

/** Stamp size levels: a fraction of each image's short side (1/30, 1/20, 1/10). */
export const STAMP_SIZES: { value: StampSize; label: string }[] = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];

export type Settings = {
  stampPath: string | null;
  stampSize: StampSize;
  /** The "スタンプを付ける" checkbox: lets the stamp be turned off without clearing the image. */
  stampEnabled: boolean;
};

export const DEFAULT_SETTINGS: Settings = { stampPath: null, stampSize: "medium", stampEnabled: true };

function isStampSize(v: unknown): v is StampSize {
  return STAMP_SIZES.some((s) => s.value === v);
}

export function loadSettings(storage: Pick<Storage, "getItem"> | undefined): Settings {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const data = JSON.parse(raw) as Record<string, unknown>;
    return {
      stampPath: typeof data.stampPath === "string" && data.stampPath !== "" ? data.stampPath : null,
      stampSize: isStampSize(data.stampSize) ? data.stampSize : DEFAULT_SETTINGS.stampSize,
      // settings saved before the checkbox existed keep using their stamp
      stampEnabled: typeof data.stampEnabled === "boolean" ? data.stampEnabled : true,
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
