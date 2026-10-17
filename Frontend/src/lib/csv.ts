import Papa from "papaparse";

/** Saves rows (first row = header) as a CSV file in the browser. */
export function downloadCsv(filename: string, rows: unknown[][]) {
  const url = URL.createObjectURL(
    new Blob([Papa.unparse(rows)], { type: "text/csv;charset=utf-8;" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
