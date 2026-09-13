import { Boxes, Building2, ClipboardList, FolderTree, Package, PackageCheck, Tag, Truck, Warehouse as WarehouseIcon } from "lucide-react";
import { useEntityListBatch } from "@/lib/blocks/hooks";
import { PageHeader } from "@/components/ui/page-header";
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

  return (
    <div className="pb-2 pt-1">
      <PageHeader title="eCommerce Dashboard" description="An overview of your catalog, inventory, and purchasing operations." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total products" icon={Package} to="/admin/product" {...totalProducts} />
        <SummaryCard label="Active products" icon={PackageCheck} to="/admin/product" {...activeProducts} />
        <SummaryCard label="Warehouses" icon={WarehouseIcon} to="/admin/warehouse" {...warehouses} />
        <SummaryCard label="Categories" icon={FolderTree} to="/admin/category" {...categories} />
        <SummaryCard label="Brands" icon={Tag} to="/admin/brand" {...brands} />
        <SummaryCard label="Suppliers" icon={Building2} to="/admin/supplier" {...suppliers} />
        <SummaryCard label="In-progress transfers" icon={Truck} to="/admin/stock-transfer" {...inProgressTransfers} />
        <SummaryCard label="Open purchase orders" icon={ClipboardList} to="/admin/purchase-order" {...openPurchaseOrders} />
      </div>

      {/*
        This used to be a note saying low-stock counts couldn't be shown without server-side
        aggregation. Half right: aggregation is genuinely missing, but the blocker for *this*
        question is narrower — "available below this row's own reorder point" compares two
        fields of one document, which no `where` clause can express at any scale. Counting a
        bounded page client-side answers it, and the panel states its own bound rather than
        implying it saw everything.
      */}
      <div className="mt-6">
        <LowStockPanel />
      </div>

      <p className="mt-5 flex items-start gap-2 rounded-lg bg-canvas px-4 py-3 text-xs text-muted shadow-[var(--shadow-float)]">
        <Boxes size={13} /> Totals for available and reserved stock across all warehouses still need a
        server-side aggregation that isn't exposed yet — not shown here to avoid guessing.
      </p>
    </div>
  );
}
