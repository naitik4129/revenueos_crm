import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Building2, Search, User } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useCompanySearch, useContactSearch } from "@/store";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const SEARCH_SHORTCUT = IS_MAC ? "⌘K" : "Ctrl K";

type Result = {
  kind: "contact" | "company";
  id: string;
  title: string;
  detail?: string | undefined;
};

/** The one search in the app: contacts and companies, server-side; Ctrl/⌘ K focuses it. */
export function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const narrow = useNarrowScreen();

  const trimmed = query.trim();
  // Typing pauses before each request.
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), 250);
    return () => clearTimeout(timer);
  }, [trimmed]);
  const contacts = useContactSearch(debounced);
  const companies = useCompanySearch(debounced);
  const results: Result[] = [
    ...contacts.results.map((c) => ({
      kind: "contact" as const,
      id: c.id,
      title: `${c.firstName} ${c.lastName}`.trim(),
      detail: c.companyName ?? c.email,
    })),
    ...companies.results.map((c) => ({
      kind: "company" as const,
      id: c.id,
      title: c.name,
      detail: c.domain ?? c.industry,
    })),
  ];
  const searching = contacts.isFetching || companies.isFetching || debounced !== trimmed;
  const showPanel = open && trimmed.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const reset = () => {
    setQuery("");
    setOpen(false);
    setActiveIndex(-1);
  };

  const go = (r: Result) => {
    reset();
    if (r.kind === "contact")
      void navigate({ to: "/contacts/$contactId", params: { contactId: r.id } });
    else void navigate({ to: "/companies/$companyId", params: { companyId: r.id } });
  };

  const option = (r: Result, i: number) => {
    const Icon = r.kind === "contact" ? User : Building2;
    const props = {
      id: `header-search-result-${i}`,
      role: "option",
      "aria-selected": i === activeIndex,
      onClick: reset,
      onMouseEnter: () => setActiveIndex(i),
      className: cn(
        "flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent",
        i === activeIndex && "bg-accent",
      ),
    };
    const body = (
      <>
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{r.title}</span>
        <span className="ml-auto truncate text-xs text-muted-foreground">{r.detail}</span>
      </>
    );
    return r.kind === "contact" ? (
      <Link key={r.id} to="/contacts/$contactId" params={{ contactId: r.id }} {...props}>
        {body}
      </Link>
    ) : (
      <Link key={r.id} to="/companies/$companyId" params={{ companyId: r.id }} {...props}>
        {body}
      </Link>
    );
  };

  const heading = (text: string) => (
    <div
      role="presentation"
      className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
    >
      {text}
    </div>
  );

  return (
    <div ref={boxRef} className="relative w-full max-w-lg">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        role="combobox"
        aria-label="Search contacts and companies"
        aria-expanded={showPanel}
        aria-controls="header-search-results"
        aria-activedescendant={activeIndex >= 0 ? `header-search-result-${activeIndex}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => {
          if (trimmed) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            e.currentTarget.blur();
          } else if (e.key === "ArrowDown") {
            if (results.length === 0) return;
            e.preventDefault();
            setActiveIndex((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            if (results.length === 0) return;
            e.preventDefault();
            setActiveIndex((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            const target = activeIndex >= 0 ? results[activeIndex] : results[0];
            if (target) {
              e.preventDefault();
              go(target);
            }
          }
        }}
        placeholder={narrow ? "Search" : "Search contacts and companies"}
        className="h-9 bg-background pl-8 pr-16"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border bg-muted px-1.5 text-[10px] text-muted-foreground sm:block">
        {SEARCH_SHORTCUT}
      </kbd>
      {showPanel && (
        <div
          id="header-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-md border bg-popover pb-1 shadow-lg"
        >
          {results.length > 0 ? (
            <>
              {contacts.results.length > 0 && heading("Contacts")}
              {results.slice(0, contacts.results.length).map(option)}
              {companies.results.length > 0 && heading("Companies")}
              {results
                .slice(contacts.results.length)
                .map((r, i) => option(r, i + contacts.results.length))}
            </>
          ) : (
            <div className="px-3 py-2.5 text-sm text-muted-foreground">
              {searching ? "Searching…" : <>Nothing matches &ldquo;{trimmed}&rdquo;</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Below Tailwind's `sm` (640px); false where matchMedia is missing (tests). */
function useNarrowScreen() {
  const query = "(max-width: 639px)";
  const [narrow, setNarrow] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = () => setNarrow(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, []);
  return narrow;
}
