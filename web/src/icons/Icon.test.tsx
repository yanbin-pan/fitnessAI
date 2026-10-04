import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "./Icon.tsx";
import { ICON_PATHS } from "./paths.ts";

describe("Icon", () => {
  it("is hidden from screen readers unless it has a label", () => {
    const { container } = render(
      <>
        <Icon name="close" />
        <Icon name="sports_tennis" label="Tennis" />
      </>,
    );
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    expect(screen.getByRole("img", { name: "Tennis" })).toBeInTheDocument();
  });

  it("has a drawing for every name", () => {
    expect(Object.keys(ICON_PATHS)).toHaveLength(44);
    // A path opens with a moveto; the first one may be relative (chevron_left's is), which then means the same as M.
    for (const [name, d] of Object.entries(ICON_PATHS)) expect(d, name).toMatch(/^[Mm]/);
  });
});
