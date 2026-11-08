import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  GIF_MAX_WIDTH,
  gifSizeFor,
  isGifSize,
  STAMP_SIZES,
  VIDEO_SIZES,
  loadSettings,
  saveSettings,
  videoSizeFor,
  videoSizeText,
} from "./settings";

function fakeStorage(initial?: string) {
  const data: Record<string, string> = initial === undefined ? {} : { "framedrop.settings": initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe("stamp size levels", () => {
  it("offers small, medium and large, defaulting to medium", () => {
    expect(STAMP_SIZES.map((s) => s.value)).toEqual(["small", "medium", "large"]);
    expect(STAMP_SIZES.map((s) => s.label)).toEqual(["小", "中", "大"]);
    expect(DEFAULT_SETTINGS).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true, videoSize: "auto", outputFormat: "mp4", gifLoop: true });
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored or storage is unavailable", () => {
    expect(loadSettings(fakeStorage())).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true, videoSize: "auto", outputFormat: "mp4", gifLoop: true });
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });

  it("restores stored values", () => {
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png", stampSize: "large" })))).toEqual({
      stampPath: "/s.png",
      stampSize: "large",
      stampEnabled: true,
      videoSize: "auto",
      outputFormat: "mp4",
      gifLoop: true,
    });
  });

  it("falls back to medium for unknown or old numeric sizes", () => {
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png", stampSize: 48 }))).stampSize).toBe("medium");
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png", stampSize: "huge" }))).stampSize).toBe("medium");
  });

  it("ignores corrupt or wrongly typed data", () => {
    expect(loadSettings(fakeStorage("{not json"))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: 5, stampSize: "x" })))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "", stampSize: "small" })))).toEqual({
      stampPath: null,
      stampSize: "small",
      stampEnabled: true,
      videoSize: "auto",
      outputFormat: "mp4",
      gifLoop: true,
    });
  });
});

describe("stampEnabled", () => {
  it("is on by default and for settings saved before the checkbox existed", () => {
    expect(DEFAULT_SETTINGS.stampEnabled).toBe(true);
    const old = JSON.stringify({ stampPath: "/s.png", stampSize: "large" });
    expect(loadSettings(fakeStorage(old)).stampEnabled).toBe(true);
  });

  it("restores an explicit off, and ignores non-boolean values", () => {
    const off = JSON.stringify({ stampPath: "/s.png", stampSize: "small", stampEnabled: false });
    expect(loadSettings(fakeStorage(off)).stampEnabled).toBe(false);
    const junk = JSON.stringify({ stampPath: "/s.png", stampEnabled: "no" });
    expect(loadSettings(fakeStorage(junk)).stampEnabled).toBe(true);
  });
});

describe("video size", () => {
  it("starts with automatic and offers the common sizes", () => {
    expect(VIDEO_SIZES[0]).toMatchObject({ value: "auto" });
    expect(VIDEO_SIZES.map((v) => v.value)).toEqual([
      "auto",
      "3840x2160",
      "1920x1080",
      "1280x720",
      "720x404",
      "720x540",
      "640x480",
      "480x270",
      "1080x1920",
      "720x1280",
      "540x960",
      "1080x1350",
      "720x900",
      "1080x1080",
      "720x720",
      "480x480",
    ]);
    for (const v of VIDEO_SIZES.slice(1)) {
      const [w, h] = v.value.split("x").map(Number);
      expect(w % 2 === 0 && h % 2 === 0).toBe(true);
      expect(v.label).toContain(`${w}×${h}`);
    }
  });

  it("converts a choice into the size sent to the backend (null for automatic)", () => {
    expect(videoSizeFor("1920x1080")).toEqual({ width: 1920, height: 1080 });
    expect(videoSizeFor("1080x1920")).toEqual({ width: 1080, height: 1920 });
    expect(videoSizeFor("auto")).toBeNull();
    expect(videoSizeFor("123x45")).toBeNull();
  });

  it("describes a choice briefly for display", () => {
    expect(videoSizeText("auto")).toBe("自動");
    expect(videoSizeText("1920x1080")).toBe("1920×1080");
    expect(videoSizeText("1080x1920")).toBe("1080×1920");
    expect(videoSizeText("nonsense")).toBe("自動");
  });

  it("defaults to automatic, restores a valid choice and ignores unknown values", () => {
    expect(DEFAULT_SETTINGS.videoSize).toBe("auto");
    const stored = (videoSize: unknown) => fakeStorage(JSON.stringify({ stampPath: null, videoSize }));
    expect(loadSettings(stored("1280x720")).videoSize).toBe("1280x720");
    expect(loadSettings(stored("999x999")).videoSize).toBe("auto");
    expect(loadSettings(stored(720)).videoSize).toBe("auto");
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png" }))).videoSize).toBe("auto");
  });
});

