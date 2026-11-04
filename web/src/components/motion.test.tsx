import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useScrollLock } from "./motion.ts";

function Locked({ children }: { children?: React.ReactNode }) {
  useScrollLock();
  return <div>{children}</div>;
}

const drag = (target: EventTarget) => {
  const event = new Event("touchmove", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

describe("useScrollLock", () => {
  it("holds the page still, touch included, until the last sheet closes", () => {
    const first = render(<Locked />);
    const second = render(<Locked><textarea aria-label="note" /></Locked>);
    expect(document.documentElement.style.overflow).toBe("hidden");
    // A drag on the backdrop is stopped; one in a text field is left alone.
    expect(drag(document.body)).toBe(true);
    expect(drag(second.getByLabelText("note"))).toBe(false);
    second.unmount();
    expect(document.documentElement.style.overflow).toBe("hidden");
    first.unmount();
    expect(document.documentElement.style.overflow).toBe("");
    expect(drag(document.body)).toBe(false);
  });
});
