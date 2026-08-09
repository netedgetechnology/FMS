import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/modules/dashboard/Dashboard";
import AccountsPage from "@/modules/accounts";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/accounts" element={<AccountsPage />} />
      </Route>
    </Routes>
  );
}
