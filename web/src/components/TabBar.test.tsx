import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../test/render.tsx";
import { TabBar } from "./TabBar.tsx";

describe("TabBar", () => {
  it("names each tab by its label and marks the current one", () => {
    renderWithProviders(<TabBar />, { route: "/settings" });
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Today" })).not.toHaveAttribute("aria-current");
  });
});
