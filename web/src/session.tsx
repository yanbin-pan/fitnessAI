import { createContext, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { onSignedOut } from "./api.ts";

const SignedOutContext = createContext(false);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [signedOut, setSignedOut] = useState(false);
  useEffect(() => onSignedOut(() => setSignedOut(true)), []);
  return <SignedOutContext.Provider value={signedOut}>{children}</SignedOutContext.Provider>;
}

export function useSignedOut(): boolean {
  return useContext(SignedOutContext);
}

/** A full navigation that skips the service worker's cache, so Cloudflare Access can show its login page. */
export function signInAgain(): void {
  window.location.assign(`/?reauth=${Date.now()}`);
}
