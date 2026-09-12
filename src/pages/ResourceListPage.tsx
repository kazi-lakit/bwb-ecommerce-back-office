import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { FileSpreadsheet, Plus } from "lucide-react";
import type { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ENTITY_ORDER } from "@/lib/blocks/schema-meta";
import { getEntityMeta, type EntityRecord } from "@/lib/blocks/collections";
import { useEntityList, useEntityMutations } from "@/lib/blocks/hooks";
import { useReferenceLabels } from "@/lib/blocks/use-reference-labels";
import {
  ADMIN_ONLY_EDIT_SCHEMAS,
  NO_DELETE_SCHEMAS,
  NO_EDIT_SCHEMAS,
  SEARCH_FIELD_BY_SCHEMA,
  STATUS_OPTIONS_BY_SCHEMA,
} from "@/lib/blocks/list-config";
import { useHasRole } from "@/lib/blocks/access";
import { useAuth } from "@/components/providers/auth-provider";
import { LIFECYCLE_ACTIONS_BY_SCHEMA, ROW_WARNING_BY_SCHEMA } from "@/components/resource/lifecycle-actions";
import { sweepExpiredReservations } from "@/lib/blocks/reservation-sweep";
import { slugFor } from "@/components/layout/nav-items";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { assignPlaceholders } from "@/lib/placeholder-images";
import { useTheme } from "@/components/providers/theme-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { Drawer } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { CardGridSkeleton, TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ResourceTable } from "@/components/resource/resource-table";
import { ProductTable } from "@/components/resource/product-table";
import { WarehouseCardGrid } from "@/components/resource/warehouse-card";
import { ResourceForm } from "@/components/resource/resource-form";
import { ProductVariantsPanel } from "@/components/resource/product-variants-panel";
import { BulkPanel } from "@/components/resource/bulk-panel";
import { toast } from "@/lib/toast-store";
import { fieldLabel, titleCase } from "@/lib/format";

const SLUG_TO_SCHEMA: Record<string, string> = Object.fromEntries(ENTITY_ORDER.map((name) => [slugFor(name), name]));

const PAGE_SIZE = 20;

