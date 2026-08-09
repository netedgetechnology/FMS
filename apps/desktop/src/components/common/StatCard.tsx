type StatCardProps = {
  title: string;
  value: string;
  valueClassName?: string;
};

export default function StatCard({
  title,
  value,
  valueClassName = "",
}: StatCardProps) {
  return (
    <div className="rounded-xl border-transparent bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className={`mt-3 text-3xl font-bold ${valueClassName}`}>
        {value}
      </div>
    </div>
  );
}
