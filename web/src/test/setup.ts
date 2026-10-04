import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Times in tests are formatted on the runner's clock; pin it.
process.env.TZ = "UTC";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// jsdom has no object URLs; the composer's thumbnails need them.
if (typeof URL.createObjectURL !== "function") {
  let next = 0;
  Object.assign(URL, {
    createObjectURL: () => `blob:test/${(next += 1)}`,
    revokeObjectURL: () => {},
  });
}
