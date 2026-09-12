import { useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { Boxes, ClipboardList, Mail, MapPin, Package, Phone, Plus, Truck } from "lucide-react";
import { useEntityList, useEntityMutations } from "@/lib/blocks/hooks";
import { getEntityMeta, type EntityRecord } from "@/lib/blocks/collections";
import { useReferenceLabels } from "@/lib/blocks/use-reference-labels";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { BooleanIndicator } from "@/components/ui/boolean-indicator";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Drawer } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { TableSkeleton } from "@/components/ui/skeleton";
import { TabList } from "@/components/ui/tabs";
import { ResourceTable } from "@/components/resource/resource-table";
import { ResourceForm } from "@/components/resource/resource-form";
import { SummaryCard } from "@/components/dashboard/summary-card";
import { LowStockPanel } from "@/components/dashboard/low-stock-panel";
import { formatAddress, type Address, type Contact } from "@/components/resource/warehouse-card";
import { toast } from "@/lib/toast-store";
import { useHasRole } from "@/lib/blocks/access";
import { useAuth } from "@/components/providers/auth-provider";
import { stockTransferActions, stockTransferRowWarning } from "@/components/resource/stock-transfer-actions";

const PAGE_SIZE = 20;
// Same real enum values used on the global dashboard (see DashboardPage.tsx) —
// "pending"/"open" aren't literal status strings, so these approximate "not yet finished".
const IN_PROGRESS_TRANSFER_STATUSES = ["draft", "approved", "in_transit", "partially_received"];
const OPEN_PURCHASE_ORDER_STATUSES = ["draft", "submitted", "approved", "partially_received"];

function useScopedCount(schemaName: string, where: Record<string, unknown>, enabled: boolean) {
  const query = useEntityList(schemaName, { pageSize: 1, where }, enabled);
  return { value: query.data?.totalCount, loading: query.isLoading };
}

const warehouseMeta = getEntityMeta("Warehouse");
const inventoryMeta = getEntityMeta("WarehouseInventory");
const transferMeta = getEntityMeta("StockTransfer");

/**
 * A warehouse's own page: its details, a small dashboard scoped to just this
 * warehouse (real totalCount-based numbers, same "no fabricated values" rule as the
 * global dashboard — see DashboardPage.tsx), and the inventory records stocked here,
 * managed in place instead of on the generic Warehouse Inventory list.
 */