function humanizeStatus(status: string): string {
  return status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export default function ResourceListPage() {
  const { entity } = useParams<{ entity: string }>();
  const { theme } = useTheme();
  const schemaName = entity ? SLUG_TO_SCHEMA[entity] : undefined;

  const [pageNo, setPageNo] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);

  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EntityRecord | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const meta = useMemo(() => (schemaName ? getEntityMeta(schemaName) : undefined), [schemaName]);
  const searchField = schemaName ? SEARCH_FIELD_BY_SCHEMA[schemaName] : undefined;
  const statusOptions = (schemaName ? STATUS_OPTIONS_BY_SCHEMA[schemaName] : undefined) ?? [];

  const where = useMemo(() => {
    const w: Record<string, unknown> = {};
    if (search && searchField) w[searchField] = { contains: search };
    if (statusFilter) w.Status = { eq: statusFilter };
    return Object.keys(w).length > 0 ? w : undefined;
  }, [search, searchField, statusFilter]);

  const list = useEntityList(schemaName ?? "", { pageNo, pageSize: PAGE_SIZE, where });
  const mutations = useEntityMutations(schemaName ?? "");
  const items = list.data?.items ?? [];
  const { user } = useAuth();

  const isProduct = schemaName === "Product";
  const isWarehouse = schemaName === "Warehouse";

  const { referenceLabels, lookupsBySchema } = useReferenceLabels(meta, items);
  const placeholders = useMemo(() => (isProduct ? assignPlaceholders(items, theme) : []), [isProduct, items, theme]);

  // Mirrors the Data Gateway's actual (or drafted, per P0_POLICY_FIXES.json) access
  // policies — see list-config.ts. Doesn't grant anything the backend wouldn't already
  // allow; only hides an action the backend would 403 on anyway.
  const isAdmin = useHasRole("admin");
  const canEdit = !!schemaName && !NO_EDIT_SCHEMAS.has(schemaName) && (!ADMIN_ONLY_EDIT_SCHEMAS.has(schemaName) || isAdmin);
  const canDelete = !!schemaName && !NO_DELETE_SCHEMAS.has(schemaName) && isAdmin;

  // Nothing on this platform expires a reservation on its own — no scheduler, no TTL index
  // (ECOMMERCE_PLATFORM_ON_BLOCKS.md §6.3). Opening this list is one of the few moments
  // someone is looking at reservations, so it's where the sweep runs: release the stock held
  // by anything past its expiry, then refresh so the rows show it. Throttled per session
  // inside the module, and a failure here is deliberately silent — it's housekeeping, not
  // something the person came to this page to do.
  const refetchList = list.refetch;
  useEffect(() => {
    if (schemaName !== "InventoryReservation") return;
    let cancelled = false;
    void sweepExpiredReservations({
      actor: user ? { type: "user", id: user.itemId, name: `${user.firstName} ${user.lastName}`.trim() } : undefined,
    })
      .then((result) => {
        if (cancelled || result.expired === 0) return;
        void refetchList();
        toast.success(
          `Released stock from ${result.expired} expired reservation${result.expired === 1 ? "" : "s"}.`
        );
        if (result.needsAttention.length > 0) {
          toast.error(
            `${result.needsAttention.length} expired reservation(s) could not release their stock — ` +
              `they show as expired with no released date and need checking.`
          );
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [schemaName, user, refetchList]);

  if (!schemaName || !meta) return <Navigate to="/" replace />;

  const totalCount = list.data?.totalCount ?? 0;
  const hasNextPage = pageNo * PAGE_SIZE < totalCount;
  const hasFilters = Boolean(searchInput) || Boolean(statusFilter);
  const label = titleCase(schemaName);

  function closeModals() {
    setEditing(null);
    setCreating(false);
    setDeleting(null);
  }

  function updateSearch(value: string) {
    setSearchInput(value);
    setPageNo(1);
  }

  function updateStatus(value: string) {
    setStatusFilter(value);
    setPageNo(1);
  }

  function clearFilters() {
    setSearchInput("");
    setStatusFilter("");
    setPageNo(1);
  }

  function handleCreate(payload: Record<string, unknown>) {
    mutations.create.mutate(payload, {
      onSuccess: () => {
        toast.success(`${label} created.`);
        closeModals();
      },
    });
  }

  function handleUpdate(payload: Record<string, unknown>) {
    if (!editing) return;
    const itemId = (editing.ItemId ?? editing.itemId) as string;
    mutations.update.mutate(
      { itemId, payload },
      {
        onSuccess: () => {
          toast.success(`${label} updated.`);
          closeModals();
        },
      }
    );
  }

  function handleDelete() {
    if (!deleting) return;
    mutations.remove.mutate(deleting, {
      onSuccess: () => {
        toast.success(`${label} deleted.`);
        closeModals();
      },
    });
  }

  /** Shared by every guided lifecycle action — one mutation + toast pattern, not reimplemented per schema. */
  function onTransition(itemId: string, payload: Record<string, unknown>, successMessage: string) {
    mutations.update.mutate({ itemId, payload }, { onSuccess: () => toast.success(successMessage) });
  }

  /**
   * Looked up per schema from `lifecycle-actions.ts`'s registry — see
   * `reservation-actions.ts`/`stock-transfer-actions.ts`/`purchase-order-actions.ts` for what
   * each schema actually offers. A schema with no registered actions/warning just gets `[]`/
   * `null`, same as before any of this existed.
   */
  function extraRowActions(record: EntityRecord): DropdownMenuItem[] {
    const actionsFn = schemaName ? LIFECYCLE_ACTIONS_BY_SCHEMA[schemaName] : undefined;
    return actionsFn ? actionsFn(record, { isAdmin, canEdit, approverIdentity: user?.email, onTransition }) : [];
  }

  function rowWarning(record: EntityRecord): string | null {
    const warningFn = schemaName ? ROW_WARNING_BY_SCHEMA[schemaName] : undefined;
    return warningFn ? warningFn(record) : null;
  }

  const newButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus size={16} /> New {label}
    </Button>
  );

  return (
    <div className="pb-2 pt-1">
      <PageHeader
        breadcrumbs={[{ label: "Dashboard", to: "/admin" }, { label: `${label}s` }]}
        title={`${label}s`}
        description={`Manage ${label.toLowerCase()} records, details, and status.`}
        actions={
          // Import writes through the same create/update calls the forms use, so the same
          // access policies apply — but it's hidden where the UI already hides editing, so
          // the ledger can't be bulk-written from a screen that refuses single edits.
          canEdit ? (
            <Button variant="secondary" onClick={() => setBulkOpen(true)}>
              <FileSpreadsheet size={15} /> Import / export
            </Button>
          ) : undefined
        }
      />

      <section className="admin-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-hairline px-5 py-5 lg:flex-row lg:items-center">
          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center">
            {searchField && (
              <SearchInput
                value={searchInput}
                onChange={(e) => updateSearch(e.target.value)}
                placeholder={`Search by ${fieldLabel(searchField).toLowerCase()}…`}
                aria-label={`Search ${label.toLowerCase()}s`}
                className="w-full sm:w-72"
              />
            )}
            {statusOptions.length > 0 && (
              <Select value={statusFilter} onChange={(e) => updateStatus(e.target.value)} className="w-full sm:w-44" aria-label="Filter by status">
                <option value="">All statuses</option>
                {statusOptions.map((s) => (
                  <option key={s} value={s}>{humanizeStatus(s)}</option>
                ))}
              </Select>
            )}
            {hasFilters && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
          </div>
          <div className="flex items-center justify-between gap-3 lg:justify-end">
            <span className="text-sm text-muted">{totalCount} total</span>
            {newButton}
          </div>
        </div>

        {list.isLoading ? (
          isWarehouse ? <CardGridSkeleton /> : <div className="p-5"><TableSkeleton columns={isProduct ? 7 : 5} /></div>
        ) : list.isError ? (
          <div className="p-5"><ErrorState message={list.error instanceof Error ? list.error.message : undefined} onRetry={() => list.refetch()} /></div>
        ) : items.length === 0 ? (
          <div className="p-5"><EmptyState title={hasFilters ? "No matching records" : `No ${label.toLowerCase()} records yet`} description={hasFilters ? "Try a different search or clear the filters." : "Create the first one to get started."} action={!hasFilters ? newButton : undefined} /></div>
        ) : (
          <>
          {isProduct ? (
            <ProductTable
              items={items}
              categoryNames={lookupsBySchema.Category}
              brandNames={lookupsBySchema.Brand}
              placeholders={placeholders}
              onEdit={setEditing}
              onDelete={setDeleting}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ) : isWarehouse ? (
            <WarehouseCardGrid items={items} onEdit={setEditing} onDelete={setDeleting} canEdit={canEdit} canDelete={canDelete} />
          ) : (
            <ResourceTable
              meta={meta}
              items={items}
              onEdit={setEditing}
              onDelete={setDeleting}
              referenceLabels={referenceLabels}
              canEdit={canEdit}
              canDelete={canDelete}
              extraRowActions={extraRowActions}
              rowWarning={rowWarning}
            />
          )}
          <div className="flex flex-col gap-3 border-t border-hairline px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted">
              Showing {(pageNo - 1) * PAGE_SIZE + 1} to {Math.min(pageNo * PAGE_SIZE, totalCount)} of {totalCount} entries
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
        )}
      </section>

      {(creating || editing) && (
        <Drawer
          onClose={closeModals}
          title={editing ? `Edit ${label}` : `New ${label}`}
          description={editing ? `Update this ${label.toLowerCase()}'s details.` : `Add a new ${label.toLowerCase()} to the catalog.`}
        >
          <ResourceForm
            meta={meta}
            record={editing}
            submitting={mutations.create.isPending || mutations.update.isPending}
            onSubmit={editing ? handleUpdate : handleCreate}
            onCancel={closeModals}
            extraSections={
              isProduct ? (
                <div className="border-t border-hairline pt-6">
                  {editing ? (
                    <ProductVariantsPanel productId={(editing.ItemId ?? editing.itemId) as string} />
                  ) : (
                    // A variant points at a product by id, and this one doesn't have one yet.
                    // Said plainly here rather than showing a disabled panel that looks broken.
                    <p className="text-xs text-muted">
                      Save this product first, then reopen it to add variants — a variant has to
                      point at a product that exists.
                    </p>
                  )}
                </div>
              ) : undefined
            }
          />
        </Drawer>
      )}

      {bulkOpen && (
        <Drawer
          onClose={() => setBulkOpen(false)}
          title={`Import / export ${label.toLowerCase()}s`}
          description="Move records in and out as CSV."
        >
          <BulkPanel meta={meta} where={where} onDone={() => void refetchList()} />
        </Drawer>
      )}

      {deleting && (
        <ConfirmDialog
          title={`Delete this ${label.toLowerCase()}?`}
          description="This action can't be undone."
          confirmLabel="Delete"
          danger
          loading={mutations.remove.isPending}
          onConfirm={handleDelete}
          onCancel={closeModals}
        />
      )}
    </div>
  );
}
