import { Activity, ArrowRight, Boxes, Building2, ClipboardList, FolderTree, Package, PackageCheck, Tag, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useEntityListBatch } from "@/lib/blocks/hooks";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { LowStockPanel } from "@/components/dashboard/low-stock-panel";

// Real enum values from the schema (see schema-meta.ts) — not guesses. "Pending"/"low
// stock" aren't literal status strings, so these approximate them as "not yet finished".
const IN_PROGRESS_TRANSFER_STATUSES = ["draft", "approved", "in_transit", "partially_received"];
const OPEN_PURCHASE_ORDER_STATUSES = ["draft", "submitted", "approved", "partially_received"];

/**
 * Every card's count is a `pageSize: 1` list call read for its `totalCount` — cheap,
 * but 8 of them fired one at a time was 8 separate round trips to the Data Gateway for
 * a page that's nothing but summary numbers. Batched into one request via
 * `useEntityListBatch` (see `collections.ts`'s `runBatchList`): each card is still its
 * own independent `getXs(where:, paging:{pageSize:1})` selection, they're just aliased
 * together on one GraphQL document instead of eight.
 */
function useCounts() {
  const batch = useEntityListBatch([
    { key: "totalProducts", schemaName: "Product" },
    { key: "activeProducts", schemaName: "Product", params: { where: { Status: { eq: "active" } } } },
    { key: "warehouses", schemaName: "Warehouse" },
    { key: "categories", schemaName: "Category" },
    { key: "brands", schemaName: "Brand" },
    { key: "suppliers", schemaName: "Supplier" },
    { key: "inProgressTransfers", schemaName: "StockTransfer", params: { where: { Status: { in: IN_PROGRESS_TRANSFER_STATUSES } } } },
    { key: "openPurchaseOrders", schemaName: "PurchaseOrder", params: { where: { Status: { in: OPEN_PURCHASE_ORDER_STATUSES } } } },
  ].map((req) => ({ ...req, params: { ...req.params, pageSize: 1 } })));

  function count(key: string) {
    return { value: batch.data?.[key]?.totalCount, loading: batch.isLoading };
  }

  return {
    totalProducts: count("totalProducts"),
    activeProducts: count("activeProducts"),
    warehouses: count("warehouses"),
    categories: count("categories"),
    brands: count("brands"),
    suppliers: count("suppliers"),
    inProgressTransfers: count("inProgressTransfers"),
    openPurchaseOrders: count("openPurchaseOrders"),
  };
}

/**
 * Every card here is backed by a real `totalCount` from the Data Gateway (a cheap
 * `pageSize: 1` list call) — no client-side aggregation, no fabricated numbers.
 * Available/Reserved inventory and Low-stock counts are intentionally NOT shown: they'd
 * need either a backend sum/aggregation over WarehouseInventory or a cross-field
 * comparison (AvailableToSell vs ReorderPoint) that the Data Gateway's filter operators
 * don't support — fetching and summing all rows client-side wouldn't be accurate at
 * scale, so per the brief ("don't display misleading values") they're left out until
 * that's available server-side.
 */
