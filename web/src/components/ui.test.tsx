import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Segmented, Toggle } from "./ui.tsx";

describe("Segmented", () => {
  it("is a named radio group that reports the chosen value", async () => {
    const onChange = vi.fn();
    render(
      <Segmented legend="Goal" value="maintain" onChange={onChange}
        options={[{ value: "lose", label: "Lose" }, { value: "maintain", label: "Maintain" }, { value: "gain", label: "Gain" }]} />,
    );
    expect(screen.getByRole("group", { name: "Goal" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Maintain" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Lose" }));
    expect(onChange).toHaveBeenCalledWith("lose");
  });
});

describe("Toggle", () => {
  it("is a switch named by its label", async () => {
    const onChange = vi.fn();
    render(<Toggle label="Log only" checked={false} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Log only" }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
