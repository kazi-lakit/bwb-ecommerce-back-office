import { createEntityApi, type EntityListParams } from "./collections";
import { isComplexFieldType, type EntityMeta } from "./schema-meta";
import { toCsv, parseCsv, type ParsedCsv } from "@/lib/csv";

/**
 * Bulk export and import for any entity schema.
 *
 * Export writes every field the schema knows about plus `ItemId`, and import uses `ItemId` to
 * decide update-versus-create — so an exported file edited in a spreadsheet and imported back
 * updates the same records rather than duplicating the catalog. That round trip is the point;
 * an export you can't safely re-import is a report, not a bulk edit tool.
 */

const SYSTEM_COLUMNS = ["ItemId", "CreatedDate", "LastUpdatedDate", "CreatedBy", "LastUpdatedBy"];
/** A ceiling on one export, so a mistaken click can't try to pull an unbounded collection. */
const MAX_EXPORT_ROWS = 5000;
const EXPORT_PAGE_SIZE = 200;

export function exportColumns(meta: EntityMeta): string[] {
  // ItemId first: it's what makes a re-import an update. The other system columns are
  // included for context but ignored on the way back in — see csvRowToPayload.
  return ["ItemId", ...meta.fields.map((f) => f.name), "CreatedDate", "LastUpdatedDate"];
}

export type BulkFormat = "csv" | "json";

export interface ExportResult {
  content: string;
  filename: string;
  mimeType: string;
  rowCount: number;
  totalCount: number;
  /** True when the collection is larger than the export ceiling. */
  truncated: boolean;
}

/**
 * Same rows, shaped as a JSON array instead of CSV text. Unlike a CSV cell, a JSON array/
 * object field needs no cell-embedded-string workaround — composite and array fields
 * (Pricing, Media, Tags, …) come out as real nested JSON, not a JSON string inside a string.
 * Every row gets exactly `columns`, in that order, with a missing value written as `null`
 * rather than omitted — so a hand-edited re-import sees every field explicitly and an
 * accidentally-deleted key isn't silently indistinguishable from "was never set".
 */
function toJson(rows: Record<string, unknown>[], columns: string[]): string {
  const picked = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const column of columns) out[column] = row[column] ?? null;
    return out;
  });
  return JSON.stringify(picked, null, 2);
}

export async function exportEntity(
  meta: EntityMeta,
  where: EntityListParams["where"],
  format: BulkFormat = "csv"
): Promise<ExportResult> {
  const api = createEntityApi(meta.schemaName);
  const rows: Record<string, unknown>[] = [];
  let totalCount = 0;

  for (let pageNo = 1; rows.length < MAX_EXPORT_ROWS; pageNo += 1) {
    const page = await api.list({ pageNo, pageSize: EXPORT_PAGE_SIZE, where });
    totalCount = page.totalCount;
    rows.push(...page.items);
    if (page.items.length === 0 || rows.length >= page.totalCount) break;
  }

  const columns = exportColumns(meta);
  const datestamp = new Date().toISOString().slice(0, 10);
  return {
    content: format === "json" ? toJson(rows, columns) : toCsv(rows, columns),
    filename: `${meta.schemaName}-${datestamp}.${format}`,
    mimeType: format === "json" ? "application/json;charset=utf-8;" : "text/csv;charset=utf-8;",
    rowCount: rows.length,
    totalCount,
    truncated: totalCount > rows.length,
  };
}

export interface RowResult {
  /** 1-based, counting the header as line 1, so it matches what a spreadsheet shows. */
  line: number;
  itemId?: string;
  payload: Record<string, unknown>;
  errors: string[];
}