export default function DashboardPage() {
  const { totalProducts, activeProducts, warehouses, categories, brands, suppliers, inProgressTransfers, openPurchaseOrders } =
    useCounts();
  const activeProductRate =
    typeof totalProducts.value === "number" && typeof activeProducts.value === "number"
      ? totalProducts.value === 0
        ? 0
        : Math.round((activeProducts.value / totalProducts.value) * 100)
      : null;

  return (
    <div className="pb-3 pt-1">
      <section className="relative isolate overflow-hidden rounded-xl bg-[#1c1917] px-6 py-8 text-white shadow-[var(--shadow-card)] sm:px-8 sm:py-10 xl:px-10">
        <div className="absolute -right-16 -top-24 -z-10 h-72 w-72 rounded-full bg-brand-accent/25 blur-3xl" />
        <div className="absolute -bottom-28 right-1/3 -z-10 h-56 w-56 rounded-full bg-white/5 blur-3xl" />
        <div className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/80">
              <Activity size={13} className="text-brand-accent" /> Operations overview
            </div>
            <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">Commerce operations, at a glance.</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/65">
              Monitor catalog health, inventory signals, and purchasing activity from one focused workspace.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link to="/admin/product" className="inline-flex min-h-10 items-center gap-2 rounded-md bg-brand-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-accent-deep">
                Manage catalog <ArrowRight size={15} />
              </Link>
              <Link to="/admin/warehouse" className="inline-flex min-h-10 items-center gap-2 rounded-md border border-white/20 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                View warehouses
              </Link>
            </div>
          </div>
          <div className="grid min-w-64 grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10">
            <div className="bg-black/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Active catalog</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{activeProducts.loading ? "—" : activeProducts.value ?? "—"}</p>
            </div>
            <div className="bg-black/20 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-white/50">Open POs</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{openPurchaseOrders.loading ? "—" : openPurchaseOrders.value ?? "—"}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Business footprint</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-ink">Core commerce records</h2>
          </div>
          <p className="text-xs text-muted">Live totals from the Data Gateway</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard label="Total products" description="All catalog records" icon={Package} to="/admin/product" {...totalProducts} />
          <SummaryCard label="Active products" description="Currently available in catalog" icon={PackageCheck} to="/admin/product" {...activeProducts} />
          <SummaryCard label="Warehouses" description="Stock locations configured" icon={WarehouseIcon} to="/admin/warehouse" {...warehouses} />
          <SummaryCard label="Categories" description="Catalog taxonomy groups" icon={FolderTree} to="/admin/category" {...categories} />
          <SummaryCard label="Brands" description="Brands represented" icon={Tag} to="/admin/brand" {...brands} />
          <SummaryCard label="Suppliers" description="Procurement partners" icon={Building2} to="/admin/supplier" {...suppliers} />
          <SummaryCard label="Active transfers" description="Not yet fully received" icon={Truck} to="/admin/stock-transfer" {...inProgressTransfers} />
          <SummaryCard label="Open purchase orders" description="Awaiting completion" icon={ClipboardList} to="/admin/purchase-order" {...openPurchaseOrders} />
        </div>
      </section>

      {/*
        This used to be a note saying low-stock counts couldn't be shown without server-side
        aggregation. Half right: aggregation is genuinely missing, but the blocker for *this*
        question is narrower — "available below this row's own reorder point" compares two
        fields of one document, which no `where` clause can express at any scale. Counting a
        bounded page client-side answers it, and the panel states its own bound rather than
        implying it saw everything.
      */}
      <section className="mt-8 grid items-start gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.75fr)]">
        <LowStockPanel />
        <div className="overflow-hidden rounded-xl border border-hairline bg-canvas shadow-[var(--shadow-card)]">
          <div className="border-b border-hairline-soft px-5 py-5 sm:px-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Operational readiness</p>
            <h2 className="mt-1 text-base font-semibold text-ink">Catalog coverage</h2>
            <p className="mt-1 text-xs text-muted">Share of product records currently marked active.</p>
          </div>
          <div className="px-5 py-6 sm:px-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-3xl font-semibold tabular-nums tracking-tight text-ink">{activeProductRate === null ? "—" : `${activeProductRate}%`}</p>
                <p className="mt-1 text-xs text-muted">
                  {activeProducts.value ?? "—"} active of {totalProducts.value ?? "—"} total
                </p>
              </div>
              <PackageCheck size={26} className="text-brand-accent" />
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-surface">
              <div className="h-full rounded-full bg-brand-accent transition-[width] duration-500" style={{ width: `${activeProductRate ?? 0}%` }} />
            </div>

            <div className="mt-7 border-t border-hairline-soft pt-5">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Quick access</h3>
              <div className="mt-3 space-y-1">
                {[
                  { label: "Review products", to: "/admin/product" },
                  { label: "Manage purchase orders", to: "/admin/purchase-order" },
                  { label: "Open supplier directory", to: "/admin/supplier" },
                ].map((item) => (
                  <Link key={item.to} to={item.to} className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm font-medium text-steel transition-colors hover:bg-surface hover:text-ink">
                    {item.label} <ArrowRight size={15} className="text-brand-accent" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="mt-6 flex items-start gap-2 rounded-lg border border-hairline bg-canvas px-4 py-3 text-xs leading-5 text-muted shadow-[var(--shadow-float)]">
        <Boxes size={14} className="mt-0.5 flex-none text-brand-accent" /> Totals for available and reserved stock across all warehouses require server-side aggregation and are intentionally omitted rather than estimated.
      </p>
    </div>
  );
}
