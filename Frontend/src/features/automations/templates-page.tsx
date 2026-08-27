import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { messageFromError, useAutomations } from "@/store";
import type { Template, TemplateType } from "@/types";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";

export function TemplatesPage() {
  const { templates, addTemplate, updateTemplate, isLoading, error, isPending } = useAutomations();
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="pb-10">
      <PageHeader
        title="Automations"
        description="Templates are referenced by workflow steps. Editing a template changes what the next send says."
        tabs={<AutomationTabs />}
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 size-4" /> New template
          </Button>
        }
      />

      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <LoadingBlock label="Loading templates…" />
        ) : error ? (
          <ErrorBlock error={error} />
        ) : (
          <>
            {templates.map((t) => (
              <Card key={t.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <StatusBadge value={t.type} tone={t.type === "email" ? "info" : "success"} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  {t.subject && <div className="text-xs font-medium">{t.subject}</div>}
                  <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
                    {t.body}
                  </p>
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={t.active}
                        disabled={isPending}
                        onCheckedChange={(v) => {
                          void updateTemplate(t.id, { active: v })
                            .then(() => toast.success(v ? "Template active" : "Template disabled"))
                            .catch((failure) => toast.error(messageFromError(failure)));
                        }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {t.active ? "Active" : "Disabled"}
                      </span>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}
      </div>

      <TemplateDialog
        open={creating || !!editing}
        template={editing}
        onOpenChange={(v) => {
          if (!v) {
            setCreating(false);
            setEditing(null);
          }
        }}
        onSave={(vals) => {
          if (editing) {
            void updateTemplate(editing.id, vals)
              .then(() => toast.success("Template updated"))
              .catch((failure) => toast.error(messageFromError(failure)));
          } else {
            void addTemplate(vals)
              .then(() => toast.success("Template created"))
              .catch((failure) => toast.error(messageFromError(failure)));
          }
        }}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  template,
  onOpenChange,
  onSave,
}: {
  open: boolean;
  template: Template | null;
  onOpenChange: (v: boolean) => void;
  onSave: (v: { name: string; type: TemplateType; subject: string; body: string }) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TemplateType>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = template?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(template?.name ?? "");
    setType(template?.type ?? "email");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Channel</Label>
              <Select value={type} onValueChange={(v) => setType(v as TemplateType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {type === "email" && (
            <div>
              <Label className="mb-1.5 block text-xs">Subject</Label>
              <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
          )}
          <div>
            <Label className="mb-1.5 block text-xs">Body</Label>
            <Textarea rows={7} value={body} onChange={(e) => setBody(e.target.value)} />
            <p className="pt-1 text-xs text-muted-foreground">
              Use {"{{first_name}}"} and {"{{company}}"} for personalisation.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || !body.trim()}
            onClick={() => {
              onSave({ name: name.trim(), type, subject, body });
              onOpenChange(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
