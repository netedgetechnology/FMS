import {
  IconDashboard,
  IconBuildingBank,
  IconBuildingStore,
  IconReceipt,
  IconFileImport,
  IconWallet,
  IconTarget,
  IconPigMoney,
  IconChartBar,
  IconReportAnalytics,
  IconCategory,
  IconScale,
  IconSettings,
  IconUserCircle,
  IconChevronDown,
} from "@tabler/icons-react";

import { NavLink } from "react-router-dom";

const menu = [
  { icon: IconDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: IconBuildingBank, label: "Accounts", path: "/accounts" },
  { icon: IconBuildingStore, label: "Business Entities", path: "/business-entities" },
  { icon: IconReceipt, label: "Transactions", path: "/transactions" },
  { icon: IconFileImport, label: "Imports", path: "/imports" },
  { icon: IconWallet, label: "Budgets", path: "/budgets" },
  { icon: IconWallet, label: "Financial Plans", path: "/financial-plans" },
  { icon: IconTarget, label: "Financial Goals", path: "/financial-goals" },
  { icon: IconPigMoney, label: "Investments", path: "/investments" },
  { icon: IconChartBar, label: "Loans", path: "/loans" },
  { icon: IconReportAnalytics, label: "Reports", path: "/reports" },
  { icon: IconCategory, label: "Categories", path: "/categories" },
  { icon: IconScale, label: "Reconciliation", path: "/reconciliation" },
  { icon: IconSettings, label: "Settings", path: "/settings" },
];

export default function AppSidebar() {
  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r border-slate-100 bg-white">

      <div className="shrink-0 px-7 pb-5 pt-7">
        <h1 className="text-[27px] font-extrabold tracking-tight text-[#0F172A]">
          FinanceOS
        </h1>

        <p className="mt-1 text-[13px] leading-5 text-slate-500">
          Personal Finance<br />
          Manager
        </p>
      </div>

      <nav className="min-h-0 flex-1 overflow-hidden px-3">

        {menu.map((item) => (
          <NavLink
            key={item.label}
            to={item.path}
            className={({ isActive }) =>
              [
                "mb-0.5 flex h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-all",
                isActive
                  ? "bg-[#EEF4FF] font-semibold text-[#2563EB]"
                  : "text-slate-700 hover:bg-slate-50",
              ].join(" ")
            }
          >
            <item.icon
              size={18}
              stroke={1.8}
              className="shrink-0"
            />

            <span className="truncate">
              {item.label}
            </span>
          </NavLink>
        ))}

      </nav>

      <div className="shrink-0 px-3 pb-4 pt-3">

        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2.5">

          <div className="flex items-center gap-2.5">

            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#F0EAFE] text-[#7C3AED]">
              <IconUserCircle size={18} stroke={1.8} />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                My Workspace
              </div>

              <div className="text-[13px] font-semibold text-slate-900">
                Personal
              </div>
            </div>

            <IconChevronDown
              size={16}
              className="shrink-0 text-slate-500"
            />

          </div>

        </div>

      </div>

    </aside>
  );
}
