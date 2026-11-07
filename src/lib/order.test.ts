import { describe, expect, it } from "vitest";
import { moveItem, sortByFileName } from "./order";

describe("sortByFileName", () => {
  it("sorts by file name ascending regardless of directory", () => {
    expect(sortByFileName(["/z/c.png", "/a/b.png", "/m/a.png"])).toEqual([
      "/m/a.png",
      "/a/b.png",
      "/z/c.png",
    ]);
  });

  it("orders numbers naturally (img2 before img10)", () => {
    expect(sortByFileName(["/p/img10.png", "/p/img2.png", "/p/img1.png"])).toEqual([
      "/p/img1.png",
      "/p/img2.png",
      "/p/img10.png",
    ]);
  });

  it("does not mutate its input", () => {
    const input = ["/p/b.png", "/p/a.png"];
    sortByFileName(input);
    expect(input).toEqual(["/p/b.png", "/p/a.png"]);
  });
});

describe("moveItem", () => {
  it("moves an item forward and backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns an equal copy for same or out-of-range indexes", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(list, -1, 0)).toEqual(["a", "b"]);
    expect(moveItem(list, 0, 5)).toEqual(["a", "b"]);
    expect(moveItem(list, 0, 1)).not.toBe(list);
  });
});
