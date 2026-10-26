import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck } from "lucide-react";
import { toast } from "sonner";
import { backend, type Workspace } from "@/lib/backend-client";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { messageFromError } from "@/store";
import { keys } from "@/store/query";
import type { TemplateType } from "@/types";
import { PanelHeader } from "@/components/common/record-parts";

const NONE = "none";

/**
 * Workspace defaults: the templates sent when a meeting is scheduled (anyone, as on the Templates
 * page). The handover owner is no longer set here — access and ownership come from the RevenueOS
 * platform; a handover with no owner notifies the project's people.
 */
export function DefaultsPanel({ workspace }: { workspace: Workspace }) {
  const client = useQueryClient();
  const templates = useQuery({
    queryKey: keys.templates(workspace.id),
    queryFn: ({ signal }) => backend.templates.list(signal),
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
      <PanelHeader icon={CalendarCheck} title="Defaults" />
      <CardContent className="grid gap-4 md:grid-cols-2 p-4">
        <p className="text-sm text-muted-foreground md:col-span-full">
          What is sent when a meeting is scheduled.
        </p>
        {templateSelect("email", "Meeting scheduled: email")}
        {templateSelect("whatsapp", "Meeting scheduled: WhatsApp")}
      </CardContent>
    </Card>
  );
}