export default function WarehouseDetailPage() {
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const hasId = Boolean(warehouseId);

  const [activeTab, setActiveTab] = useState<"inventory" | "transfers">("inventory");
  const [pageNo, setPageNo] = useState(1);
  const [editingWarehouse, setEditingWarehouse] = useState(false);
  const [editingInventory, setEditingInventory] = useState<EntityRecord | null>(null);
  const [creatingInventory, setCreatingInventory] = useState(false);
  const [deletingInventory, setDeletingInventory] = useState<EntityRecord | null>(null);

  const [transferPageNo, setTransferPageNo] = useState(1);
  const [editingTransfer, setEditingTransfer] = useState<EntityRecord | null>(null);
  const [creatingTransfer, setCreatingTransfer] = useState(false);
  const [deletingTransfer, setDeletingTransfer] = useState<EntityRecord | null>(null);

  // WarehouseInventory's Edit is admin-only per list-config.ts/P0_POLICY_FIXES.json (its
  // Delete already carries an "only admin can delete" policy, same as StockTransfer).
  const isAdmin = useHasRole("admin");
  const { user } = useAuth();

  const warehouseQuery = useEntityList("Warehouse", { where: { ItemId: { eq: warehouseId } }, pageSize: 1 }, hasId);
  const warehouse = warehouseQuery.data?.items[0];
  const warehouseMutations = useEntityMutations("Warehouse");

  const inventoryWhere = useMemo(() => (warehouseId ? { WarehouseId: { eq: warehouseId } } : undefined), [warehouseId]);
  const inventoryList = useEntityList("WarehouseInventory", { pageNo, pageSize: PAGE_SIZE, where: inventoryWhere }, hasId);
  const inventoryMutations = useEntityMutations("WarehouseInventory");
  const inventoryItems = inventoryList.data?.items ?? [];
  const { referenceLabels } = useReferenceLabels(inventoryMeta, inventoryItems);

  const transferWhere = useMemo(
    () =>
      warehouseId
        ? { or: [{ SourceWarehouseId: { eq: warehouseId } }, { DestinationWarehouseId: { eq: warehouseId } }] }
        : undefined,
    [warehouseId]
  );
  const transferList = useEntityList("StockTransfer", { pageNo: transferPageNo, pageSize: PAGE_SIZE, where: transferWhere }, hasId);
  const transferMutations = useEntityMutations("StockTransfer");
  const transferItems = transferList.data?.items ?? [];
  const { referenceLabels: transferReferenceLabels } = useReferenceLabels(transferMeta, transferItems);

  const inventoryCount = useScopedCount("WarehouseInventory", { WarehouseId: { eq: warehouseId } }, hasId);
  const transferCount = useScopedCount(
    "StockTransfer",
    {
      Status: { in: IN_PROGRESS_TRANSFER_STATUSES },
      or: [{ SourceWarehouseId: { eq: warehouseId } }, { DestinationWarehouseId: { eq: warehouseId } }],
    },
    hasId
  );
  const purchaseOrderCount = useScopedCount(
    "PurchaseOrder",
    { WarehouseId: { eq: warehouseId }, Status: { in: OPEN_PURCHASE_ORDER_STATUSES } },
    hasId
  );
  const movementCount = useScopedCount("InventoryMovement", { WarehouseId: { eq: warehouseId } }, hasId);

  if (!warehouseId) return <Navigate to="/admin/warehouse" replace />;

  if (warehouseQuery.isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (!warehouse) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          title="Warehouse not found"
          description="It may have been deleted."
          action={
            <Link to="/admin/warehouse">
              <Button variant="secondary">Back to warehouses</Button>
            </Link>
          }
        />
      </div>
    );
  }

  // A `const` re-binding so TS carries the "definitely a string" narrowing from the
  // early return above into the closures below (narrowing on the raw `useParams` value
  // doesn't survive into nested function bodies).
  const id = warehouseId;

  const address = formatAddress(warehouse.Address as Address | undefined);
  const contact = warehouse.Contact as Contact | undefined;
  const totalInventory = inventoryList.data?.totalCount ?? 0;
  const hasNextPage = pageNo * PAGE_SIZE < totalInventory;
  const totalTransfers = transferList.data?.totalCount ?? 0;
  const hasNextTransferPage = transferPageNo * PAGE_SIZE < totalTransfers;
  const warehouseName = (warehouse.Name as string) || "Untitled warehouse";

  function closeInventoryDrawer() {
    setCreatingInventory(false);
    setEditingInventory(null);
  }

  function closeTransferDrawer() {
    setCreatingTransfer(false);
    setEditingTransfer(null);
  }

  function handleUpdateWarehouse(payload: Record<string, unknown>) {
    warehouseMutations.update.mutate(
      { itemId: id, payload },
      {
        onSuccess: () => {
          toast.success("Warehouse updated.");
          setEditingWarehouse(false);
        },
      }
    );
  }

  function handleCreateInventory(payload: Record<string, unknown>) {
    inventoryMutations.create.mutate(payload, {
      onSuccess: () => {
        toast.success("Inventory record created.");
        closeInventoryDrawer();
      },
    });
  }

  function handleUpdateInventory(payload: Record<string, unknown>) {
    if (!editingInventory) return;
    const itemId = (editingInventory.ItemId ?? editingInventory.itemId) as string;
    inventoryMutations.update.mutate(
      { itemId, payload },
      {
        onSuccess: () => {
          toast.success("Inventory record updated.");
          closeInventoryDrawer();
        },
      }
    );
  }

  function handleDeleteInventory() {
    if (!deletingInventory) return;
    inventoryMutations.remove.mutate(deletingInventory, {
      onSuccess: () => {
        toast.success("Inventory record deleted.");
        setDeletingInventory(null);
      },
    });
  }

  function handleCreateTransfer(payload: Record<string, unknown>) {
    transferMutations.create.mutate(payload, {
      onSuccess: () => {
        toast.success("Stock transfer created.");
        closeTransferDrawer();
      },
    });
  }

  function handleUpdateTransfer(payload: Record<string, unknown>) {
    if (!editingTransfer) return;
    const itemId = (editingTransfer.ItemId ?? editingTransfer.itemId) as string;
    transferMutations.update.mutate(
      { itemId, payload },
      {
        onSuccess: () => {
          toast.success("Stock transfer updated.");
          closeTransferDrawer();
        },
      }
    );
  }

  function handleDeleteTransfer() {
    if (!deletingTransfer) return;
    transferMutations.remove.mutate(deletingTransfer, {
      onSuccess: () => {
        toast.success("Stock transfer deleted.");
        setDeletingTransfer(null);
      },
    });
  }

  /** Same guided lifecycle actions as the global /admin/stock-transfer list — see stock-transfer-actions.ts. */
  function transferExtraActions(record: EntityRecord) {
    return stockTransferActions(record, {
      isAdmin,
      canEdit: true,
      approverIdentity: user?.email,
      onTransition: (itemId, payload, successMessage) =>
        transferMutations.update.mutate({ itemId, payload }, { onSuccess: () => toast.success(successMessage) }),
    });
  }

  const newInventoryButton = (
    <Button onClick={() => setCreatingInventory(true)}>
      <Plus size={16} /> New inventory record
    </Button>
  );

  const newTransferButton = (
    <Button onClick={() => setCreatingTransfer(true)}>
      <Plus size={16} /> New stock transfer
    </Button>
  );

  return (
    <div className="pb-2 pt-1">
      <PageHeader
        breadcrumbs={[
          { label: "Dashboard", to: "/admin" },
          { label: "Warehouses", to: "/admin/warehouse" },
          { label: warehouseName },
        ]}
        title={warehouseName}
        description={warehouse.Code as string}
        actions={
          <Button variant="secondary" onClick={() => setEditingWarehouse(true)}>
            Edit warehouse
          </Button>
        }
      />

      <Card className="mb-5 flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {warehouse.Status ? <StatusBadge status={warehouse.Status as string} /> : null}
            {warehouse.Type ? <Badge>{warehouse.Type as string}</Badge> : null}
          </div>
          {address && (
            <p className="flex items-start gap-1.5 text-sm text-steel">
              <MapPin size={14} className="mt-0.5 flex-none text-muted" />
              <span>{address}</span>
            </p>
          )}
          {contact && (contact.Name || contact.Email || contact.Phone) && (
            <div className="space-y-1 text-sm text-steel">
              {contact.Name && <p className="text-ink">{contact.Name}</p>}
              {contact.Email && (
                <p className="flex items-center gap-1.5">
                  <Mail size={14} className="flex-none text-muted" /> {contact.Email}
                </p>
              )}
              {contact.Phone && (
                <p className="flex items-center gap-1.5">
                  <Phone size={14} className="flex-none text-muted" /> {contact.Phone}
                </p>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <BooleanIndicator value={Boolean(warehouse.AllowPickup)} label="Pickup" />
          <BooleanIndicator value={Boolean(warehouse.AllowShipping)} label="Shipping" />
          {warehouse.FulfillmentPriority != null && <span className="text-muted">Priority {String(warehouse.FulfillmentPriority)}</span>}
          {warehouse.Timezone ? <span className="text-muted">{warehouse.Timezone as string}</span> : null}
        </div>
      </Card>

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Inventory items" icon={Boxes} {...inventoryCount} />
        <SummaryCard label="In-progress transfers" icon={Truck} {...transferCount} />
        <SummaryCard label="Open purchase orders" icon={ClipboardList} {...purchaseOrderCount} />
        <SummaryCard label="Inventory movements" icon={Package} {...movementCount} />
      </div>

      {/* Scoped to this warehouse — the same computation as the dashboard's, filtered. */}
      <div className="mb-5">
        <LowStockPanel warehouseId={warehouseId} />
      </div>

      <section className="admin-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-hairline px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <TabList
            tabs={[
              { key: "inventory", label: `Inventory (${totalInventory})` },
              { key: "transfers", label: `Stock transfers (${totalTransfers})` },
            ]}
            active={activeTab}
            onChange={(key) => setActiveTab(key as "inventory" | "transfers")}
          />
          {activeTab === "inventory" ? newInventoryButton : newTransferButton}
        </div>

        {activeTab === "inventory" ? (
          inventoryList.isLoading ? (
            <div className="p-5">
              <TableSkeleton />
            </div>
          ) : inventoryList.isError ? (
            <div className="p-5">
              <ErrorState
                message={inventoryList.error instanceof Error ? inventoryList.error.message : undefined}
                onRetry={() => inventoryList.refetch()}
              />
            </div>
          ) : inventoryItems.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No inventory records yet"
                description="Add the first product variant stocked at this warehouse."
                action={newInventoryButton}
              />
            </div>
          ) : (
            <>
              <ResourceTable
                meta={inventoryMeta}
                items={inventoryItems}
                onEdit={setEditingInventory}
                onDelete={setDeletingInventory}
                referenceLabels={referenceLabels}
                hiddenFields={["WarehouseId"]}
                canEdit={isAdmin}
                canDelete={isAdmin}
              />
              <div className="flex flex-col gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-sm text-muted">
                  Showing {(pageNo - 1) * PAGE_SIZE + 1} to {Math.min(pageNo * PAGE_SIZE, totalInventory)} of {totalInventory} entries
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" disabled={pageNo <= 1} onClick={() => setPageNo((p) => Math.max(1, p - 1))}>
                    Previous
                  </Button>
                  <Button variant="secondary" size="sm" disabled={!hasNextPage} onClick={() => setPageNo((p) => p + 1)}>
                    Next
                  </Button>
                </div>
              </div>
            </>
          )
        ) : transferList.isLoading ? (
          <div className="p-5">
            <TableSkeleton />
          </div>
        ) : transferList.isError ? (
          <div className="p-5">
            <ErrorState
              message={transferList.error instanceof Error ? transferList.error.message : undefined}
              onRetry={() => transferList.refetch()}
            />
          </div>
        ) : transferItems.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No stock transfers yet"
              description="Move stock into or out of this warehouse by creating a transfer."
              action={newTransferButton}
            />
          </div>
        ) : (
          <>
            <ResourceTable
              meta={transferMeta}
              items={transferItems}
              onEdit={setEditingTransfer}
              onDelete={setDeletingTransfer}
              referenceLabels={transferReferenceLabels}
              canDelete={isAdmin}
              extraRowActions={transferExtraActions}
              rowWarning={stockTransferRowWarning}
            />
            <div className="flex flex-col gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-muted">
                Showing {(transferPageNo - 1) * PAGE_SIZE + 1} to {Math.min(transferPageNo * PAGE_SIZE, totalTransfers)} of {totalTransfers} entries
              </span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={transferPageNo <= 1} onClick={() => setTransferPageNo((p) => Math.max(1, p - 1))}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" disabled={!hasNextTransferPage} onClick={() => setTransferPageNo((p) => p + 1)}>
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </section>

      {editingWarehouse && (
        <Drawer onClose={() => setEditingWarehouse(false)} title="Edit warehouse" description="Update this warehouse's details.">
          <ResourceForm
            meta={warehouseMeta}
            record={warehouse}
            submitting={warehouseMutations.update.isPending}
            onSubmit={handleUpdateWarehouse}
            onCancel={() => setEditingWarehouse(false)}
          />
        </Drawer>
      )}

      {(creatingInventory || editingInventory) && (
        <Drawer
          onClose={closeInventoryDrawer}
          title={editingInventory ? "Edit inventory record" : "New inventory record"}
          description={editingInventory ? "Update this inventory record's details." : `Add a new inventory record for ${warehouseName}.`}
        >
          <ResourceForm
            meta={inventoryMeta}
            record={editingInventory}
            initialValues={{ WarehouseId: id }}
            submitting={inventoryMutations.create.isPending || inventoryMutations.update.isPending}
            onSubmit={editingInventory ? handleUpdateInventory : handleCreateInventory}
            onCancel={closeInventoryDrawer}
          />
        </Drawer>
      )}

      {deletingInventory && (
        <ConfirmDialog
          title="Delete this inventory record?"
          description="This action can't be undone."
          confirmLabel="Delete"
          danger
          loading={inventoryMutations.remove.isPending}
          onConfirm={handleDeleteInventory}
          onCancel={() => setDeletingInventory(null)}
        />
      )}

      {(creatingTransfer || editingTransfer) && (
        <Drawer
          onClose={closeTransferDrawer}
          title={editingTransfer ? "Edit stock transfer" : "New stock transfer"}
          description={
            editingTransfer
              ? "Update this stock transfer's details."
              : `Move stock into or out of ${warehouseName}. Set the source and destination warehouse below.`
          }
        >
          <ResourceForm
            meta={transferMeta}
            record={editingTransfer}
            initialValues={{ SourceWarehouseId: id }}
            submitting={transferMutations.create.isPending || transferMutations.update.isPending}
            onSubmit={editingTransfer ? handleUpdateTransfer : handleCreateTransfer}
            onCancel={closeTransferDrawer}
          />
        </Drawer>
      )}

      {deletingTransfer && (
        <ConfirmDialog
          title="Delete this stock transfer?"
          description="This action can't be undone."
          confirmLabel="Delete"
          danger
          loading={transferMutations.remove.isPending}
          onConfirm={handleDeleteTransfer}
          onCancel={() => setDeletingTransfer(null)}
        />
      )}
    </div>
  );
}
