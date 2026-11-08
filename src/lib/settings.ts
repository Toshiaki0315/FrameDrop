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
  { value: "720x404", label: "720×404（16:9）", group: "横向き" },
  { value: "720x540", label: "720×540（4:3）", group: "横向き" },
  { value: "640x480", label: "SD 640×480（4:3）", group: "横向き" },
  { value: "480x270", label: "480×270（16:9）", group: "横向き" },
  { value: "1080x1920", label: "縦 フルHD 1080×1920（9:16）", group: "縦向き" },
  { value: "720x1280", label: "縦 HD 720×1280（9:16）", group: "縦向き" },
  { value: "540x960", label: "縦 540×960（9:16）", group: "縦向き" },
  { value: "1080x1350", label: "縦長 1080×1350（4:5）", group: "縦向き" },
  { value: "720x900", label: "縦長 720×900（4:5）", group: "縦向き" },
  { value: "1080x1080", label: "正方形 1080×1080（1:1）", group: "正方形" },
  { value: "720x720", label: "正方形 720×720（1:1）", group: "正方形" },
  { value: "480x480", label: "正方形 480×480（1:1）", group: "正方形" },
];

export type OutputFormat = "mp4" | "gif";

export const OUTPUT_FORMATS: { value: OutputFormat; label: string }[] = [
  { value: "mp4", label: "MP4 動画" },
  { value: "gif", label: "GIF アニメーション" },
];

/** GIFs get huge quickly, so their width is capped. */
export const GIF_MAX_WIDTH = 720;

/** True for a size a GIF may use: a listed size no wider than GIF_MAX_WIDTH (never "auto"). */
export function isGifSize(id: string): boolean {
  const size = videoSizeFor(id);
  return size !== null && size.width <= GIF_MAX_WIDTH;
}

/**
 * The size to use for a GIF instead of `id`: the same one if it fits, else 720px wide with the
 * same aspect ratio ("auto" becomes 720×540, as the images' shape is not known here).
 */
export function gifSizeFor(id: string): string {
  if (isGifSize(id)) return id;
  const size = videoSizeFor(id);
  if (!size) return `${GIF_MAX_WIDTH}x540`;
  const height = Math.floor((GIF_MAX_WIDTH * size.height) / size.width / 2) * 2;
  return `${GIF_MAX_WIDTH}x${height}`;
}

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
  /** What the main screen writes: an MP4 or a GIF. */
  outputFormat: OutputFormat;
  /** GIF only: true repeats forever, false plays once. */
  gifLoop: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  stampPath: null,
  stampSize: "medium",
  stampEnabled: true,
  videoSize: "auto",
  outputFormat: "mp4",
  gifLoop: true,
};

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
      outputFormat: data.outputFormat === "gif" ? "gif" : "mp4",
      gifLoop: typeof data.gifLoop === "boolean" ? data.gifLoop : true,
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
