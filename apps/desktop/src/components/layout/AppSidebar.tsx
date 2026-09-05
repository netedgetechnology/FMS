import finwealogo from "@/assets/icons/finwealogo.png";
import { useState } from "react";
import {
  IconDashboard,
  IconBuildingBank,
  IconBuildingStore,
  IconReceipt,
  IconFileImport,
  IconFileDescription,
  IconWallet,
  IconTarget,
  IconPigMoney,
  IconChartBar,
  IconReportAnalytics,
  IconCategory,
  IconScale,
  IconSettings,
  IconUserCircle,
  IconChevronUp,
  IconChevronDown,
} from "@tabler/icons-react";
import { NavLink } from "react-router-dom";
import { useSettings } from "@/modules/settings/hooks/useSettings";
import { useProfile } from "@/modules/profile/hooks/useProfile";


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
];

const workspaceMenu = [
  { icon: IconUserCircle, label: "Profile", path: "/profile" },
  { icon: IconSettings, label: "Settings", path: "/settings" },
  { icon: IconFileDescription, label: "Document Vault", path: "/documents" },
];

export default function AppSidebar() {
  const { settings } = useSettings();
  const { profile } = useProfile();
  const [isWorkspaceMenuOpen, setIsWorkspaceMenuOpen] = useState(false);
  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col border-r border-slate-100 bg-white dark:border-slate-800 dark:bg-[#111827]">

      <div className="shrink-0 px-7 pb-5 pt-7">
        <div className="flex items-center gap-2">
          <img
            src={finwealogo}
            alt="FinWea"
            className="h-8 w-auto object-contain"
          />
          <h1 className="whitespace-nowrap text-[27px] font-extrabold tracking-tight text-[#111827]">FinWea</h1>
        </div>

        <p className="mt-1 text-[13px] leading-5 text-slate-500">
          Your Finance Manager
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

          {isWorkspaceMenuOpen && (
            <div className="mb-2 space-y-0.5 border-b border-slate-200 pb-2">
              {workspaceMenu.map((item) => (
                <NavLink
                  key={item.label}
                  to={item.path}
                  className={({ isActive }) =>
                    [
                      "flex h-9 items-center gap-3 rounded-xl px-3 text-[14px] transition-all",
                      isActive
                        ? "bg-[#EEF4FF] font-semibold text-[#2563EB]"
                        : "text-slate-700 hover:bg-slate-100",
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
            </div>
          )}

          <button
            type="button"
            onClick={() => setIsWorkspaceMenuOpen((open) => !open)}
            aria-expanded={isWorkspaceMenuOpen}
            className="flex w-full items-center gap-2.5 text-left"
          >

            <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#F0EAFE] text-[#7C3AED]">
              {profile.avatar ? (
                <img
                  src={profile.avatar}
                  alt="Profile"
                  className="h-full w-full object-cover"
                />
              ) : (
                <IconUserCircle size={18} stroke={1.8} />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                My Workspace
              </div>

              <div className="text-[13px] font-semibold text-slate-900">
                {settings.workspaceName}
              </div>
            </div>

            {isWorkspaceMenuOpen ? (
              <IconChevronDown
                size={16}
                className="shrink-0 text-slate-500"
              />
            ) : (
              <IconChevronUp
                size={16}
                className="shrink-0 text-slate-500"
              />
            )}

          </button>

        </div>

      </div>

    </aside>
  );
}










