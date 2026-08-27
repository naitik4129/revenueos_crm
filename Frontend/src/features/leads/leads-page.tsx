import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Search } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { useAddLead } from "@/app/add-lead-context";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { isOverdue, relDay } from "@/lib/format";
import { useLeads, useSession } from "@/store";
import { PIPELINE_STAGES } from "@/types";

export function LeadsPage() {
  const { leads } = useLeads();
  const { users, userName } = useSession();
  const addLead = useAddLead();
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("all");
  const [stage, setStage] = useState("all");
  const [auto, setAuto] = useState("all");

  const filtered = useMemo(
    () =>
      leads.filter((l) => {
        if (owner !== "all" && l.ownerId !== owner) return false;
        if (stage !== "all" && l.stage !== stage) return false;
        if (auto !== "all" && l.automation !== auto) return false;
        if (
          q &&
          !`${l.firstName} ${l.lastName} ${l.company}`.toLowerCase().includes(q.toLowerCase())
        )
          return false;
        return true;
      }),
    [leads, owner, stage, auto, q],
  );

  const missing = filtered.filter((l) => !l.nextAction && !l.doNotContact).length;

  return (
    <div className="pb-10">
      <PageHeader
        title="Leads"
        description="One row per lead. Stage, next action and automation state tell you what happens next."
        actions={
          <Button size="sm" onClick={addLead.open}>
            Add lead
          </Button>
        }
      />

      <div className="space-y-4 p-6">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search leads"
              className="pl-8"
            />
          </div>
          <Filter
            value={owner}
            onChange={setOwner}
            placeholder="Owner"
            options={[
              ["all", "All owners"],
              ...users.map((u) => [u.id, u.name] as [string, string]),
            ]}
          />
          <Filter
            value={stage}
            onChange={setStage}
            placeholder="Stage"
            options={[
              ["all", "All stages"],
              ...PIPELINE_STAGES.map((s) => [s, s] as [string, string]),
            ]}
          />
          <Filter
            value={auto}
            onChange={setAuto}
            placeholder="Automation"
            options={[
              ["all", "All automation"],
              ["Active", "Active"],
              ["Paused", "Paused"],
              ["Manual", "Manual"],
              ["Stopped", "Stopped"],
            ]}
          />
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {leads.length} leads
          </div>
        </div>

        {missing > 0 && (
          <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
            <AlertTriangle className="size-4 text-warning-foreground" />
            {missing} active {missing === 1 ? "lead has" : "leads have"} no next action assigned.
          </div>
        )}

        <Card className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
                <tr>
                  {[
                    "Lead / Company",
                    "Source",
                    "Owner",
                    "Stage",
                    "Next action",
                    "Due",
                    "Automation",
                    "Last activity",
                  ].map((h) => (
                    <th key={h} className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-2">
                      <Link
                        to="/leads/$leadId"
                        params={{ leadId: l.id }}
                        className="block hover:underline"
                      >
                        <span className="font-medium">
                          {l.firstName} {l.lastName}
                        </span>
                        <span className="block text-xs text-muted-foreground">{l.company}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{l.source}</td>
                    <td className="px-3 py-2 text-xs">{userName(l.ownerId)}</td>
                    <td className="px-3 py-2">
                      {l.doNotContact ? (
                        <StatusBadge value="Do Not Contact" />
                      ) : (
                        <StatusBadge value={l.stage} />
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.nextAction ? (
                        l.nextAction.title
                      ) : l.doNotContact ? (
                        <span className="text-muted-foreground">Suppressed</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-warning-foreground">
                          <AlertTriangle className="size-3.5" /> No next action
                        </span>
                      )}
                    </td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 text-xs ${
                        l.nextAction && isOverdue(l.nextAction.dueAt)
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {l.nextAction ? relDay(l.nextAction.dueAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge value={l.automation} dot />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">
                      {relDay(l.lastActivity)}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-10 text-center text-sm text-muted-foreground"
                    >
                      No leads match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Filter({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-44">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => (
          <SelectItem key={v} value={v}>
            {label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
