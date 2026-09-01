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
import { messageFromError, useLeads } from "@/store";
import type { ImportLeadsResult } from "@/lib/backend-client";
import {
  downloadSampleCsv,
  MAX_IMPORT_ROWS,
  mapRow,
  parseCsvText,
  previewValidate,
  type MappedRow,
} from "./csv-import-utils";

type Step = "select" | "preview" | "results";

const PREVIEW_LIMIT = 50;

export function ImportLeadsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { importLeadsCsv, isPending } = useLeads();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("select");
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [headerWarnings, setHeaderWarnings] = useState<{
    unmatched: string[];
    duplicates: string[];
  }>({
    unmatched: [],
    duplicates: [],
  });
  const [mappedRows, setMappedRows] = useState<MappedRow[]>([]);
  const [result, setResult] = useState<ImportLeadsResult | null>(null);

  const reset = () => {
    setStep("select");
    setFileName("");
    setParseError(null);
    setHeaderWarnings({ unmatched: [], duplicates: [] });
    setMappedRows([]);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const close = () => {
    onOpenChange(false);
    reset();
  };

  async function onFileChange(file: File) {
    setParseError(null);

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setParseError("Please choose a .csv file.");
      return;
    }

    const text = await file.text();
    if (!text.trim()) {
      setParseError("The selected file is empty.");
      return;
    }

    const { headerMap, dataRows } = parseCsvText(text);

    if (headerMap.missingRequired.length > 0) {
      setParseError(`Missing required column(s): ${headerMap.missingRequired.join(", ")}.`);
      return;
    }
    if (!headerMap.hasEmailOrPhone) {
      setParseError("The CSV must include an Email or Phone column.");
      return;
    }
    if (dataRows.length === 0) {
      setParseError("The CSV has a header row but no data rows.");
      return;
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
      setParseError(
        `This file has ${dataRows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}. Split the file and import in batches.`,
      );
      return;
    }

    setFileName(file.name);
    setHeaderWarnings({
      unmatched: headerMap.unmatchedHeaders,
      duplicates: headerMap.duplicateHeaders,
    });
    setMappedRows(dataRows.map((r) => mapRow(headerMap.columnToField, r.cells, r.rowNumber)));
    setStep("preview");
  }

  const invalidCount = mappedRows.filter((r) => previewValidate(r) !== null).length;
  const validCount = mappedRows.length - invalidCount;

  async function submit() {
    try {
      const { data } = await importLeadsCsv(
        mappedRows.map((r) => ({
          rowNumber: r.rowNumber,
          firstName: r.firstName,
          lastName: r.lastName,
          company: r.company,
          jobTitle: r.jobTitle,
          industry: r.industry,
          email: r.email,
          phone: r.phone,
          source: r.source,
          serviceInterest: r.serviceInterest,
        })),
      );
      setResult(data);
      setStep("results");
      toast.success(`Imported ${data.created.length} of ${data.totalRows} rows.`);
    } catch (error) {
      toast.error(messageFromError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(v) : close())}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Columns are matched by name, not position — order doesn't matter. Required: First Name,
            Company, Source, and either Email or Phone.
          </DialogDescription>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-md border border-dashed p-4">
              <div className="text-sm text-muted-foreground">
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
            </div>

            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="block w-full text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary-foreground hover:file:opacity-90"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void onFileChange(file);
                }}
              />
            </div>

            {parseError && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" />
                {parseError}
              </div>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">{mappedRows.length}</span> data row
              {mappedRows.length === 1 ? "" : "s"} found in{" "}
              <span className="font-medium">{fileName}</span>
              {invalidCount > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  — {validCount} look valid, {invalidCount} will likely fail (checked again on
                  import).
                </span>
              )}
            </div>

            {headerWarnings.unmatched.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                <span>
                  Unrecognized column{headerWarnings.unmatched.length === 1 ? "" : "s"} (ignored):{" "}
                  {headerWarnings.unmatched.join(", ")}
                </span>
              </div>
            )}
            {headerWarnings.duplicates.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                <span>
                  Duplicate column header{headerWarnings.duplicates.length === 1 ? "" : "s"} (first
                  occurrence used): {headerWarnings.duplicates.join(", ")}
                </span>
              </div>
            )}

            <ScrollArea className="h-72 rounded-md border">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/90 text-left text-muted-foreground backdrop-blur">
                  <tr>
                    {["Row", "Name", "Company", "Email / Phone", "Source", "Status"].map((h) => (
                      <th key={h} className="px-2 py-1.5 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows.slice(0, PREVIEW_LIMIT).map((row) => {
                    const error = previewValidate(row);
                    return (
                      <tr key={row.rowNumber} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{row.rowNumber}</td>
                        <td className="px-2 py-1.5">
                          {row.firstName} {row.lastName ?? ""}
                        </td>
                        <td className="px-2 py-1.5">{row.company}</td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.email || row.phone || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">{row.source || "—"}</td>
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
              {mappedRows.length > PREVIEW_LIMIT && (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Showing the first {PREVIEW_LIMIT} of {mappedRows.length} rows.
                </p>
              )}
            </ScrollArea>
          </div>
        )}

        {step === "results" && result && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div className="rounded-md border border-success/40 bg-success/10 p-3">
                <div className="text-lg font-semibold">{result.created.length}</div>
                <div className="text-xs text-muted-foreground">Created</div>
              </div>
              <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
                <div className="text-lg font-semibold">{result.duplicates.length}</div>
                <div className="text-xs text-muted-foreground">Duplicates skipped</div>
              </div>
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3">
                <div className="text-lg font-semibold">{result.failed.length}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>

            {(result.duplicates.length > 0 || result.failed.length > 0) && (
              <ScrollArea className="h-56 rounded-md border">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted/90 text-left text-muted-foreground backdrop-blur">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Row</th>
                      <th className="px-2 py-1.5 font-medium">Outcome</th>
                      <th className="px-2 py-1.5 font-medium">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.failed.map((r) => (
                      <tr key={`f-${r.rowNumber}`} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-2 py-1.5 text-destructive">Failed</td>
                        <td className="px-2 py-1.5">{r.reason}</td>
                      </tr>
                    ))}
                    {result.duplicates.map((r) => (
                      <tr key={`d-${r.rowNumber}`} className="border-t">
                        <td className="px-2 py-1.5 text-muted-foreground">{r.rowNumber}</td>
                        <td className="px-2 py-1.5 text-warning-foreground">Duplicate</td>
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
              <Button variant="ghost" onClick={() => setStep("select")}>
                Back
              </Button>
              <Button disabled={isPending} onClick={() => void submit()}>
                {isPending
                  ? "Importing…"
                  : `Import ${mappedRows.length} row${mappedRows.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
          {step === "results" && <Button onClick={close}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
