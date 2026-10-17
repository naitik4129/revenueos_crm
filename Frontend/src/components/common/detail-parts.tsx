import type { ReactNode } from "react";
import {
  ArrowRightLeft,
  Bot,
  Building2,
  CalendarDays,
  FileText,
  Handshake,
  Info,
  ListChecks,
  Mail,
  MessageCircle,
  Phone,
  StickyNote,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { dateInputValue } from "@/lib/dates";
import { dayDiff, dayOf, fmtDate, fmtTime } from "@/lib/format";
import { timelineTitle } from "@/lib/labels";
import { messageFromError } from "@/store";
import type { ActorSource, CrmTimelineEvent } from "@/types";

type ListQuery<T> = { data?: T | undefined; isLoading: boolean; error: unknown };

/** A card for one list query: loading, error, empty text, or the rows. */
export function Section<T extends { data: unknown[] }>({
  query,
  empty,
  children,
}: {
  query: ListQuery<T>;
  empty: string;
  children: (data: T) => ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-2">
        {query.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : query.error ? (
          <p className="py-6 text-center text-sm text-destructive">
            {messageFromError(query.error)}
          </p>
        ) : query.data && query.data.data.length > 0 ? (
          children(query.data)
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_ICON: Record<string, LucideIcon> = {
  call: Phone,
  email: Mail,
  note: StickyNote,
  task: ListChecks,
  meeting: CalendarDays,
  stage: ArrowRightLeft,
  lifecycle: TrendingUp,
  handover: Handshake,
  whatsapp: MessageCircle,
  proposal: FileText,
  automation: Bot,
  company: Building2,
};
const SOURCE_TAG: Partial<Record<ActorSource, string>> = {
  automation: "Automation",
  system: "System",
  brain: "RevenueOS",
};

function dayHeading(iso: string) {
  const diff = dayDiff(dayOf(iso), dateInputValue());
  return diff === 0 ? "Today" : diff === -1 ? "Yesterday" : fmtDate(iso);
}

/** Activity feed: one icon per kind, grouped by day (India time), newest first. */
export function TimelineList({ query }: { query: ListQuery<{ data: CrmTimelineEvent[] }> }) {
  return (
    <Section query={query} empty="No activity yet.">
      {(data) =>
        data.data.map((event, i) => {
          const Icon = KIND_ICON[event.kind] ?? Info;
          const tag = SOURCE_TAG[event.source];
          const day = dayHeading(event.at);
          const newDay = i === 0 || dayHeading(data.data[i - 1]!.at) !== day;
          return (
            <div key={event.id}>
              {newDay && (
                <div className="pb-1 pt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {day}
                </div>
              )}
              <div className="flex gap-3 py-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Icon className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-sm font-medium">{timelineTitle(event.title)}</span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtTime(event.at)}
                    </span>
                  </div>
                  {event.detail && (
                    <p className="whitespace-pre-wrap pt-0.5 text-sm text-muted-foreground">
                      {event.detail}
                    </p>
                  )}
                  <div className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                    {tag && <StatusBadge value={tag} tone="primary" />}
                    {(!tag || event.actor !== tag) && <span>{event.actor}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })
      }
    </Section>
  );
}

/** "Label ........ value" line in a details card; "-" when empty. */
export function InfoRow({ name, value }: { name: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{name}</span>
      <span className="min-w-0 truncate text-right">{value || "-"}</span>
    </div>
  );
}