function coerce(
  value: string,
  field: { name: string; type: string; isArray: boolean }
): { value?: unknown; error?: string } {
  const text = value.trim();

  if (field.isArray || isComplexFieldType(field.type)) {
    try {
      return { value: JSON.parse(value) };
    } catch {
      return { error: `${field.name}: expected JSON (as exported), got ${JSON.stringify(value.slice(0, 30))}` };
    }
  }

  switch (field.type) {
    case "Int":
    case "Float": {
      const n = Number(text);
      if (!Number.isFinite(n)) return { error: `${field.name}: "${text}" isn't a number` };
      if (field.type === "Int" && !Number.isInteger(n)) return { error: `${field.name}: "${text}" isn't a whole number` };
      return { value: n };
    }
    case "Boolean": {
      const truthy = ["true", "yes", "1"];
      const falsy = ["false", "no", "0"];
      const lower = text.toLowerCase();
      if (truthy.includes(lower)) return { value: true };
      if (falsy.includes(lower)) return { value: false };
      return { error: `${field.name}: "${text}" isn't true/false` };
    }
    case "DateTime": {
      if (Number.isNaN(Date.parse(text))) return { error: `${field.name}: "${text}" isn't a date` };
      return { value: new Date(text).toISOString() };
    }
    default:
      // Strings keep whatever the cell held, untrimmed — a SKU with a stray space is a
      // different SKU, and silently fixing it hides the data problem instead of showing it.
      return { value };
  }
}

/**
 * Turns one CSV row into a mutation payload.
 *
 * **An empty cell is skipped, not sent as empty.** A spreadsheet export opened, edited in one
 * column and saved back will have blanks wherever the editor's tooling dropped something, and
 * treating those as "set this field to nothing" would silently wipe data the person never
 * touched. Clearing a field deliberately is therefore not expressible here — the right trade,
 * since the destructive reading of an ambiguous blank is the one you can't undo.
 */
export function csvRowToPayload(meta: EntityMeta, row: Record<string, string>, line: number): RowResult {
  const payload: Record<string, unknown> = {};
  const errors: string[] = [];
  const known = new Set(meta.fields.map((f) => f.name));

  for (const [column, raw] of Object.entries(row)) {
    if (SYSTEM_COLUMNS.includes(column)) continue;
    if (!known.has(column)) {
      errors.push(`unknown column "${column}"`);
      continue;
    }
    if (raw === "") continue;
    const field = meta.fields.find((f) => f.name === column)!;
    const { value, error } = coerce(raw, field);
    if (error) errors.push(error);
    else payload[column] = value;
  }

  for (const field of meta.fields) {
    if (field.required && payload[field.name] === undefined && !row.ItemId) {
      errors.push(`${field.name} is required`);
    }
  }

  return { line, itemId: row.ItemId || undefined, payload, errors };
}

export function parseRows(meta: EntityMeta, parsed: ParsedCsv): RowResult[] {
  return parsed.rows.map((row, i) => csvRowToPayload(meta, row, i + 2));
}

/**
 * The JSON counterpart to `coerce` above. A JSON export already carries real types — a
 * number is a JSON number, a composite/array field is real JSON, not a string to re-parse —
 * so this mostly validates rather than converts. It still accepts the string forms `coerce`
 * does (a hand-edited `"42"` for an Int, `"true"` for a Boolean, …), since a JSON file is just
 * as editable by hand as a CSV one and shouldn't be stricter about it.
 */
function coerceJson(
  value: unknown,
  field: { name: string; type: string; isArray: boolean }
): { value?: unknown; error?: string } {
  if (field.isArray || isComplexFieldType(field.type)) {
    // Already real JSON (an array or an object) — nothing to parse, unlike a CSV cell.
    return { value };
  }

  switch (field.type) {
    case "Int":
    case "Float": {
      const n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) return { error: `${field.name}: ${JSON.stringify(value)} isn't a number` };
      if (field.type === "Int" && !Number.isInteger(n)) return { error: `${field.name}: ${JSON.stringify(value)} isn't a whole number` };
      return { value: n };
    }
    case "Boolean": {
      if (typeof value === "boolean") return { value };
      const lower = String(value).trim().toLowerCase();
      if (["true", "yes", "1"].includes(lower)) return { value: true };
      if (["false", "no", "0"].includes(lower)) return { value: false };
      return { error: `${field.name}: ${JSON.stringify(value)} isn't true/false` };
    }
    case "DateTime": {
      const text = String(value);
      if (Number.isNaN(Date.parse(text))) return { error: `${field.name}: ${JSON.stringify(value)} isn't a date` };
      return { value: new Date(text).toISOString() };
    }
    default:
      // Same "don't quietly rewrite what's there" rule as the CSV path: a real JSON string
      // is kept exactly as written; anything else for a String field is called out rather
      // than silently stringified, since that usually means the wrong column.
      if (typeof value === "string") return { value };
      return { error: `${field.name}: expected a string, got ${JSON.stringify(value)}` };
  }
}

