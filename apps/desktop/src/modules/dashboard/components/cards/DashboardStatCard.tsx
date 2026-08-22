import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { Sparkline } from "../charts/Sparkline";

const positiveData = [
  { value: 10 },
  { value: 11 },
  { value: 12 },
  { value: 14 },
  { value: 13 },
  { value: 16 },
  { value: 15 },
  { value: 18 },
];

const negativeData = [
  { value: 18 },
  { value: 17 },
  { value: 16 },
  { value: 17 },
  { value: 15 },
  { value: 14 },
  { value: 13 },
  { value: 12 },
];

export interface DashboardStatCardProps {
  title: string;
  value: string;
  change?: string | null;
  positive?: boolean;
  icon: LucideIcon;
  iconBackground: string;
  iconColor: string;
}

export function DashboardStatCard({
  title,
  value,
  change,
  positive = true,
  icon: Icon,
  iconBackground,
  iconColor,
}: DashboardStatCardProps) {
  const chartColor =
    positive ? "#16A34A" : "#EF4444";

  const data =
    positive ? positiveData : negativeData;

  return (
    <div className="h-[156px] rounded-3xl bg-white px-5 py-5 shadow-[0_6px_24px_rgba(15,23,42,0.05)]">

      <div className="flex justify-between">

        <div>

          <div className="text-caption font-medium text-slate-500">
            {title}
          </div>

          <div className="mt-2 text-card-value amount leading-none tracking-[-0.02em] text-[#0F172A]">
            {value}
          </div>

        </div>

        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm"
          style={{ backgroundColor: iconBackground }}
        >
          <Icon
            size={20}
            style={{ color: iconColor }}
          />
        </div>

      </div>

      <div className="mt-5 flex items-end justify-between">

        <div>

          {change ? (
            <>
              <div
                className={
                  positive
                    ? "flex items-center text-caption font-semibold text-emerald-600"
                    : "flex items-center text-caption font-semibold text-red-500"
                }
              >

                {positive ? (
                  <ArrowUpRight size={14} />
                ) : (
                  <ArrowDownRight size={14} />
                )}

                <span className="ml-1">
                  {change}
                </span>

              </div>

              <div className="mt-1 text-small text-slate-400">
                vs last month
              </div>
            </>
          ) : (
            <div className="text-small text-slate-400">
              Current period
            </div>
          )}

        </div>

        <div className="h-11 w-[66px]">
          <Sparkline
            color={chartColor}
            data={data}
          />
        </div>

      </div>

    </div>
  );
}
