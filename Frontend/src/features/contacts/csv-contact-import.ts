import Papa from "papaparse";
import type { ImportContactRow } from "@/lib/backend-client";
import { validateContact } from "@/lib/contact-validation";
import { CONTACT_SOURCES } from "@/types";

export const MAX_IMPORT_ROWS = 2000;

const BOM_CHAR = String.fromCharCode(0xfeff);
/** "First Name", "first_name" and "FIRST NAME" all become "first name". */
function normalizeHeader(raw: string): string {
  return raw
    .replace(BOM_CHAR, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Columns are matched by name (any case, spaces or underscores), never by position. */
const FIELDS = {
  firstName: ["first name", "firstname", "fname", "given name"],
  lastName: ["last name", "lastname", "lname", "surname"],
  jobTitle: ["job title", "jobtitle", "title", "designation", "position"],
  email: ["email", "email address", "e mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "whatsapp"],
  linkedinUrl: ["linkedin", "linkedin url", "linkedinurl", "linkedin profile"],
  country: ["country"],
  location: ["location", "city"],
  source: ["source", "lead source"],
  company: ["company", "company name", "organization", "organisation"],
  website: ["website", "company website", "domain"],
  industry: ["industry"],
  createDeal: ["create deal", "createdeal", "deal"],
  dealTitle: ["deal title", "dealtitle", "service interest"],
} as const;
type Field = keyof typeof FIELDS;

const ALIAS_TO_FIELD = new Map<string, Field>(
  (Object.keys(FIELDS) as Field[]).flatMap((field) =>
    [field, ...FIELDS[field]].map((alias) => [normalizeHeader(alias), field] as const),
  ),
);

export interface ParsedContactsCsv {
  rows: ImportContactRow[];
  unmatchedHeaders: string[];
  duplicateHeaders: string[];
  /** Whole-file problem (missing columns, no rows, too many rows); null when importable. */
  error: string | null;
}

export function parseContactsCsv(text: string): ParsedContactsCsv {
  const [headers = [], ...rest] = Papa.parse<string[]>(text, { skipEmptyLines: false }).data;
  const columnToField = new Map<number, Field>();
  const seen = new Set<Field>();
  const unmatchedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];
  headers.forEach((raw, i) => {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(raw));
    if (!field) {
      if (raw.trim()) unmatchedHeaders.push(raw);
    } else if (seen.has(field)) duplicateHeaders.push(raw);
    else {
      seen.add(field);
      columnToField.set(i, field);
    }
  });

  const rows = rest
    .map((cells, i) => ({ rowNumber: i + 2, cells: cells.map((c) => (c ?? "").trim()) }))
    .filter((r) => r.cells.some(Boolean))
    .map(({ rowNumber, cells }) => {
      const row: ImportContactRow = { rowNumber, firstName: "" };
      columnToField.forEach((field, column) => {
        const value = cells[column];
        // "Cold Call" -> cold_call, the form the backend checks.
        if (value)
          row[field] = field === "source" ? value.toLowerCase().replace(/[\s-]+/g, "_") : value;
      });
      return row;
    });

  let error: string | null = null;
  if (!seen.has("firstName")) error = "Missing required column: First Name.";
  else if (!seen.has("email") && !seen.has("phone") && !seen.has("linkedinUrl"))
    error = "The CSV needs an Email, Phone or LinkedIn column.";
  else if (rows.length === 0) error = "The CSV has a header row but no data rows.";
  else if (rows.length > MAX_IMPORT_ROWS)
    error = `This file has ${rows.length} rows; the maximum per import is ${MAX_IMPORT_ROWS}. Split it and import in batches.`;
  return { rows, unmatchedHeaders, duplicateHeaders, error };
}

/** Instant preview check only; the backend validates every row again. */
export function previewRowError(row: ImportContactRow): string | null {
  const errors = validateContact(row);
  const first = errors.firstName ?? errors.email ?? errors.phone;
  if (first) return first;
  if (row.source && !(CONTACT_SOURCES as readonly string[]).includes(row.source))
    return `Unknown source "${row.source}".`;
  return null;
}

/** Same rule as the backend's rowWantsDeal: yes/y/true/1, or any deal title. */
export function rowWantsDeal(row: ImportContactRow) {
  return (
    ["yes", "y", "true", "1"].includes(row.createDeal?.toLowerCase() ?? "") ||
    Boolean(row.dealTitle)
  );
}

const SAMPLE = {
  fields: [
    "First Name",
    "Last Name",
    "Email",
    "Phone",
    "LinkedIn",
    "Job Title",
    "Company",
    "Website",
    "Industry",
    "Country",
    "Source",
    "Create Deal",
    "Deal Title",
  ],
  data: [
    [
      "Ada",
      "Lovelace",
      "ada@example.com",
      "+91 98765 43210",
      "",
      "Head of Engineering",
      "Analytical Engines",
      "analytical.example",
      "Technology",
      "India",
      "referral",
      "yes",
      "Lead generation",
    ],
    [
      "Alan",
      "Turing",
      "",
      "",
      "https://www.linkedin.com/in/example",
      "CTO",
      "Bletchley Labs",
      "",
      "Software",
      "UK",
      "linkedin",
      "",
      "",
    ],
  ],
};

export function downloadSampleCsv() {
  const url = URL.createObjectURL(
    new Blob([Papa.unparse(SAMPLE)], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "contacts-import-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
