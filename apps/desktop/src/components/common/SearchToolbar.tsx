import { Input } from "@/components/ui/input";

type SearchToolbarProps = {
  placeholder?: string;
};

export default function SearchToolbar({
  placeholder = "Search...",
}: SearchToolbarProps) {
  return (
    <div className="mb-6">
      <Input
        placeholder={placeholder}
        className="max-w-md"
      />
    </div>
  );
}
