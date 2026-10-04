import { Link, useLocation } from "react-router";

function tabClass(active: boolean): string {
  return `flex h-12 flex-1 items-center justify-center text-sm ${active ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-slate-500"}`;
}

export function TabBar() {
  const { pathname } = useLocation();
  const onDay = pathname.startsWith("/day");
  const onSettings = pathname === "/settings";
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-800 dark:bg-slate-950">
      <Link to="/day/today" className={tabClass(onDay)} aria-current={onDay ? "page" : undefined}>
        Today
      </Link>
      <Link to="/settings" className={tabClass(onSettings)} aria-current={onSettings ? "page" : undefined}>
        Settings
      </Link>
    </nav>
  );
}
