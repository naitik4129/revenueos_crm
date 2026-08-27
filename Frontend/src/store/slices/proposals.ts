import { useCallback, useMemo, useState } from "react";
import * as seed from "@/mocks/seed";
import type { Proposal } from "@/types";
import { createSliceContext } from "../context";
import type { NextId } from "../ids";
import { NOW } from "@/lib/dates";
import type { TimelineSlice } from "./timeline";

export interface ProposalsSlice {
  proposals: Proposal[];
  addProposal: (proposal: Omit<Proposal, "id">) => void;
  updateProposal: (id: string, patch: Partial<Proposal>) => void;
}

export const [ProposalsContext, useProposals] = createSliceContext<ProposalsSlice>("useProposals");

export function useProposalsSlice(
  nid: NextId,
  addTimeline: TimelineSlice["addTimeline"],
  currentUserName: string,
): ProposalsSlice {
  const [proposals, setProposals] = useState<Proposal[]>(seed.proposals);

  const addProposal = useCallback(
    (proposal: Omit<Proposal, "id">) => {
      const created: Proposal = { ...proposal, id: nid("p") };
      setProposals((prev) => [created, ...prev]);
      addTimeline({
        leadId: proposal.leadId,
        at: NOW,
        kind: "proposal",
        title: "Proposal Uploaded",
        actor: currentUserName,
        source: "Manual",
        detail: proposal.fileName,
      });
    },
    [nid, addTimeline, currentUserName],
  );

  const updateProposal = useCallback(
    (id: string, patch: Partial<Proposal>) => {
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: NOW } : p)),
      );
      const proposal = proposals.find((p) => p.id === id);
      if (proposal && patch.status) {
        addTimeline({
          leadId: proposal.leadId,
          at: NOW,
          kind: "proposal",
          title: `Proposal ${patch.status}`,
          actor: currentUserName,
          source: "Manual",
          detail: patch.fileName ?? proposal.fileName,
        });
      }
    },
    [proposals, addTimeline, currentUserName],
  );

  return useMemo(
    () => ({ proposals, addProposal, updateProposal }),
    [proposals, addProposal, updateProposal],
  );
}
