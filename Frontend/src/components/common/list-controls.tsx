import { useEffect, useState, type ReactNode } from "react";
import { Columns3, Download, Search, UserCog, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { fmtDateTime, relShort } from "@/lib/format";
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
  initial = "",
}: {
  placeholder: string;
  label: string;
  onSearch: (text: string) => void;
  /** Text to start with, e.g. when the box remounts on a view switch. */
  initial?: string;
}) {
  const [text, setText] = useState(initial);
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
  children,
}: {
  count: number;
  users: { id: string; name: string }[];
  assigning: boolean;
  onAssign: (ownerId: string | null) => void;
  onExport: () => void;
  onClear: () => void;
  /** More actions for this list (contacts: lifecycle, DNC, delete). */
  children?: ReactNode;
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
      {children}
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

export type ListColumn<T> = {
  id: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** The server's sort key for this column; sortable only when set. */
  sort?: string;
};

/** A column header that sorts: first click ascending, the next descending, and so on. */
function SortHeader({
  label: text,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: string;
  sort: string | undefined;
  onSort: (sort: string) => void;
}) {
  const dir = sort === sortKey ? "ascending" : sort === `-${sortKey}` ? "descending" : null;
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => onSort(dir === "ascending" ? `-${sortKey}` : sortKey)}
      aria-label={`Sort by ${text}${dir ? ` (${dir})` : ""}`}
    >
      {text}
      <span aria-hidden className={dir ? "text-foreground" : "opacity-30"}>
        {dir === "descending" ? "▼" : "▲"}
      </span>
    </button>
  );
}

/**
 * Dense list table: optional tick boxes (pass `onSelect`), a fixed name column, the chosen
 * columns, then optional row actions.
 */
export function RecordTable<T extends { id: string }>({
  rows,
  columns,
  name,
  nameHeader = "Name",
  nameSort,
  sort,
  onSort,
  rowLabel,
  selected = [],
  onSelect,
  actions,
  dimmed,
}: {
  rows: T[];
  columns: ListColumn<T>[];
  name: (row: T) => ReactNode;
  nameHeader?: string;
  rowLabel: (row: T) => string;
  selected?: string[];
  onSelect?: (ids: string[]) => void;
  actions?: (row: T) => ReactNode;
  dimmed?: boolean;
  /** Sort key of the name column. */
  nameSort?: string;
  /** Current sort ("key" or "-key"); headers with a sort key call onSort. */
  sort?: string | undefined;
  onSort?: (sort: string) => void;
}) {
  return (
    <div className="max-h-[calc(100vh-17rem)] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-muted text-left text-xs text-muted-foreground">
          <tr>
            {onSelect && (
              <th className="w-10 px-3 py-2">
                <SelectAll ids={rows.map((r) => r.id)} selected={selected} onChange={onSelect} />
              </th>
            )}
            <th className="px-3 py-2 font-medium" aria-sort={ariaSort(nameSort, sort)}>
              {nameSort && onSort ? (
                <SortHeader label={nameHeader} sortKey={nameSort} sort={sort} onSort={onSort} />
              ) : (
                nameHeader
              )}
            </th>
            {columns.map((c) => (
              <th
                key={c.id}
                className="whitespace-nowrap px-3 py-2 font-medium"
                aria-sort={ariaSort(c.sort, sort)}
              >
                {c.sort && onSort ? (
                  <SortHeader label={c.label} sortKey={c.sort} sort={sort} onSort={onSort} />
                ) : (
                  c.label
                )}
              </th>
            ))}
            {actions && (
              <th className="px-3 py-2">
                <span className="sr-only">Actions</span>
              </th>
            )}
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
                {onSelect && (
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
                )}
                <td className="px-3 py-1.5">
                  <div className="min-w-40">{name(row)}</div>
                </td>
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className="max-w-56 truncate whitespace-nowrap px-3 py-1.5 text-xs"
                  >
                    {col.cell(row) ?? <span className="text-muted-foreground">-</span>}
                  </td>
                ))}
                {actions && (
                  <td className="whitespace-nowrap px-3 py-1 text-right">{actions(row)}</td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ariaSort(key: string | undefined, sort: string | undefined) {
  if (!key) return undefined;
  return sort === key ? "ascending" : sort === `-${key}` ? "descending" : "none";
}

/** Centered icon, title, text and actions for a list with no rows. */
export function ListEmptyState({
  icon: Icon,
  title,
  text,
  compact,
  children,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  /** Smaller, for cards (dashboard) instead of whole lists. */
  compact?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 text-center", compact ? "py-6" : "py-16")}>
      <div
        className={cn(
          "grid place-items-center rounded-full bg-primary/10 text-primary",
          compact ? "size-9" : "size-12",
        )}
      >
        <Icon className={compact ? "size-4" : "size-6"} />
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

/** "Today, 11:33 am" / "3d ago", with the full date and time on hover. */
export function RelTime({ iso }: { iso?: string | undefined }) {
  if (!iso) return null;
  return <span title={fmtDateTime(iso)}>{relShort(iso)}</span>;
}
