import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePhoto } from "../photos/prepare.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer, clipboardImages, imagesIn } from "./Composer.tsx";

vi.mock("../photos/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 })),
}));

const screenshot = (name = "image.png") => new File(["pixels"], name, { type: "image/png" });
const uploaded = (id: string) => jsonResponse({ id, media_type: "image/jpeg", bytes: 7, width: 1568, height: 1176 }, 201);
const stored = () => jsonResponse({ user: message(), reply: null, day: dayView() }, 201);
const sentMessages = (calls: unknown[][]) =>
  calls.filter(([url]) => url === "/api/messages").map(([, init]) => JSON.parse(String((init as RequestInit).body)));

/** What a paste carries: its files as both items and files (as browsers list them), and any text. */
function clipboard({ files = [] as File[], text }: { files?: File[]; text?: string }) {
  const items = [
    ...files.map((file) => ({ kind: "file", type: file.type, getAsFile: () => file })),
    ...(text === undefined ? [] : [{ kind: "string", type: "text/plain", getAsFile: () => null }]),
  ];
  const types = [...(files.length > 0 ? ["Files"] : []), ...(text === undefined ? [] : ["text/plain"])];
  return { items, files, types, getData: (type: string) => (type === "text/plain" ? (text ?? "") : "") } as unknown as DataTransfer;
}

/** Pastes into the message box; true when the browser's own paste went ahead. */
const paste = (data: DataTransfer) => fireEvent.paste(screen.getByLabelText("Message Zabaione"), { clipboardData: data });

describe("Composer: pasting a screenshot", () => {
  beforeEach(() => {
    vi.mocked(preparePhoto).mockClear();
  });

  it("attaches it like a photo from the camera button, uploads it and sends it", async () => {
    const fetchMock = mockFetch((url) => (url === "/api/photos" ? uploaded("a".repeat(32)) : stored()));
    renderWithProviders(<Composer />);
    expect(paste(clipboard({ files: [screenshot()] }))).toBe(false);
    expect(await screen.findByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(preparePhoto).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toHaveLength(1));
    expect(sentMessages(fetchMock.mock.calls)[0]).toMatchObject({ text: "", photo_ids: ["a".repeat(32)] });
  });

  it("leaves a paste of plain text alone", () => {
    mockFetch(() => stored());
    renderWithProviders(<Composer />);
    expect(paste(clipboard({ text: "2 eggs" }))).toBe(true);
    expect(screen.queryByRole("img")).toBeNull();
    expect(preparePhoto).not.toHaveBeenCalled();
  });

  it("attaches the image and still lets copied words paste", async () => {
    mockFetch((url) => (url === "/api/photos" ? uploaded("b".repeat(32)) : stored()));
    renderWithProviders(<Composer />);
    expect(paste(clipboard({ files: [screenshot()], text: "Margherita pizza" }))).toBe(true);
    expect(await screen.findByRole("img", { name: "Photo 1" })).toBeInTheDocument();
  });

  it("keeps to the photo limit and says so", async () => {
    let next = 0;
    mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
    renderWithProviders(<Composer />);
    paste(clipboard({ files: ["1", "2", "3", "4", "5"].map((n) => screenshot(`${n}.png`)) }));
    expect(await screen.findByText("Up to 4 photos per message.")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(4);
  });
});

describe("Composer: a paste that keeps the image back (iOS Safari)", () => {
  const readClipboard = (read: () => Promise<unknown[]>) =>
    Object.defineProperty(navigator, "clipboard", { value: { read: vi.fn(read) }, configurable: true });
  const clipboardItem = (type: string) => ({ types: [type], getType: async () => new Blob(["pixels"], { type }) });

  beforeEach(() => {
    vi.mocked(preparePhoto).mockClear();
  });

  it("asks the clipboard for the image and attaches it", async () => {
    readClipboard(async () => [clipboardItem("image/png")]);
    mockFetch((url) => (url === "/api/photos" ? uploaded("c".repeat(32)) : stored()));
    renderWithProviders(<Composer />);
    // The paste lists an image but hands over no file.
    expect(paste({ items: [], files: [], types: ["image/png"] } as unknown as DataTransfer)).toBe(false);
    expect(navigator.clipboard.read).toHaveBeenCalledOnce();
    expect(await screen.findByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  it("says so, and points to the camera button, when the clipboard won't give it up", async () => {
    readClipboard(async () => {
      throw new DOMException("Not allowed", "NotAllowedError");
    });
    mockFetch(() => stored());
    renderWithProviders(<Composer />);
    paste({ items: [], files: [], types: [] } as unknown as DataTransfer);
    expect(await screen.findByText(/Attach it with the camera button instead/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("never asks the clipboard about a paste of text", () => {
    readClipboard(async () => []);
    mockFetch(() => stored());
    renderWithProviders(<Composer />);
    expect(paste(clipboard({ text: "toast" }))).toBe(true);
    expect(navigator.clipboard.read).not.toHaveBeenCalled();
  });

  it("finds only images on the clipboard", async () => {
    readClipboard(async () => [clipboardItem("text/html"), clipboardItem("image/jpeg")]);
    const files = await clipboardImages();
    expect(files.map((file) => [file.name, file.type])).toEqual([["pasted.jpeg", "image/jpeg"]]);
  });
});

describe("imagesIn", () => {
  it("takes each image once, and nothing that isn't an image", () => {
    const png = screenshot();
    const pdf = new File(["%PDF"], "menu.pdf", { type: "application/pdf" });
    expect(imagesIn(clipboard({ files: [png, pdf] }))).toEqual([png]);
    // A browser that lists the file only under files.
    expect(imagesIn({ items: [], files: [png], types: ["Files"] } as unknown as DataTransfer)).toEqual([png]);
    expect(imagesIn(clipboard({ text: "hello" }))).toEqual([]);
    expect(imagesIn(null)).toEqual([]);
  });
});
