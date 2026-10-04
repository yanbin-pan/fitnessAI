import { Link } from "react-router";

export function SetupPrompt() {
  return (
    <main className="mx-auto max-w-xl p-6 pt-[calc(env(safe-area-inset-top)_+_1.5rem)]">
      <h1 className="text-xl font-semibold">Welcome</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-300">Set up your profile so the app can work out your daily targets.</p>
      <Link to="/settings" className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2 font-semibold text-white">
        Set up profile
      </Link>
    </main>
  );
}
