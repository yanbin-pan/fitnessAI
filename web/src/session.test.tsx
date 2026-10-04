import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { api } from "./api.ts";
import { SignedOutBanner } from "./components/SignedOutBanner.tsx";
import { SessionProvider } from "./session.tsx";
import { mockFetch } from "./test/render.tsx";

function renderBanner() {
  return render(
    <SessionProvider>
      <SignedOutBanner />
    </SessionProvider>,
  );
}

describe("signed-out banner (spec 11.3)", () => {
  it("appears when a request finds the session expired, and its button does a full navigation to /?reauth=<ts>", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    vi.spyOn(Date, "now").mockReturnValue(1_760_000_000_000);
    mockFetch(() => ({ type: "opaqueredirect", status: 0, ok: false }) as Response);
    renderBanner();
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => {
      await api("/api/days/today").catch(() => undefined);
    });
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: /tap to sign in/i }));
    expect(assign).toHaveBeenCalledExactlyOnceWith("/?reauth=1760000000000");
  });

  it("stays hidden when the phone is merely offline", async () => {
    mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    renderBanner();
    await act(async () => {
      await api("/api/days/today").catch(() => undefined);
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
