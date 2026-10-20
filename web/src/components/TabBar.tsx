import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";
import { seeHealthNews, useHealthNews } from "../health/background.ts";
import { Icon } from "../icons/Icon.tsx";
import { useT } from "../i18n/index.tsx";
import type { IconName } from "../icons/paths.ts";
import { useInsights } from "../queries.ts";

const INSIGHTS_SEEN_KEY = "fitnessai.insights-seen";

function readSeen(): string | null {
  try {
    return localStorage.getItem(INSIGHTS_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeSeen(generatedAt: string): void {
  try {
    localStorage.setItem(INSIGHTS_SEEN_KEY, generatedAt);
  } catch {
    // Without storage the dot just shows again on the next visit.
  }
}

/**
 * Whether a weekly report has been written since the Insights tab was last open. The first report this phone ever sees
 * counts as seen, so the dot means "new since you last looked", not "you have never looked".
 */
function useNewInsights(onTab: boolean): boolean {
  const generatedAt = useInsights().data?.insight?.generated_at ?? null;
  const [seen, setSeen] = useState(readSeen);
  useEffect(() => {
    if (generatedAt === null || generatedAt === seen) return;
    if (onTab || seen === null) {
      writeSeen(generatedAt);
      setSeen(generatedAt);
    }
  }, [generatedAt, seen, onTab]);
  return generatedAt !== null && seen !== null && generatedAt !== seen && !onTab;
}

function Tab({ to, icon, label, active, news = false }: { to: string; icon: IconName; label: string; active: boolean; news?: boolean }) {
  const t = useT();
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-xl text-xs ${active ? "font-medium text-accent-ink" : "text-muted"}`}
    >
      <span className={`relative flex h-8 w-12 items-center justify-center rounded-xl ${active ? "pressed" : ""}`}>
        <Icon name={icon} size={22} />
        {/* Something new waits there (2026-10-20, option A): a small dot in the accent, ringed in the bar's colour. */}
        {news && <span aria-hidden="true" className="absolute top-[3px] right-2.5 h-2 w-2 rounded-full bg-accent shadow-[0_0_0_2px_var(--nm-base)]" />}
      </span>
      <span className="max-w-full truncate px-0.5">
        {label}
        {news && <span className="sr-only">, {t.nav.new}</span>}
      </span>
    </Link>
  );
}

export function TabBar() {
  const { pathname } = useLocation();
  const t = useT();
  const onHealth = pathname.startsWith("/health");
  const onInsights = pathname === "/insights";
  const healthNews = useHealthNews();
  useEffect(() => {
    if (onHealth && healthNews) seeHealthNews();
  }, [onHealth, healthNews]);
  const insightsNews = useNewInsights(onInsights);
  // Onboarding is a screen of its own.
  if (pathname === "/welcome") return null;
  return (
    <nav
      aria-label={t.nav.main}
      className="fixed inset-x-0 bottom-0 z-20 flex h-[calc(var(--tabbar-h)_+_env(safe-area-inset-bottom))] items-start justify-center bg-base px-2 pt-2 pb-[env(safe-area-inset-bottom)]"
    >
      <div className="flex w-full max-w-xl">
        <Tab to="/day/today" icon="sunny" label={t.nav.today} active={pathname.startsWith("/day")} />
        <Tab to="/insights" icon="monitoring" label={t.nav.insights} active={onInsights} news={insightsNews} />
        <Tab to="/health" icon="ecg_heart" label={t.nav.health} active={onHealth} news={healthNews && !onHealth} />
        <Tab to="/settings" icon="settings" label={t.nav.settings} active={pathname.startsWith("/settings")} />
      </div>
    </nav>
  );
}
