import { useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { backend, type ImportContactRow } from "@/lib/backend-client";
import { messageFromError, useCrmMutation } from "@/store";
import type { ImportContactsResult } from "@/types";
import {
  downloadSampleCsv,
  parseContactsCsv,
  previewRowError,
  rowWantsDeal,
  type ParsedContactsCsv,
} from "./csv-contact-import";

const PREVIEW_LIMIT = 50;

export function ImportContactsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedContactsCsv | null>(null);
  const [result, setResult] = useState<ImportContactsResult | null>(null);
  const importRows = useCrmMutation((rows: ImportContactRow[]) => backend.contacts.importCsv(rows));

  const step = result ? "results" : parsed ? "preview" : "select";
  const rows = parsed?.rows ?? [];
  const invalidCount = rows.filter((r) => previewRowError(r) !== null).length;
  const dealCount = rows.filter(rowWantsDeal).length;

  const reset = () => {
    setFileName("");
    setFileError(null);
    setParsed(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const close = () => {
    onOpenChange(false);
    reset();
  };

  async function onFile(file: File) {
    setFileError(null);
    if (!file.name.toLowerCase().endsWith(".csv"))
      return setFileError("Please choose a .csv file.");
    const text = await file.text();
    if (!text.trim()) return setFileError("The selected file is empty.");
    const next = parseContactsCsv(text);
    if (next.error) return setFileError(next.error);
    setFileName(file.name);
    setParsed(next);
  }

  async function submit() {
    try {
      const { data } = await importRows.mutateAsync(rows);
      setResult(data);
      toast.success(`Imported ${data.created.length} of ${data.totalRows} rows.`);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Columns are matched by name, in any order. Required: First Name, and an Email, Phone or
            LinkedIn. Company / Website create or match a company. Create Deal (yes) or a Deal Title
            also opens a deal. New contacts start as prospects.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              Not sure of the format?
              <Button
                variant="link"
                className="h-auto p-0 pl-1 align-baseline"
                onClick={downloadSampleCsv}
              >
                <Download className="mr-1 size-3.5" />
                Download sample CSV
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
            {fileError && <Notice tone="error">{fileError}</Notice>}
          </div>
        )}

        {step === "preview" && parsed && (
          <div className="space-y-3">
            <p className="text-sm">
              <span className="font-medium">{rows.length}</span> row{rows.length === 1 ? "" : "s"}{" "}
              in <span className="font-medium">{fileName}</span>
              {dealCount > 0 && <> · {dealCount} will also open a deal</>}
              {invalidCount > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  · {invalidCount} will likely fail (checked again on import)
                </span>
              )}
            </p>
            {parsed.unmatchedHeaders.length > 0 && (
              <Notice tone="warning">
                Unrecognized columns (ignored): {parsed.unmatchedHeaders.join(", ")}
              </Notice>
            )}
            {parsed.duplicateHeaders.length > 0 && (
              <Notice tone="warning">
                Duplicate columns (first one used): {parsed.duplicateHeaders.join(", ")}
              </Notice>
            )}
            <ScrollArea className="h-72 rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/90 text-left text-muted-foreground backdrop-blur">
                  <tr>
                    {["Row", "Name", "Company", "Email / Phone / LinkedIn", "Deal", "Status"].map(
                      (h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, PREVIEW_LIMIT).map((row) => {
                    const error = previewRowError(row);
                    return (
                      <tr key={row.rowNumber} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{row.rowNumber}</td>
                        <td className="px-2 py-1.5">
                          {row.firstName} {row.lastName ?? ""}
                        </td>
                        <td className="px-2 py-1.5">{row.company ?? "-"}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.email || row.phone || row.linkedinUrl || "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          {rowWantsDeal(row) ? (row.dealTitle ?? "Yes") : "-"}
                        </td>
                        <td className="px-2 py-1.5">
                          {error ? (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircle className="size-3.5" /> {error}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-success-foreground">
                              <CheckCircle2 className="size-3.5" /> OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length > PREVIEW_LIMIT && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Showing the first {PREVIEW_LIMIT} of {rows.length} rows.
                </p>
              )}
            </ScrollArea>
          </div>
        )}

        {step === "results" && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <Tally
                tone="border-success/40 bg-success/10"
                count={result.created.length}
                label="Created"
              />
              <Tally
                tone="border-warning/40 bg-warning/10"
                count={result.duplicates.length}
                label="Duplicates skipped"
              />
              <Tally
                tone="border-destructive/40 bg-destructive/10"
                count={result.failed.length}
                label="Failed"
              />
            </div>
            {(result.duplicates.length > 0 || result.failed.length > 0) && (
              <ScrollArea className="h-56 rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 text-left text-muted-foreground backdrop-blur">
                    <tr>
                      {["Row", "Outcome", "Reason"].map((h) => (
                        <th key={h} className="px-2 py-1.5 font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ...result.failed.map((r) => ({ ...r, outcome: "Failed" })),
                      ...result.duplicates.map((r) => ({ ...r, outcome: "Duplicate" })),
                    ].map((r) => (
                      <tr key={`${r.outcome}-${r.rowNumber}`} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                        <td
                          className={`px-2 py-1.5 ${r.outcome === "Failed" ? "text-destructive" : "text-warning-foreground"}`}
                        >
                          {r.outcome}
                        </td>
                        <td className="px-2 py-1.5">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>
        )}

        <DialogFooter>
          {step === "select" && (
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          )}
          {step === "preview" && (
            <>
              <Button variant="ghost" onClick={reset}>
                Back
              </Button>
              <Button disabled={importRows.isPending} onClick={() => void submit()}>
                {importRows.isPending
                  ? "Importing…"
                  : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
          {step === "results" && <Button onClick={close}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Notice({ tone, children }: { tone: "error" | "warning"; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === "error"
          ? "flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          : "flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs"
      }
    >
      <AlertTriangle className="size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function Tally({ tone, count, label }: { tone: string; count: number; label: string }) {
  return (
    <div className={`rounded-md border p-3 ${tone}`}>
      <div className="text-lg font-semibold">{count}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
