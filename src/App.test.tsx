import { render, screen, waitFor, act, fireEvent, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const saveMock = vi.fn();
const openMock = vi.fn();
const writeTextMock = vi.fn();
let dropHandler: (e: { payload: { type: string; paths?: string[] } }) => void;
const listeners: Record<string, (e: { payload: unknown }) => void> = {};

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: (...a: unknown[]) => saveMock(...a),
  open: (...a: unknown[]) => openMock(...a),
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (cb: typeof dropHandler) => {
      dropHandler = cb;
      return () => {};
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, cb: (e: { payload: unknown }) => void) => {
    listeners[name] = cb;
    return () => {};
  },
}));

import App from "./App";
import { clearThumbnailCache } from "./Thumbnail";

async function renderApp() {
  render(<App />);
  await waitFor(() => expect(dropHandler).toBeDefined());
  await waitFor(() => expect(listeners["conversion-progress"]).toBeDefined());
  await waitFor(() => expect(listeners["open-settings"]).toBeDefined());
}

function titles(): (string | null)[] {
  return screen.getAllByRole("listitem").map((li) => li.getAttribute("title"));
}

function beginDrag(from: number, to: number | null) {
  const items = screen.getAllByRole("listitem");
  (document as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = () =>
    to === null ? null : items[to];
  fireEvent.pointerDown(items[from], { button: 0, pointerId: 1, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 40, clientY: 50 });
}

function endDrag() {
  fireEvent.pointerUp(window);
}

function dragItem(from: number, to: number | null) {
  beginDrag(from, to);
  endDrag();
}

function insertMarkers(): (string | null)[] {
  return screen.getAllByRole("listitem").map((li) => li.getAttribute("data-insert"));
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

/** userEvent.setup() installs its own clipboard stub, so install ours after calling it. */
function mockClipboard() {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: writeTextMock }, configurable: true });
}

function generateCalls() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "generate_mp4");
}

function drop(paths: string[]) {
  act(() => dropHandler({ payload: { type: "drop", paths } }));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd === "check_ffmpeg") return true;
    return cmd === "get_thumbnail" ? `data:image/png;base64,${args?.path}` : undefined;
  });
  writeTextMock.mockReset();
  writeTextMock.mockResolvedValue(undefined);
  clearThumbnailCache();
  openMock.mockReset();
  localStorage.clear();
  saveMock.mockReset();
  saveMock.mockResolvedValue("/pics/output.mp4");
});

