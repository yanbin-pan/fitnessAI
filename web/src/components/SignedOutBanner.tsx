import { signInAgain, useSignedOut } from "../session.tsx";

export function SignedOutBanner() {
  if (!useSignedOut()) return null;
  return (
    <div role="alert" className="sticky top-0 z-30 bg-amber-400 px-4 pb-2 pt-[calc(env(safe-area-inset-top)_+_0.5rem)] text-sm text-slate-900">
      Signed out.{" "}
      <button type="button" onClick={signInAgain} className="font-semibold underline">
        Tap to sign in
      </button>
    </div>
  );
}
