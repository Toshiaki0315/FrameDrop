import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
let dropHandler: (e: { payload: { type: string; paths?: string[] } }) => void;
let progressHandler: (e: { payload: unknown }) => void;

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
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

function drop(paths: string[]) {
  act(() => dropHandler({ payload: { type: "drop", paths } }));
}

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("App", () => {
  it("lists dropped files and ignores duplicates", async () => {
    await renderApp();
    drop(["/pics/a.png", "/pics/b.png"]);
    drop(["/pics/b.png", "/pics/c.png"]);
    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["/pics/a.png", "/pics/b.png", "/pics/c.png"]);
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
    invokeMock.mockRejectedValue("ffmpeg not found");
    await renderApp();
    drop(["/pics/a.png"]);
    await user.click(screen.getByRole("button", { name: "変換開始" }));
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("エラー: ffmpeg not found"),
    );
  });
});
