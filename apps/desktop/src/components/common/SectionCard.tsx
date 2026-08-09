type SectionCardProps = {
  title: string;
  children: React.ReactNode;
};

export default function SectionCard({
  title,
  children,
}: SectionCardProps) {
  return (
    <div className="rounded-xl border-transparent bg-white shadow-sm">
      <div className="border-b px-6 py-4">
        <h2 className="font-semibold">{title}</h2>
      </div>

      <div className="p-5">
        {children}
      </div>
    </div>
  );
}
