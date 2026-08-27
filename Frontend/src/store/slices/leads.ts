import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { AutomationMode, Lead, NextAction } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";
import { NOW } from "@/lib/dates";
import type { RunEffects } from "./automations";
import type { TimelineSlice } from "./timeline";

export interface LeadsSlice {
  leads: Lead[];
  getLead: (id: string) => Lead | undefined;
  addLead: (lead: Partial<Lead>) => string;
  updateLead: (id: string, patch: Partial<Lead>) => void;
  setNextAction: (id: string, next: NextAction | null) => void;
  setAutomation: (id: string, mode: AutomationMode, reason?: string) => void;
  markDnc: (id: string, reason: string) => void;
  addNote: (leadId: string, body: string) => void;
}

export const [LeadsContext, useLeads] = createSliceContext<LeadsSlice>("useLeads");

interface LeadsSliceDeps {
  nid: NextId;
  addTimeline: TimelineSlice["addTimeline"];
  runEffects: RunEffects;
  currentUserName: string;
  userName: (id: string) => string;
}

export function useLeadsSlice({
  nid,
  addTimeline,
  runEffects,
  currentUserName,
  userName,
}: LeadsSliceDeps): LeadsSlice {
  const [leads, setLeads] = useState<Lead[]>(seed.leads);

  const updateLead = useCallback((id: string, patch: Partial<Lead>) => {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch, lastActivity: NOW } : l)));
  }, []);

  const setNextAction = useCallback(
    (id: string, next: NextAction | null) => updateLead(id, { nextAction: next }),
    [updateLead],
  );

  const addLead = useCallback(
    (partial: Partial<Lead>) => {
      const id = nid("l");
      const lead: Lead = {
        id,
        firstName: "New",
        lastName: "Lead",
        company: "",
        jobTitle: "",
        industry: "",
        phone: "",
        email: "",
        source: "Website",
        serviceInterest: "",
        ownerId: seed.currentUserId,
        stage: "New",
        automation: "Manual",
        doNotContact: false,
        lastActivity: NOW,
        nextAction: null,
        createdAt: NOW,
        notes: [],
        ...partial,
      };

      setLeads((prev) => [lead, ...prev]);
      addTimeline({
        leadId: id,
        at: lead.createdAt,
        kind: "system",
        title: "Lead Created",
        actor: currentUserName,
        source: "Manual",
        detail: `Source: ${lead.source}`,
      });
      addTimeline({
        leadId: id,
        at: lead.createdAt,
        kind: "system",
        title: "Lead Assigned",
        actor: currentUserName,
        source: "Manual",
        detail: `Owner: ${userName(lead.ownerId)}`,
      });
      return id;
    },
    [nid, addTimeline, currentUserName, userName],
  );

  const setAutomation = useCallback(
    (id: string, mode: AutomationMode, reason?: string) => {
      updateLead(id, { automation: mode });
      addTimeline({
        leadId: id,
        at: NOW,
        kind: "automation",
        title:
          mode === "Active"
            ? "Automation Resumed"
            : mode === "Paused"
              ? "Automation Paused"
              : mode === "Stopped"
                ? "Automation Stopped"
                : "Switched to Manual",
        actor: currentUserName,
        source: "Manual",
        detail: reason,
      });
      runEffects.applyAutomationMode(id, mode);
    },
    [updateLead, addTimeline, currentUserName, runEffects],
  );

  const markDnc = useCallback(
    (id: string, reason: string) => {
      updateLead(id, {
        doNotContact: true,
        automation: "Stopped",
        dncReason: reason,
        dncBy: currentUserName,
        dncAt: NOW,
        nextAction: null,
      });
      runEffects.cancelRunsForLead(id, "Lead marked Do Not Contact");
      addTimeline({
        leadId: id,
        at: NOW,
        kind: "system",
        title: "Do Not Contact",
        actor: currentUserName,
        source: "Manual",
        detail: reason,
      });
    },
    [updateLead, addTimeline, currentUserName, runEffects],
  );

  const addNote = useCallback(
    (leadId: string, body: string) => {
      const note = { id: nid("n"), author: currentUserName, at: NOW, body };
      setLeads((prev) =>
        prev.map((l) => (l.id === leadId ? { ...l, notes: [...l.notes, note] } : l)),
      );
      addTimeline({
        leadId,
        at: NOW,
        kind: "note",
        title: "Note Added",
        actor: currentUserName,
        source: "Manual",
        detail: body,
      });
    },
    [nid, addTimeline, currentUserName],
  );

  return useMemo(
    () => ({
      leads,
      getLead: (id: string) => leads.find((l) => l.id === id),
      addLead,
      updateLead,
      setNextAction,
      setAutomation,
      markDnc,
      addNote,
    }),
    [leads, addLead, updateLead, setNextAction, setAutomation, markDnc, addNote],
  );
}
