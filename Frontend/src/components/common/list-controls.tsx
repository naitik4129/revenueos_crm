import { useEffect, useState, type ReactNode } from "react";
import { Columns3, Download, Search, UserCog, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
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

/** HubSpot-style view tabs under a page header; `active` is null when no view matches. */
export function ViewTabs({
  views,
  active,
  onSelect,
}: {
  views: { id: string; label: string }[];
  active: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div role="tablist" aria-label="Views" className="-mb-px flex gap-1 overflow-x-auto">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={v.id === active}
          onClick={() => onSelect(v.id)}
          className={cn(
            "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground hover:text-foreground",
            v.id === active && "border-primary font-medium text-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** "Columns" popover: tick which optional columns the table shows. */
export function ColumnChooser({
  columns,
  visible,
  onChange,
}: {
  columns: { id: string; label: string }[];
  visible: string[];
  onChange: (visible: string[]) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Columns3 className="size-4" /> Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-52 p-1">
        {columns.map((c) => (
          <label
            key={c.id}
            className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              checked={visible.includes(c.id)}
              onCheckedChange={(on) =>
                // Keep the table's column order, whatever order they were ticked in.
                onChange(
                  columns
                    .map((x) => x.id)
                    .filter((id) => (id === c.id ? on === true : visible.includes(id))),
                )
              }
            />
            {c.label}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Replaces a list toolbar while rows are ticked: count, assign owner, export, clear. */
export function BulkBar({
  count,
  users,
  assigning,
  onAssign,
  onExport,
  onClear,
}: {
  count: number;
  users: { id: string; name: string }[];
  assigning: boolean;
  onAssign: (ownerId: string | null) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <>
      <span className="text-sm font-medium">{count} selected</span>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={assigning}>
            <UserCog className="size-4" />
            {assigning ? "Assigning…" : "Assign owner"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="max-h-72 w-56 overflow-y-auto p-1">
          {[{ id: null, name: "Unassigned" }, ...users].map((u) => (
            <button
              key={u.id ?? "none"}
              type="button"
              className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => onAssign(u.id)}
            >
              {u.name}
            </button>
          ))}
        </PopoverContent>
      </Popover>
      <Button size="sm" variant="outline" className="gap-1.5" onClick={onExport}>
        <Download className="size-4" /> Export CSV
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto gap-1.5" onClick={onClear}>
        <X className="size-4" /> Clear selection
      </Button>
    </>
  );
}

/** Ticks every row on the page, or clears them; shows a dash when only some are ticked. */
export function SelectAll({
  ids,
  selected,
  onChange,
}: {
  ids: string[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const all = ids.length > 0 && selected.length === ids.length;
  return (
    <Checkbox
      aria-label="Select all on this page"
      checked={all ? true : selected.length > 0 ? "indeterminate" : false}
      onCheckedChange={() => onChange(all ? [] : ids)}
    />
  );
}

export type ListColumn<T> = { id: string; label: string; cell: (row: T) => ReactNode };

/** Dense list table: tick boxes, a fixed name column, then the chosen columns. */
export function RecordTable<T extends { id: string }>({
  rows,
  columns,
  name,
  rowLabel,
  selected,
  onSelect,
  dimmed,
}: {
  rows: T[];
  columns: ListColumn<T>[];
  name: (row: T) => ReactNode;
  rowLabel: (row: T) => string;
  selected: string[];
  onSelect: (ids: string[]) => void;
  dimmed?: boolean;
}) {
  return (
    <div className="max-h-[calc(100vh-17rem)] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2">
              <SelectAll ids={rows.map((r) => r.id)} selected={selected} onChange={onSelect} />
            </th>
            <th className="px-3 py-2 font-medium">Name</th>
            {columns.map((c) => (
              <th key={c.id} className="whitespace-nowrap px-3 py-2 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className={dimmed ? "opacity-60" : undefined}>
          {rows.map((row) => {
            const checked = selected.includes(row.id);
            return (
              <tr
                key={row.id}
                className={cn("border-t hover:bg-accent/40", checked && "bg-accent/60")}
              >
                <td className="px-3 py-1.5">
                  <Checkbox
                    aria-label={`Select ${rowLabel(row)}`}
                    checked={checked}
                    onCheckedChange={() =>
                      onSelect(
                        checked ? selected.filter((id) => id !== row.id) : [...selected, row.id],
                      )
                    }
                  />
                </td>
                <td className="px-3 py-1.5">{name(row)}</td>
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className="max-w-56 truncate whitespace-nowrap px-3 py-1.5 text-xs"
                  >
                    {col.cell(row) ?? <span className="text-muted-foreground">-</span>}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Centered icon, title, text and actions for a list with no rows. */
export function ListEmptyState({
  icon: Icon,
  title,
  text,
  children,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-16 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <Icon className="size-6" />
      </div>
      <h2 className="mt-3 text-base font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>
      <div className="mt-4 flex gap-2">{children}</div>
    </div>
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
