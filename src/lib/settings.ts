const STORAGE_KEY = "framedrop.settings";

export type StampSize = "small" | "medium" | "large";

/** Stamp size levels: a fraction of each image's short side (1/30, 1/20, 1/10). */
export const STAMP_SIZES: { value: StampSize; label: string }[] = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "large", label: "大" },
];

export type VideoSizeOption = { value: string; label: string; group?: string };

/**
 * Common output sizes ("WxH"). "auto" fits the largest input image. Every size is even
 * (required by yuv420p); images keep their aspect ratio and leftover area is black.
 */
export const VIDEO_SIZES: VideoSizeOption[] = [
  { value: "auto", label: "自動（画像の最大サイズに合わせる）" },
  { value: "3840x2160", label: "4K 3840×2160（16:9）", group: "横向き" },
  { value: "1920x1080", label: "フルHD 1920×1080（16:9）", group: "横向き" },
  { value: "1280x720", label: "HD 1280×720（16:9）", group: "横向き" },
  { value: "640x480", label: "SD 640×480（4:3）", group: "横向き" },
  { value: "1080x1920", label: "縦 フルHD 1080×1920（9:16）", group: "縦向き" },
  { value: "720x1280", label: "縦 HD 720×1280（9:16）", group: "縦向き" },
  { value: "1080x1350", label: "縦長 1080×1350（4:5）", group: "縦向き" },
  { value: "1080x1080", label: "正方形 1080×1080（1:1）", group: "正方形" },
];

/** The size sent to the backend for a choice; null means automatic. */
export function videoSizeFor(id: string): { width: number; height: number } | null {
  if (id === "auto" || !VIDEO_SIZES.some((v) => v.value === id)) return null;
  const [width, height] = id.split("x").map(Number);
  return { width, height };
}

/** Short text for the chosen size: "自動" or e.g. "1920×1080". */
export function videoSizeText(id: string): string {
  const size = videoSizeFor(id);
  return size ? `${size.width}×${size.height}` : "自動";
}

export type Settings = {
  stampPath: string | null;
  stampSize: StampSize;
  /** The "スタンプを付ける" checkbox: lets the stamp be turned off without clearing the image. */
  stampEnabled: boolean;
  /** An id from VIDEO_SIZES. */
  videoSize: string;
};

export const DEFAULT_SETTINGS: Settings = { stampPath: null, stampSize: "medium", stampEnabled: true, videoSize: "auto" };

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
      videoSize:
        typeof data.videoSize === "string" && VIDEO_SIZES.some((v) => v.value === data.videoSize)
          ? data.videoSize
          : DEFAULT_SETTINGS.videoSize,
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
