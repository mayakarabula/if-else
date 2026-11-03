import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./auth/RequireAuth";
import { ActivityPage } from "./pages/ActivityPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { LoginPage } from "./pages/LoginPage";
import { RuleFormPage } from "./pages/RuleFormPage";
import { RulesPage } from "./pages/RulesPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route index element={<RulesPage />} />
          <Route path="create" element={<RuleFormPage />} />
          <Route path="rules/:id/edit" element={<RuleFormPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="activity" element={<ActivityPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
