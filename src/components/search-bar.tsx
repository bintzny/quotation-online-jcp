import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

/** Plain GET form so searches are bookmarkable and work without JavaScript. */
export function SearchBar({
  q,
  placeholder,
  label,
  hidden,
}: {
  q?: string;
  placeholder: string;
  label: string;
  hidden?: Record<string, string | undefined>;
}) {
  return (
    <form method="get" className="flex gap-2" role="search">
      {Object.entries(hidden ?? {}).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <Input name="q" defaultValue={q} placeholder={placeholder} aria-label={label} className="max-w-md" maxLength={100} />
      <Button type="submit" variant="outline">
        <SearchIcon />
        <span className="hidden sm:inline">{label}</span>
      </Button>
    </form>
  );
}
