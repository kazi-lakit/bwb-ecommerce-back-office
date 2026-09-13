import { createEntityApi } from "./collections";
import type { ImportedStockEntry, ImportedVariant, RowResult } from "./bulk";

/**
 * The back-office's own path into the "Import Product With Variants And Stock" Blocks
 * Workflow (published in `blocks-shop`, webhookId `wfprod01wfprod01wfprod01wfprod01`): one
 * webhook call that inserts each Product, fans out to insert its Variants using the real new
 * ProductId, then fans out again to insert each variant's Stock using the real new VariantId —
 * all server-side, and (for the stock step specifically) under a workflow-embedded
 * `inventory-operator` credential rather than whatever role the signed-in caller happens to
 * have. See `blocks-workflow-api-findings` for how this was built and verified.
 *
 * This is deliberately narrower than `applyRows`'s own Product path in `bulk.ts`:
 * - **Create-only.** The workflow always calls `insertData`; it has no notion of "this Sku/
 *   ItemId already exists, update it instead" the way `applyProductRows` does. Rows that carry
 *   an `ItemId` (i.e. update rows from an existing export) are skipped here, not silently
 *   turned into duplicates — use the regular Import button for those.
 * - **No `CategoryIds`/`Media`/`OptionValues`.** Confirmed live: a workflow `dataAction` node
 *   can only set scalar fields and single-level nested *objects* (`Pricing`, `Dimensions`) via
 *   its `fieldMapping` — a plain array field comes back `null` no matter what's sent. Set those
 *   afterward with a normal `update()` call (already fully supported) if a workflow-created
 *   product needs them.
 *
 * Every field this sends is always present, defaulting to `""` for "no value" — confirmed
 * live that omitting a mapped key entirely crashes the whole workflow execution
 * (`NullReferenceException`), while sending JSON `null` doesn't crash but writes the literal
 * string `"null"` into the field. `""` is the one sentinel that's safe for every field type,
 * including numeric ones (stores a real `null`, not an error, not `"0"`).
 */
const WEBHOOK_URL =
  "https://logic.seliseblocks.com/api/Workflow/Webhook/D9d1f667bf6a940828c66e196544e536a/280330f37fcb415ca87754579aff2139/wfprod01wfprod01wfprod01wfprod01";

function str(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Stock quantity buckets default to 0 (a real, meaningful "none of this"), not `""` (null) —
 * matching how the rest of this app (`computeAvailableToSell` et al.) already treats an
 * unspecified bucket. `ReorderPoint`/`ReorderQuantity` default to `""` instead, since "no
 * reorder threshold set" is a real, different state from "threshold is zero". */
function stockPayload(entry: ImportedStockEntry, warehouseIdByCode: Map<string, string>) {
  const q = entry.quantity;
  const available =
    (q.OnHand ?? 0) - (q.Reserved ?? 0) - (q.Damaged ?? 0) - (q.QualityHold ?? 0) - (q.Blocked ?? 0);
  return {
    warehouseId: warehouseIdByCode.get(entry.warehouseCode) ?? "",
    onHand: str(q.OnHand ?? 0),
    reserved: str(q.Reserved ?? 0),
    damaged: str(q.Damaged ?? 0),
    qualityHold: str(q.QualityHold ?? 0),
    incoming: str(q.Incoming ?? 0),
    blocked: str(q.Blocked ?? 0),
    backordered: str(q.Backordered ?? 0),
    inTransit: str(q.InTransit ?? 0),
    availableToSell: str(available),
    reorderPoint: entry.reorderPoint !== undefined ? str(entry.reorderPoint) : "",
    reorderQuantity: entry.reorderQuantity !== undefined ? str(entry.reorderQuantity) : "",
  };
}

function variantPayload(variant: ImportedVariant, warehouseIdByCode: Map<string, string>) {
  const pricing = (variant.payload.Pricing as Record<string, unknown> | undefined) ?? {};
  const dimensions = (variant.payload.Dimensions as Record<string, unknown> | undefined) ?? {};
  return {
    sku: variant.sku,
    name: str(variant.payload.Name),
    barcode: str(variant.payload.Barcode),
    status: str(variant.payload.Status),
    isInventoryTracked: variant.payload.IsInventoryTracked === true,
    pricingCurrency: str(pricing.Currency),
    pricingRegularPrice: str(pricing.RegularPrice),
    dimensionsWeight: str(dimensions.Weight),
    dimensionsWeightUnit: str(dimensions.WeightUnit),
    dimensionsLength: str(dimensions.Length),
    dimensionsWidth: str(dimensions.Width),
    dimensionsHeight: str(dimensions.Height),
    dimensionsDimensionUnit: str(dimensions.DimensionUnit),
    stock: variant.stock.map((entry) => stockPayload(entry, warehouseIdByCode)),
  };
}

export interface WorkflowImportOutcome {
  /** Rows actually sent (create-only, valid, non-empty). */
  attempted: number;
  /** Rows skipped because they already have an ItemId (this workflow can't update). */
  skippedExisting: number;
  ok: boolean;
  status?: string;
  executionId?: string;
  error?: string;
}

/**
 * Sends every create-only, error-free row through the workflow webhook in one call. Rows
 * with an `ItemId` (updates) are excluded up front — see the module doc for why.
 */
export async function importProductsViaWorkflow(rows: RowResult[]): Promise<WorkflowImportOutcome> {
  const createRows = rows.filter((r) => r.errors.length === 0 && !r.itemId);
  const skippedExisting = rows.filter((r) => r.errors.length === 0 && r.itemId).length;

  if (createRows.length === 0) {
    return { attempted: 0, skippedExisting, ok: false, error: "No new (non-update) rows to import." };
  }

  const warehouseCodes = new Set<string>();
  for (const row of createRows) {
    for (const variant of row.variants ?? []) {
      for (const stock of variant.stock) warehouseCodes.add(stock.warehouseCode);
    }
  }
  const warehouseIdByCode = new Map<string, string>();
  if (warehouseCodes.size > 0) {
    const warehouses = await createEntityApi("Warehouse").list({
      where: { Code: { in: Array.from(warehouseCodes) } },
      pageSize: warehouseCodes.size,
    });
    for (const w of warehouses.items) {
      const code = w.Code as string | undefined;
      const id = w.ItemId as string | undefined;
      if (code && id) warehouseIdByCode.set(code, id);
    }
  }

  const unknownCodes = Array.from(warehouseCodes).filter((code) => !warehouseIdByCode.has(code));
  if (unknownCodes.length > 0) {
    return {
      attempted: 0,
      skippedExisting,
      ok: false,
      error: `Unknown WarehouseCode(s): ${unknownCodes.join(", ")} — fix these before importing.`,
    };
  }

  const payload = createRows.map((row) => ({
    name: str(row.payload.Name),
    slug: str(row.payload.Slug),
    productType: str(row.payload.ProductType),
    status: str(row.payload.Status),
    shortDescription: str(row.payload.ShortDescription),
    longDescription: str(row.payload.LongDescription),
    brandId: str(row.payload.BrandId),
    variants: (row.variants ?? []).map((variant) => variantPayload(variant, warehouseIdByCode)),
  }));

  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await res.json().catch(() => null)) as { status?: string; executionId?: string } | null;
    if (!res.ok) {
      return { attempted: createRows.length, skippedExisting, ok: false, error: `Webhook returned ${res.status}` };
    }
    return { attempted: createRows.length, skippedExisting, ok: true, status: json?.status, executionId: json?.executionId };
  } catch (error) {
    return {
      attempted: createRows.length,
      skippedExisting,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
