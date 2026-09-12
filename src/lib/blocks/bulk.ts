import { createEntityApi, type EntityListParams } from "./collections";
import { isComplexFieldType, type EntityMeta } from "./schema-meta";
import { toCsv, type ParsedCsv } from "@/lib/csv";

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

export interface ExportResult {
  csv: string;
  rowCount: number;
  totalCount: number;
  /** True when the collection is larger than the export ceiling. */
  truncated: boolean;
}

export async function exportEntity(
  meta: EntityMeta,
  where: EntityListParams["where"]
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

  return {
    csv: toCsv(rows, exportColumns(meta)),
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
