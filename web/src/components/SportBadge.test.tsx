import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SportBadge } from "./SportBadge.tsx";

describe("SportBadge", () => {
  it("is named after its sport, unless its caller names it", () => {
    const { rerender } = render(<SportBadge activity="wakeboarding" />);
    expect(screen.getByRole("img", { name: "Wakeboarding" })).toBeInTheDocument();
    // The activity picker puts the sport's name on the button around the badge, so the badge itself stays quiet.
    rerender(<SportBadge activity="wakeboarding" labelled={false} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});
