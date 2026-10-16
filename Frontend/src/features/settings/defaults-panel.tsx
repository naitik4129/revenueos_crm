import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { backend, type Workspace } from "@/lib/backend-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DefaultOwnerSelect } from "@/features/admin/default-owner-select";
import { adminKeys, errorText } from "@/features/admin/admin-keys";
import { messageFromError, useSession } from "@/store";
import { keys } from "@/store/query";
import type { TemplateType } from "@/types";

const NONE = "none";

/**
 * Workspace defaults: the handover owner (admins only; the backend enforces it) and the
 * templates sent when a meeting is scheduled (anyone, as on the Templates page).
 */
export function DefaultsPanel({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient();
  const { currentUser, userName } = useSession();
  const isAdmin = currentUser?.role === "Admin";
  const members = useQuery({
    queryKey: adminKeys.members(workspace.id),
    queryFn: ({ signal }) => backend.workspaces.members(workspace.id, signal),
    enabled: isAdmin,
  });
  const templates = useQuery({
    queryKey: keys.templates(workspace.id),
    queryFn: ({ signal }) => backend.templates.list(signal),
  });
  const owner = useMutation({
    mutationFn: (defaultOwnerId: string | null) =>
      backend.workspaces.update(workspace.id, { defaultOwnerId }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.workspaces });
      toast.success("Default owner saved.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const template = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      backend.templates.update(id, { isDefaultMeetingScheduled: on }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.templates(workspace.id) });
      void client.invalidateQueries({ queryKey: keys.workspaces });
      toast.success("Default template saved.");
    },
    onError: (error) => toast.error(messageFromError(error)),
  });

  const templateSelect = (channel: TemplateType, label: string) => {
    const options = (templates.data?.data ?? []).filter((t) => t.type === channel && t.active);
    const current = (templates.data?.data ?? []).find(
      (t) => t.type === channel && t.isDefaultMeetingScheduled,
    );
    return (
      <div>
        <Label className="mb-1.5 block text-xs">{label}</Label>
        <Select
          value={current?.id ?? NONE}
          disabled={templates.isLoading || template.isPending}
          onValueChange={(id) =>
            id === NONE
              ? current && template.mutate({ id: current.id, on: false })
              : template.mutate({ id, on: true })
          }
        >
          <SelectTrigger aria-label={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None (do not send)</SelectItem>
            {options.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Users className="size-4" /> Defaults
        </CardTitle>
        <CardDescription>
          Who owns a brain handover that names no owner, and what is sent when a meeting is
          scheduled.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-3">
        <div>
          <Label className="mb-1.5 block text-xs">Default owner</Label>
          {isAdmin ? (
            <DefaultOwnerSelect
              value={workspace.defaultOwnerId}
              members={members.data?.data ?? []}
              disabled={members.isLoading || owner.isPending}
              onChange={(id) => owner.mutate(id)}
            />
          ) : (
            <p className="py-2 text-sm">
              {workspace.defaultOwnerId ? userName(workspace.defaultOwnerId) : "No default owner"}
              <span className="block text-xs text-muted-foreground">Set by an admin.</span>
            </p>
          )}
        </div>
        {templateSelect("email", "Meeting scheduled: email")}
        {templateSelect("whatsapp", "Meeting scheduled: WhatsApp")}
      </CardContent>
    </Card>
  );
}
