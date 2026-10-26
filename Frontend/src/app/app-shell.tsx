import { useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Bot,
  Building2,
  CalendarDays,
  Check,
  ChevronsUpDown,
  FileText,
  Gauge,
  Handshake,
  ListChecks,
  LogOut,
  Menu,
  Plus,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/common/brand-logo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { AddContactContext } from "@/app/add-contact-context";
import { GlobalSearch } from "@/app/global-search";
import { ContactFormDialog } from "@/features/contacts/contact-form-dialog";
import { messageFromError, useNotifications, useSession } from "@/store";
import { backend } from "@/lib/backend-client";
import { keys } from "@/store/query";
import { useWorkspace } from "@/store/workspace-context";
import { cn } from "@/lib/utils";
import { relDay } from "@/lib/format";
import { supabase } from "@/lib/supabase-client";

type NavItem = { to: string; label: string; icon: typeof Gauge };

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: "/", label: "Dashboard", icon: Gauge }] },
  {
    label: "CRM",
    items: [
      { to: "/contacts", label: "Contacts", icon: Users },
      { to: "/companies", label: "Companies", icon: Building2 },
      { to: "/deals", label: "Deals", icon: Handshake },
    ],
  },
  {
    label: "Sales",
    items: [
      { to: "/tasks", label: "Tasks", icon: ListChecks },
      { to: "/meetings", label: "Meetings", icon: CalendarDays },
      { to: "/proposals", label: "Proposals", icon: FileText },
    ],
  },
  { label: "Automation", items: [{ to: "/automations", label: "Automations", icon: Bot }] },
];
const SETTINGS_NAV: NavItem = { to: "/settings", label: "Settings", icon: SettingsIcon };
const ADMIN_NAV: NavItem = { to: "/admin", label: "Admin", icon: ShieldCheck };

