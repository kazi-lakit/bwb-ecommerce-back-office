/**
 * A small, correct CSV reader/writer (RFC 4180).
 *
 * Written rather than pulled in: the whole need is one encoder and one parser, and the
 * failure modes that matter here are the ones a naive `split(",")` gets wrong — quoted fields
 * containing commas, embedded newlines, and doubled quotes. Those are handled below and
 * covered by the verification suite.
 */

/** Fields needing quotes: separators, quotes, newlines, or leading/trailing spaces. */
function needsQuoting(value: string): boolean {
  return /[",\r\n]/.test(value) || value !== value.trim();
}

function encodeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  // Composite and array fields have no flat representation, so they travel as JSON in one
  // cell. Round-trips exactly, and is the only lossless option short of inventing a nested
  // column convention that spreadsheets would mangle anyway.
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return needsQuoting(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const lines = [columns.map(encodeCell).join(",")];
  for (const row of rows) lines.push(columns.map((column) => encodeCell(row[column])).join(","));
  // CRLF per the spec — it's what Excel expects, and every other reader accepts it.
  return lines.join("\r\n");
}

export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Parses CSV into rows keyed by header.
 *
 * Character-by-character rather than line-by-line, because a quoted field may contain the
 * line separator — splitting on newlines first corrupts exactly the data most likely to need
 * quoting (descriptions, addresses).
 */
export function parseCsv(text: string): ParsedCsv {
  const stripped = text.replace(/^﻿/, ""); // Excel writes a BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    // A trailing newline shouldn't produce a final empty row.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  };

  while (i < stripped.length) {
    const char = stripped[i];

    if (inQuotes) {
      if (char === '"') {
        if (stripped[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endCell();
      i += 1;
      continue;
    }
    if (char === "\r") {
      // Consume CRLF as one break.
      if (stripped[i + 1] === "\n") i += 1;
      endRow();
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }
    cell += char;
    i += 1;
  }
  if (cell !== "" || row.length > 0) endRow();

  const [headers = [], ...body] = rows;
  return {
    headers,
    rows: body.map((cells) => {
      const record: Record<string, string> = {};
      headers.forEach((header, index) => {
        record[header] = cells[index] ?? "";
      });
      return record;
    }),
  };
}

/** Hands the browser a file. Real download, unlike a sandboxed preview — this is the app. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
