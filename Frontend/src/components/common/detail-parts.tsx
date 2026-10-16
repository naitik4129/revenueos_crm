import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/common/status-badge";
import { relDay } from "@/lib/format";
import { messageFromError } from "@/store";
import type { CrmTimelineEvent } from "@/types";

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

export function TimelineList({ query }: { query: ListQuery<{ data: CrmTimelineEvent[] }> }) {
  return (
    <Section query={query} empty="No activity yet.">
      {(data) =>
        data.data.map((event) => (
          <div key={event.id} className="flex gap-3 border-b py-3 last:border-0">
            <div className="w-36 shrink-0 text-xs text-muted-foreground">{relDay(event.at)}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{event.title}</span>
                <StatusBadge
                  value={event.source}
                  tone={event.source === "user" ? "muted" : "primary"}
                />
              </div>
              {event.detail && (
                <p className="whitespace-pre-wrap pt-0.5 text-sm text-muted-foreground">
                  {event.detail}
                </p>
              )}
              <div className="pt-0.5 text-xs text-muted-foreground">{event.actor}</div>
            </div>
          </div>
        ))
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
