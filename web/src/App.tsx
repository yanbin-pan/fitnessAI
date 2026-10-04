import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api.ts";
import { SignedOutBanner } from "./components/SignedOutBanner.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { SettingsPage } from "./pages/SettingsPage.tsx";
import { TodayPage } from "./pages/TodayPage.tsx";
import { SessionProvider } from "./session.tsx";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Retry only when the network dropped; a refusal will not change by asking again.
      retry: (failures, error) => error instanceof ApiError && error.kind === "offline" && failures < 2,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <BrowserRouter>
          <div className="min-h-dvh bg-base text-ink">
            <SignedOutBanner />
            <Routes>
              <Route path="/" element={<Navigate to="/day/today" replace />} />
              <Route path="/day/:date" element={<TodayPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/day/today" replace />} />
            </Routes>
            <TabBar />
          </div>
        </BrowserRouter>
      </SessionProvider>
    </QueryClientProvider>
  );
}
