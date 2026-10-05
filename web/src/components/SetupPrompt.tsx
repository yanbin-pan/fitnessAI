import { Link } from "react-router";
import { useT } from "../i18n/index.tsx";
import { primaryButton } from "./ui.tsx";

export function SetupPrompt() {
  const t = useT();
  return (
    <main className="mx-auto max-w-xl p-6 pt-[calc(env(safe-area-inset-top)_+_1.5rem)]">
      <div className="raised rounded-3xl p-6">
        <h1 className="text-xl font-semibold">{t.setup.title}</h1>
        <p className="mt-2 text-muted">{t.setup.body}</p>
        <Link to="/settings" className={`${primaryButton} mt-4 inline-block`}>
          {t.setup.action}
        </Link>
      </div>
    </main>
  );
}
