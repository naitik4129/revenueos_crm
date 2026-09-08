import { Link } from "@tanstack/react-router";
import { Phone, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useAutomations } from "@/store";
import type { PipelineStage } from "@/types";
import { ScheduledFollowupTimeline } from "./scheduled-followups";

const CALL_STAGES: PipelineStage[] = [
  "new",
  "ready_for_first_call",
  "contact_attempted",
  "connected_qualifying",
];
const NURTURE_STAGES: PipelineStage[] = [
  "not_connected_nurture",
  "interested_later",
  "future_possibility",
  "objection_nurture",
];
const MEETING_STAGES: PipelineStage[] = [
  "meeting_scheduling",
  "meeting_scheduled",
  "meeting_follow_up",
];
const PROPOSAL_STAGES: PipelineStage[] = [
  "proposal_preparation",
  "proposal_sent",
  "proposal_decision_pending",
  "negotiation",
];

type Phase = "new" | "call" | "nurture" | "meeting" | "proposal";

function phaseFor(stage: PipelineStage): Phase {
  if (stage === "new") return "new";
  if (CALL_STAGES.includes(stage)) return "call";
  if (NURTURE_STAGES.includes(stage)) return "nurture";
  if (MEETING_STAGES.includes(stage)) return "meeting";
  return "proposal";
}

const PHASES: { key: Phase; label: string }[] = [
  { key: "new", label: "New" },
  { key: "call", label: "Call" },
  { key: "nurture", label: "Nurture" },
  { key: "meeting", label: "Meeting" },
  { key: "proposal", label: "Proposal" },
];

/**
 * "What do I do right now" card for a lead — the guided counterpart to the
 * freeform Stage override dropdown further down the page. Always resolves
 * to exactly one primary action based on pipelineStage (and, in nurture,
 * whether a workflow is already running), so a rep never has to guess which
 * of the many possible next steps applies to this lead.
 */
export function LeadJourneyCard({
  leadId,
  pipelineStage,
  doNotContact,
  onCallClick,
  onEnrollClick,
}: {
  leadId: string;
  pipelineStage: PipelineStage;
  doNotContact: boolean;
  onCallClick: () => void;
  onEnrollClick: () => void;
}) {
  const automationStore = useAutomations();
  const phase = phaseFor(pipelineStage);
  const hasActiveRun = automationStore.runs.some(
    (run) => run.leadId === leadId && ["running", "waiting", "paused"].includes(run.status),
  );

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
          {PHASES.map((step, index) => (
            <div key={step.key} className="flex items-center gap-1">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 font-medium",
                  step.key === phase
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {step.label}
              </span>
              {index < PHASES.length - 1 && <span className="text-muted-foreground">→</span>}
            </div>
          ))}
        </div>

        {doNotContact ? (
          <p className="text-sm text-muted-foreground">Lead is suppressed - no action needed.</p>
        ) : phase === "new" || phase === "call" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Call this lead and log the result.</p>
            <Button size="sm" onClick={onCallClick}>
              <Phone className="mr-1 size-4" /> Call this lead
            </Button>
          </div>
        ) : phase === "nurture" && !hasActiveRun ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">This lead needs a nurture workflow.</p>
            <Button size="sm" onClick={onEnrollClick}>
              <WorkflowIcon className="mr-1 size-4" /> Choose nurture workflow
            </Button>
          </div>
        ) : phase === "nurture" ? (
          <ScheduledFollowupTimeline
            leadId={leadId}
            doNotContact={doNotContact}
            onEnrollClick={onEnrollClick}
          />
        ) : phase === "meeting" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Schedule or follow up on this lead's meeting.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/meetings">Go to Meetings</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Prepare, send, or track this lead's proposal.</p>
            <Button asChild size="sm" variant="outline">
              <Link to="/proposals">Go to Proposals</Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
