import { CalendarDays, FileText, Phone, Workflow as WorkflowIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { PipelineStage, Run, ScheduledAction } from "@/types";
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
 * "What do I do right now" card for a deal: always one primary action, from the stage (and,
 * in nurture, whether a workflow is already running).
 */
export function DealJourneyCard({
  runs,
  scheduledActions,
  stage,
  doNotContact,
  onCallClick,
  onEnrollClick,
  onMeetingClick,
  onProposalClick,
}: {
  /** This deal's runs and scheduled actions (useDealDetail). */
  runs: Run[];
  scheduledActions: ScheduledAction[];
  stage: PipelineStage;
  doNotContact: boolean;
  onCallClick: () => void;
  onEnrollClick: () => void;
  onMeetingClick: () => void;
  onProposalClick: () => void;
}) {
  const phase = phaseFor(stage);
  const hasActiveRun = runs.some((run) => ["running", "waiting", "paused"].includes(run.status));

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
          <p className="text-sm text-muted-foreground">
            The contact is Do Not Contact - no action needed.
          </p>
        ) : phase === "new" || phase === "call" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Call the contact and log the result.</p>
            <Button size="sm" onClick={onCallClick}>
              <Phone className="mr-1 size-4" /> Log call
            </Button>
          </div>
        ) : phase === "nurture" && !hasActiveRun ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">This deal needs a nurture workflow.</p>
            <Button size="sm" onClick={onEnrollClick}>
              <WorkflowIcon className="mr-1 size-4" /> Choose nurture workflow
            </Button>
          </div>
        ) : phase === "nurture" ? (
          <ScheduledFollowupTimeline
            runs={runs}
            scheduledActions={scheduledActions}
            doNotContact={doNotContact}
            onEnrollClick={onEnrollClick}
          />
        ) : phase === "meeting" ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Schedule or follow up on the meeting.</p>
            <Button size="sm" variant="outline" onClick={onMeetingClick}>
              <CalendarDays className="mr-1 size-4" /> Schedule meeting
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">Prepare, send, or track the proposal.</p>
            <Button size="sm" variant="outline" onClick={onProposalClick}>
              <FileText className="mr-1 size-4" /> New proposal
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
