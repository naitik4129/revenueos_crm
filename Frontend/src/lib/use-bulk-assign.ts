import { toast } from "sonner";
import { messageFromError, useCrmMutation } from "@/store";

/**
 * Sets one owner on many records with one PATCH each (there is no bulk endpoint), then reports
 * how many saved and the first error.
 */
export function useBulkAssignOwner(
  update: (id: string, ownerId: string | null) => Promise<unknown>,
  noun: string,
) {
  const mutation = useCrmMutation(
    async ({ ids, ownerId }: { ids: string[]; ownerId: string | null }) => {
      const results = await Promise.allSettled(ids.map((id) => update(id, ownerId)));
      return results.flatMap((r) => (r.status === "rejected" ? [r.reason as unknown] : []));
    },
  );
  const assign = (ids: string[], ownerId: string | null, onDone: () => void) =>
    mutation.mutate(
      { ids, ownerId },
      {
        onSuccess: (failures) => {
          onDone();
          if (failures.length === 0)
            toast.success(`Owner updated on ${ids.length} ${noun}${ids.length === 1 ? "" : "s"}.`);
          else
            toast.error(
              `${ids.length - failures.length} updated, ${failures.length} failed: ${messageFromError(failures[0])}`,
            );
        },
        onError: (e) => toast.error(messageFromError(e)),
      },
    );
  return { assign, isPending: mutation.isPending };
}
