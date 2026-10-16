import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { backend, type TemplatePreviewResult } from "@/lib/backend-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PickerOption } from "@/components/common/search-picker";
import { ContactPicker, DealPicker } from "@/features/contacts/pickers";
import { emailPreviewDocument } from "@/lib/template-html";
import { htmlToWhatsAppText } from "@/lib/html-to-whatsapp-text";
import { markTokensHtml, splitTokens } from "@/lib/template-preview";
import { fmtDateTime } from "@/lib/format";
import { messageFromError } from "@/store";
import { useWorkspace } from "@/store/workspace-context";
import type { TemplateType } from "@/types";

type Target = "deal" | "contact";

const REASON: Record<TemplatePreviewResult["missing"][number]["reason"], string> = {
  unknown: "Not a variable: it is sent exactly as typed. Check the spelling.",
  needs_deal: "Needs a deal: this contact has no open deal. Real sends always go through a deal.",
  needs_meeting:
    "Needs a meeting: filled only in Meeting Scheduled notifications, from the deal's meeting.",
};

/**
 * The editor's Preview tab. With a deal or contact chosen, the backend fills the unsaved text;
 * anything it could not fill stays as `{{...}}`, highlighted and explained.
 */
export function TemplatePreviewPanel({
  type,
  subject,
  body,
}: {
  type: TemplateType;
  subject: string;
  body: string;
}) {
  const { currentWorkspaceId } = useWorkspace();
  const [target, setTarget] = useState<Target>("deal");
  const [picked, setPicked] = useState<PickerOption | null>(null);
  const preview = useQuery({
    queryKey: ["templatePreview", currentWorkspaceId, target, picked?.id, type, subject, body],
    queryFn: () =>
      backend.templates.preview({
        ...(type === "email" ? { subject } : {}),
        body,
        ...(target === "deal" ? { dealId: picked!.id } : { contactId: picked!.id }),
      }),
    enabled: Boolean(picked),
    placeholderData: keepPreviousData,
  });
  const result = picked ? preview.data : undefined;
  const shownSubject = result?.subject ?? subject;
  const shownBody = result?.body ?? body;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">Preview with</span>
        <Select
          value={target}
          onValueChange={(value) => {
            setTarget(value as Target);
            setPicked(null);
          }}
        >
          <SelectTrigger aria-label="Preview with" className="h-8 w-28 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="deal">Deal</SelectItem>
            <SelectItem value="contact">Contact</SelectItem>
          </SelectContent>
        </Select>
        <div className="min-w-[220px] flex-1">
          {target === "deal" ? (
            <DealPicker value={picked} onChange={setPicked} />
          ) : (
            <ContactPicker value={picked} onChange={setPicked} />
          )}
        </div>
      </div>

      {!picked && (
        <p className="text-xs text-muted-foreground">
          Pick a deal or contact to see the filled text. Variables are highlighted until then.
        </p>
      )}
      {preview.error && (
        <p className="text-xs text-destructive">{messageFromError(preview.error)}</p>
      )}
      {result?.meeting && (
        <p className="text-xs text-muted-foreground">
          Meeting values from &quot;{result.meeting.title}&quot;, {fmtDateTime(result.meeting.at)}.
        </p>
      )}

      {type === "email" && (
        <div className="rounded-md border px-3 py-2 text-sm" aria-label="Preview subject">
          <span className="text-xs text-muted-foreground">Subject: </span>
          <Highlighted text={shownSubject} />
        </div>
      )}
      {type === "email" ? (
        <iframe
          title="Email template preview"
          sandbox=""
          referrerPolicy="no-referrer"
          className="block h-[360px] max-h-[60dvh] w-full min-w-0 rounded-md border bg-white"
          srcDoc={emailPreviewDocument(markTokensHtml(shownBody))}
        />
      ) : (
        <pre className="min-h-[150px] max-h-[320px] overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-sans text-sm [overflow-wrap:anywhere]">
          <Highlighted text={htmlToWhatsAppText(shownBody)} />
        </pre>
      )}

      {result && result.missing.length > 0 && (
        <ul
          className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
          aria-label="Not filled"
        >
          {result.missing.map((m) => (
            <li key={m.token}>
              <code className="font-mono">{`{{${m.token}}}`}</code> — {REASON[m.reason]}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitTokens(text).map((part, i) =>
        part.token ? (
          <mark key={i} className="rounded bg-warning/30 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}
