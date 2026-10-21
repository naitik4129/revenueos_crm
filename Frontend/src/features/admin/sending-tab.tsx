import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  backend,
  type SendChannel,
  type SendPolicy,
  type SendPolicyPatch,
} from "@/lib/backend-client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { StatusBadge } from "@/components/common/status-badge";
import { fmtDate } from "@/lib/format";
import { useWorkspace } from "@/store/workspace-context";
import { adminKeys, errorText } from "./admin-keys";
import { Field, WorkspacePicker } from "./admin-shared";

const CHANNELS: { id: SendChannel; label: string }[] = [
  { id: "email", label: "Email" },
  { id: "whatsapp", label: "WhatsApp" },
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Sending limits per workspace and channel: caps, warm-up ramp, gaps, hours, pause. */
export function SendingTab() {
  const { workspaces } = useWorkspace();
  const [picked, setPicked] = useState<string | null>(null);
  const workspaceId = picked ?? workspaces[0]?.id ?? null;
  const policies = useQuery({
    queryKey: adminKeys.sending(workspaceId ?? ""),
    queryFn: ({ signal }) => backend.admin.sending.get(workspaceId!, signal),
    enabled: Boolean(workspaceId),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <WorkspacePicker workspaces={workspaces} value={workspaceId} onChange={setPicked} />
        <p className="text-sm text-muted-foreground">
          Workflow sends only. Times are India time (IST); over a limit a send waits, it is never
          dropped.
        </p>
      </div>
      {policies.isPending && workspaceId && <LoadingBlock />}
      {policies.isError && <ErrorBlock error={policies.error} />}
      {policies.data && workspaceId && (
        <div className="grid gap-4 xl:grid-cols-2">
          {CHANNELS.map(({ id, label }) => (
            <ChannelCard
              // Re-mount on every saved change so the form starts from what the server holds.
              key={`${workspaceId}-${id}-${policies.data[id].updatedAt}`}
              workspaceId={workspaceId}
              label={label}
              policy={policies.data[id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type FormState = {
  dailyCap: string;
  rampStart: string;
  rampStepPerDay: string;
  minGapSeconds: string;
  maxGapSeconds: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number[];
};

const formFrom = (p: SendPolicy): FormState => ({
  dailyCap: String(p.dailyCap),
  rampStart: String(p.rampStart),
  rampStepPerDay: String(p.rampStepPerDay),
  minGapSeconds: String(p.minGapSeconds),
  maxGapSeconds: String(p.maxGapSeconds),
  windowStart: p.windowStart,
  windowEnd: p.windowEnd,
  windowDays: p.windowDays,
});

function ChannelCard({
  workspaceId,
  label,
  policy,
}: {
  workspaceId: string;
  label: string;
  policy: SendPolicy;
}) {
  const client = useQueryClient();
  const [form, setForm] = useState(() => formFrom(policy));
  const [pauseReason, setPauseReason] = useState("");
  const save = useMutation({
    mutationFn: (patch: SendPolicyPatch) =>
      backend.admin.sending.update(workspaceId, policy.channel, patch),
    onSuccess: (saved) => {
      client.setQueryData(
        adminKeys.sending(workspaceId),
        (old: Record<SendChannel, SendPolicy> | undefined) =>
          old ? { ...old, [saved.channel]: saved } : old,
      );
      toast.success(`${label} sending saved.`);
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const toggleDay = (day: number, on: boolean) =>
    setForm((f) => ({
      ...f,
      windowDays: on
        ? [...f.windowDays, day].sort((a, b) => a - b)
        : f.windowDays.filter((d) => d !== day),
    }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate({
      dailyCap: Number(form.dailyCap),
      rampStart: Number(form.rampStart),
      rampStepPerDay: Number(form.rampStepPerDay),
      minGapSeconds: Number(form.minGapSeconds),
      maxGapSeconds: Number(form.maxGapSeconds),
      windowStart: form.windowStart,
      windowEnd: form.windowEnd,
      windowDays: form.windowDays,
    });
  };
  const gapsInvalid = Number(form.minGapSeconds) > Number(form.maxGapSeconds);

  return (
    <Card className="p-4" aria-label={`${label} sending`} role="region">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{label}</h2>
        <StatusBadge
          value={policy.paused ? "Paused" : "Sending"}
          tone={policy.paused ? "danger" : "success"}
          dot
        />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Sent today</dt>
        <dd>
          {policy.sentToday} / {policy.todayCap}
        </dd>
        <dt className="text-muted-foreground">Warm-up</dt>
        <dd>
          {policy.rampDay === null
            ? "Not started (starts at the first send)"
            : `Day ${policy.rampDay}${policy.todayCap >= policy.dailyCap ? " (at full cap)" : ""}`}
        </dd>
      </dl>

      {policy.paused ? (
        <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p>
            <span className="font-medium">Paused</span>
            {policy.pausedAt ? ` since ${fmtDate(policy.pausedAt)}` : ""}: {policy.pauseReason}
          </p>
          <Button
            className="mt-2"
            size="sm"
            disabled={save.isPending}
            onClick={() => save.mutate({ paused: false })}
          >
            Resume {label}
          </Button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Input
            aria-label={`Reason to pause ${label}`}
            placeholder="Reason to pause"
            value={pauseReason}
            onChange={(e) => setPauseReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!pauseReason.trim() || save.isPending}
            onClick={() => save.mutate({ paused: true, pauseReason: pauseReason.trim() })}
          >
            Pause
          </Button>
        </div>
      )}

      <form className="mt-4 space-y-3" onSubmit={submit}>
        <div className="grid grid-cols-3 gap-3">
          <Field label={`Daily cap (max ${policy.safeMaxDailyCap})`}>
            <Input
              type="number"
              min={1}
              max={policy.safeMaxDailyCap}
              required
              value={form.dailyCap}
              onChange={set("dailyCap")}
            />
          </Field>
          <Field label="Ramp start / day">
            <Input
              type="number"
              min={1}
              required
              value={form.rampStart}
              onChange={set("rampStart")}
            />
          </Field>
          <Field label="Ramp step / day">
            <Input
              type="number"
              min={0}
              required
              value={form.rampStepPerDay}
              onChange={set("rampStepPerDay")}
            />
          </Field>
          <Field label="Min gap (s)">
            <Input
              type="number"
              min={0}
              required
              value={form.minGapSeconds}
              onChange={set("minGapSeconds")}
            />
          </Field>
          <Field label="Max gap (s)">
            <Input
              type="number"
              min={0}
              required
              value={form.maxGapSeconds}
              onChange={set("maxGapSeconds")}
            />
          </Field>
          <div />
          <Field label="From (IST)">
            <Input type="time" required value={form.windowStart} onChange={set("windowStart")} />
          </Field>
          <Field label="To (IST)">
            <Input type="time" required value={form.windowEnd} onChange={set("windowEnd")} />
          </Field>
        </div>
        <fieldset>
          <legend className="mb-1.5 text-xs font-medium">Sending days</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((name, i) => (
              <label key={name} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={form.windowDays.includes(i + 1)}
                  onCheckedChange={(on) => toggleDay(i + 1, on === true)}
                />
                {name}
              </label>
            ))}
          </div>
        </fieldset>
        {gapsInvalid && (
          <p className="text-sm text-destructive">Min gap can't be above the max gap.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={save.isPending || gapsInvalid || form.windowDays.length === 0}
          >
            Save {label}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || policy.rampDay === null}
            onClick={() => save.mutate({ restartRamp: true })}
          >
            Restart warm-up
          </Button>
        </div>
      </form>
    </Card>
  );
}