describe("GIF", () => {
  it("loops forever and writes MP4 by default", () => {
    expect(DEFAULT_SETTINGS.outputFormat).toBe("mp4");
    expect(DEFAULT_SETTINGS.gifLoop).toBe(true);
  });

  it("restores the format and loop choice, ignoring bad values", () => {
    const stored = (data: object) => fakeStorage(JSON.stringify({ stampPath: null, ...data }));
    expect(loadSettings(stored({ outputFormat: "gif", gifLoop: false }))).toMatchObject({ outputFormat: "gif", gifLoop: false });
    expect(loadSettings(stored({ outputFormat: "avi", gifLoop: "yes" }))).toMatchObject({ outputFormat: "mp4", gifLoop: true });
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: null })))).toMatchObject({ outputFormat: "mp4", gifLoop: true });
  });

  it("allows widths up to 720px, and not automatic", () => {
    expect(GIF_MAX_WIDTH).toBe(720);
    expect(isGifSize("720x404")).toBe(true);
    expect(isGifSize("480x270")).toBe(true);
    expect(isGifSize("640x480")).toBe(true);
    expect(isGifSize("720x1280")).toBe(true);
    expect(isGifSize("1280x720")).toBe(false);
    expect(isGifSize("3840x2160")).toBe(false);
    expect(isGifSize("1080x1920")).toBe(false);
    expect(isGifSize("auto")).toBe(false);
  });

  it("offers GIF-sized choices of 480–720px in every orientation", () => {
    const gif = VIDEO_SIZES.filter((v) => isGifSize(v.value));
    expect(gif.length).toBeGreaterThanOrEqual(6);
    for (const v of gif) {
      const [w] = v.value.split("x").map(Number);
      expect(w).toBeGreaterThanOrEqual(480);
      expect(w).toBeLessThanOrEqual(720);
    }
  });

  it("shrinks any other size to 720px wide, keeping the aspect ratio", () => {
    expect(gifSizeFor("3840x2160")).toBe("720x404");
    expect(gifSizeFor("1920x1080")).toBe("720x404");
    expect(gifSizeFor("1280x720")).toBe("720x404");
    expect(gifSizeFor("1080x1920")).toBe("720x1280");
    expect(gifSizeFor("1080x1350")).toBe("720x900");
    expect(gifSizeFor("1080x1080")).toBe("720x720");
    expect(gifSizeFor("auto")).toBe("720x540");
  });

  it("every shrunk size is one of the listed choices", () => {
    const ids = VIDEO_SIZES.map((v) => v.value);
    for (const v of VIDEO_SIZES) expect(ids).toContain(gifSizeFor(v.value));
  });

  it("keeps a size that already fits", () => {
    expect(gifSizeFor("640x480")).toBe("640x480");
    expect(gifSizeFor("480x270")).toBe("480x270");
  });
});

describe("saveSettings", () => {
  it("writes JSON that loadSettings reads back", () => {
    const storage = fakeStorage();
    const settings = { stampPath: "/a.gif", stampSize: "small" as const, stampEnabled: false, videoSize: "1080x1920", outputFormat: "gif" as const, gifLoop: false };
    saveSettings(storage, settings);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("does not throw when storage fails", () => {
    const failing = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => saveSettings(failing, DEFAULT_SETTINGS)).not.toThrow();
  });
});
