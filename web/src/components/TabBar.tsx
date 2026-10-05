import { Link, useLocation } from "react-router";
import { Icon } from "../icons/Icon.tsx";
import { useT } from "../i18n/index.tsx";
import type { IconName } from "../icons/paths.ts";

function Tab({ to, icon, label, active }: { to: string; icon: IconName; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`flex w-20 flex-col items-center gap-0.5 rounded-xl text-xs ${active ? "font-medium text-accent-ink" : "text-muted"}`}
    >
      <span className={`flex h-8 w-12 items-center justify-center rounded-xl ${active ? "pressed" : ""}`}>
        <Icon name={icon} size={22} />
      </span>
      {label}
    </Link>
  );
}

export function TabBar() {
  const { pathname } = useLocation();
  const t = useT();
  return (
    <nav
      aria-label={t.nav.main}
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] items-start justify-center gap-16 bg-base pt-2 pb-[env(safe-area-inset-bottom)]"
    >
      <Tab to="/day/today" icon="sunny" label={t.nav.today} active={pathname.startsWith("/day")} />
      <Tab to="/settings" icon="settings" label={t.nav.settings} active={pathname === "/settings"} />
    </nav>
  );
}
