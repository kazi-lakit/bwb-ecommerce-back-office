import { createEntityApi, getEntityMeta, runBatchList, runBatchUpdate, type EntityListParams } from "./collections";
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
/** Batched creates (`insertMany`) and batched updates (aliased mutations) are each split into
 * chunks this large, so one import of thousands of rows doesn't try to send them all as a
 * single oversized request. */
const BATCH_WRITE_SIZE = 50;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Product's real fields, plus one synthetic column carrying its variants (and each
 * variant's optional per-warehouse stock) — see `VARIANT_FIELDS`/`applyRows` below. Not a
 * real Product field on the Data Gateway; assembled/consumed only by this module. */
const VARIANTS_COLUMN = "Variants";

export function exportColumns(meta: EntityMeta): string[] {
  // ItemId first: it's what makes a re-import an update. The other system columns are
  // included for context but ignored on the way back in — see csvRowToPayload.
  const fieldColumns = meta.fields.map((f) => f.name);
  if (meta.schemaName === "Product") fieldColumns.push(VARIANTS_COLUMN);
  return ["ItemId", ...fieldColumns, "CreatedDate", "LastUpdatedDate"];
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

/** Pages through `schemaName` under `where` until exhausted (capped, like the main export
 * loop) — used for the side-fetches a Product export needs (its variants, their stock, the
 * warehouses to turn `WarehouseId` back into a portable `Code`). */
async function fetchAll(schemaName: string, where: EntityListParams["where"], cap = MAX_EXPORT_ROWS): Promise<Record<string, unknown>[]> {
  const api = createEntityApi(schemaName);
  const out: Record<string, unknown>[] = [];
  for (let pageNo = 1; out.length < cap; pageNo += 1) {
    const page = await api.list({ pageNo, pageSize: EXPORT_PAGE_SIZE, where });
    out.push(...page.items);
    if (page.items.length === 0 || out.length >= page.totalCount) break;
  }
  return out;
}

/**
 * Embeds each product's variants (and each variant's stock) into its row's `Variants`
 * column, in exactly the shape `parseVariantEntry`/`applyProductRows` expect back on
 * import — so exporting Products and re-importing the file unchanged is a no-op, not a
 * silent loss of the variant/stock data this module can now also write.
 */
async function embedProductVariants(rows: Record<string, unknown>[]): Promise<void> {
  const productIds = rows.map((r) => r.ItemId as string | undefined).filter((id): id is string => Boolean(id));
  if (productIds.length === 0) return;

  const variants = await fetchAll("ProductVariant", { ProductId: { in: productIds } });
  const variantIds = variants.map((v) => v.ItemId as string | undefined).filter((id): id is string => Boolean(id));

  // Stock and warehouses don't depend on each other, so — same optimization as the rest of
  // this codebase's reads — they go out as one aliased GraphQL request, not two round trips.
  let stock: Record<string, unknown>[] = [];
  let warehouses: Record<string, unknown>[] = [];
  if (variantIds.length > 0) {
    const batch = await runBatchList([
      { key: "stock", schemaName: "WarehouseInventory", params: { where: { VariantId: { in: variantIds } }, pageSize: MAX_EXPORT_ROWS } },
      { key: "warehouses", schemaName: "Warehouse", params: { pageSize: MAX_EXPORT_ROWS } },
    ]);
    stock = batch.stock.items;
    warehouses = batch.warehouses.items;
  }

  const warehouseCodeById = new Map(warehouses.map((w) => [w.ItemId as string, w.Code as string]));

  const stockByVariantId = new Map<string, Record<string, unknown>[]>();
  for (const s of stock) {
    const variantId = s.VariantId as string | undefined;
    if (!variantId) continue;
    const quantity = (s.Quantity as Record<string, unknown> | undefined) ?? {};
    const entry: Record<string, unknown> = { WarehouseCode: warehouseCodeById.get(s.WarehouseId as string) ?? s.WarehouseId, ...quantity };
    if (s.ReorderPoint !== undefined && s.ReorderPoint !== null) entry.ReorderPoint = s.ReorderPoint;
    if (s.ReorderQuantity !== undefined && s.ReorderQuantity !== null) entry.ReorderQuantity = s.ReorderQuantity;
    const list = stockByVariantId.get(variantId) ?? [];
    list.push(entry);
    stockByVariantId.set(variantId, list);
  }

  const variantsByProductId = new Map<string, Record<string, unknown>[]>();
  for (const v of variants) {
    const productId = v.ProductId as string | undefined;
    const variantId = v.ItemId as string | undefined;
    if (!productId || !variantId) continue;
    const { ItemId: _itemId, CreatedDate: _c, LastUpdatedDate: _u, CreatedBy: _cb, LastUpdatedBy: _ub, ...fields } = v;
    const list = variantsByProductId.get(productId) ?? [];
    list.push({ ...fields, Stock: stockByVariantId.get(variantId) ?? [] });
    variantsByProductId.set(productId, list);
  }

  for (const row of rows) {
    const id = row.ItemId as string | undefined;
    row[VARIANTS_COLUMN] = id ? variantsByProductId.get(id) ?? [] : [];
  }
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

  if (meta.schemaName === "Product" && rows.length > 0) await embedProductVariants(rows);

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

const STOCK_QUANTITY_FIELDS = [
  "OnHand", "Reserved", "Damaged", "QualityHold", "Incoming", "Blocked", "Backordered", "InTransit",
] as const;

export interface ImportedStockEntry {
  /** A `Warehouse.Code`, not an `ItemId` — the warehouse's real id doesn't exist in a
   * portable import file any more than a Product's own does; it's resolved at apply time. */
  warehouseCode: string;
  quantity: Partial<Record<(typeof STOCK_QUANTITY_FIELDS)[number], number>>;
  reorderPoint?: number;
  reorderQuantity?: number;
}

export interface ImportedVariant {
  sku: string;
  /** Every other `ProductVariant` field (Name, Pricing, Dimensions, …) except `ProductId`,
   * which is filled in once the parent product's real id is known — see `applyRows`. */
  payload: Record<string, unknown>;
  /** Empty when the row didn't provide stock — creating a variant with no stock rows is
   * entirely valid (this feature is "able to provide data", not "must provide data"). */
  stock: ImportedStockEntry[];
}

/**
 * One variant entry from a Product row's `Variants` column, validated against
 * `ProductVariant`'s real field list (everything but `ProductId`, which only exists once
 * this row's product is created) plus the `Stock` extension. Values are always run through
 * `coerceJson` here — by the time a CSV cell's `Variants` JSON has been `JSON.parse`d, its
 * contents are exactly as typed as a JSON import's ever were, so there's no separate
 * CSV-flavoured coercion needed at this level, only at the outer column.
 */
function parseVariantEntry(raw: unknown, index: number): { value?: ImportedVariant; errors: string[] } {
  const label = `Variants[${index}]`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { errors: [`${label}: expected an object`] };
  }
  const obj = raw as Record<string, unknown>;
  const sku = typeof obj.Sku === "string" ? obj.Sku.trim() : "";
  const errors: string[] = [];
  if (!sku) errors.push(`${label}: Sku is required`);

  const payload: Record<string, unknown> = {};
  const variantMeta = getEntityMeta("ProductVariant");
  for (const field of variantMeta.fields) {
    if (field.name === "ProductId" || field.name === "Sku") continue;
    const value = obj[field.name];
    if (value === undefined || value === null || value === "") continue;
    const { value: coerced, error } = coerceJson(value, field);
    if (error) errors.push(`${label} ${error}`);
    else payload[field.name] = coerced;
  }
  if (sku) payload.Sku = sku;

  const stock: ImportedStockEntry[] = [];
  const rawStock = obj[STOCK_COLUMN];
  if (rawStock !== undefined && rawStock !== null) {
    if (!Array.isArray(rawStock)) {
      errors.push(`${label}: ${STOCK_COLUMN} must be an array`);
    } else {
      rawStock.forEach((entry, si) => {
        const stockLabel = `${label}.${STOCK_COLUMN}[${si}]`;
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push(`${stockLabel}: expected an object`);
          return;
        }
        const so = entry as Record<string, unknown>;
        const warehouseCode = typeof so.WarehouseCode === "string" ? so.WarehouseCode.trim() : "";
        if (!warehouseCode) {
          errors.push(`${stockLabel}: WarehouseCode is required`);
          return;
        }
        const quantity: ImportedStockEntry["quantity"] = {};
        for (const qtyField of STOCK_QUANTITY_FIELDS) {
          const v = so[qtyField];
          if (v === undefined || v === null || v === "") continue;
          const n = typeof v === "number" ? v : Number(v);
          if (!Number.isFinite(n)) {
            errors.push(`${stockLabel}: ${qtyField} isn't a number`);
            continue;
          }
          quantity[qtyField] = n;
        }
        const reorderPoint = numberOrUndefined(so.ReorderPoint);
        const reorderQuantity = numberOrUndefined(so.ReorderQuantity);
        stock.push({ warehouseCode, quantity, reorderPoint, reorderQuantity });
      });
    }
  }

  return { value: sku ? { sku, payload, stock } : undefined, errors };
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

const STOCK_COLUMN = "Stock";

/** Parses a Product row's whole `Variants` array (already-real JSON by the time this runs —
 * see `parseVariantEntry`). */
function parseVariants(raw: unknown): { variants: ImportedVariant[]; errors: string[] } {
  if (!Array.isArray(raw)) return { variants: [], errors: [`${VARIANTS_COLUMN}: expected an array`] };
  const variants: ImportedVariant[] = [];
  const errors: string[] = [];
  raw.forEach((entry, i) => {
    const { value, errors: entryErrors } = parseVariantEntry(entry, i);
    if (value) variants.push(value);
    errors.push(...entryErrors);
  });
  return { variants, errors };
}

export interface RowResult {
  /** 1-based, counting the header as line 1, so it matches what a spreadsheet shows. */
  line: number;
  itemId?: string;
  payload: Record<string, unknown>;
  errors: string[];
  /** Only ever set for a `Product` row whose `Variants` column had at least one entry. */
  variants?: ImportedVariant[];
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
  let variants: ImportedVariant[] | undefined;

  for (const [column, raw] of Object.entries(row)) {
    if (SYSTEM_COLUMNS.includes(column)) continue;
    if (meta.schemaName === "Product" && column === VARIANTS_COLUMN) {
      if (raw === "") continue;
      try {
        const parsed: unknown = JSON.parse(raw);
        const result = parseVariants(parsed);
        if (result.variants.length > 0) variants = result.variants;
        errors.push(...result.errors);
      } catch {
        errors.push(`${VARIANTS_COLUMN}: expected JSON (as exported), got ${JSON.stringify(raw.slice(0, 30))}`);
      }
      continue;
    }
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

  return { line, itemId: row.ItemId || undefined, payload, errors, variants };
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
  let variants: ImportedVariant[] | undefined;

  for (const [column, raw] of Object.entries(row)) {
    if (SYSTEM_COLUMNS.includes(column)) continue;
    if (meta.schemaName === "Product" && column === VARIANTS_COLUMN) {
      if (raw === null || raw === undefined) continue;
      const result = parseVariants(raw);
      if (result.variants.length > 0) variants = result.variants;
      errors.push(...result.errors);
      continue;
    }
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
  return { line, itemId, payload, errors, variants };
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
  /** Only meaningful for a `Product` import that actually carried a `Variants` column. */
  variantsCreated?: number;
  variantsUpdated?: number;
  stockWritten?: number;
}

/**
 * Applies the rows in batches, not one write at a time — new rows go in via `insertMany`
 * (one native bulk-insert mutation), and rows carrying an `ItemId` (an update) go in via
 * `runBatchUpdate` (N `update<Schema>` mutations aliased into one GraphQL request, since
 * there's no `insertMany`-equivalent for "N rows, N different payloads"). Both are chunked
 * at `BATCH_WRITE_SIZE` so one big import doesn't become one oversized request.
 *
 * The two batching primitives fail differently, and `ImportOutcome` reflects that instead of
 * hiding it: `insertMany` is atomic server-side (one bad row fails every row in that chunk,
 * confirmed live — see `createEntityApi.createMany`'s doc), so a create failure is reported
 * against every row in the chunk it broke, not pinpointed to the one that actually caused it.
 * An aliased update batch resolves each row independently (confirmed: GraphQL only throws
 * away the HTTP layer on a non-2xx status, so one row's business failure just leaves that
 * alias's data `null`, not the others'), so update failures keep the original per-line
 * precision.
 *
 * `Product` rows get one extra pass — see `applyProductRows` — since a product's variants
 * (and each variant's optional per-warehouse stock) don't exist as their own import rows;
 * they ride along on the product's own row and are applied right after it, using the
 * product's just-created-or-updated real `ItemId`.
 */
export async function applyRows(meta: EntityMeta, rows: RowResult[]): Promise<ImportOutcome> {
  if (meta.schemaName === "Product") return applyProductRows(rows);

  const api = createEntityApi(meta.schemaName);
  const outcome: ImportOutcome = { created: 0, updated: 0, failed: [] };

  const updateRows: RowResult[] = [];
  const createRows: RowResult[] = [];
  for (const row of rows) {
    if (row.errors.length > 0) outcome.failed.push({ line: row.line, message: row.errors.join("; ") });
    else if (row.itemId) updateRows.push(row);
    else createRows.push(row);
  }

  for (const batch of chunk(updateRows, BATCH_WRITE_SIZE)) {
    try {
      const results = await runBatchUpdate(
        batch.map((row, i) => ({ key: String(i), schemaName: meta.schemaName, itemId: row.itemId!, payload: row.payload }))
      );
      batch.forEach((row, i) => {
        const result = results[String(i)];
        if (result?.totalImpactedData) outcome.updated += 1;
        else outcome.failed.push({ line: row.line, message: result?.message || "No record matched this ItemId." });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of batch) outcome.failed.push({ line: row.line, message });
    }
  }

  for (const batch of chunk(createRows, BATCH_WRITE_SIZE)) {
    try {
      const result = await api.createMany(batch.map((row) => row.payload));
      outcome.created += result.itemIds?.length ?? batch.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of batch) outcome.failed.push({ line: row.line, message });
    }
  }

  return outcome;
}

/** `OnHand - Reserved - Damaged - QualityHold - Blocked` — the same formula
 * `inventory-ops.ts`'s `computeAvailable` uses; kept in sync with it deliberately. */
function computeAvailableToSell(quantity: ImportedStockEntry["quantity"]): number {
  return (
    (quantity.OnHand ?? 0) -
    (quantity.Reserved ?? 0) -
    (quantity.Damaged ?? 0) -
    (quantity.QualityHold ?? 0) -
    (quantity.Blocked ?? 0)
  );
}

/** One variant entry paired with the row it came from and (once known) its parent product's
 * real id — the unit `applyProductRows` batches variant writes over. */
interface FlatVariant {
  row: RowResult;
  variant: ImportedVariant;
  productId: string;
}

/** One stock entry paired with the flattened variant it belongs to and (once resolved) real
 * `WarehouseId` — the unit `applyProductRows` batches stock writes over. */
interface FlatStock {
  flatVariant: FlatVariant;
  stock: ImportedStockEntry;
  variantId: string;
  warehouseId: string;
}

function stockMutationPayload(entry: FlatStock): Record<string, unknown> {
  return {
    WarehouseId: entry.warehouseId,
    ProductId: entry.flatVariant.productId,
    VariantId: entry.variantId,
    Sku: entry.flatVariant.variant.sku,
    Quantity: entry.stock.quantity,
    AvailableToSell: computeAvailableToSell(entry.stock.quantity),
    ReorderPoint: entry.stock.reorderPoint,
    ReorderQuantity: entry.stock.reorderQuantity,
  };
}

/**
 * The Product-specific import path: create/update every Product, then — once each has a real
 * id — create/update every one of their `Variants` entries, then — once each of *those* has a
 * real id — create/update every `Stock` entry. Each of the three levels is applied in
 * `BATCH_WRITE_SIZE` chunks via `insertMany`/`runBatchUpdate` (see `applyRows`'s doc for how
 * those two batching primitives differ), rather than one write per row/variant/stock entry —
 * a product with 50 variants each carrying stock at 3 warehouses used to be ~150 sequential
 * writes; it's now a handful of batched requests. A write's own failure only ever removes
 * that one row from the *next* level's input (a product that failed to create never reaches
 * the variant stage at all) — everything else in the same chunk, and every other chunk, still
 * goes through, reported per-line rather than losing that context behind one failure message.
 *
 * Re-importing a previous export must not duplicate what's already there: a variant is
 * matched to an existing one by `Sku` (its natural key — the import file has no way to carry
 * a variant's own `ItemId` the way a product row carries its own), and a stock row is matched
 * by the `(VariantId, WarehouseId)` pair `WarehouseDetailPage`'s own admin screens treat as
 * that natural key — see `BLOCKS_FEATURE_SUGGESTIONS.md`'s note that nothing enforces it as a
 * real constraint yet, which is exactly why this checks first rather than trusting a blind
 * create not to produce a second, conflicting balance row.
 */
async function applyProductRows(rows: RowResult[]): Promise<ImportOutcome> {
  const productApi = createEntityApi("Product");
  const variantApi = createEntityApi("ProductVariant");
  const stockApi = createEntityApi("WarehouseInventory");
  const outcome: ImportOutcome = { created: 0, updated: 0, failed: [], variantsCreated: 0, variantsUpdated: 0, stockWritten: 0 };

  const okRows = rows.filter((r) => r.errors.length === 0);
  for (const row of rows) {
    if (row.errors.length > 0) outcome.failed.push({ line: row.line, message: row.errors.join("; ") });
  }

  // Pre-fetch every warehouse code this import references, once, rather than per stock row.
  const warehouseCodes = new Set<string>();
  for (const row of okRows) {
    for (const variant of row.variants ?? []) {
      for (const stock of variant.stock) warehouseCodes.add(stock.warehouseCode);
    }
  }
  const warehouseIdByCode = new Map<string, string>();
  if (warehouseCodes.size > 0) {
    const warehouses = await createEntityApi("Warehouse").list({ where: { Code: { in: Array.from(warehouseCodes) } }, pageSize: warehouseCodes.size });
    for (const w of warehouses.items) {
      const code = w.Code as string | undefined;
      const id = (w.ItemId ?? w.itemId) as string | undefined;
      if (code && id) warehouseIdByCode.set(code, id);
    }
  }

  // Pre-fetch any existing variant sharing a SKU this import uses, so re-importing a
  // previous export updates the same variant instead of creating a duplicate.
  const skus = new Set<string>();
  for (const row of okRows) for (const variant of row.variants ?? []) skus.add(variant.sku);
  const existingVariantIdBySku = new Map<string, string>();
  if (skus.size > 0) {
    const existing = await variantApi.list({ where: { Sku: { in: Array.from(skus) } }, pageSize: skus.size });
    for (const v of existing.items) {
      const sku = v.Sku as string | undefined;
      const id = (v.ItemId ?? v.itemId) as string | undefined;
      if (sku && id) existingVariantIdBySku.set(sku, id);
    }
  }

  // ---- Products: batch-update the existing ones, batch-create the new ones ----
  const productIdByRow = new Map<RowResult, string>();
  const [updateProductRows, createProductRows] = [okRows.filter((r) => r.itemId), okRows.filter((r) => !r.itemId)];

  for (const batch of chunk(updateProductRows, BATCH_WRITE_SIZE)) {
    try {
      const results = await runBatchUpdate(batch.map((row, i) => ({ key: String(i), schemaName: "Product", itemId: row.itemId!, payload: row.payload })));
      batch.forEach((row, i) => {
        const result = results[String(i)];
        if (result?.totalImpactedData) {
          outcome.updated += 1;
          productIdByRow.set(row, row.itemId!);
        } else {
          outcome.failed.push({ line: row.line, message: result?.message || "No record matched this ItemId." });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of batch) outcome.failed.push({ line: row.line, message });
    }
  }

  for (const batch of chunk(createProductRows, BATCH_WRITE_SIZE)) {
    try {
      const result = await productApi.createMany(batch.map((row) => row.payload));
      const itemIds = result.itemIds ?? [];
      if (itemIds.length !== batch.length) {
        for (const row of batch) outcome.failed.push({ line: row.line, message: result.message || "insertMany didn't return one id per row." });
        continue;
      }
      batch.forEach((row, i) => {
        outcome.created += 1;
        productIdByRow.set(row, itemIds[i]);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const row of batch) outcome.failed.push({ line: row.line, message });
    }
  }

  // ---- Variants: flatten every row's Variants against its now-real ProductId ----
  const flatVariants: FlatVariant[] = [];
  for (const row of okRows) {
    const productId = productIdByRow.get(row);
    if (!productId) continue; // this row's product failed above; already reported there
    for (const variant of row.variants ?? []) flatVariants.push({ row, variant, productId });
  }

  const variantIdByFlat = new Map<FlatVariant, string>();
  const [updateVariants, createVariants] = [
    flatVariants.filter((fv) => existingVariantIdBySku.has(fv.variant.sku)),
    flatVariants.filter((fv) => !existingVariantIdBySku.has(fv.variant.sku)),
  ];

  for (const batch of chunk(updateVariants, BATCH_WRITE_SIZE)) {
    try {
      const results = await runBatchUpdate(
        batch.map((fv, i) => ({
          key: String(i),
          schemaName: "ProductVariant",
          itemId: existingVariantIdBySku.get(fv.variant.sku)!,
          payload: { ...fv.variant.payload, ProductId: fv.productId },
        }))
      );
      batch.forEach((fv, i) => {
        const result = results[String(i)];
        if (result?.totalImpactedData) {
          outcome.variantsUpdated = (outcome.variantsUpdated ?? 0) + 1;
          variantIdByFlat.set(fv, existingVariantIdBySku.get(fv.variant.sku)!);
        } else {
          outcome.failed.push({ line: fv.row.line, message: `variant ${fv.variant.sku}: ${result?.message || "update failed"}` });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const fv of batch) outcome.failed.push({ line: fv.row.line, message: `variant ${fv.variant.sku}: ${message}` });
    }
  }

  for (const batch of chunk(createVariants, BATCH_WRITE_SIZE)) {
    try {
      const result = await variantApi.createMany(batch.map((fv) => ({ ...fv.variant.payload, ProductId: fv.productId })));
      const itemIds = result.itemIds ?? [];
      if (itemIds.length !== batch.length) {
        for (const fv of batch) {
          outcome.failed.push({ line: fv.row.line, message: `variant ${fv.variant.sku}: ${result.message || "insertMany didn't return one id per row."}` });
        }
        continue;
      }
      batch.forEach((fv, i) => {
        outcome.variantsCreated = (outcome.variantsCreated ?? 0) + 1;
        variantIdByFlat.set(fv, itemIds[i]);
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const fv of batch) outcome.failed.push({ line: fv.row.line, message: `variant ${fv.variant.sku}: ${message}` });
    }
  }

  // ---- Stock: flatten every surviving variant's Stock against its now-real VariantId ----
  // Existing balances are only looked up for variants that already existed — a brand new
  // variant's id was just generated, so it cannot already have a balance row.
  const existingVariantIds = Array.from(existingVariantIdBySku.values());
  const existingStockIdByKey = new Map<string, string>(); // `${variantId}:${warehouseId}` -> ItemId
  if (existingVariantIds.length > 0) {
    const existingStock = await stockApi.list({ where: { VariantId: { in: existingVariantIds } }, pageSize: MAX_EXPORT_ROWS });
    for (const s of existingStock.items) {
      const variantId = s.VariantId as string | undefined;
      const warehouseId = s.WarehouseId as string | undefined;
      const id = (s.ItemId ?? s.itemId) as string | undefined;
      if (variantId && warehouseId && id) existingStockIdByKey.set(`${variantId}:${warehouseId}`, id);
    }
  }

  const flatStock: FlatStock[] = [];
  for (const fv of flatVariants) {
    const variantId = variantIdByFlat.get(fv);
    if (!variantId) continue; // this variant failed above; already reported there
    for (const stock of fv.variant.stock) {
      const warehouseId = warehouseIdByCode.get(stock.warehouseCode);
      if (!warehouseId) {
        outcome.failed.push({ line: fv.row.line, message: `variant ${fv.variant.sku}: unknown WarehouseCode "${stock.warehouseCode}"` });
        continue;
      }
      flatStock.push({ flatVariant: fv, stock, variantId, warehouseId });
    }
  }

  const [updateStock, createStock] = [
    flatStock.filter((fs) => existingStockIdByKey.has(`${fs.variantId}:${fs.warehouseId}`)),
    flatStock.filter((fs) => !existingStockIdByKey.has(`${fs.variantId}:${fs.warehouseId}`)),
  ];

  for (const batch of chunk(updateStock, BATCH_WRITE_SIZE)) {
    try {
      const results = await runBatchUpdate(
        batch.map((fs, i) => ({
          key: String(i),
          schemaName: "WarehouseInventory",
          itemId: existingStockIdByKey.get(`${fs.variantId}:${fs.warehouseId}`)!,
          payload: stockMutationPayload(fs),
        }))
      );
      batch.forEach((fs, i) => {
        const result = results[String(i)];
        if (result?.totalImpactedData) outcome.stockWritten = (outcome.stockWritten ?? 0) + 1;
        else {
          outcome.failed.push({
            line: fs.flatVariant.row.line,
            message: `variant ${fs.flatVariant.variant.sku} stock at "${fs.stock.warehouseCode}": ${result?.message || "update failed"}`,
          });
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const fs of batch) {
        outcome.failed.push({ line: fs.flatVariant.row.line, message: `variant ${fs.flatVariant.variant.sku} stock at "${fs.stock.warehouseCode}": ${message}` });
      }
    }
  }

  for (const batch of chunk(createStock, BATCH_WRITE_SIZE)) {
    try {
      const result = await stockApi.createMany(batch.map((fs) => ({ ...stockMutationPayload(fs), Version: 1 })));
      const itemIds = result.itemIds ?? [];
      if (itemIds.length !== batch.length) {
        for (const fs of batch) {
          outcome.failed.push({
            line: fs.flatVariant.row.line,
            message: `variant ${fs.flatVariant.variant.sku} stock at "${fs.stock.warehouseCode}": ${result.message || "insertMany didn't return one id per row."}`,
          });
        }
        continue;
      }
      outcome.stockWritten = (outcome.stockWritten ?? 0) + batch.length;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const fs of batch) {
        outcome.failed.push({ line: fs.flatVariant.row.line, message: `variant ${fs.flatVariant.variant.sku} stock at "${fs.stock.warehouseCode}": ${message}` });
      }
    }
  }

  return outcome;
}
