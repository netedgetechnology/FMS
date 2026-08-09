import {
  IconDashboard,
  IconWallet,
  IconReceipt,
  IconPigMoney,
  IconChartBar,
  IconReportAnalytics,
  IconSettings,
  IconBuildingBank,
} from "@tabler/icons-react";

import { NavLink } from "react-router-dom";

const menu = [
  {
    icon: IconDashboard,
    label: "Dashboard",
    path: "/dashboard",
  },
  {
    icon: IconBuildingBank,
    label: "Accounts",
    path: "/accounts",
  },
  {
    icon: IconReceipt,
    label: "Transactions",
    path: "/transactions",
  },
  {
    icon: IconWallet,
    label: "Budgets",
    path: "/budgets",
  },
  {
    icon: IconPigMoney,
    label: "Investments",
    path: "/investments",
  },
  {
    icon: IconChartBar,
    label: "Loans",
    path: "/loans",
  },
  {
    icon: IconReportAnalytics,
    label: "Reports",
    path: "/reports",
  },
  {
    icon: IconSettings,
    label: "Settings",
    path: "/settings",
  },
];

export default function AppSidebar() {
  return (
    <aside className="flex h-screen w-[320px] flex-col border-r border-transparent bg-white">

      <div className="border-b border-transparent px-9 py-9">

        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
          FinanceOS
        </h1>

        <p className="mt-2 text-sm text-slate-500">
          Personal Finance Manager
        </p>

      </div>

      <nav className="flex-1 space-y-1.5 px-6 py-5">

        {menu.map((item) => (

          <NavLink
            key={item.label}
            to={item.path}
            className={({ isActive }) =>
              [
                "group flex items-center gap-3 rounded-xl px-5 py-3.5 transition-all duration-200",
                isActive
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              ].join(" ")
            }
          >

            <item.icon size={20} />

            <span className="text-[15px] font-medium">
              {item.label}
            </span>

          </NavLink>

        ))}

      </nav>

      <div className="border-t border-transparent p-5">

        <div className="rounded-2xl bg-slate-50 p-5">

          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Workspace
          </p>

          <h3 className="mt-2 font-semibold text-slate-900">
            Personal Finance
          </h3>

          <p className="mt-1 text-sm text-slate-500">
            FinanceOS Desktop
          </p>

        </div>

      </div>

    </aside>
  );
}

