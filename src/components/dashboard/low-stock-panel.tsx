import { Link } from "react-router-dom";
import { AlertTriangle, PackageX } from "lucide-react";
import { useLowStock, type StockRow } from "@/lib/blocks/low-stock";
import { Spinner } from "@/components/ui/spinner";

function Row({ row, tone }: { row: StockRow; tone: "out" | "low" }) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
      <span className="min-w-0 truncate text-ink">{row.sku || row.variantId || row.itemId}</span>
      <span className={tone === "out" ? "flex-none text-brand-error" : "flex-none text-brand-warn"}>
        {tone === "out" ? "none left" : `${row.available} left · reorder at ${row.reorderPoint}`}
      </span>
    </li>
  );
}

/**
 * Inventory that needs attention. Replaces the dashboard's standing note that these numbers
 * couldn't be shown — they can, just not by asking the server for them (see `low-stock.ts`).
 */
export function LowStockPanel({ warehouseId, limit }: { warehouseId?: string; limit?: number }) {
  const { out, low, scanned, totalCount, isPartial, isLoading } = useLowStock({ warehouseId, limit });

  if (isLoading) {
    return (
      <div className="flex justify-center rounded-lg border border-hairline py-10">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  const nothingWrong = out.length === 0 && low.length === 0;

  return (
    <section className="rounded-lg border border-hairline">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Needs attention</h2>
        <Link to="/admin/warehouse-inventory" className="text-xs text-brand-accent hover:underline">
          All inventory
        </Link>
      </header>

      {nothingWrong ? (
        <p className="px-4 py-6 text-sm text-muted">
          Nothing out of stock or below its reorder point{isPartial ? " in the rows checked" : ""}.
        </p>
      ) : (
        <div className="divide-y divide-hairline-soft">
          {out.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-brand-error">
                <PackageX size={13} /> Out of stock ({out.length})
              </p>
              <ul className="px-1 pb-2">
                {out.slice(0, 8).map((row) => (
                  <Row key={row.itemId} row={row} tone="out" />
                ))}
              </ul>
              {out.length > 8 && <p className="px-4 pb-3 text-xs text-muted">and {out.length - 8} more</p>}
            </div>
          )}

          {low.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-brand-warn">
                <AlertTriangle size={13} /> Below reorder point ({low.length})
              </p>
              <ul className="px-1 pb-2">
                {low.slice(0, 8).map((row) => (
                  <Row key={row.itemId} row={row} tone="low" />
                ))}
              </ul>
              {low.length > 8 && <p className="px-4 pb-3 text-xs text-muted">and {low.length - 8} more</p>}
            </div>
          )}
        </div>
      )}

      {/*
        Said plainly rather than hidden. This is counted client-side over a bounded page,
        because "available below this row's own reorder point" compares two fields of the same
        document and no `where` clause can express that. When there are more rows than were
        checked, every count above is a floor — and a count that quietly covered a third of the
        warehouse would be exactly the guessing this dashboard already refused to do.
      */}
      {isPartial && (
        <p className="border-t border-hairline px-4 py-2 text-xs text-muted">
          Counted over {scanned} of {totalCount} inventory rows — there may be more.
        </p>
      )}
    </section>
  );
}
