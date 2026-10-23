import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { clearPetSignals } from "../companions/signal.ts";
import { clearDrafts } from "../components/drafts.ts";

// Times in tests are formatted on the runner's clock; pin it.
process.env.TZ = "UTC";

afterEach(async () => {
  cleanup();
  clearDrafts();
  clearPetSignals();
  // Imported here, not at the top: a static import would load the Health modules before a test file's vi.mock of them.
  (await import("../health/background.ts")).resetHealthBackground();
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
