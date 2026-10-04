import { Link } from "react-router";
import { primaryButton } from "./ui.tsx";

export function SetupPrompt() {
  return (
    <main className="mx-auto max-w-xl p-6 pt-[calc(env(safe-area-inset-top)_+_1.5rem)]">
      <div className="raised rounded-3xl p-6">
        <h1 className="text-xl font-semibold">Welcome</h1>
        <p className="mt-2 text-muted">Set up your profile so the app can work out your daily targets.</p>
        <Link to="/settings" className={`${primaryButton} mt-4 inline-block`}>
          Set up profile
        </Link>
      </div>
    </main>
  );
}
