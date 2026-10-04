import { describe, expect, it } from "vitest";
import { fitWithin } from "./prepare.ts";

describe("fitWithin", () => {
  it("shrinks a phone photo to 1568 px on its long edge, keeping its shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: 1568 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
