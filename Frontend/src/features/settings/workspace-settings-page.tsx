import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import {
  Bot,
  CalendarDays,
  Mail,
  MessageCircle,
  RefreshCw,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/app/app-shell";
import { backend, type EmailConnection } from "@/lib/backend-client";
import { backendBaseUrl } from "@/lib/supabase-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Avatar } from "@/components/common/record-parts";
import { NATIVE_SELECT, cn } from "@/lib/utils";
import { useSession } from "@/store";
import { useWorkspace } from "@/store/workspace-context";
import { DefaultsPanel } from "./defaults-panel";
import {
  calendarStatus,
  emailStatus,
  whatsappStatus,
  type ConnectionState,
  type ConnectionSummary,
} from "./connection-status";
import { fmtDateTime } from "@/lib/format";
import { PanelHeader } from "@/components/common/record-parts";

const message = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

type Section = "defaults" | "email" | "whatsapp" | "calendar" | "profile";
const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "defaults", label: "Workspace defaults", icon: Users },
  { id: "email", label: "Email", icon: Mail },
  { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { id: "calendar", label: "Google Calendar", icon: CalendarDays },
  { id: "profile", label: "Profile", icon: UserRound },
];

export function WorkspaceSettingsPage() {
  const { currentWorkspace, isLoading } = useWorkspace();
  // Google's OAuth redirect lands on ?calendar=…: open that section so its toast shows in place.
  const [section, setSection] = useState<Section>(() =>
    new URLSearchParams(window.location.search).has("calendar") ? "calendar" : "defaults",
  );
  const status = useConnectionDots(currentWorkspace?.id);

  return (
    <div className="pb-10">
      <PageHeader
        title="Settings"
        description={
          currentWorkspace
            ? `Defaults and connections for ${currentWorkspace.name}.`
            : isLoading
              ? "Loading workspace…"
              : "Select a workspace to configure its connections."
        }
      />
      <div className="px-6 py-4">
        {currentWorkspace ? (
          <div className="grid items-start gap-4 md:grid-cols-[13rem_minmax(0,1fr)]">
            <nav
              aria-label="Settings sections"
              className="flex flex-wrap gap-1 md:sticky md:top-20 md:flex-col md:flex-nowrap"
            >
              {SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={section === item.id ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                    section === item.id && "bg-accent font-medium text-foreground",
                  )}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1">{item.label}</span>
                  {item.id in status && (
                    <StatusDot state={status[item.id as keyof typeof status]} />
                  )}
                </button>
              ))}
            </nav>
            <div className="min-w-0">
              {/* Every section stays mounted so unsaved edits and live polling survive a switch. */}
              <div hidden={section !== "defaults"}>
                <DefaultsPanel workspace={currentWorkspace} />
              </div>
              <div hidden={section !== "email"}>
                <EmailPanel workspaceId={currentWorkspace.id} />
              </div>
              <div hidden={section !== "whatsapp"}>
                <WhatsAppPanel workspaceId={currentWorkspace.id} />
              </div>
              <div hidden={section !== "calendar"}>
                <GoogleCalendarPanel workspaceId={currentWorkspace.id} />
              </div>
              <div hidden={section !== "profile"}>
                <ProfilePanel />
              </div>
            </div>
          </div>
        ) : (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {isLoading ? "Loading workspace…" : "No workspace is selected."}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

/** The sub-nav dots; same query keys as the panels, so these share their cache. */
function useConnectionDots(workspaceId: string | undefined) {
  const enabled = Boolean(workspaceId);
  const email = useQuery({
    queryKey: ["connections", "email", workspaceId],
    queryFn: ({ signal }) => backend.connections.email.get(signal),
    enabled,
  });
  const whatsapp = useQuery({
    queryKey: ["connections", "whatsapp", workspaceId],
    queryFn: ({ signal }) => backend.connections.whatsapp.get(signal),
    enabled,
  });
  const calendar = useQuery({
    queryKey: ["connections", "google-calendar", workspaceId],
    queryFn: ({ signal }) => backend.connections.googleCalendar.get(signal),
    enabled,
  });
  const state = <T,>(
    q: { data?: T | undefined; isError: boolean },
    fn: (d: T) => ConnectionSummary,
  ) => (q.isError ? "error" : q.data ? fn(q.data).state : undefined);
  return {
    email: state(email, emailStatus),
    whatsapp: state(whatsapp, whatsappStatus),
    calendar: state(calendar, calendarStatus),
  };
}

const STATE_STYLE: Record<ConnectionState, { dot: string; label: string; pill: string }> = {
  connected: { dot: "bg-success", label: "Connected", pill: "bg-success/10 text-success" },
  not_connected: {
    dot: "bg-muted-foreground/40",
    label: "Not connected",
    pill: "bg-muted text-muted-foreground",
  },
  pending: {
    dot: "bg-warning",
    label: "Connecting",
    pill: "bg-warning/15 text-warning-foreground",
  },
  error: { dot: "bg-destructive", label: "Error", pill: "bg-destructive/10 text-destructive" },
};

function StatusDot({ state }: { state: ConnectionState | undefined }) {
  if (!state) return null;
  return (
    <span
      className={cn("size-2 shrink-0 rounded-full", STATE_STYLE[state].dot)}
      title={STATE_STYLE[state].label}
      aria-label={STATE_STYLE[state].label}
    />
  );
}

/** "● Connected · Sending as … [action]" at the top of a connection card. */
function ConnectionBar({ status, children }: { status: ConnectionSummary; children?: ReactNode }) {
  const style = STATE_STYLE[status.state];
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
          style.pill,
        )}
      >
        <span className={cn("size-1.5 rounded-full", style.dot)} />
        {style.label}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{status.text}</span>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function ProfilePanel() {
  const { currentUser } = useSession();
  return (
    <Card>
      <PanelHeader icon={UserRound} title="Profile" />
      <CardContent className="space-y-4 p-4">
        <p className="text-sm text-muted-foreground md:col-span-full">
          Your name, email and password belong to your RevenueOS account and are changed on the
          platform, not here.
        </p>
        {currentUser ? (
          <div className="flex items-center gap-4">
            <Avatar name={currentUser.name} className="size-12 text-base" />
            <div className="min-w-0 space-y-0.5">
              <div className="truncate font-medium">{currentUser.name}</div>
              <div className="truncate text-sm text-muted-foreground">{currentUser.email}</div>
              <div className="text-xs text-muted-foreground">CRM role: {currentUser.role}</div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Loading your profile…</p>
        )}
      </CardContent>
    </Card>
  );
}

function EmailPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["connections", "email", workspaceId],
    queryFn: ({ signal }) => backend.connections.email.get(signal),
  });
  const [form, setForm] = useState<EmailConnection | null>(null);
  const [resendApiKey, setResendApiKey] = useState("");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [testTo, setTestTo] = useState("");
  useEffect(() => {
    if (query.data) setForm(query.data);
  }, [query.data]);
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["connections", "email", workspaceId] });
  const save = useMutation({
    mutationFn: () =>
      backend.connections.email.update({
        provider: form!.provider ?? "resend",
        enabled: form!.enabled,
        senderName: form!.senderName,
        senderAddress: form!.senderAddress,
        smtpHost: form!.smtpHost,
        smtpPort: form!.smtpPort,
        smtpSecurity: form!.smtpSecurity,
        ...(resendApiKey ? { resendApiKey } : {}),
        ...(smtpUsername ? { smtpUsername } : {}),
        ...(smtpPassword ? { smtpPassword } : {}),
      }),
    onSuccess: () => {
      setResendApiKey("");
      setSmtpUsername("");
      setSmtpPassword("");
      refresh();
      toast.success("Email connection saved.");
    },
    onError: (error) => toast.error(message(error)),
  });
  const test = useMutation({
    mutationFn: () => backend.connections.email.test(testTo),
    onSuccess: () => toast.success("Test email sent."),
    onError: (error) => toast.error(message(error)),
  });
  if (!form)
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          {query.isError ? (
            <div className="space-y-2">
              <p className="text-destructive">
                Couldn't load the email connection: {message(query.error)}
              </p>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            </div>
          ) : (
            "Loading email connection…"
          )}
        </CardContent>
      </Card>
    );
  const update = <K extends keyof EmailConnection>(key: K, value: EmailConnection[K]) =>
    setForm({ ...form, [key]: value });
  return (
    <Card>
      <PanelHeader icon={Mail} title="Email" />
      <CardContent className="space-y-5 p-4">
        <p className="text-sm text-muted-foreground md:col-span-full">
          Secrets are write-only and encrypted. Empty secret fields retain saved values.
        </p>
        <ConnectionBar status={emailStatus(form)}>
          <Input
            type="email"
            value={testTo}
            placeholder="Test recipient"
            aria-label="Test recipient"
            className="h-8 w-52"
            onChange={(e) => setTestTo(e.target.value)}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!testTo || test.isPending}
            onClick={() => test.mutate()}
          >
            Send test
          </Button>
        </ConnectionBar>
        {form.source === "environment" && (
          <Notice>
            Using the read-only Resend environment fallback until database settings are saved.
          </Notice>
        )}
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Active provider">
            <select
              className={cn(NATIVE_SELECT, "h-9 w-full px-3 text-sm")}
              value={form.provider ?? "resend"}
              onChange={(e) => update("provider", e.target.value as "resend" | "smtp")}
            >
              <option value="resend">Resend</option>
              <option value="smtp">SMTP</option>
            </select>
          </Field>
          <Field label="Sender name">
            <Input value={form.senderName} onChange={(e) => update("senderName", e.target.value)} />
          </Field>
          <Field label="Sender address">
            <Input
              type="email"
              value={form.senderAddress}
              onChange={(e) => update("senderAddress", e.target.value)}
            />
          </Field>
        </div>
        {(form.provider ?? "resend") === "resend" ? (
          <Field label={`Resend API key${form.resendApiKeyConfigured ? " (configured)" : ""}`}>
            <Input
              type="password"
              value={resendApiKey}
              placeholder={form.resendApiKeyConfigured ? "•••••••• - retain current" : "re_…"}
              onChange={(e) => setResendApiKey(e.target.value)}
            />
          </Field>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="SMTP host">
              <Input value={form.smtpHost} onChange={(e) => update("smtpHost", e.target.value)} />
            </Field>
            <Field label="Port">
              <Input
                type="number"
                value={form.smtpPort}
                onChange={(e) => update("smtpPort", Number(e.target.value))}
              />
            </Field>
            <Field label="Encryption">
              <select
                className={cn(NATIVE_SELECT, "h-9 w-full px-3 text-sm")}
                value={form.smtpSecurity}
                onChange={(e) => update("smtpSecurity", e.target.value as "tls" | "starttls")}
              >
                <option value="starttls">STARTTLS</option>
                <option value="tls">Implicit TLS</option>
              </select>
            </Field>
            <Field label={`Username${form.smtpUsernameConfigured ? " (configured)" : ""}`}>
              <Input
                value={smtpUsername}
                placeholder={form.smtpUsernameConfigured ? "Retain current" : "Username"}
                onChange={(e) => setSmtpUsername(e.target.value)}
              />
            </Field>
            <Field label={`Password${form.smtpPasswordConfigured ? " (configured)" : ""}`}>
              <Input
                type="password"
                value={smtpPassword}
                placeholder={form.smtpPasswordConfigured ? "•••••••• - retain current" : "Password"}
                onChange={(e) => setSmtpPassword(e.target.value)}
              />
            </Field>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Switch checked={form.enabled} onCheckedChange={(value) => update("enabled", value)} />
          <span className="text-sm">Outbound email enabled</span>
          <Button className="ml-auto" onClick={() => save.mutate()} disabled={save.isPending}>
            Save email settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatsAppPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["connections", "whatsapp", workspaceId],
    queryFn: ({ signal }) => backend.connections.whatsapp.get(signal),
    refetchInterval: 5_000,
  });
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [settings, setSettings] = useState({
    enabled: false,
    dailyCap: 200,
  });
  useEffect(() => {
    if (query.data && !dirty)
      setSettings({
        enabled: query.data.enabled,
        dailyCap: query.data.dailyCap,
      });
  }, [query.data, dirty]);
  const updateSettings = (patch: Partial<typeof settings>) => {
    setDirty(true);
    setSettings((prev) => ({ ...prev, ...patch }));
  };
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["connections", "whatsapp", workspaceId] });
  const save = useMutation({
    mutationFn: () => backend.connections.whatsapp.update(settings),
    onSuccess: () => {
      setDirty(false);
      refresh();
      toast.success("WhatsApp controls saved.");
    },
    onError: (error) => toast.error(message(error)),
  });
  const command = useMutation({
    mutationFn: backend.connections.whatsapp.command,
    onSuccess: () => {
      setLogoutOpen(false);
      refresh();
      toast.success("WhatsApp command queued.");
    },
    onError: (error) => toast.error(message(error)),
  });
  const data = query.data;
  return (
    <Card>
      <PanelHeader icon={Bot} title="WhatsApp · Baileys" />
      <CardContent className="space-y-5 p-4">
        <p className="text-sm text-muted-foreground md:col-span-full">
          Unofficial WhatsApp Web connection. Use an opted-in, dedicated business account for this
          workspace.
        </p>
        {!data ? (
          query.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                Couldn't load WhatsApp status: {message(query.error)}
              </p>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading WhatsApp health…</p>
          )
        ) : (
          <>
            <ConnectionBar status={whatsappStatus(data)}>
              <Button
                size="sm"
                onClick={() => command.mutate("connect")}
                disabled={command.isPending}
              >
                Connect / get QR
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => command.mutate("restart")}
                disabled={command.isPending}
              >
                <RefreshCw /> Restart
              </Button>
              <Button size="sm" variant="destructive" onClick={() => setLogoutOpen(true)}>
                Log out session
              </Button>
            </ConnectionBar>
            <div className="grid gap-3 sm:grid-cols-2">
              <Metric label="Sent today" value={`${data.todayCount} / ${data.dailyCap}`} />
              <Metric label="Pending" value={String(data.pendingCount)} />
            </div>
            {data.outboundRestricted && (
              <Notice danger>
                WhatsApp has reported account reachout or new-chat restrictions. New sends are
                halted automatically.
              </Notice>
            )}
            {data.qr && (
              <div className="flex flex-col items-center rounded-lg border bg-white p-5 text-black">
                <QRCodeSVG value={data.qr} size={220} level="M" />
                <p className="mt-3 text-center text-xs">
                  Scan from WhatsApp → Linked devices. This QR expires shortly.
                </p>
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Daily cap (IST)">
                <Input
                  type="number"
                  min={1}
                  max={10000}
                  value={settings.dailyCap}
                  onChange={(e) => updateSettings({ dailyCap: Number(e.target.value) })}
                />
              </Field>
              <Field label="Send spacing">
                <Input value="Randomized 5-15 seconds" disabled />
              </Field>
              <div className="flex items-end gap-2 pb-2">
                <Switch
                  checked={settings.enabled}
                  onCheckedChange={(enabled) => updateSettings({ enabled })}
                />
                <span className="text-sm font-medium">Outbound enabled</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-4">
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                Save controls
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Worker heartbeat:{" "}
              {data.workerHeartbeatAt ? fmtDateTime(data.workerHeartbeatAt) : "Never"} · Invalid
              existing phone values: {data.invalidPhoneCount}
            </div>
            {data.inboundReview.length > 0 && (
              <div className="space-y-2 rounded-lg border p-3">
                <div className="text-sm font-medium">Inbound replies needing review</div>
                {data.inboundReview.map((event) => (
                  <div
                    key={event.messageId}
                    className="flex flex-wrap justify-between gap-2 border-t pt-2 text-xs"
                  >
                    <span>{event.senderPhoneE164 ?? "Unknown direct sender"}</span>
                    <span className="capitalize text-muted-foreground">
                      {event.disposition} · {event.messageType} · {event.matchCount} matches ·{" "}
                      {fmtDateTime(event.receivedAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={logoutOpen}
        onOpenChange={setLogoutOpen}
        title="Log out this workspace's WhatsApp session?"
        description="The encrypted Baileys credentials and Signal keys will be removed. Pairing will be required again."
        confirmLabel="Log out"
        disabled={command.isPending}
        onConfirm={() => command.mutate("logout")}
      />
    </Card>
  );
}

function GoogleCalendarPanel({ workspaceId }: { workspaceId: string }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["connections", "google-calendar", workspaceId],
    queryFn: ({ signal }) => backend.connections.googleCalendar.get(signal),
    refetchInterval: 5_000,
  });
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["connections", "google-calendar", workspaceId] });

  const suggestedRedirectUri = backendBaseUrl
    ? `${backendBaseUrl}/api/v1/connections/google-calendar/oauth/callback`
    : "";
  useEffect(() => {
    if (query.data && !dirty) {
      setClientId(query.data.clientId ?? "");
      setRedirectUri(query.data.redirectUri ?? suggestedRedirectUri);
    }
    // Only re-sync from freshly-fetched server data, not on every keystroke
    // recomputing suggestedRedirectUri.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data, dirty]);

  // Google's OAuth redirect lands back here as ?calendar=connected|error —
  // surface it once as a toast, then strip it so a page refresh doesn't
  // re-show it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const calendarResult = params.get("calendar");
    if (!calendarResult) return;
    if (calendarResult === "connected") toast.success("Google Calendar connected.");
    else toast.error(params.get("message") || "Failed to connect Google Calendar.");
    params.delete("calendar");
    params.delete("message");
    const rest = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
    refresh();
    // Only meant to run once, on the redirect landing — not a live dependency loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveCredentials = useMutation({
    mutationFn: () =>
      backend.connections.googleCalendar.updateCredentials({
        clientId,
        redirectUri,
        ...(clientSecret ? { clientSecret } : {}),
      }),
    onSuccess: () => {
      setDirty(false);
      setClientSecret("");
      refresh();
      toast.success("Google OAuth credentials saved.");
    },
    onError: (error) => toast.error(message(error)),
  });
  const start = useMutation({
    mutationFn: backend.connections.googleCalendar.oauthStart,
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (error) => toast.error(message(error)),
  });
  const disconnect = useMutation({
    mutationFn: backend.connections.googleCalendar.disconnect,
    onSuccess: () => {
      setDisconnectOpen(false);
      refresh();
      toast.success("Google Calendar disconnected.");
    },
    onError: (error) => toast.error(message(error)),
  });
  const data = query.data;

  const credentialsForm = data && (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Client ID">
          <Input
            value={clientId}
            onChange={(e) => {
              setDirty(true);
              setClientId(e.target.value);
            }}
          />
        </Field>
        <Field label={`Client secret${data.clientSecretConfigured ? " (configured)" : ""}`}>
          <Input
            type="password"
            value={clientSecret}
            placeholder={data.clientSecretConfigured ? "•••••••• - retain current" : "GOCSPX-…"}
            onChange={(e) => {
              setDirty(true);
              setClientSecret(e.target.value);
            }}
          />
        </Field>
      </div>
      <Field label="Redirect URI">
        <Input
          value={redirectUri}
          onChange={(e) => {
            setDirty(true);
            setRedirectUri(e.target.value);
          }}
        />
      </Field>
      <p className="-mt-3 text-xs text-muted-foreground">
        Add this exact URL as an authorized redirect URI on the OAuth client in Google Cloud
        Console.
      </p>
      <div className="flex justify-end border-b pb-4">
        <Button onClick={() => saveCredentials.mutate()} disabled={saveCredentials.isPending}>
          Save credentials
        </Button>
      </div>
    </>
  );

  return (
    <Card>
      <PanelHeader icon={CalendarDays} title="Google Calendar" />
      <CardContent className="space-y-5 p-4">
        <p className="text-sm text-muted-foreground md:col-span-full">
          A meeting scheduled in the CRM creates an event with an auto-generated Meet link on this
          workspace's calendar and invites its participants.
        </p>
        {!data ? (
          query.isError ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">
                Couldn't load Google Calendar status: {message(query.error)}
              </p>
              <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading Google Calendar status…</p>
          )
        ) : (
          <>
            <ConnectionBar status={calendarStatus(data)}>
              <Button
                size="sm"
                variant={data.status === "connected" ? "outline" : "default"}
                onClick={() => start.mutate()}
                disabled={!data.configured || start.isPending}
              >
                {data.status === "connected"
                  ? "Reconnect"
                  : data.status === "error"
                    ? "Reconnect Google Calendar"
                    : "Connect Google Calendar"}
              </Button>
              {data.status === "connected" && (
                <Button size="sm" variant="destructive" onClick={() => setDisconnectOpen(true)}>
                  Disconnect
                </Button>
              )}
            </ConnectionBar>
            {data.platformConfigured ? (
              <details
                className="rounded-md border px-3 py-2 text-sm"
                open={data.usesOwnCredentials}
              >
                <summary className="cursor-pointer text-muted-foreground">
                  Advanced: use your own Google app
                </summary>
                <div className="mt-3 space-y-4">
                  <Notice>
                    Most workspaces don't need this — just click Connect below. If you save your own
                    OAuth client here it replaces the shared one, and you'll need to reconnect.
                  </Notice>
                  {credentialsForm}
                </div>
              </details>
            ) : (
              <>
                <Notice>
                  Register an OAuth 2.0 client (Web application) in Google Cloud Console with the
                  Calendar API enabled, then paste its credentials below. The client secret is
                  encrypted in the database, same as the Resend API key.
                </Notice>
                {credentialsForm}
              </>
            )}
          </>
        )}
      </CardContent>
      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect Google Calendar?"
        description="Meetings will no longer sync to Google Calendar or generate Meet links automatically until reconnected. The saved OAuth client credentials are kept, so reconnecting won't require re-entering them."
        confirmLabel="Disconnect"
        disabled={disconnect.isPending}
        onConfirm={() => disconnect.mutate()}
      />
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${danger ? "border-destructive/30 bg-destructive/5 text-destructive" : "bg-muted/50 text-muted-foreground"}`}
    >
      {children}
    </div>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold capitalize">{value}</div>
    </div>
  );
}
