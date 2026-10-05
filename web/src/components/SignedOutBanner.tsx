import { useT } from "../i18n/index.tsx";
import { signInAgain, useSignedOut } from "../session.tsx";

export function SignedOutBanner() {
  const t = useT();
  if (!useSignedOut()) return null;
  return (
    <div
      role="alert"
      className="sticky top-0 z-30 rounded-b-2xl bg-[#F6D57A] px-4 pb-2 pt-[calc(env(safe-area-inset-top)_+_0.5rem)] text-sm text-[#3D2C00] shadow-[0_3px_6px_var(--nm-lo)] dark:bg-[#5A4710] dark:text-[#FDE68A]"
    >
      {t.session.signedOut}{" "}
      <button type="button" onClick={signInAgain} className="font-semibold underline">
        {t.session.signIn}
      </button>
    </div>
  );
}
