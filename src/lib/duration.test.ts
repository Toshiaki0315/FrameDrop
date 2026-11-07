import { describe, expect, it } from "vitest";
import { parseDuration } from "./duration";

describe("parseDuration", () => {
  it.each([
    ["2", 2],
    ["0.5", 0.5],
    [" 3 ", 3],
  ])("accepts %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["", "0", "-1", "abc", "NaN", "Infinity", "1e999"])("rejects %j", (input) => {
    expect(parseDuration(input)).toBeNull();
  });
});
