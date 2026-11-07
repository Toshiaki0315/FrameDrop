import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const saveMock = vi.fn();
let dropHandler: (e: { payload: { type: string; paths?: string[] } }) => void;
let progressHandler: (e: { payload: unknown }) => void;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: (...a: unknown[]) => saveMock(...a) }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: typeof dropHandler) => {
      dropHandler = cb;
      return () => {};
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (_name: string, cb: typeof progressHandler) => {
    progressHandler = cb;
    return () => {};
  },
}));

import App from "./App";

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(dropHandler).toBeDefined());
  await waitFor(() => expect(progressHandler).toBeDefined());
}

function titles(): (string | null)[] {
  return screen.getAllByRole("listitem").map((li) => li.getAttribute("title"));
}

function dragItem(from: number, to: number | null) {
  const items = screen.getAllByRole("listitem");
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    to === null ? null : items[to];
  fireEvent.pointerDown(items[from], { button: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 5, clientY: 5 });
  fireEvent.pointerUp(window);
}

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function generateCalls() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "generate_mp4");
}

function drop(paths: string[]) {
  act(() => dropHandler({ payload: { type: "drop", paths } }));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) =>
    cmd === "get_thumbnail" ? `data:image/png;base64,${args?.path}` : undefined,
  );
  saveMock.mockReset();
  saveMock.mockResolvedValue("/pics/output.mp4");
});

