import { useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Paperclip, Plus, Trash2, X } from "lucide-react";
import { PageHeader } from "@/app/app-shell";
import { AutomationTabs } from "@/features/automations/automation-tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { messageFromError, useAutomations } from "@/store";
import type { Template, TemplateAttachment, TemplateType } from "@/types";
import { ErrorBlock, LoadingBlock } from "@/components/common/server-state";
import { TemplateBodyEditor } from "@/features/automations/template-body-editor";
import { htmlToWhatsAppText } from "@/lib/html-to-whatsapp-text";

const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp";

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isBodyEmpty(html: string): boolean {
  return stripHtml(html).length === 0;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function TemplatesPage() {
  const {
    templates,
    addTemplate,
    updateTemplate,
    deleteTemplate,
    uploadTemplateAttachment,
    deleteTemplateAttachment,
    isLoading,
    error,
    isPending,
  } = useAutomations();
  const [editing, setEditing] = useState<Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Template | null>(null);

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
                  <p className="line-clamp-4 text-xs text-muted-foreground">{stripHtml(t.body)}</p>
                  {t.attachments.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3" />
                      {t.attachments.length} attachment{t.attachments.length > 1 ? "s" : ""}
                    </div>
                  )}
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
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => setEditing(t)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(t)}
                        aria-label="Delete template"
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
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
        addTemplate={addTemplate}
        updateTemplate={updateTemplate}
        uploadTemplateAttachment={uploadTemplateAttachment}
        deleteTemplateAttachment={deleteTemplateAttachment}
      />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        title={`Delete "${deleteTarget?.name ?? ""}"?`}
        description="This removes the template. Templates still used by a published workflow step can't be deleted — remove them from that step first."
        disabled={isPending}
        onConfirm={() => {
          if (!deleteTarget) return;
          const target = deleteTarget;
          setDeleteTarget(null);
          void deleteTemplate(target.id)
            .then(() => toast.success("Template deleted"))
            .catch((failure) => toast.error(messageFromError(failure)));
        }}
      />
    </div>
  );
}

function TemplateDialog({
  open,
  template,
  onOpenChange,
  addTemplate,
  updateTemplate,
  uploadTemplateAttachment,
  deleteTemplateAttachment,
}: {
  open: boolean;
  template: Template | null;
  onOpenChange: (v: boolean) => void;
  addTemplate: (input: {
    name: string;
    type: TemplateType;
    subject: string;
    body: string;
  }) => Promise<Template>;
  updateTemplate: (
    id: string,
    input: { name?: string; subject?: string; body?: string; active?: boolean },
  ) => Promise<Template>;
  uploadTemplateAttachment: (templateId: string, file: File) => Promise<TemplateAttachment>;
  deleteTemplateAttachment: (templateId: string, attachmentId: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<TemplateType>("email");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [existingAttachments, setExistingAttachments] = useState<TemplateAttachment[]>([]);
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<string[]>([]);
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  const key = template?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(template?.name ?? "");
    setType(template?.type ?? "email");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setExistingAttachments(template?.attachments ?? []);
    setRemovedAttachmentIds([]);
    setStagedFiles([]);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const visibleExisting = existingAttachments.filter((a) => !removedAttachmentIds.includes(a.id));
  const attachmentCount = visibleExisting.length + stagedFiles.length;

  function handleFilesSelected(e: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (selected.length === 0) return;
    if (type === "whatsapp" && attachmentCount + selected.length > 1) {
      toast.error("WhatsApp templates support only one attachment.");
      return;
    }
    setStagedFiles((prev) => [...prev, ...selected]);
  }

  async function handleSave() {
    if (!name.trim() || isBodyEmpty(body)) return;
    const effectiveSubject = type === "email" ? subject.trim() : "";
    setSaving(true);
    let saved: Template;
    try {
      saved = template
        ? await updateTemplate(template.id, { name: name.trim(), subject: effectiveSubject, body })
        : await addTemplate({ name: name.trim(), type, subject: effectiveSubject, body });
    } catch (err) {
      toast.error(messageFromError(err));
      setSaving(false);
      return;
    }
    toast.success(template ? "Template updated" : "Template created");
    setSaving(false);
    onOpenChange(false);

    for (const id of removedAttachmentIds) {
      try {
        await deleteTemplateAttachment(saved.id, id);
      } catch (err) {
        toast.error(`Failed to remove an attachment: ${messageFromError(err)}`);
      }
    }
    for (const file of stagedFiles) {
      try {
        await uploadTemplateAttachment(saved.id, file);
      } catch (err) {
        toast.error(
          `Failed to upload "${file.name}": ${messageFromError(err)}. Edit the template again to retry.`,
        );
      }
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="mb-1.5 block text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs">Channel</Label>
              <Select
                value={type}
                onValueChange={(v) => setType(v as TemplateType)}
                disabled={!!template}
              >
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
            <Tabs defaultValue="edit">
              <TabsList className="h-8">
                <TabsTrigger value="edit" className="px-2.5 py-1 text-xs">
                  Edit
                </TabsTrigger>
                <TabsTrigger value="preview" className="px-2.5 py-1 text-xs">
                  Preview
                </TabsTrigger>
              </TabsList>
              <TabsContent value="edit" className="mt-1.5">
                <TemplateBodyEditor value={body} onChange={setBody} loadKey={key} />
              </TabsContent>
              <TabsContent value="preview" className="mt-1.5">
                {type === "email" ? (
                  <div
                    className="min-h-[150px] rounded-md border p-3 text-sm"
                    dangerouslySetInnerHTML={{ __html: body }}
                  />
                ) : (
                  <pre className="min-h-[150px] whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm">
                    {htmlToWhatsAppText(body)}
                  </pre>
                )}
              </TabsContent>
            </Tabs>
            <p className="pt-1 text-xs text-muted-foreground">
              Use the "Insert variable" menu in the toolbar to personalise with lead/owner details.
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="text-xs">Attachments{type === "whatsapp" ? " (max 1)" : ""}</Label>
              <label>
                <span className="cursor-pointer text-xs text-primary underline-offset-4 hover:underline">
                  + Add file
                </span>
                <input
                  type="file"
                  multiple={type === "email"}
                  accept={ATTACHMENT_ACCEPT}
                  className="hidden"
                  onChange={handleFilesSelected}
                />
              </label>
            </div>
            {attachmentCount === 0 ? (
              <p className="text-xs text-muted-foreground">No attachments.</p>
            ) : (
              <ul className="space-y-1">
                {visibleExisting.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-center justify-between rounded-md border px-2 py-1 text-xs"
                  >
                    <span className="truncate">
                      {a.fileName}{" "}
                      <span className="text-muted-foreground">({formatBytes(a.sizeBytes)})</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${a.fileName}`}
                      onClick={() => setRemovedAttachmentIds((prev) => [...prev, a.id])}
                    >
                      <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </li>
                ))}
                {stagedFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${index}`}
                    className="flex items-center justify-between rounded-md border border-dashed px-2 py-1 text-xs"
                  >
                    <span className="truncate">
                      {file.name}{" "}
                      <span className="text-muted-foreground">({formatBytes(file.size)})</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => setStagedFiles((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <X className="size-3.5 text-muted-foreground hover:text-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || isBodyEmpty(body) || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
