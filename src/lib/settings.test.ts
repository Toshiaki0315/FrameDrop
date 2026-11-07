import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  STAMP_SIZES,
  VIDEO_SIZES,
  loadSettings,
  saveSettings,
  videoSizeFor,
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
    expect(DEFAULT_SETTINGS).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true, videoSize: "auto" });
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored or storage is unavailable", () => {
    expect(loadSettings(fakeStorage())).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true, videoSize: "auto" });
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
      "640x480",
      "1080x1920",
      "720x1280",
      "1080x1350",
      "1080x1080",
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

  it("defaults to automatic, restores a valid choice and ignores unknown values", () => {
    expect(DEFAULT_SETTINGS.videoSize).toBe("auto");
    const stored = (videoSize: unknown) => fakeStorage(JSON.stringify({ stampPath: null, videoSize }));
    expect(loadSettings(stored("1280x720")).videoSize).toBe("1280x720");
    expect(loadSettings(stored("999x999")).videoSize).toBe("auto");
    expect(loadSettings(stored(720)).videoSize).toBe("auto");
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png" }))).videoSize).toBe("auto");
  });
});

describe("saveSettings", () => {
  it("writes JSON that loadSettings reads back", () => {
    const storage = fakeStorage();
    const settings = { stampPath: "/a.gif", stampSize: "small" as const, stampEnabled: false, videoSize: "1080x1920" };
    saveSettings(storage, settings);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("does not throw when storage fails", () => {
    const failing = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => saveSettings(failing, DEFAULT_SETTINGS)).not.toThrow();
  });
});
