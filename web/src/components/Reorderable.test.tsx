import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Reorderable, moved } from "./Reorderable.tsx";

function List({ onChange }: { onChange?: (ids: string[]) => void }) {
  const [ids, setIds] = useState(["a", "b", "c"]);
  return (
    <Reorderable
      ids={ids}
      onReorder={(next) => {
        setIds(next);
        onChange?.(next);
      }}
    >
      {(id, grip) => (
        <section aria-label={id}>
          <button type="button" aria-label={`Move ${id}`} {...grip.props} />
        </section>
      )}
    </Reorderable>
  );
}

const names = () => screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));

afterEach(() => vi.useRealTimers());

describe("Reorderable", () => {
  it("moves an item within the list", () => {
    expect(moved(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moved(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("drags a card past the next one: it lifts, the other steps aside, and the order changes once it settles", () => {
    vi.useFakeTimers();
    // Each card is 100px tall with a 16px gap.
    const rect = (top: number) => ({ top, bottom: top + 100, height: 100, left: 0, right: 300, width: 300, x: 0, y: top, toJSON: () => ({}) });
    const tops: Record<string, number> = { a: 0, b: 116, c: 232 };
    const spy = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const id = this.querySelector("section")?.getAttribute("aria-label") ?? "";
      return rect(tops[id] ?? 0) as DOMRect;
    });
    const changed = vi.fn();
    render(<List onChange={changed} />);
    const grip = screen.getByRole("button", { name: "Move a" });
    fireEvent.pointerDown(grip, { clientY: 50, pointerId: 1, button: 0 });
    const held = screen.getByRole("region", { name: "a" }).closest("[data-held]");
    expect(held).not.toBeNull();
    fireEvent.pointerMove(grip, { clientY: 180, pointerId: 1 });
    expect((held as HTMLElement).style.transform).toBe("translate3d(0, 130px, 0)");
    const b = screen.getByRole("region", { name: "b" }).parentElement?.parentElement as HTMLElement;
    expect(b.style.transform).toBe("translate3d(0, -116px, 0)");
    fireEvent.pointerUp(grip, { clientY: 180, pointerId: 1 });
    expect((held as HTMLElement).style.transform).toBe("translate3d(0, 116px, 0)");
    act(() => vi.advanceTimersByTime(300));
    expect(changed).toHaveBeenCalledWith(["b", "a", "c"]);
    expect(names()).toEqual(["b", "a", "c"]);
    spy.mockRestore();
  });

  it("leaves the order alone when the card is put back where it was", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    render(<List onChange={changed} />);
    const grip = screen.getByRole("button", { name: "Move b" });
    fireEvent.pointerDown(grip, { clientY: 10, pointerId: 1, button: 0 });
    fireEvent.pointerUp(grip, { clientY: 10, pointerId: 1 });
    act(() => vi.advanceTimersByTime(300));
    expect(changed).not.toHaveBeenCalled();
    expect(names()).toEqual(["a", "b", "c"]);
  });
});
