import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SETTINGS,
  STAMP_MAX,
  STAMP_MIN,
  clampStampSize,
  loadSettings,
  saveSettings,
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

describe("clampStampSize", () => {
  it("keeps the size within 32..64 and rounds to whole pixels", () => {
    expect([STAMP_MIN, STAMP_MAX]).toEqual([32, 64]);
    expect(clampStampSize(10)).toBe(32);
    expect(clampStampSize(100)).toBe(64);
    expect(clampStampSize(47.6)).toBe(48);
    expect(clampStampSize(Number.NaN)).toBe(DEFAULT_SETTINGS.stampSize);
  });
});

describe("loadSettings", () => {
  it("returns defaults when nothing is stored or storage is unavailable", () => {
    expect(loadSettings(fakeStorage())).toEqual({ stampPath: null, stampSize: 48 });
    expect(loadSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
  });

  it("restores stored values, clamping the size", () => {
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png", stampSize: 40 })))).toEqual({
      stampPath: "/s.png",
      stampSize: 40,
    });
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "/s.png", stampSize: 999 }))).stampSize).toBe(64);
  });

  it("ignores corrupt or wrongly typed data", () => {
    expect(loadSettings(fakeStorage("{not json"))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: 5, stampSize: "x" })))).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeStorage(JSON.stringify({ stampPath: "", stampSize: 40 })))).toEqual({
      stampPath: null,
      stampSize: 40,
    });
  });
});

describe("saveSettings", () => {
  it("writes JSON that loadSettings reads back", () => {
    const storage = fakeStorage();
    saveSettings(storage, { stampPath: "/a.gif", stampSize: 33 });
    expect(loadSettings(storage)).toEqual({ stampPath: "/a.gif", stampSize: 33 });
  });

  it("does not throw when storage fails", () => {
    const failing = { setItem: vi.fn(() => { throw new Error("quota"); }) };
    expect(() => saveSettings(failing, DEFAULT_SETTINGS)).not.toThrow();
  });
});