/**
 * The JSON counterpart to `csvRowToPayload` — same rules (empty/missing means "don't touch
 * this field", unknown columns are reported not dropped, required fields only matter on
 * create), just reading a plain object instead of a CSV row of strings. `null` is treated
 * the same as an omitted key: a hand-edited re-import of an exported row (which writes
 * `null` for anything unset, see `toJson`) must not turn that into "clear this field".
 */
export function jsonRowToPayload(meta: EntityMeta, row: Record<string, unknown>, line: number): RowResult {
  const payload: Record<string, unknown> = {};
  const errors: string[] = [];
  const known = new Set(meta.fields.map((f) => f.name));

  for (const [column, raw] of Object.entries(row)) {
    if (SYSTEM_COLUMNS.includes(column)) continue;
    if (!known.has(column)) {
      errors.push(`unknown column "${column}"`);
      continue;
    }
    if (raw === null || raw === undefined || raw === "") continue;
    const field = meta.fields.find((f) => f.name === column)!;
    const { value, error } = coerceJson(raw, field);
    if (error) errors.push(error);
    else payload[column] = value;
  }

  for (const field of meta.fields) {
    if (field.required && payload[field.name] === undefined && !row.ItemId) {
      errors.push(`${field.name} is required`);
    }
  }

  const itemId = typeof row.ItemId === "string" && row.ItemId ? row.ItemId : undefined;
  return { line, itemId, payload, errors };
}

/**
 * Parses a JSON import file — an array of row objects, the same shape `exportEntity`
 * writes (see `toJson`). `line` numbers the array position (1-based); there's no header row
 * to offset by the way a spreadsheet's line 1 is its header.
 */
export function parseJsonRows(meta: EntityMeta, text: string): RowResult[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(data)) {
    throw new Error("Expected a JSON array of records, the same shape a JSON export writes.");
  }

  return data.map((row, i) => {
    const line = i + 1;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      return { line, payload: {}, errors: [`entry ${line} isn't an object`] };
    }
    return jsonRowToPayload(meta, row as Record<string, unknown>, line);
  });
}

/** One entry point for the panel — reads a CSV or JSON import file by the format the user picked. */
export function parseImportFile(meta: EntityMeta, format: BulkFormat, text: string): RowResult[] {
  return format === "json" ? parseJsonRows(meta, text) : parseRows(meta, parseCsv(text));
}

export interface ImportOutcome {
  created: number;
  updated: number;
  failed: { line: number; message: string }[];
}

/**
 * Applies the rows, one write at a time.
 *
 * There is no batch mutation and no transaction, so a failure partway leaves earlier rows
 * applied. That's reported per line rather than hidden behind a single "import failed" —
 * knowing row 34 is the one that broke, and that 1–33 landed, is the difference between
 * fixing a cell and re-importing blind.
 */
export async function applyRows(meta: EntityMeta, rows: RowResult[]): Promise<ImportOutcome> {
  const api = createEntityApi(meta.schemaName);
  const outcome: ImportOutcome = { created: 0, updated: 0, failed: [] };

  for (const row of rows) {
    if (row.errors.length > 0) {
      outcome.failed.push({ line: row.line, message: row.errors.join("; ") });
      continue;
    }
    try {
      if (row.itemId) {
        await api.update(row.itemId, row.payload);
        outcome.updated += 1;
      } else {
        await api.create(row.payload);
        outcome.created += 1;
      }
    } catch (error) {
      outcome.failed.push({ line: row.line, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return outcome;
}
