import {
  IconDashboard,
  IconBuildingBank,
  IconBuildingStore,
  IconReceipt,
  IconWallet,
  IconTarget,
  IconPigMoney,
  IconChartBar,
  IconReportAnalytics,
  IconCategory,
  IconSettings,
} from "@tabler/icons-react";

import { NavLink } from "react-router-dom";

const menu = [
  { icon: IconDashboard, label: "Dashboard", path: "/dashboard" },
  { icon: IconBuildingBank, label: "Accounts", path: "/accounts" },
  { icon: IconBuildingStore, label: "Business Entities", path: "/business-entities" },
  { icon: IconReceipt, label: "Transactions", path: "/transactions" },
  { icon: IconWallet, label: "Budgets", path: "/budgets" },
  { icon: IconWallet, label: "Financial Plans", path: "/financial-plans" },
  { icon: IconTarget, label: "Financial Goals", path: "/financial-goals" },
  { icon: IconPigMoney, label: "Investments", path: "/investments" },
  { icon: IconChartBar, label: "Loans", path: "/loans" },
  { icon: IconReportAnalytics, label: "Reports", path: "/reports" },
  { icon: IconCategory, label: "Categories", path: "/categories" },
  { icon: IconSettings, label: "Settings", path: "/settings" },
];

export default function AppSidebar() {
  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r border-slate-100 bg-white">

      <div className="px-8 pb-8 pt-10">

        <h1 className="text-[28px] font-extrabold tracking-tight text-[#0F172A]">
          FinanceOS
        </h1>

        <p className="mt-2 text-[14px] text-slate-500">
          Personal Finance Manager
        </p>

      </div>

      <nav className="flex-1 px-3">

        {menu.map((item) => (

          <NavLink
            key={item.label}
            to={item.path}
            className={({ isActive }) =>
              [
                "mb-1 flex h-11 items-center gap-3 rounded-xl px-4 text-[15px] transition-all",
                isActive
                  ? "bg-[#EEF4FF] font-semibold text-[#2563EB]"
                  : "text-slate-700 hover:bg-slate-50",
              ].join(" ")
            }
          >

            <item.icon size={18} />

            <span>{item.label}</span>

          </NavLink>

        ))}

      </nav>

      <div className="px-4 pb-6">

        <div className="rounded-2xl bg-slate-50 p-4">

          <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </div>

          <div className="mt-3 font-semibold text-slate-900">
            Personal
          </div>

        </div>

      </div>

    </aside>
  );
}
