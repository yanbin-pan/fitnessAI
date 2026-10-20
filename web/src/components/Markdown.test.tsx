import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.tsx";

const html = (text: string) => render(<Markdown text={text} />).container.innerHTML;

describe("Markdown", () => {
  it("draws bold, italic and code inline", () => {
    const out = html("**Salmon** tonight, *not* `fries`");
    expect(out).toContain('<strong class="font-semibold">Salmon</strong>');
    expect(out).toContain("<em>not</em>");
    expect(out).toContain(">fries</code>");
    expect(out).not.toContain("**");
  });

  it("leaves arithmetic and snake_case as typed", () => {
    const out = html("2 * 3 * 4 and my_food_log");
    expect(out).toContain("2 * 3 * 4 and my_food_log");
  });

  it("makes lists and paragraphs, keeping single line breaks", () => {
    const { container } = render(<Markdown text={"Two ideas:\n- Greek yogurt\n- **Eggs**\n\n1. First\n2. Second\nline\nbreak"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(2);
    expect(container.querySelector("ul strong")?.textContent).toBe("Eggs");
    expect(container.querySelectorAll("br")).toHaveLength(1);
  });

  it("never turns text into markup", () => {
    const { container } = render(<Markdown text={"<img src=x onerror=alert(1)> **hi**"} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