describe("App", () => {
  it("lists dropped files, ignores duplicates and sorts each batch by file name", async () => {
    await renderApp();
    drop(["/pics/b.png", "/pics/a.png"]);
    drop(["/pics/b.png", "/other/d.png", "/pics/c.png"]);
    expect(titles()).toEqual(["/pics/a.png", "/pics/b.png", "/pics/c.png", "/other/d.png"]);
  });

  it("shows thumbnails instead of file names", async () => {
    await renderApp();
    drop(["/pics/a.png", "/pics/b.png"]);
    const imgs = await screen.findAllByRole("img");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual([
      "data:image/png;base64,/pics/a.png",
      "data:image/png;base64,/pics/b.png",
    ]);
    expect(imgs.map((i) => i.getAttribute("alt"))).toEqual(["a.png", "b.png"]);
    expect(invokeMock).toHaveBeenCalledWith("get_thumbnail", { path: "/pics/a.png" });
    expect(screen.queryByText("/pics/a.png")).not.toBeInTheDocument();
  });

  it("falls back to a placeholder with the file name when a thumbnail fails", async () => {
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "get_thumbnail") throw new Error("boom");
    });
    await renderApp();
    drop(["/pics/a.png"]);
    expect(await screen.findByText("a.png")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("reorders thumbnails by dragging one onto another", async () => {
    await renderApp();
    drop(["/p/a.png", "/p/b.png", "/p/c.png"]);
    dragItem(0, 2);
    expect(titles()).toEqual(["/p/b.png", "/p/c.png", "/p/a.png"]);
    dragItem(2, 0);
    expect(titles()).toEqual(["/p/a.png", "/p/b.png", "/p/c.png"]);
  });

  it("keeps the order when released on itself or outside the list", async () => {
    await renderApp();
    drop(["/p/a.png", "/p/b.png"]);
    dragItem(0, 0);
    dragItem(1, null);
    expect(titles()).toEqual(["/p/a.png", "/p/b.png"]);
  });

  it("converts in the reordered order", async () => {
    const user = userEvent.setup();
    await renderApp();
    drop(["/pics/a.png", "/pics/b.png", "/pics/c.png"]);
    dragItem(2, 0);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    expect(generateCalls()[0][1]).toMatchObject({
      filePaths: ["/pics/c.png", "/pics/a.png", "/pics/b.png"],
    });
  });

  it("ignores non-drop drag events", async () => {
    await renderApp();
    act(() => dropHandler({ payload: { type: "over" } }));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("disables the convert button until files are dropped", async () => {
    await renderApp();
    const button = screen.getByRole("button", { name: "変換開始" });
    expect(button).toBeDisabled();
    drop(["/pics/a.png"]);
    expect(button).toBeEnabled();
  });

  it("shows an error and disables convert for an invalid duration", async () => {
    const user = userEvent.setup();
    await renderApp();
    drop(["/pics/a.png"]);
    const input = screen.getByLabelText("1枚あたりの表示時間（秒）");
    await user.clear(input);
    await user.type(input, "0");
    expect(screen.getByRole("alert")).toHaveTextContent("1枚あたりの表示時間は0より大きい数値を入力してください");
    expect(screen.getByRole("button", { name: "変換開始" })).toBeDisabled();
  });

  it("opens a save dialog defaulting to output.mp4 next to the first image", async () => {
    const user = userEvent.setup();
    await renderApp();
    drop(["/pics/a.png"]);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: "/pics/output.mp4",
      filters: [{ name: "MP4 動画", extensions: ["mp4"] }],
    });
  });

  it("uses the path chosen in the save dialog", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue("/movies/my.mp4");
    await renderApp();
    drop(["/pics/a.png"]);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    expect(invokeMock).toHaveBeenCalledWith(
      "generate_mp4",
      expect.objectContaining({ outputPath: "/movies/my.mp4" }),
    );
  });

  it("does not convert when the save dialog is cancelled", async () => {
    const user = userEvent.setup();
    saveMock.mockResolvedValue(null);
    await renderApp();
    drop(["/pics/a.png"]);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    expect(generateCalls()).toHaveLength(0);
    expect(screen.getByRole("status")).toHaveTextContent("キャンセルしました");
  });

  it("invokes generate_mp4 with file paths, duration and output path", async () => {
    const user = userEvent.setup();
    await renderApp();
    drop(["/pics/a.png", "/pics/b.png"]);
    const input = screen.getByLabelText("1枚あたりの表示時間（秒）");
    await user.clear(input);
    await user.type(input, "2.5");
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    expect(invokeMock).toHaveBeenCalledWith("generate_mp4", {
      filePaths: ["/pics/a.png", "/pics/b.png"],
      durationPerImage: 2.5,
      outputPath: "/pics/output.mp4",
    });
  });

  it("updates the status from progress events", async () => {
    await renderApp();
    act(() => progressHandler({ payload: { status: "started", current: 0, total: 3 } }));
    expect(screen.getByRole("status")).toHaveTextContent("変換を開始しました");
    act(() => progressHandler({ payload: { status: "progress", current: 2, total: 3 } }));
    expect(screen.getByRole("status")).toHaveTextContent("処理中 2/3");
    act(() => progressHandler({ payload: { status: "completed", current: 3, total: 3 } }));
    expect(screen.getByRole("status")).toHaveTextContent("完了しました");
  });

  it("shows an error status when generate_mp4 rejects", async () => {
    const user = userEvent.setup();
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "generate_mp4") throw "ffmpeg not found";
      return "data:image/png;base64,x";
    });
    await renderApp();
    drop(["/pics/a.png"]);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("エラー: ffmpeg not found"),
    );
  });

  describe("while converting", () => {
    const convertButton = () => screen.getByRole("button", { name: "変換開始" });

    it("shows a message and disables the button as soon as it is clicked", async () => {
      const user = userEvent.setup();
      const dialog = deferred<string | null>();
      saveMock.mockReturnValue(dialog.promise);
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(convertButton());
      expect(screen.getByRole("status")).toHaveTextContent("保存先を選択中");
      expect(convertButton()).toBeDisabled();
    });

    it("shows a preparing message and stays disabled until generate_mp4 finishes", async () => {
      const user = userEvent.setup();
      const job = deferred();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") return job.promise;
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(convertButton());
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("変換を準備中"));
      expect(convertButton()).toBeDisabled();
      await act(async () => job.resolve());
      await waitFor(() => expect(convertButton()).toBeEnabled());
    });

    it("runs only one conversion even if clicked repeatedly", async () => {
      const user = userEvent.setup();
      const job = deferred();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") return job.promise;
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.dblClick(convertButton());
      await user.click(convertButton());
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      await act(async () => job.resolve());
    });

    it("re-enables the button after a cancel or an error", async () => {
      const user = userEvent.setup();
      saveMock.mockResolvedValueOnce(null);
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(convertButton());
      await waitFor(() => expect(convertButton()).toBeEnabled());

      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") throw "boom";
        return "data:image/png;base64,x";
      });
      await user.click(convertButton());
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("エラー: boom"));
      expect(convertButton()).toBeEnabled();
    });
  });
});
