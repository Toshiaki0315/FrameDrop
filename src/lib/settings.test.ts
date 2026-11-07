import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, STAMP_SIZES, loadSettings, saveSettings } from "./settings";

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
    expect(DEFAULT_SETTINGS).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true });
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored or storage is unavailable", () => {
    expect(loadSettings(fakeStorage())).toEqual({ stampPath: null, stampSize: "medium", stampEnabled: true });
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

describe("saveSettings", () => {
  it("writes JSON that loadSettings reads back", () => {
    const storage = fakeStorage();
    saveSettings(storage, { stampPath: "/a.gif", stampSize: "small", stampEnabled: false });
    expect(loadSettings(storage)).toEqual({ stampPath: "/a.gif", stampSize: "small", stampEnabled: false });
  });

  it("does not throw when storage fails", () => {
    const failing = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => saveSettings(failing, DEFAULT_SETTINGS)).not.toThrow();
  });
});
