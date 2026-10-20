import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { jsonResponse, mockFetch, renderWithProviders } from "../test/render.tsx";
import { Composer } from "./Composer.tsx";

vi.mock("../photos/prepare.ts", () => ({
  preparePhoto: vi.fn(async () => ({ blob: new Blob(["resized"], { type: "image/jpeg" }), width: 1568, height: 1176 })),
}));

describe("Composer drafts", () => {
  it("keeps what was typed and attached on a day while another day is open", async () => {
    mockFetch(() => jsonResponse({ id: "a".repeat(32), media_type: "image/jpeg", bytes: 7, width: 1568, height: 1176 }, 201));
    const first = renderWithProviders(<Composer date="2026-10-03" />);
    await userEvent.type(screen.getByLabelText("Message Zabaione"), "half a pizza");
    await userEvent.upload(screen.getByLabelText("Add photos"), new File(["x"], "pizza.jpg", { type: "image/jpeg" }));
    first.unmount();

    const other = renderWithProviders(<Composer date="2026-10-02" />);
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("");
    expect(screen.queryByRole("img", { name: "Photo 1" })).toBeNull();
    other.unmount();

    renderWithProviders(<Composer date="2026-10-03" />);
    expect(screen.getByLabelText("Message Zabaione")).toHaveValue("half a pizza");
    expect(screen.getByRole("img", { name: "Photo 1" })).toBeInTheDocument();
  });
});
