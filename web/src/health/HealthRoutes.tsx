import { Navigate, Route, Routes } from "react-router";
import { CoachView } from "./CoachView.tsx";
import { HealthChat } from "./HealthChat.tsx";
import { HealthHome } from "./HealthHome.tsx";
import { MarkerPage } from "./MarkerPage.tsx";
import { DietPage, SectionPage } from "./ProfilePages.tsx";
import { RecordPage, RecordsPage } from "./RecordsPage.tsx";

/** The Health tab's screens, under /health (2026-10-19 health tab design §3). */
export function HealthRoutes() {
  return (
    <Routes>
      <Route index element={<HealthHome />} />
      <Route path="chat" element={<HealthChat />} />
      <Route path="records" element={<RecordsPage />} />
      <Route path="records/:id" element={<RecordPage />} />
      <Route path="markers/:key" element={<MarkerPage />} />
      <Route path="profile/:section" element={<SectionPage />} />
      <Route path="diet" element={<DietPage />} />
      <Route path="coach" element={<CoachView />} />
      <Route path="*" element={<Navigate to="/health" replace />} />
    </Routes>
  );
}
