import { convertToVisualHtml } from "@/lib/template-editor-schema";
import { useRef, useState, type ChangeEvent } from "react";
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
import { TEMPLATE_VARIABLES } from "@/lib/template-variables";

import {
  emailPreviewDocument,
  isTemplateBodyEmpty,
  needsHtmlMode,
  sanitizeEmailHtml,
  templateSummary,
} from "@/lib/template-html";

const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.gif,.webp";

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
              <Card key={t.id} className="flex min-w-0 flex-col [overflow-wrap:anywhere]">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-sm">{t.name}</CardTitle>
                    <StatusBadge value={t.type} tone={t.type === "email" ? "info" : "success"} />
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  {t.subject && <div className="text-xs font-medium">{t.subject}</div>}
                  {t.isDefaultMeetingScheduled && (
                    <div className="w-fit rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      Default: Meeting Scheduled
                    </div>
                  )}
                  <p className="line-clamp-4 text-xs text-muted-foreground">
                    {templateSummary(t.body)}
                  </p>
                  {t.attachments.length > 0 && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3" />
                      {t.attachments.length} attachment{t.attachments.length > 1 ? "s" : ""}
                    </div>
                  )}
                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
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
        description="This removes the template. Templates still used by a published workflow step can't be deleted - remove them from that step first."
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
    input: {
      name?: string;
      subject?: string;
      body?: string;
      active?: boolean;
      isDefaultMeetingScheduled?: boolean;
    },
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
  const [isDefaultMeetingScheduled, setIsDefaultMeetingScheduled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [bodyMode, setBodyMode] = useState("visual");
  const [htmlEdited, setHtmlEdited] = useState(false);
  const [conversionTarget, setConversionTarget] = useState<"visual" | "whatsapp" | null>(null);
  const htmlInputRef = useRef<HTMLTextAreaElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const key = template?.id ?? "new";
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setName(template?.name ?? "");
    setType(template?.type ?? "email");
    setSubject(template?.subject ?? "");
    setBody(template?.body ?? "");
    setBodyMode(template?.type === "email" && needsHtmlMode(template.body) ? "html" : "visual");
    setHtmlEdited(false);
    setConversionTarget(null);
    setExistingAttachments(template?.attachments ?? []);
    setRemovedAttachmentIds([]);
    setStagedFiles([]);
    setIsDefaultMeetingScheduled(template?.isDefaultMeetingScheduled ?? false);
  }
  if (!open && loadedFor !== null) setLoadedFor(null);

  const visibleExisting = existingAttachments.filter((a) => !removedAttachmentIds.includes(a.id));
  const attachmentCount = visibleExisting.length + stagedFiles.length;

  function changeBodyMode(next: string) {
    if (saving) return;
    if (next === "visual" && (htmlEdited || needsHtmlMode(body))) {
      setConversionTarget("visual");
    } else setBodyMode(next);
  }

  function changeChannel(next: TemplateType) {
    if (next === "whatsapp" && (htmlEdited || needsHtmlMode(body))) {
      setConversionTarget("whatsapp");
    } else {
      setType(next);
      if (next === "whatsapp" && bodyMode === "html") setBodyMode("visual");
    }
  }

  function insertHtmlVariable(token: string) {
    const input = htmlInputRef.current;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? start;
    const variable = `{{${token}}}`;
    setBody(body.slice(0, start) + variable + body.slice(end));
    setHtmlEdited(true);
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + variable.length, start + variable.length);
    });
  }

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

  function insertSubjectVariable(token: string) {
    const variable = `{{${token}}}`;
    const input = subjectInputRef.current;
    const start = input?.selectionStart ?? subject.length;
    const end = input?.selectionEnd ?? start;
    const nextSubject = `${subject.slice(0, start)}${variable}${subject.slice(end)}`;

    setSubject(nextSubject);
    window.requestAnimationFrame(() => {
      if (!input) return;
      const cursor = start + variable.length;
      input.focus();
      input.setSelectionRange(cursor, cursor);
    });
  }

  async function handleSave() {
    if (saving || !name.trim() || isTemplateBodyEmpty(body)) return;
    if (type === "whatsapp" && attachmentCount > 1) {
      toast.error("WhatsApp templates support only one attachment.");
      return;
    }
    const effectiveSubject = type === "email" ? subject.trim() : "";
    const effectiveBody = type === "email" ? sanitizeEmailHtml(body) : body;
    setSaving(true);
    let saved: Template;
    try {
      if (template) {
        saved = await updateTemplate(template.id, {
          name: name.trim(),
          subject: effectiveSubject,
          body: effectiveBody,
          isDefaultMeetingScheduled,
        });
      } else {
        saved = await addTemplate({
          name: name.trim(),
          type,
          subject: effectiveSubject,
          body: effectiveBody,
        });
        if (isDefaultMeetingScheduled) {
          saved = await updateTemplate(saved.id, { isDefaultMeetingScheduled: true });
        }
      }
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!saving) onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 border-b px-6 py-4">
          <DialogTitle>{template ? "Edit template" : "New template"}</DialogTitle>
        </DialogHeader>
        {/* A regular block owns scrolling: fieldset's anonymous layout box does not
            reliably shrink/scroll as a flex child. Keep it inside for disabled semantics. */}
        <div className="min-h-0 min-w-0 flex-auto overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
          <fieldset disabled={saving} className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label className="mb-1.5 block text-xs">Name</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div>
                <Label className="mb-1.5 block text-xs">Channel</Label>
                <Select
                  value={type}
                  onValueChange={(v) => changeChannel(v as TemplateType)}
                  disabled={!!template || saving}
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
                <Label htmlFor="template-subject" className="mb-1.5 block text-xs">
                  Subject
                </Label>
                <div className="flex min-w-0 flex-wrap gap-2">
                  <Input
                    ref={subjectInputRef}
                    id="template-subject"
                    className="min-w-0 flex-[1_1_200px]"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                  <Select value="" onValueChange={insertSubjectVariable}>
                    <SelectTrigger
                      aria-label="Insert subject variable"
                      className="h-9 w-[170px] shrink-0 text-xs"
                    >
                      <SelectValue placeholder="Insert variable" />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_VARIABLES.map((v) => (
                        <SelectItem key={v.token} value={v.token} className="text-xs">
                          {v.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <Switch
                checked={isDefaultMeetingScheduled}
                onCheckedChange={setIsDefaultMeetingScheduled}
              />
              <div>
                <div className="text-sm font-medium">
                  Use as default &quot;Meeting Scheduled&quot; {type} template
                </div>
                <p className="text-xs text-muted-foreground">
                  Automatically sent to the lead whenever a meeting is scheduled. Only one {type}{" "}
                  template can hold this at a time - enabling it here disables it on any other.
                </p>
              </div>
            </div>

            <div>
              <Label className="mb-1.5 block text-xs">Body</Label>
              <Tabs value={bodyMode} onValueChange={changeBodyMode}>
                <TabsList className="h-8">
                  <TabsTrigger value="visual" disabled={saving}>
                    Visual
                  </TabsTrigger>
                  {type === "email" && (
                    <TabsTrigger value="html" disabled={saving}>
                      HTML
                    </TabsTrigger>
                  )}
                  <TabsTrigger value="preview" disabled={saving}>
                    Preview
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="visual" className="mt-1.5">
                  {bodyMode === "visual" && (
                    <TemplateBodyEditor
                      value={body}
                      onChange={setBody}
                      loadKey={key}
                      disabled={saving}
                    />
                  )}
                </TabsContent>
                {type === "email" && (
                  <TabsContent value="html" className="mt-1.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="template-html">HTML source</Label>
                      <Select value="" disabled={saving} onValueChange={insertHtmlVariable}>
                        <SelectTrigger
                          aria-label="Insert HTML variable"
                          className="h-8 w-[170px] text-xs"
                        >
                          <SelectValue placeholder="Insert variable" />
                        </SelectTrigger>
                        <SelectContent>
                          {TEMPLATE_VARIABLES.map((v) => (
                            <SelectItem key={v.token} value={v.token}>
                              {v.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <textarea
                      ref={htmlInputRef}
                      id="template-html"
                      value={body}
                      disabled={saving}
                      spellCheck={false}
                      className="block h-[260px] min-h-[150px] max-h-[min(420px,60dvh)] w-full min-w-0 resize-y overflow-auto rounded-md border p-3 font-mono text-xs"
                      placeholder="Paste an HTML email or HTML fragment here"
                      onChange={(event) => {
                        setBody(event.target.value);
                        setHtmlEdited(true);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Paste your email HTML, then select Preview to see the design.
                    </p>
                  </TabsContent>
                )}
                <TabsContent value="preview" className="mt-1.5">
                  {type === "email" ? (
                    <iframe
                      title="Email template preview"
                      sandbox=""
                      referrerPolicy="no-referrer"
                      className="block h-[360px] max-h-[60dvh] w-full min-w-0 rounded-md border bg-white"
                      srcDoc={emailPreviewDocument(body)}
                    />
                  ) : (
                    <pre className="min-h-[150px] max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm [overflow-wrap:anywhere]">
                      {htmlToWhatsAppText(body)}
                    </pre>
                  )}
                </TabsContent>
              </Tabs>
              <p className="pt-1 text-xs text-muted-foreground">
                Insert lead, owner, date/time, or meeting details in the subject or body. Dates and
                times use IST (Asia/Kolkata). Current date/time and tomorrow's date are calculated
                when sending. Meeting details use the scheduled meeting and are only available for
                Meeting Scheduled notifications; other sends using meeting variables will fail.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <Label className="text-xs">
                  Attachments{type === "whatsapp" ? " (max 1)" : ""}
                </Label>
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
          </fieldset>
        </div>
        <ConfirmDialog
          open={conversionTarget !== null}
          onOpenChange={(next) => {
            if (!next) setConversionTarget(null);
          }}
          title="Convert to visual editor?"
          description="Converting keeps basic text formatting, links, and lists. Complex layouts, images, and styling may be removed."
          confirmLabel="Convert"
          onConfirm={() => {
            setBody(convertToVisualHtml(body));
            setHtmlEdited(false);
            setBodyMode("visual");
            if (conversionTarget === "whatsapp") setType("whatsapp");
            setConversionTarget(null);
          }}
        />
        <DialogFooter className="shrink-0 border-t bg-background px-6 py-4">
          <Button variant="ghost" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!name.trim() || isTemplateBodyEmpty(body) || saving}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
