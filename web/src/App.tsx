import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { ApiError } from "./api.ts";
import { SignedOutBanner } from "./components/SignedOutBanner.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { LanguageProvider } from "./i18n/index.tsx";
import { HealthRoutes } from "./health/HealthRoutes.tsx";
import { OnboardingPage } from "./onboarding/OnboardingPage.tsx";
import { InsightsPage } from "./pages/InsightsPage.tsx";
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
      <LanguageProvider>
        <SessionProvider>
          <BrowserRouter>
            <div className="min-h-dvh bg-base text-ink">
              <SignedOutBanner />
              <Routes>
                <Route path="/" element={<Navigate to="/day/today" replace />} />
                <Route path="/day/:date" element={<TodayPage />} />
                <Route path="/insights" element={<InsightsPage />} />
                <Route path="/health/*" element={<HealthRoutes />} />
                <Route path="/regulars" element={<Navigate to="/health" replace />} />
                <Route path="/settings/*" element={<SettingsPage />} />
                <Route path="/welcome" element={<OnboardingPage />} />
                <Route path="*" element={<Navigate to="/day/today" replace />} />
              </Routes>
              <TabBar />
            </div>
          </BrowserRouter>
        </SessionProvider>
      </LanguageProvider>
    </QueryClientProvider>
  );
}
