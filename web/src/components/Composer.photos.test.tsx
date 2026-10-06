import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { preparePhoto } from "../photos/prepare.ts";
import { dayView, message } from "../test/fixtures.ts";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

vi.mock("../photos/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 })),
}));

const photoFile = (name = "meal.jpg") => new File(["original"], name, { type: "image/jpeg" });
const uploaded = (id: string) => jsonResponse({ id, media_type: "image/jpeg", bytes: 7, width: 1568, height: 1176 }, 201);
const stored = () => jsonResponse({ user: message(), reply: null, day: dayView() }, 201);
const sentMessages = (calls: unknown[][]) =>
  calls.filter(([url]) => url === "/api/messages").map(([, init]) => JSON.parse(String((init as RequestInit).body)));

describe("Composer photos", () => {
  beforeEach(() => {
    vi.mocked(preparePhoto).mockClear();
  });

  it("uploads a photo as soon as it is attached, sends it, then clears it", async () => {
    const fetchMock = mockFetch((url) => (url === "/api/photos" ? uploaded("a".repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/photos");
    expect(init).toMatchObject({ method: "POST", headers: { "content-type": "image/jpeg" } });
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull());
    expect(sentMessages(fetchMock.mock.calls)).toEqual([expect.objectContaining({ text: "", photo_ids: ["a".repeat(32)] })]);
  });

  it("waits for its uploads before it lets you send", async () => {
    let finish: (res: Response) => void = () => {};
    mockFetch((url) => (url === "/api/photos" ? new Promise<Response>((resolve) => (finish = resolve)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "lunch");
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(await screen.findByRole("status", { name: "Uploading photo 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    finish(uploaded("b".repeat(32)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  it("offers a retry when an upload fails", async () => {
    let uploads = 0;
    mockFetch((url) => {
      if (url !== "/api/photos") return stored();
      uploads += 1;
      if (uploads === 1) throw new TypeError("Failed to fetch");
      return uploaded("c".repeat(32));
    });
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't upload");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Retry photo 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("leaves out a photo you remove", async () => {
    let next = 0;
    const fetchMock = mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile("first.jpg"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile("second.jpg"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toHaveLength(1));
    expect(sentMessages(fetchMock.mock.calls)[0].photo_ids).toEqual(["2".repeat(32)]);
  });

  it("takes at most four photos and says so", async () => {
    let next = 0;
    mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), ["1", "2", "3", "4", "5"].map((n) => photoFile(`${n}.jpg`)));
    expect(await screen.findByText("Up to 4 photos per message.")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Photo \d$/ })).toHaveLength(4);
    expect(screen.getByLabelText("Add photos")).toBeDisabled();
  });

  it("takes exactly four photos without a notice", async () => {
    let next = 0;
    mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), ["1", "2", "3", "4"].map((n) => photoFile(`${n}.jpg`)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    expect(screen.getAllByRole("img", { name: /^Photo \d$/ })).toHaveLength(4);
    expect(screen.queryByText("Up to 4 photos per message.")).toBeNull();
  });

  it("lets you pick the same photo again after removing it", async () => {
    mockFetch((url) => (url === "/api/photos" ? uploaded("a".repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    const file = photoFile();
    await userEvent.upload(screen.getByLabelText("Add photos"), file);
    await userEvent.click(await screen.findByRole("button", { name: "Remove photo 1" }));
    await userEvent.upload(screen.getByLabelText("Add photos"), file);
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  it("forgets the four-photo notice once the message is sent", async () => {
    let next = 0;
    mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), ["1", "2", "3", "4", "5"].map((n) => photoFile(`${n}.jpg`)));
    expect(await screen.findByText("Up to 4 photos per message.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull());
    expect(screen.queryByText("Up to 4 photos per message.")).toBeNull();
  });

  it("drops the last send's error once a photo is added, since the message has changed", async () => {
    mockFetch((url) => {
      if (url === "/api/photos") return uploaded("a".repeat(32));
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "lunch");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
  });

  describe("sending again after a lost response", () => {
    it("keeps the id, the time and the photos, and uploads nothing twice", async () => {
      let sends = 0;
      const fetchMock = mockFetch((url) => {
        if (url === "/api/photos") return uploaded("a".repeat(32));
        sends += 1;
        if (sends === 1) throw new TypeError("Failed to fetch"); // the server may have run the coach all the same
        return stored();
      });
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.type(screen.getByLabelText("Message Zabaione"), "lunch");
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("offline");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull());
      const [first, second] = sentMessages(fetchMock.mock.calls);
      expect(first).toMatchObject({ text: "lunch", photo_ids: ["a".repeat(32)] });
      expect(second).toEqual(first);
      expect(fetchMock.mock.calls.filter(([url]) => url === "/api/photos")).toHaveLength(1);
    });

    it("uses a new id once the photos have changed", async () => {
      let next = 0;
      let sends = 0;
      const fetchMock = mockFetch((url) => {
        if (url === "/api/photos") return uploaded(String(++next).repeat(32));
        sends += 1;
        if (sends === 1) throw new TypeError("Failed to fetch");
        return stored();
      });
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), [photoFile("1.jpg"), photoFile("2.jpg")]);
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByRole("alert");
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toHaveLength(2));
      const [first, second] = sentMessages(fetchMock.mock.calls);
      expect(first.photo_ids).toEqual(["1".repeat(32), "2".repeat(32)]);
      expect(second.photo_ids).toEqual(["2".repeat(32)]);
      expect(second.id).not.toBe(first.id);
    });
  });

  describe("photos that are still being prepared", () => {
    const resized = { blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 };
    /** Holds the next photo in preparation until the test lets it go, or finds it unreadable. */
    function holdNextPhoto() {
      let release: () => void = () => {};
      let fail: () => void = () => {};
      vi.mocked(preparePhoto).mockImplementationOnce(
        () =>
          new Promise((resolve, reject) => {
            release = () => resolve(resized);
            fail = () => reject(new Error("not an image"));
          }),
      );
      return { release: () => release(), fail: () => fail() };
    }
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("doesn't upload one you removed in the meantime", async () => {
      const { release } = holdNextPhoto();
      const fetchMock = mockFetch(() => uploaded("e".repeat(32)));
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      release();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
    });

    it("doesn't upload one when the composer has gone, and lets go of its thumbnails", async () => {
      const create = vi.spyOn(URL, "createObjectURL");
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      const { release } = holdNextPhoto();
      const fetchMock = mockFetch(() => uploaded("d".repeat(32)));
      const { unmount } = renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      unmount();
      release();
      await settle();
      expect(fetchMock).not.toHaveBeenCalled();
      const revoked = revoke.mock.calls.map(([url]) => url);
      expect(create.mock.results.map((result) => result.value).filter((url) => !revoked.includes(url))).toEqual([]);
    });

    it("says nothing about one you removed before it turned out to be unreadable", async () => {
      const { fail } = holdNextPhoto();
      mockFetch(() => uploaded("f".repeat(32)));
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile("broken.jpg"));
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      fail();
      await settle();
      expect(screen.queryByText("That photo couldn't be read. Try another.")).toBeNull();
    });

    it("prepares photos one at a time, each after the one before has finished", async () => {
      const first = holdNextPhoto();
      const second = holdNextPhoto();
      mockFetch((url) => (url === "/api/photos" ? uploaded("a".repeat(32)) : stored()));
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), [photoFile("1.jpg"), photoFile("2.jpg")]);
      await settle();
      expect(preparePhoto).toHaveBeenCalledTimes(1);
      first.release();
      await waitFor(() => expect(preparePhoto).toHaveBeenCalledTimes(2));
      second.release();
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    });

    it("goes on to the next photo when one can't be read", async () => {
      const first = holdNextPhoto();
      holdNextPhoto();
      mockFetch((url) => (url === "/api/photos" ? uploaded("a".repeat(32)) : stored()));
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), [photoFile("broken.jpg"), photoFile("2.jpg")]);
      await settle();
      expect(preparePhoto).toHaveBeenCalledTimes(1);
      first.fail();
      await waitFor(() => expect(preparePhoto).toHaveBeenCalledTimes(2));
      expect(await screen.findByText("That photo couldn't be read. Try another.")).toBeInTheDocument();
    });

    it("drops one it can't read and says so", async () => {
      vi.mocked(preparePhoto).mockRejectedValueOnce(new Error("not an image"));
      const fetchMock = mockFetch(() => uploaded("f".repeat(32)));
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile("broken.jpg"));
      expect(await screen.findByText("That photo couldn't be read. Try another.")).toBeInTheDocument();
      expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
      expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("retries with the photo it already resized", async () => {
    let uploads = 0;
    const fetchMock = mockFetch((url) => {
      if (url !== "/api/photos") return stored();
      uploads += 1;
      if (uploads === 1) throw new TypeError("Failed to fetch");
      return uploaded("c".repeat(32));
    });
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await userEvent.click(await screen.findByRole("button", { name: "Retry photo 1" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    const bodies = fetchMock.mock.calls.filter(([url]) => url === "/api/photos").map(([, init]) => init?.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBeInstanceOf(Blob);
    expect(bodies[1]).toBe(bodies[0]);
    expect(preparePhoto).toHaveBeenCalledTimes(1);
  });

  it("offers a retry when the server turns an upload away for now, not only when the connection drops", async () => {
    mockFetch((url) => (url === "/api/photos" ? new Response("Too Many Requests", { status: 429 }) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(await screen.findByRole("button", { name: "Retry photo 1" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("didn't upload");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it.each([
    [413, "image_too_large"],
    [400, "not_an_image"],
  ])("drops a photo the server answers %i %s, since a retry can't succeed, and says so", async (status, error) => {
    const fetchMock = mockFetch((url) => (url === "/api/photos" ? jsonResponse({ error }, status) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "lunch");
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    expect(await screen.findByText("That photo can't be sent. Try another.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Retry photo/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The rest of the message can still go.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toEqual([expect.objectContaining({ text: "lunch", photo_ids: [] })]));
  });

  it("says nothing about a photo removed while the server was refusing it", async () => {
    let refuse: (res: Response) => void = () => {};
    mockFetch((url) => (url === "/api/photos" ? new Promise<Response>((resolve) => (refuse = resolve)) : stored()));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await screen.findByRole("status", { name: "Uploading photo 1" });
    await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
    refuse(jsonResponse({ error: "image_too_large" }, 413));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText("That photo can't be sent. Try another.")).toBeNull();
  });

  it("clears the photos at once and stays locked until the server has the message", async () => {
    let arrive: (res: Response) => void = () => {};
    mockFetch((url) => (url === "/api/photos" ? uploaded("9".repeat(32)) : new Promise<Response>((resolve) => (arrive = resolve))));
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByLabelText("Add photos")).toBeDisabled();
    expect(screen.getByLabelText("Message Zabaione")).toHaveAttribute("readonly");
    arrive(stored());
    await waitFor(() => expect(screen.getByLabelText("Add photos")).toBeEnabled());
    expect(screen.getByLabelText("Message Zabaione")).not.toHaveAttribute("readonly");
  });

  it("puts the photos back when the message never reached the server", async () => {
    let sends = 0;
    mockFetch((url) => {
      if (url === "/api/photos") return uploaded("9".repeat(32));
      sends += 1;
      throw new TypeError("Failed to fetch");
    });
    renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
    expect(sends).toBe(1);
  });

  describe("when the server won't take a message's photos", () => {
    const photoUploads = (calls: unknown[][]) => calls.filter(([url]) => url === "/api/photos");

    it("says what to do when they went with an earlier message, and sends once they are removed", async () => {
      let sends = 0;
      const fetchMock = mockFetch((url) => {
        if (url === "/api/photos") return uploaded("a".repeat(32));
        sends += 1;
        if (sends === 1) throw new TypeError("Failed to fetch"); // this one reached the server, but its reply was lost
        if (sends === 2) return jsonResponse({ error: "photo_taken" }, 409); // so the edited message can't have its photo
        return stored();
      });
      renderWithProviders(<Composer date="2026-10-03" />);
      const box = screen.getByLabelText("Message Zabaione");
      await userEvent.type(box, "lunch");
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("offline");
      await userEvent.type(box, " plate");
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent("Those photos went with your last message. Remove them to send this one."),
      );
      // Nothing is uploaded or sent again behind your back: that could log the same meal twice.
      expect(photoUploads(fetchMock.mock.calls)).toHaveLength(1);
      expect(sentMessages(fetchMock.mock.calls)).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toHaveLength(3));
      const [first, second, third] = sentMessages(fetchMock.mock.calls);
      expect(second.photo_ids).toEqual(["a".repeat(32)]);
      expect(second.id).not.toBe(first.id);
      expect(third).toMatchObject({ text: "lunch plate", photo_ids: [] });
    });

    it("says what to do when a photo is no longer on the server, and sends once it is attached again", async () => {
      let next = 0;
      let sends = 0;
      const fetchMock = mockFetch((url) => {
        if (url === "/api/photos") return uploaded(String(++next).repeat(32));
        sends += 1;
        return sends === 1 ? jsonResponse({ error: "photo_not_found" }, 400) : stored();
      });
      renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("A photo is no longer on the server. Remove it and attach it again.");
      expect(photoUploads(fetchMock.mock.calls)).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile("again.jpg"));
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(sentMessages(fetchMock.mock.calls)).toHaveLength(2));
      expect(sentMessages(fetchMock.mock.calls)[1].photo_ids).toEqual(["2".repeat(32)]);
    });
  });

  describe("room for the feed behind it", () => {
    /** jsdom has no ResizeObserver; this one lets the test fire the callback the way a browser does on a resize. */
    function stubResizeObserver() {
      const observers: FakeResizeObserver[] = [];
      class FakeResizeObserver {
        callback: ResizeObserverCallback;
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
          observers.push(this);
        }
        resize() {
          this.callback([], this as unknown as ResizeObserver);
        }
      }
      vi.stubGlobal("ResizeObserver", FakeResizeObserver);
      return observers;
    }

    it("publishes its height as --composer-h, follows it as it grows, and takes it back when it goes", () => {
      const observers = stubResizeObserver();
      let height = 67.2;
      vi.spyOn(HTMLFormElement.prototype, "getBoundingClientRect").mockImplementation(() => ({ height }) as DOMRect);
      const root = document.documentElement;
      const { container, unmount } = renderWithProviders(<Composer date="2026-10-03" />);
      expect(observers).toHaveLength(1);
      expect(observers[0].observe).toHaveBeenCalledWith(container.querySelector("form"));
      observers[0].resize();
      expect(root.style.getPropertyValue("--composer-h")).toBe("68px");
      height = 178;
      observers[0].resize();
      expect(root.style.getPropertyValue("--composer-h")).toBe("178px");
      unmount();
      expect(observers[0].disconnect).toHaveBeenCalled();
      expect(root.style.getPropertyValue("--composer-h")).toBe("");
    });
  });

  describe("object URLs for the thumbnails", () => {
    // Under StrictMode React runs state updaters twice, as it does in `npm run dev:web`: an updater that
    // creates an object URL then leaks one per photo.
    function watchObjectUrls() {
      const create = vi.spyOn(URL, "createObjectURL");
      const revoke = vi.spyOn(URL, "revokeObjectURL");
      return () => {
        const revoked = revoke.mock.calls.map(([url]) => url);
        return create.mock.results.map((result) => result.value as string).filter((url) => !revoked.includes(url));
      };
    }

    it("keeps one per thumbnail and lets go of the rest as photos are resized, removed and sent", async () => {
      const live = watchObjectUrls();
      let next = 0;
      mockFetch((url) => (url === "/api/photos" ? uploaded(String(++next).repeat(32)) : stored()));
      renderWithProviders(
        <StrictMode>
          <Composer date="2026-10-03" />
        </StrictMode>,
      );
      await userEvent.upload(screen.getByLabelText("Add photos"), [photoFile("1.jpg"), photoFile("2.jpg")]);
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      expect(live()).toHaveLength(2);
      await userEvent.click(screen.getByRole("button", { name: "Remove photo 1" }));
      expect(live()).toHaveLength(1);
      await userEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull());
      expect(live()).toEqual([]);
    });

    it("lets go of the thumbnails when the composer goes away", async () => {
      const live = watchObjectUrls();
      mockFetch((url) => (url === "/api/photos" ? uploaded("b".repeat(32)) : stored()));
      const { unmount } = renderWithProviders(<Composer date="2026-10-03" />);
      await userEvent.upload(screen.getByLabelText("Add photos"), photoFile());
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeEnabled());
      expect(live()).toHaveLength(1);
      unmount();
      expect(live()).toEqual([]);
    });
  });
});
