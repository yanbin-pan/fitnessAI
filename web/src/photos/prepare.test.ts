import { describe, expect, it, vi } from "vitest";
import { fitWithin, preparePhoto } from "./prepare.ts";

describe("fitWithin", () => {
  it("shrinks a phone photo to 1568 px on its long edge, keeping its shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe("preparePhoto", () => {
  /**
   * jsdom can neither decode nor draw: this stands in for the photo and the canvas, records each
   * step, and encodes to `encoded` (null when the browser can't encode).
   */
  function fakeBrowser(encoded: Blob | null = new Blob(["jpeg"], { type: "image/jpeg" })) {
    vi.stubGlobal(
      "Image",
      class {
        src = "";
        naturalWidth = 4032;
        naturalHeight = 3024;
        decode = () => Promise.resolve();
      },
    );
    const steps: string[] = [];
    const context = {
      fillStyle: "#000000",
      fillRect: (x: number, y: number, w: number, h: number) => steps.push(`fill ${context.fillStyle} ${x},${y},${w},${h}`),
      drawImage: (_image: unknown, x: number, y: number, w: number, h: number) => steps.push(`draw ${x},${y},${w},${h}`),
    };
    const canvas = {
      width: 300,
      height: 150,
      getContext: () => context,
      toBlob: (done: (blob: Blob | null) => void, type: string, quality: number) => {
        steps.push(`encode ${type} ${quality} at ${canvas.width}x${canvas.height}`);
        done(encoded);
      },
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => (tag === "canvas" ? canvas : createElement(tag))) as typeof document.createElement);
    return { steps, canvas };
  }

  it("draws the photo on white, so a transparent PNG doesn't come out black", async () => {
    const { steps } = fakeBrowser();
    const prepared = await preparePhoto(new Blob(["png"], { type: "image/png" }));
    expect(steps).toEqual(["fill #ffffff 0,0,1568,1176", "draw 0,0,1568,1176", "encode image/jpeg 0.85 at 1568x1176"]);
    expect(prepared).toMatchObject({ width: 1568, height: 1176 });
  });

  it("lets go of the canvas once the photo is encoded", async () => {
    const { canvas } = fakeBrowser();
    await preparePhoto(new Blob(["png"], { type: "image/png" }));
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });

  it("lets go of the canvas when the photo can't be encoded, too", async () => {
    const { canvas } = fakeBrowser(null);
    await expect(preparePhoto(new Blob(["png"], { type: "image/png" }))).rejects.toThrow("can't encode");
    expect([canvas.width, canvas.height]).toEqual([0, 0]);
  });
});
