import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/modules/dashboard/Dashboard";
import AccountsPage from "@/modules/accounts";
import { LoansPage } from "@/modules/loans";
import { InvestmentsPage } from "@/modules/investments";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/accounts" element={<AccountsPage />} />

        <Route path="/loans" element={<LoansPage />} />
        <Route path="/investments" element={<InvestmentsPage />} />
      </Route>
    </Routes>
  );
}



