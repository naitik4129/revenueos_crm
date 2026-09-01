import Papa from "papaparse";
import { LEAD_SOURCES, type LeadSource } from "@/types";

export const CANONICAL_FIELDS = [
  "firstName",
  "lastName",
  "company",
  "jobTitle",
  "industry",
  "email",
  "phone",
  "source",
  "serviceInterest",
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

const REQUIRED_FIELDS: CanonicalField[] = ["firstName", "company", "source"];

const HEADER_ALIASES: Record<CanonicalField, string[]> = {
  firstName: ["first name", "firstname", "fname", "given name"],
  lastName: ["last name", "lastname", "lname", "surname"],
  company: ["company", "company name", "organization", "organisation"],
  jobTitle: ["job title", "jobtitle", "title", "designation", "position"],
  industry: ["industry"],
  email: ["email", "email address", "e mail"],
  phone: ["phone", "phone number", "mobile", "mobile number", "contact number", "whatsapp"],
  source: ["source", "lead source"],
  serviceInterest: ["service interest", "interest", "service", "service of interest"],
};

const SAMPLE_HEADERS = [
  "First Name",
  "Last Name",
  "Company",
  "Job Title",
  "Industry",
  "Email",
  "Phone",
  "Source",
  "Service Interest",
];
const SAMPLE_ROW = [
  "Ada",
  "Lovelace",
  "Analytical Engines Ltd",
  "Head of Engineering",
  "Technology",
  "ada@example.com",
  "+91 98765 43210",
  "website",
  "B2B Lead Generation",
];

const BOM_CHAR = String.fromCharCode(0xfeff);

/** Case/whitespace/underscore/BOM-insensitive header key, so "First Name", "first_name" and "FIRST NAME" all resolve the same way. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(BOM_CHAR, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const ALIAS_TO_FIELD = new Map<string, CanonicalField>(
  CANONICAL_FIELDS.flatMap((field) => [
    [normalizeHeader(field), field] as const,
    ...HEADER_ALIASES[field].map((alias) => [normalizeHeader(alias), field] as const),
  ]),
);

export interface HeaderMapResult {
  columnToField: Map<number, CanonicalField>;
  unmatchedHeaders: string[];
  duplicateHeaders: string[];
  missingRequired: CanonicalField[];
  hasEmailOrPhone: boolean;
}

/** Maps CSV columns to canonical fields by NAME, never by position — column order in the file is irrelevant. */
export function buildHeaderMap(rawHeaders: string[]): HeaderMapResult {
  const columnToField = new Map<number, CanonicalField>();
  const seen = new Set<CanonicalField>();
  const unmatchedHeaders: string[] = [];
  const duplicateHeaders: string[] = [];

  rawHeaders.forEach((raw, i) => {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(raw));
    if (!field) {
      if (raw.trim()) unmatchedHeaders.push(raw);
      return;
    }
    if (seen.has(field)) {
      duplicateHeaders.push(raw);
      return;
    }
    seen.add(field);
    columnToField.set(i, field);
  });

  return {
    columnToField,
    unmatchedHeaders,
    duplicateHeaders,
    missingRequired: REQUIRED_FIELDS.filter((f) => !seen.has(f)),
    hasEmailOrPhone: seen.has("email") || seen.has("phone"),
  };
}

export function normalizeSourceValue(raw: string): LeadSource | null {
  const norm = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return (LEAD_SOURCES as readonly string[]).includes(norm) ? (norm as LeadSource) : null;
}

export interface ParsedCsv {
  headerMap: HeaderMapResult;
  dataRows: { rowNumber: number; cells: string[] }[];
}

/**
 * Parses raw CSV text with header:false so duplicate-header detection stays
 * under our own control (Papa auto-renames duplicate headers when
 * header:true, which would hide them from the user). Papa.parse handles
 * quoted fields, embedded commas/newlines, a leading BOM, and mixed
 * line-endings on its own.
 */
export function parseCsvText(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text, { skipEmptyLines: false });
  const [rawHeaderRow, ...rest] = result.data;
  const headerMap = buildHeaderMap(rawHeaderRow ?? []);
  const dataRows = rest
    .map((cells, i) => ({ rowNumber: i + 2, cells: cells.map((c) => (c ?? "").trim()) }))
    .filter((r) => r.cells.some((c) => c !== ""));
  return { headerMap, dataRows };
}

export interface MappedRow {
  rowNumber: number;
  firstName: string;
  lastName?: string | undefined;
  company: string;
  jobTitle?: string | undefined;
  industry?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  source: string;
  serviceInterest?: string | undefined;
}

export function mapRow(
  columnToField: Map<number, CanonicalField>,
  cells: string[],
  rowNumber: number,
): MappedRow {
  const out: Partial<Record<CanonicalField, string>> = {};
  columnToField.forEach((field, columnIndex) => {
    out[field] = cells[columnIndex] ?? "";
  });
  return {
    rowNumber,
    firstName: out.firstName ?? "",
    lastName: out.lastName,
    company: out.company ?? "",
    jobTitle: out.jobTitle,
    industry: out.industry,
    email: out.email,
    phone: out.phone,
    source: out.source ?? "",
    serviceInterest: out.serviceInterest,
  };
}

/** Client-side-only, non-authoritative preview check for instant feedback. The backend re-validates every row for real before creating anything. */
export function previewValidate(row: MappedRow): string | null {
  if (!row.firstName.trim()) return "First name is required.";
  if (!row.company.trim()) return "Company is required.";
  if (!row.email?.trim() && !row.phone?.trim()) return "Needs an email or a phone number.";
  if (!row.source.trim() || !normalizeSourceValue(row.source))
    return `Unknown source "${row.source}".`;
  return null;
}

export function generateSampleCsv(): string {
  return Papa.unparse({ fields: SAMPLE_HEADERS, data: [SAMPLE_ROW] });
}

export function downloadSampleCsv() {
  const blob = new Blob([generateSampleCsv()], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "leads-import-sample.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const MAX_IMPORT_ROWS = 2000;
