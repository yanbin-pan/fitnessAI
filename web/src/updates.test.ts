import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { keepCurrent } from "./updates.ts";

let workers: EventTarget & { controller: object | null; getRegistration: () => Promise<{ update: () => Promise<void> } | undefined> };
let update: ReturnType<typeof vi.fn<() => Promise<void>>>;
let reload: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;
let stop: () => void = () => {};

function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  update = vi.fn<() => Promise<void>>(async () => {});
  reload = vi.fn();
  visibility = "visible";
  workers = Object.assign(new EventTarget(), { controller: {}, getRegistration: async () => ({ update }) });
  Object.defineProperty(navigator, "serviceWorker", { value: workers, configurable: true });
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  vi.stubGlobal("location", { ...window.location, reload });
});

afterEach(() => {
  stop();
  delete (navigator as { serviceWorker?: unknown }).serviceWorker;
});

describe("keepCurrent", () => {
  it("looks for a new version whenever the app is shown or hidden", async () => {
    stop = keepCurrent();
    setVisibility("hidden");
    setVisibility("visible");
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(reload).not.toHaveBeenCalled();
  });

  it("switches to a new version at once while the app is out of sight", () => {
    stop = keepCurrent();
    visibility = "hidden";
    workers.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("waits until the app comes back before switching under someone using it", () => {
    stop = keepCurrent();
    workers.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    setVisibility("hidden");
    expect(reload).not.toHaveBeenCalled();
    setVisibility("visible");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not take the first install for a new version", () => {
    workers.controller = null;
    stop = keepCurrent();
    visibility = "hidden";
    workers.dispatchEvent(new Event("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
    // A real release later on still switches.
    workers.dispatchEvent(new Event("controllerchange"));
    expect(reload).toHaveBeenCalledOnce();
  });
});