describe("App", () => {
  it("does not repeat the app name in the page (the title bar shows it)", async () => {
    await renderApp();
    expect(screen.queryByRole("heading", { name: "FrameDrop" })).not.toBeInTheDocument();
    expect(screen.queryByText("FrameDrop")).not.toBeInTheDocument();
  });

  it("lists dropped files, sorting each batch by file name and appending later drops", async () => {
    await renderApp();
    drop(["/pics/b.png", "/pics/a.png"]);
    drop(["/pics/b.png", "/other/d.png", "/pics/c.png"]);
    expect(titles()).toEqual([
      "/pics/a.png",
      "/pics/b.png",
      "/pics/b.png",
      "/pics/c.png",
      "/other/d.png",
    ]);
  });

  describe("using the same image several times", () => {
    const item = (i: number) => screen.getAllByRole("listitem")[i];
    const badges = () => screen.getAllByRole("listitem").map((li) => li.querySelector(".badge")?.textContent);

    it("adds an image again when it is dropped again, without key warnings", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      await renderApp();
      drop(["/p/a.png"]);
      drop(["/p/a.png"]);
      drop(["/p/a.png"]);
      expect(titles()).toEqual(["/p/a.png", "/p/a.png", "/p/a.png"]);
      expect(badges()).toEqual(["1", "2", "3"]);
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });

    it("duplicates a thumbnail right after itself with its button", async () => {
      const user = userEvent.setup();
      await renderApp();
      drop(["/p/a.png", "/p/b.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を複製" }));
      expect(titles()).toEqual(["/p/a.png", "/p/a.png", "/p/b.png"]);
      expect(badges()).toEqual(["1", "2", "3"]);
    });

    it("deletes only the chosen entry, and shows the empty state when none are left", async () => {
      const user = userEvent.setup();
      await renderApp();
      drop(["/p/a.png", "/p/b.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を複製" }));
      await user.click(within(item(1)).getByRole("button", { name: "a.png を削除" }));
      expect(titles()).toEqual(["/p/a.png", "/p/b.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を削除" }));
      await user.click(within(item(0)).getByRole("button", { name: "b.png を削除" }));
      expect(screen.queryAllByRole("listitem")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "変換開始" })).toBeDisabled();
    });

    it("does not start a drag when a thumbnail's buttons are pressed", async () => {
      await renderApp();
      drop(["/p/a.png", "/p/b.png"]);
      const button = within(item(0)).getByRole("button", { name: "a.png を複製" });
      fireEvent.pointerDown(button, { button: 0, pointerId: 1, clientX: 5, clientY: 5 });
      fireEvent.pointerMove(window, { clientX: 40, clientY: 50 });
      expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
      fireEvent.pointerUp(window);
    });

    it("can reorder duplicated entries independently", async () => {
      const user = userEvent.setup();
      await renderApp();
      drop(["/p/a.png", "/p/b.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を複製" })); // a a b
      dragItem(0, 2); // a b a
      expect(titles()).toEqual(["/p/a.png", "/p/b.png", "/p/a.png"]);
    });

    it("sends repeated images to generate_mp4 in order", async () => {
      const user = userEvent.setup();
      await renderApp();
      drop(["/pics/a.png", "/pics/b.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を複製" }));
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      expect(generateCalls()[0][1]).toMatchObject({
        filePaths: ["/pics/a.png", "/pics/a.png", "/pics/b.png"],
      });
    });

    it("requests a thumbnail only once per distinct image", async () => {
      const user = userEvent.setup();
      await renderApp();
      drop(["/p/a.png"]);
      await user.click(within(item(0)).getByRole("button", { name: "a.png を複製" }));
      drop(["/p/a.png"]);
      await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(3));
      const calls = invokeMock.mock.calls.filter(([cmd]) => cmd === "get_thumbnail");
      expect(calls).toHaveLength(1);
    });

    it("disables duplicate and delete while converting", async () => {
      const user = userEvent.setup();
      const job = deferred();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") return job.promise;
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/p/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("変換を準備中"));
      expect(within(item(0)).getByRole("button", { name: "a.png を複製" })).toBeDisabled();
      expect(within(item(0)).getByRole("button", { name: "a.png を削除" })).toBeDisabled();
      await act(async () => job.resolve());
    });
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

  it("shows a ghost of the grabbed thumbnail that follows the pointer", async () => {
    await renderApp();
    drop(["/p/a.png", "/p/b.png"]);
    await screen.findAllByRole("img");
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
    beginDrag(0, 1);
    const ghost = screen.getByTestId("drag-ghost");
    expect(ghost.querySelector("img")).toHaveAttribute("src", "data:image/png;base64,/p/a.png");
    expect(ghost.style.left).toBe("30px");
    expect(ghost.style.top).toBe("40px");
    endDrag();
    expect(screen.queryByTestId("drag-ghost")).not.toBeInTheDocument();
  });

  it("marks where the thumbnail will be inserted while dragging", async () => {
    await renderApp();
    drop(["/p/a.png", "/p/b.png", "/p/c.png"]);
    expect(insertMarkers()).toEqual([null, null, null]);

    beginDrag(0, 2); // moving forward: lands after the hovered item
    expect(insertMarkers()).toEqual([null, null, "after"]);
    endDrag();
    expect(insertMarkers()).toEqual([null, null, null]);

    beginDrag(2, 0); // moving backward: lands before the hovered item
    expect(insertMarkers()).toEqual(["before", null, null]);
    endDrag();
  });

  it("shows no insertion mark when hovering itself or outside the list", async () => {
    await renderApp();
    drop(["/p/a.png", "/p/b.png"]);
    beginDrag(0, 0);
    expect(insertMarkers()).toEqual([null, null]);
    endDrag();
    beginDrag(1, null);
    expect(insertMarkers()).toEqual([null, null]);
    endDrag();
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
      title: "動画の保存先を選択",
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
      stamp: null,
      videoSize: null,
    });
  });

  describe("progress events", () => {
    const emitProgress = (status: string, current: number, total: number) =>
      act(() => listeners["conversion-progress"]({ payload: { status, current, total } }));
    const status = () => screen.getByRole("status");
    const bar = () => screen.getByRole("progressbar") as HTMLProgressElement;

    it("shows no progress bar while idle", async () => {
      await renderApp();
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("shows the stage text with an (n/total) counter for stamping", async () => {
      await renderApp();
      emitProgress("stamping", 1, 3);
      expect(status()).toHaveTextContent("スタンプを差し込み中 (1/3)");
      emitProgress("converting", 2, 5);
      expect(status()).toHaveTextContent("画像を変換中 (2/5)");
    });

    it("shows a determinate bar to the right of the text for counted stages", async () => {
      await renderApp();
      emitProgress("stamping", 2, 4);
      expect(bar().max).toBe(4);
      expect(bar().value).toBe(1); // one image done, the second in progress
      expect(status().nextElementSibling).toBe(bar());
      emitProgress("stamping", 4, 4);
      expect(bar().value).toBe(3);
    });

    it("shows an indeterminate bar for started and encoding", async () => {
      await renderApp();
      emitProgress("started", 0, 3);
      expect(status()).toHaveTextContent("変換を開始しました");
      expect(bar()).not.toHaveAttribute("value");
      emitProgress("encoding", 0, 3);
      expect(status()).toHaveTextContent("動画を書き出し中");
      expect(bar()).not.toHaveAttribute("value");
    });

    it("shows the actual output size while encoding and when done", async () => {
      await renderApp();
      act(() =>
        listeners["conversion-progress"]({
          payload: { status: "encoding", current: 0, total: 3, width: 1920, height: 1080 },
        }),
      );
      expect(status()).toHaveTextContent("動画を書き出し中… 1920×1080");
      act(() =>
        listeners["conversion-progress"]({
          payload: { status: "completed", current: 3, total: 3, width: 1080, height: 1920 },
        }),
      );
      expect(status()).toHaveTextContent("完了しました（1080×1920）");
    });

    it("hides the bar and reports completion", async () => {
      await renderApp();
      emitProgress("encoding", 0, 3);
      emitProgress("completed", 3, 3);
      expect(status()).toHaveTextContent("完了しました");
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });

    it("shows an indeterminate bar from the moment conversion is requested", async () => {
      const user = userEvent.setup();
      const job = deferred();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") return job.promise;
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(status()).toHaveTextContent("変換を準備中"));
      expect(bar()).not.toHaveAttribute("value");
      await act(async () => job.resolve());
      await waitFor(() => expect(screen.queryByRole("progressbar")).not.toBeInTheDocument());
    });

    it("removes the bar after an error", async () => {
      const user = userEvent.setup();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") throw "boom";
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(status()).toHaveTextContent("エラー: boom"));
      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    });
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

  describe("settings", () => {
    function openSettings() {
      act(() => listeners["open-settings"]({ payload: null }));
    }
    const stored = () => JSON.parse(localStorage.getItem("framedrop.settings") ?? "null");

    it("opens from the menu event and closes with the close button or Escape", async () => {
      const user = userEvent.setup();
      await renderApp();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      openSettings();
      expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      openSettings();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows 未設定 until a stamp is chosen", async () => {
      await renderApp();
      openSettings();
      expect(screen.getByText("未設定")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "クリア" })).toBeDisabled();
    });

    it("lets the user choose a stamp image of the supported formats and previews it", async () => {
      const user = userEvent.setup();
      openMock.mockResolvedValue("/stamps/s.png");
      await renderApp();
      openSettings();
      await user.click(screen.getByRole("button", { name: "スタンプ画像を選択…" }));
      const options = openMock.mock.calls[0][0];
      expect(options).toMatchObject({ multiple: false, directory: false });
      expect(options.filters[0].extensions).toEqual(
        expect.arrayContaining(["jpg", "jpeg", "gif", "tif", "tiff", "bmp", "heic", "heif"]),
      );
      const preview = await screen.findByRole("img", { name: "s.png" });
      expect(preview).toHaveAttribute("src", "data:image/png;base64,/stamps/s.png");
      expect(stored()).toMatchObject({ stampPath: "/stamps/s.png" });
      expect(screen.queryByText("未設定")).not.toBeInTheDocument();
    });

    it("keeps the current stamp when the file dialog is cancelled, and clears on request", async () => {
      const user = userEvent.setup();
      await renderApp();
      openSettings();
      openMock.mockResolvedValueOnce("/stamps/s.png");
      await user.click(screen.getByRole("button", { name: "スタンプ画像を選択…" }));
      await screen.findByRole("img", { name: "s.png" });
      openMock.mockResolvedValueOnce(null);
      await user.click(screen.getByRole("button", { name: "スタンプ画像を選択…" }));
      expect(stored()).toMatchObject({ stampPath: "/stamps/s.png" });
      await user.click(screen.getByRole("button", { name: "クリア" }));
      expect(screen.getByText("未設定")).toBeInTheDocument();
      expect(stored()).toMatchObject({ stampPath: null });
    });

    it("offers small, medium and large stamp sizes (medium by default) and remembers the choice", async () => {
      const user = userEvent.setup();
      await renderApp();
      openSettings();
      const group = screen.getByRole("radiogroup", { name: "スタンプのサイズ" });
      expect(within(group).getAllByRole("radio").map((r) => (r as HTMLInputElement).value)).toEqual([
        "small",
        "medium",
        "large",
      ]);
      expect(screen.getByRole("radio", { name: "中" })).toBeChecked();
      await user.click(screen.getByRole("radio", { name: "大" }));
      expect(screen.getByRole("radio", { name: "大" })).toBeChecked();
      expect(stored()).toMatchObject({ stampSize: "large" });
      await user.click(screen.getByRole("radio", { name: "小" }));
      expect(stored()).toMatchObject({ stampSize: "small" });
    });

    it("explains that sizes are fractions of the image's short side", async () => {
      await renderApp();
      openSettings();
      expect(screen.getByText(/短辺の 1\/30・1\/20・1\/10/)).toBeInTheDocument();
    });

    it("restores saved settings on startup", async () => {
      localStorage.setItem("framedrop.settings", JSON.stringify({ stampPath: "/stamps/s.gif", stampSize: "small" }));
      await renderApp();
      openSettings();
      expect(screen.getByRole("radio", { name: "小" })).toBeChecked();
      expect(await screen.findByRole("img", { name: "s.gif" })).toBeInTheDocument();
    });

    it("sends the stamp to generate_mp4 only when one is configured", async () => {
      const user = userEvent.setup();
      localStorage.setItem("framedrop.settings", JSON.stringify({ stampPath: "/stamps/s.gif", stampSize: "small" }));
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      expect(generateCalls()[0][1]).toMatchObject({ stamp: { path: "/stamps/s.gif", size: "small" } });
    });
  });

  describe("when FFmpeg is not installed", () => {
    /** check_ffmpeg answers from `results` in order (the last value repeats). */
    function ffmpegAnswers(...results: (boolean | "throw")[]) {
      let i = 0;
      invokeMock.mockImplementation(async (cmd: string, args?: { path?: string }) => {
        if (cmd === "check_ffmpeg") {
          const r = results[Math.min(i++, results.length - 1)];
          if (r === "throw") throw new Error("boom");
          return r;
        }
        return cmd === "get_thumbnail" ? `data:image/png;base64,${args?.path}` : undefined;
      });
    }
    const checkCalls = () => invokeMock.mock.calls.filter(([cmd]) => cmd === "check_ffmpeg").length;
    const banner = () => screen.queryByRole("region", { name: "FFmpeg の警告" });
    const dialog = () => screen.queryByRole("dialog", { name: "FFmpeg が見つかりません" });

    it("shows no banner when FFmpeg is available or the check itself fails", async () => {
      await renderApp();
      await waitFor(() => expect(checkCalls()).toBeGreaterThan(0));
      expect(banner()).not.toBeInTheDocument();
      ffmpegAnswers("throw");
      cleanup();
      await renderApp();
      await waitFor(() => expect(checkCalls()).toBeGreaterThan(1));
      expect(banner()).not.toBeInTheDocument();
    });

    it("shows a banner at startup that explains FFmpeg is needed", async () => {
      ffmpegAnswers(false);
      await renderApp();
      const b = await screen.findByRole("region", { name: "FFmpeg の警告" });
      expect(b).toHaveTextContent("FFmpeg が見つかりません。動画を作るには、FFmpeg のインストールが必要です。");
      expect(within(b).getByRole("button", { name: "インストール方法" })).toBeInTheDocument();
    });

    it("opens a dialog with the install command and the Homebrew note", async () => {
      const user = userEvent.setup();
      ffmpegAnswers(false);
      await renderApp();
      await user.click(await screen.findByRole("button", { name: "インストール方法" }));
      const d = dialog()!;
      expect(d).toHaveTextContent("動画の書き出しに FFmpeg が必要です。ターミナルを開いて、次のコマンドでインストールしてください。");
      expect(within(d).getByText("brew install ffmpeg")).toBeInTheDocument();
      expect(d).toHaveTextContent("Homebrew が入っていない場合は、先に https://brew.sh の手順で Homebrew をインストールしてください。");
      expect(d).toHaveTextContent("インストールが終わったら「再確認」を押します。");
    });

    it("stops the conversion and opens the dialog instead of asking for a save location", async () => {
      const user = userEvent.setup();
      ffmpegAnswers(false);
      await renderApp();
      await screen.findByRole("region", { name: "FFmpeg の警告" });
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      expect(dialog()).toBeInTheDocument();
      expect(saveMock).not.toHaveBeenCalled();
      expect(generateCalls()).toHaveLength(0);
      expect(screen.getByRole("button", { name: "変換開始" })).toBeEnabled();
    });

    it("copies the install command", async () => {
      const user = userEvent.setup();
      mockClipboard();
      ffmpegAnswers(false);
      await renderApp();
      await user.click(await screen.findByRole("button", { name: "インストール方法" }));
      await user.click(screen.getByRole("button", { name: "コピー" }));
      expect(writeTextMock).toHaveBeenCalledWith("brew install ffmpeg");
      expect(await screen.findByText("コピーしました")).toBeInTheDocument();
    });

    it("tells the user when copying fails", async () => {
      const user = userEvent.setup();
      mockClipboard();
      writeTextMock.mockRejectedValue(new Error("denied"));
      ffmpegAnswers(false);
      await renderApp();
      await user.click(await screen.findByRole("button", { name: "インストール方法" }));
      await user.click(screen.getByRole("button", { name: "コピー" }));
      expect(await screen.findByText("コピーできませんでした。手動でコピーしてください")).toBeInTheDocument();
    });

    it("re-checks on request: closes and clears the banner once FFmpeg is found", async () => {
      const user = userEvent.setup();
      ffmpegAnswers(false, false, true);
      await renderApp();
      await user.click(await screen.findByRole("button", { name: "インストール方法" }));
      await user.click(screen.getByRole("button", { name: "再確認" }));
      expect(await screen.findByText("まだ FFmpeg が見つかりません")).toBeInTheDocument();
      expect(dialog()).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "再確認" }));
      await waitFor(() => expect(dialog()).not.toBeInTheDocument());
      expect(banner()).not.toBeInTheDocument();
    });

    it("re-checks when the window regains focus", async () => {
      ffmpegAnswers(false, true);
      await renderApp();
      await screen.findByRole("region", { name: "FFmpeg の警告" });
      act(() => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitFor(() => expect(banner()).not.toBeInTheDocument());
    });

    it("closes the dialog with the close button or Escape but keeps the banner", async () => {
      const user = userEvent.setup();
      ffmpegAnswers(false);
      await renderApp();
      await user.click(await screen.findByRole("button", { name: "インストール方法" }));
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(dialog()).not.toBeInTheDocument();
      expect(banner()).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "インストール方法" }));
      await user.keyboard("{Escape}");
      expect(dialog()).not.toBeInTheDocument();
    });

    it("opens the dialog when a conversion fails because FFmpeg has disappeared", async () => {
      const user = userEvent.setup();
      let checks = 0;
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "check_ffmpeg") return checks++ === 0; // available at startup, gone later
        if (cmd === "generate_mp4") throw "FFmpeg が見つかりません";
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(dialog()).toBeInTheDocument());
      expect(banner()).toBeInTheDocument();
    });
  });

  describe("stamp checkbox on the main screen", () => {
    const stored = () => JSON.parse(localStorage.getItem("framedrop.settings") ?? "null");
    const withStamp = (extra: Record<string, unknown> = {}) =>
      localStorage.setItem(
        "framedrop.settings",
        JSON.stringify({ stampPath: "/stamps/s.png", stampSize: "medium", ...extra }),
      );
    const checkbox = () => screen.getByRole("checkbox", { name: "スタンプを付ける" });

    it("is checked by default when a stamp image is set, and the stamp is sent", async () => {
      const user = userEvent.setup();
      withStamp();
      await renderApp();
      expect(checkbox()).toBeChecked();
      expect(checkbox()).toBeEnabled();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      expect(generateCalls()[0][1]).toMatchObject({ stamp: { path: "/stamps/s.png", size: "medium" } });
    });

    it("turns the stamp off for the conversion when unchecked, and remembers it", async () => {
      const user = userEvent.setup();
      withStamp();
      await renderApp();
      await user.click(checkbox());
      expect(checkbox()).not.toBeChecked();
      expect(stored()).toMatchObject({ stampEnabled: false, stampPath: "/stamps/s.png" });
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      expect(generateCalls()[0][1]).toMatchObject({ stamp: null });
    });

    it("restores an unchecked state on startup", async () => {
      withStamp({ stampEnabled: false });
      await renderApp();
      expect(checkbox()).not.toBeChecked();
      expect(checkbox()).toBeEnabled();
    });

    it("is disabled and unchecked without a stamp image, and offers to open the settings", async () => {
      const user = userEvent.setup();
      await renderApp();
      expect(checkbox()).toBeDisabled();
      expect(checkbox()).not.toBeChecked();
      await user.click(screen.getByRole("button", { name: "スタンプ画像を設定…" }));
      expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    });

    it("does not offer the settings link once a stamp image is set", async () => {
      withStamp();
      await renderApp();
      expect(screen.queryByRole("button", { name: "スタンプ画像を設定…" })).not.toBeInTheDocument();
    });

    it("turns itself on when a new stamp image is chosen in the settings", async () => {
      const user = userEvent.setup();
      withStamp({ stampEnabled: false });
      openMock.mockResolvedValue("/stamps/new.gif");
      await renderApp();
      act(() => listeners["open-settings"]({ payload: null }));
      await user.click(screen.getByRole("button", { name: "スタンプ画像を選択…" }));
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(checkbox()).toBeChecked();
      expect(stored()).toMatchObject({ stampPath: "/stamps/new.gif", stampEnabled: true });
    });

    it("becomes disabled when the stamp image is cleared in the settings", async () => {
      const user = userEvent.setup();
      withStamp();
      await renderApp();
      act(() => listeners["open-settings"]({ payload: null }));
      await user.click(screen.getByRole("button", { name: "クリア" }));
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(checkbox()).toBeDisabled();
      expect(checkbox()).not.toBeChecked();
    });

    it("cannot be changed while converting", async () => {
      const user = userEvent.setup();
      withStamp();
      const job = deferred();
      invokeMock.mockImplementation(async (cmd: string) => {
        if (cmd === "generate_mp4") return job.promise;
        return "data:image/png;base64,x";
      });
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("変換を準備中"));
      expect(checkbox()).toBeDisabled();
      await act(async () => job.resolve());
    });
  });

  describe("video size setting", () => {
    const stored = () => JSON.parse(localStorage.getItem("framedrop.settings") ?? "null");
    const openSettings = () => act(() => listeners["open-settings"]({ payload: null }));
    const select = () => screen.getByRole("combobox", { name: "動画サイズ" }) as HTMLSelectElement;

    it("offers automatic and the common sizes in the settings, automatic by default", async () => {
      await renderApp();
      openSettings();
      expect(select().value).toBe("auto");
      const labels = within(select()).getAllByRole("option").map((o) => o.textContent);
      expect(labels[0]).toBe("自動（画像の最大サイズに合わせる）");
      expect(labels).toEqual(
        expect.arrayContaining([
          "4K 3840×2160（16:9）",
          "フルHD 1920×1080（16:9）",
          "HD 1280×720（16:9）",
          "縦 フルHD 1080×1920（9:16）",
          "正方形 1080×1080（1:1）",
        ]),
      );
      expect(screen.getByText(/縦横比を保って収め、余った部分は黒帯/)).toBeInTheDocument();
    });

    it("remembers the chosen size", async () => {
      const user = userEvent.setup();
      await renderApp();
      openSettings();
      await user.selectOptions(select(), "1920x1080");
      expect(select().value).toBe("1920x1080");
      expect(stored()).toMatchObject({ videoSize: "1920x1080" });
    });

    it("restores the saved size on startup", async () => {
      localStorage.setItem("framedrop.settings", JSON.stringify({ stampPath: null, videoSize: "720x1280" }));
      await renderApp();
      openSettings();
      expect(select().value).toBe("720x1280");
    });

    it("sends the chosen size to generate_mp4, or null for automatic", async () => {
      const user = userEvent.setup();
      localStorage.setItem("framedrop.settings", JSON.stringify({ stampPath: null, videoSize: "1080x1920" }));
      await renderApp();
      drop(["/pics/a.png"]);
      await user.click(screen.getByRole("button", { name: "変換開始" }));
      await waitFor(() => expect(generateCalls()).toHaveLength(1));
      expect(generateCalls()[0][1]).toMatchObject({ videoSize: { width: 1080, height: 1920 } });
    });
  });

  describe("video size chip on the main screen", () => {
    const chip = (name: string) => screen.getByRole("button", { name });

    it("shows 自動 by default and opens the settings when clicked", async () => {
      const user = userEvent.setup();
      await renderApp();
      await user.click(chip("動画サイズ: 自動"));
      expect(screen.getByRole("dialog", { name: "設定" })).toBeInTheDocument();
    });

    it("shows the chosen size", async () => {
      localStorage.setItem("framedrop.settings", JSON.stringify({ stampPath: null, videoSize: "1920x1080" }));
      await renderApp();
      expect(chip("動画サイズ: 1920×1080")).toBeInTheDocument();
    });

    it("updates right after the size is changed in the settings", async () => {
      const user = userEvent.setup();
      await renderApp();
      act(() => listeners["open-settings"]({ payload: null }));
      await user.selectOptions(screen.getByRole("combobox", { name: "動画サイズ" }), "1280x720");
      await user.click(screen.getByRole("button", { name: "閉じる" }));
      expect(chip("動画サイズ: 1280×720")).toBeInTheDocument();
    });
  });
});