export function AppShell({ children }: { children: ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigate = useNavigate();
  const client = useQueryClient();
  const { notifications, markNotificationsRead } = useNotifications();
  const [bellOpen, setBellOpen] = useState(false);
  const { currentUser } = useSession();
  const { workspaces, setCurrentWorkspaceId, isLoading: workspacesLoading } = useWorkspace();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdmin = currentUser?.role === "Admin";
  const noWorkspace = !workspacesLoading && workspaces.length === 0;

  const unread = notifications.filter((n) => !n.read).length;
  const sidebar = (onNavigate?: () => void) => (
    <SidebarContent pathname={pathname} isAdmin={isAdmin} onNavigate={onNavigate} />
  );

  return (
    <AddContactContext.Provider value={{ open: () => setAddOpen(true) }}>
      <div className="flex min-h-screen bg-background">
        <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex">
          {sidebar()}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/80 px-4 backdrop-blur">
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 lg:hidden"
              aria-label="Open navigation"
              onClick={() => setMobileNavOpen(true)}
            >
              <Menu className="size-5" />
            </Button>
            <GlobalSearch />

            <div className="ml-auto flex items-center gap-1">
              <Popover
                open={bellOpen}
                onOpenChange={(o) => {
                  setBellOpen(o);
                  if (o && unread > 0) {
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
                  {notifications.length === 0 && (
                    <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                      No notifications.
                    </div>
                  )}
                  <ScrollArea className={notifications.length > 0 ? "h-96" : "hidden"}>
                    {notifications.map((n) => (
                      <button
                        key={n.id}
                        className="flex w-full gap-2 border-b px-3 py-2.5 text-left last:border-0 hover:bg-accent"
                        onClick={() => {
                          setBellOpen(false);
                          if (n.dealId)
                            void navigate({ to: "/deals/$dealId", params: { dealId: n.dealId } });
                          else if (n.contactId)
                            void navigate({
                              to: "/contacts/$contactId",
                              params: { contactId: n.contactId },
                            });
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
            </div>
          </header>

          <main className="min-w-0 flex-1">
            {/* Every CRM page needs a workspace; admin pages do not. */}
            {noWorkspace && !pathname.startsWith("/admin") ? (
              <NoWorkspace />
            ) : (
              children
            )}
          </main>
        </div>
      </div>

      <Dialog open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <DialogContent className="left-0 top-0 flex h-full w-64 max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-r bg-sidebar p-0 sm:rounded-none">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Go to a page or switch workspace.
          </DialogDescription>
          {sidebar(() => setMobileNavOpen(false))}
        </DialogContent>
      </Dialog>

      <ContactFormDialog open={addOpen} onOpenChange={setAddOpen} />
    </AddContactContext.Provider>
  );
}

/** Logo, workspace switcher, grouped nav, settings/admin and the signed-in user. */
function SidebarContent({
  pathname,
  isAdmin,
  onNavigate,
}: {
  pathname: string;
  isAdmin: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const { currentUser } = useSession();
  const {
    workspaces,
    currentWorkspaceId,
    currentWorkspace,
    setCurrentWorkspaceId,
    isLoading: workspacesLoading,
  } = useWorkspace();

  const link = (item: NavItem) => {
    const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
    return (
      <Link
        key={item.to}
        to={item.to}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
          active &&
            "bg-sidebar-accent font-medium text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-sidebar-primary",
        )}
      >
        <item.icon
          className={cn("size-4", active ? "text-sidebar-primary" : "text-muted-foreground")}
        />
        {item.label}
      </Link>
    );
  };

  return (
    <>
      <div className="px-3 pb-2 pt-4">
        <Link to="/" aria-label="MOTM Flow home" onClick={onNavigate}>
          <BrandLogo caption="MOTM Flow · Sales Automation" />
        </Link>
      </div>

      <div className="px-2 pb-2">
        <Popover open={switcherOpen} onOpenChange={setSwitcherOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-background/60 px-2.5 py-1.5 text-left hover:bg-sidebar-accent"
              aria-label="Switch workspace"
            >
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Workspace
                </div>
                <div className="truncate text-sm font-medium">
                  {currentWorkspace?.name ?? (workspacesLoading ? "Loading…" : "No workspace")}
                </div>
              </div>
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-1">
            <div className="max-h-64 overflow-y-auto">
              {workspaces.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {workspacesLoading ? "Loading workspaces…" : "You are not in any workspace."}
                </div>
              )}
              {workspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent",
                    workspace.id === currentWorkspaceId && "bg-accent",
                  )}
                  onClick={() => {
                    setCurrentWorkspaceId(workspace.id);
                    setSwitcherOpen(false);
                  }}
                >
                  <span className="truncate">{workspace.name}</span>
                  {workspace.id === currentWorkspaceId && <Check className="size-3.5 shrink-0" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <ScrollArea className="flex-1 px-2">
        <nav aria-label="Main" className="space-y-3 pb-4 pt-1">
          {NAV_GROUPS.map((group) => (
            <div key={group.label ?? "home"} className="space-y-0.5">
              {group.label && (
                <div className="px-2.5 pb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {group.label}
                </div>
              )}
              {group.items.map(link)}
            </div>
          ))}
        </nav>
      </ScrollArea>

      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        {link(SETTINGS_NAV)}
        {isAdmin && link(ADMIN_NAV)}
        <div className="mt-1 flex items-center gap-2 rounded-md px-2 py-1.5">
          <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
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
    </>
  );
}

function NoWorkspace() {
  return (
    <div className="mx-auto max-w-md px-6 py-20 text-center">
      <h1 className="text-lg font-semibold">No workspace yet</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Workspaces come from the RevenueOS platform. Ask an admin to give you access to a client
        project there, and it will appear here automatically.
      </p>
    </div>
  );
}

export function PageHeader({
  title,
  count,
  description,
  actions,
  tabs,
  heading,
}: {
  title: string;
  /** "29 contacts" under a list page's title; always shown. */
  count?: string | undefined;
  /** Help text; hidden on phones, where it pushes the content down. */
  description?: string | undefined;
  actions?: ReactNode;
  tabs?: ReactNode;
  heading?: ReactNode;
}) {
  return (
    <div className="border-b bg-card px-6 pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3 pb-3">
        {heading ?? (
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
            {count && <p className="text-sm text-muted-foreground">{count}</p>}
            {description && (
              <p className="hidden text-sm text-muted-foreground sm:block">{description}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      </div>
      {tabs}
    </div>
  );
}
