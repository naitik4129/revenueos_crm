import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Bot,
  CalendarDays,
  ChevronsUpDown,
  FileText,
  Gauge,
  ListChecks,
  LogOut,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/common/brand-logo";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { toast } from "sonner";
import { AddLeadContext } from "@/app/add-lead-context";
import { AddLeadDialog } from "@/features/leads/add-lead-dialog";
import { messageFromError, useLeads, useNotifications, useSession } from "@/store";
import { cn } from "@/lib/utils";
import { relDay } from "@/lib/format";
import { label } from "@/lib/labels";
import { supabase } from "@/lib/supabase-client";

const NAV = [
  { to: "/", label: "Dashboard", icon: Gauge },
  { to: "/leads", label: "Leads", icon: Users },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/meetings", label: "Meetings", icon: CalendarDays },
  { to: "/proposals", label: "Proposals", icon: FileText },
  { to: "/automations", label: "Automations", icon: Bot },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { leads } = useLeads();
  const { notifications, markNotificationsRead } = useNotifications();
  const { currentUser } = useSession();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!searchOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!searchBoxRef.current?.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [searchOpen]);

  const unread = notifications.filter((n) => !n.read).length;
  const trimmedQuery = query.trim();
  const results = useMemo(() => {
    const tokens = trimmedQuery.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return leads
      .filter((l) => {
        const text = [
          l.firstName,
          l.lastName,
          l.company,
          l.email,
          l.phone,
          l.jobTitle,
          l.industry,
          l.serviceInterest,
          label(l.pipelineStage),
        ]
          .join(" ")
          .toLowerCase();
        return tokens.every((t) => text.includes(t));
      })
      .slice(0, 6);
  }, [leads, trimmedQuery]);
  const showSearchPanel = searchOpen && trimmedQuery.length > 0;

  const resetSearch = () => {
    setQuery("");
    setSearchOpen(false);
    setActiveIndex(-1);
  };

  return (
    <AddLeadContext.Provider value={{ open: () => setAddOpen(true) }}>
      <div className="flex min-h-screen bg-background">
        <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          <div className="px-3 py-5">
            <BrandLogo caption="MOTM Flow · Sales Automation" />
          </div>

          <div className="px-3 pb-3">
            <Button
              className="w-full justify-start gap-2"
              size="sm"
              onClick={() => setAddOpen(true)}
            >
              <Plus className="size-4" /> Add Lead
            </Button>
          </div>

          <ScrollArea className="flex-1 px-2">
            <nav className="space-y-0.5 pb-4">
              {NAV.map((item) => {
                const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
                      active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                    )}
                  >
                    <item.icon className="size-4 text-muted-foreground" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </ScrollArea>

          <div className="border-t border-sidebar-border p-3">
            <div className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-sidebar-accent">
              <BrandLogo variant="mark" className="size-6" />
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">MOTM Technologies</div>
                <div className="text-muted-foreground">Workspace · IST</div>
              </div>
              <ChevronsUpDown className="size-3.5 text-muted-foreground" />
            </div>
            <div className="mt-1 flex items-center gap-2 rounded-md px-2 py-2">
              <div className="grid size-7 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                {currentUser?.initials ?? "-"}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="truncate font-medium">{currentUser?.name ?? "Loading…"}</div>
                <div className="text-muted-foreground">{currentUser?.role ?? "Salesperson"}</div>
              </div>
              {supabase && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 shrink-0"
                  aria-label="Sign out"
                  onClick={() => void supabase?.auth.signOut()}
                >
                  <LogOut className="size-3.5" />
                </Button>
              )}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-card/80 px-4 backdrop-blur">
            <Link to="/" aria-label="MOTM Flow home" className="shrink-0 lg:hidden">
              <BrandLogo variant="mark" className="size-8" />
            </Link>
            <div ref={searchBoxRef} className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                role="combobox"
                aria-expanded={showSearchPanel}
                aria-controls="header-search-results"
                aria-activedescendant={
                  activeIndex >= 0 ? `header-search-result-${activeIndex}` : undefined
                }
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSearchOpen(true);
                  setActiveIndex(-1);
                }}
                onFocus={() => {
                  if (trimmedQuery) setSearchOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchOpen(false);
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
                      resetSearch();
                      void navigate({ to: "/leads/$leadId", params: { leadId: target.id } });
                    }
                  }
                }}
                placeholder="Search leads and companies…"
                className="h-9 pl-8"
              />
              {showSearchPanel && (
                <div
                  id="header-search-results"
                  role="listbox"
                  className="absolute left-0 right-0 top-11 z-40 overflow-hidden rounded-md border bg-popover shadow-lg"
                >
                  {results.length > 0 ? (
                    results.map((l, i) => (
                      <Link
                        key={l.id}
                        id={`header-search-result-${i}`}
                        role="option"
                        aria-selected={i === activeIndex}
                        to="/leads/$leadId"
                        params={{ leadId: l.id }}
                        onClick={resetSearch}
                        onMouseEnter={() => setActiveIndex(i)}
                        className={cn(
                          "flex items-center justify-between px-3 py-2 text-sm hover:bg-accent",
                          i === activeIndex && "bg-accent",
                        )}
                      >
                        <span>
                          {l.firstName} {l.lastName}
                        </span>
                        <span className="text-xs text-muted-foreground">{l.company}</span>
                      </Link>
                    ))
                  ) : (
                    <div className="px-3 py-2.5 text-sm text-muted-foreground">
                      No leads match &ldquo;{trimmedQuery}&rdquo;
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="hidden gap-2 text-muted-foreground md:flex"
                onClick={() => setPaletteOpen(true)}
              >
                <span className="text-xs">Quick actions</span>
                <kbd className="rounded border bg-muted px-1 text-[10px]">⌘K</kbd>
              </Button>

              <Popover
                onOpenChange={(o) => {
                  if (o) {
                    markNotificationsRead().catch((error: unknown) => {
                      toast.error(messageFromError(error));
                    });
                  }
                }}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="relative"
                    aria-label="Notifications"
                  >
                    <Bell className="size-4" />
                    {unread > 0 && (
                      <span className="absolute right-1.5 top-1.5 grid size-4 place-items-center rounded-full bg-destructive text-[9px] font-semibold text-destructive-foreground">
                        {unread}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-96 p-0">
                  <div className="border-b px-3 py-2 text-sm font-medium">Notifications</div>
                  <ScrollArea className="h-96">
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        className="flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent"
                        onClick={() => {
                          if (n.leadId)
                            void navigate({ to: "/leads/$leadId", params: { leadId: n.leadId } });
                          else if (n.href === "/automations/runs")
                            void navigate({ to: "/automations/runs" });
                          else if (n.href === "/automations") void navigate({ to: "/automations" });
                          else if (n.href === "/meetings") void navigate({ to: "/meetings" });
                        }}
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            n.kind === "danger" && "bg-destructive",
                            n.kind === "warning" && "bg-warning",
                            n.kind === "success" && "bg-success",
                            n.kind === "info" && "bg-info",
                          )}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{n.title}</span>
                          <span className="block text-xs text-muted-foreground">{n.detail}</span>
                          <span className="block pt-0.5 text-[11px] text-muted-foreground">
                            {relDay(n.at)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add Lead
              </Button>
            </div>
          </header>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>

      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />

      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder="Type a command or search…" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Actions">
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                setAddOpen(true);
              }}
            >
              Add Lead
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                void navigate({ to: "/tasks" });
              }}
            >
              Open Tasks
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                void navigate({ to: "/meetings" });
              }}
            >
              Schedule Meeting
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                void navigate({ to: "/proposals" });
              }}
            >
              Upload Proposal
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setPaletteOpen(false);
                void navigate({ to: "/automations" });
              }}
            >
              Open Automations
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Leads">
            {leads.slice(0, 8).map((l) => (
              <CommandItem
                key={l.id}
                value={`${l.firstName} ${l.lastName} ${l.company}`}
                onSelect={() => {
                  setPaletteOpen(false);
                  void navigate({ to: "/leads/$leadId", params: { leadId: l.id } });
                }}
              >
                {l.firstName} {l.lastName} · {l.company}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </AddLeadContext.Provider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  tabs,
  heading,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  tabs?: ReactNode;
  heading?: ReactNode;
}) {
  return (
    <div className="border-b bg-card px-6 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        {heading ?? (
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {tabs}
    </div>
  );
}
