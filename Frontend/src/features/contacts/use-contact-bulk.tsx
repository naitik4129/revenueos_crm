import { useState } from "react";
import { toast } from "sonner";
import { backend, type ContactBulkInput, type ContactBulkResult } from "@/lib/backend-client";
import { messageFromError, useCrmMutation } from "@/store";
import type { Contact } from "@/types";
import { BulkResultDialog } from "./contact-bulk";

const plural = (n: number) => `${n} contact${n === 1 ? "" : "s"}`;

const contactName = (c: Contact) => `${c.firstName} ${c.lastName}`.trim() || c.email || "(no name)";

/**
 * Runs one bulk action on the selected contacts (POST /contacts/bulk, one request) and keeps the
 * result: a toast, plus the list of skipped contacts with their reasons when any were skipped.
 */
export function useContactBulk(selected: Contact[], onDone: () => void) {
  // Names are kept with the result: the selection is cleared when the action is done.
  const [result, setResult] = useState<{ r: ContactBulkResult; names: Map<string, string> } | null>(
    null,
  );
  const mutation = useCrmMutation((input: ContactBulkInput) =>
    backend.contacts.bulk(
      selected.map((c) => c.id),
      input,
    ),
  );
  const run = (input: ContactBulkInput, close?: () => void) => {
    const names = new Map(selected.map((c) => [c.id, contactName(c)]));
    mutation.mutate(input, {
      onSuccess: (r) => {
        close?.();
        onDone();
        const { ok, skipped } = r.counts;
        if (skipped === 0) toast.success(`Updated ${plural(ok)}.`);
        else {
          toast.warning(`Updated ${plural(ok)}; ${skipped} skipped.`);
          setResult({ r, names });
        }
      },
      // Dialog actions show the error in the dialog; the owner menu has none.
      onError: (e) => {
        if (!close) toast.error(messageFromError(e));
      },
    });
  };
  const summary = result && (
    <BulkResultDialog result={result.r} names={result.names} onClose={() => setResult(null)} />
  );
  return {
    run,
    pending: mutation.isPending,
    error: mutation.error,
    reset: mutation.reset,
    summary,
  };
}
