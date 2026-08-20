import { Navigate, Route, Routes } from "react-router-dom";

import AppLayout from "@/components/layout/AppLayout";
import Dashboard from "@/modules/dashboard/Dashboard";
import AccountsPage from "@/modules/accounts";
import { LoansPage } from "@/modules/loans";
import { InvestmentsPage } from "@/modules/investments";
import ReportsPage from "@/modules/reports";
import CategoriesPage from "@/modules/categories";
import { BusinessEntitiesPage } from "@/modules/business-entities";
import TransactionsPage from "@/modules/transactions/pages/TransactionsPage";
import { FinancialPlansPage } from "@/modules/financial-plans/pages";
import { FinancialGoalsPage } from "@/modules/financial-goals/pages";

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route path="/dashboard" element={<Dashboard />} />

        <Route path="/accounts" element={<AccountsPage />} />

        <Route path="/loans" element={<LoansPage />} />

        <Route path="/investments" element={<InvestmentsPage />} />

        <Route path="/reports" element={<ReportsPage />} />

        <Route path="/categories" element={<CategoriesPage />} />

        <Route
          path="/business-entities"
          element={<BusinessEntitiesPage />}
        />

        <Route
          path="/transactions"
          element={<TransactionsPage />}
        />

        <Route
          path="/financial-plans"
          element={<FinancialPlansPage />}
        />

        <Route
          path="/financial-goals"
          element={<FinancialGoalsPage />}
        />

      </Route>
    </Routes>
  );
}
