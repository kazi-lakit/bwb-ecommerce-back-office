import { useMemo } from "react";
import { useEntityList } from "./hooks";
import type { EntityRecord } from "./collections";

/**
 * Which inventory rows need attention, computed client-side over a bounded page.
 *
 * The Data Gateway can't do this server-side, and not only because it lacks aggregation: the
 * question is "is `AvailableToSell` below this row's own `ReorderPoint`", a comparison between
 * two fields of the same document, and a `where` clause can only compare a field to a literal.
 * There is no filter that expresses it at any scale.
 *
 * So it's computed here over the first `limit` rows, and **`isPartial` says so when there are
 * more**. The dashboard previously declined to show these numbers at all rather than guess;
 * a count that silently covered a third of the warehouse would be the same mistake in a new
 * shape. A partial count that admits it is useful; one that doesn't is worse than none.
 */

const DEFAULT_LIMIT = 500;

export type StockLevel = "out" | "low" | "ok";

export interface StockRow {
  itemId: string;
  warehouseId?: string;
  variantId?: string;
  sku?: string;
  available: number;
  onHand: number;
  reorderPoint: number;
  level: StockLevel;
}

export interface LowStockResult {
  out: StockRow[];
  low: StockRow[];
  /** Rows actually examined. */
  scanned: number;
  /** Rows that exist. */
  totalCount: number;
  /** True when `totalCount` exceeds what was scanned, so the counts below are a floor. */
  isPartial: boolean;
  isLoading: boolean;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function classify(available: number, reorderPoint: number): StockLevel {
  if (available <= 0) return "out";
  // A reorder point of zero means "nobody has set one", not "reorder at zero" — treating the
  // default as a threshold would flag the entire catalog as healthy-but-borderline.
  if (reorderPoint > 0 && available <= reorderPoint) return "low";
  return "ok";
}

/**
 * The whole computation, separated from the fetching: classify, split, sort, and report
 * whether what was examined was everything. Pure, so the rules can be exercised directly
 * rather than inferred from a rendered panel.
 */
export function summarizeStockRows(
  items: EntityRecord[],
  totalCount: number
): Omit<LowStockResult, "isLoading"> {
  const out: StockRow[] = [];
  const low: StockRow[] = [];

  for (const record of items) {
    const quantity = (record.Quantity ?? {}) as Record<string, unknown>;
    const available = num(record.AvailableToSell);
    const reorderPoint = num(record.ReorderPoint);
    const row: StockRow = {
      itemId: (record.ItemId ?? record.itemId) as string,
      warehouseId: record.WarehouseId as string | undefined,
      variantId: record.VariantId as string | undefined,
      sku: record.Sku as string | undefined,
      available,
      onHand: num(quantity.OnHand),
      reorderPoint,
      level: classify(available, reorderPoint),
    };
    if (row.level === "out") out.push(row);
    else if (row.level === "low") low.push(row);
  }

  // Worst first: nothing sellable outranks running low, and within each, the furthest below
  // its own threshold comes first.
  out.sort((a, b) => a.available - b.available);
  low.sort((a, b) => a.available - a.reorderPoint - (b.available - b.reorderPoint));

  return {
    out,
    low,
    scanned: items.length,
    totalCount,
    isPartial: totalCount > items.length,
  };
}

export function useLowStock(options: { warehouseId?: string; limit?: number } = {}): LowStockResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const where = useMemo(
    () => (options.warehouseId ? { WarehouseId: { eq: options.warehouseId } } : undefined),
    [options.warehouseId]
  );

  const query = useEntityList("WarehouseInventory", { pageNo: 1, pageSize: limit, where });

  return useMemo(() => {
    const items = (query.data?.items ?? []) as EntityRecord[];
    return {
      ...summarizeStockRows(items, query.data?.totalCount ?? items.length),
      isLoading: query.isLoading,
    };
  }, [query.data, query.isLoading]);
}
