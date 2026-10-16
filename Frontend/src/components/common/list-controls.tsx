import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** A search box that reports its text once typing pauses (for server-side search). */
export function SearchBox({
  placeholder,
  label,
  onSearch,
}: {
  placeholder: string;
  label: string;
  onSearch: (text: string) => void;
}) {
  const [text, setText] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => onSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, onSearch]);
  return (
    <div className="relative w-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="pl-8"
      />
    </div>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: (readonly [string, string])[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function Pager({
  offset,
  pageSize,
  total,
  onOffset,
}: {
  offset: number;
  pageSize: number;
  total: number;
  onOffset: (offset: number) => void;
}) {
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground">
      <span>
        {offset + 1}-{Math.min(offset + pageSize, total)} of {total}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={offset === 0}
        onClick={() => onOffset(Math.max(offset - pageSize, 0))}
      >
        Previous
      </Button>
      <Button
        size="sm"
        variant="outline"
        disabled={offset + pageSize >= total}
        onClick={() => onOffset(offset + pageSize)}
      >
        Next
      </Button>
    </div>
  );
}
