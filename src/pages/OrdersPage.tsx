import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useHasRole } from "@/lib/blocks/access";
import {
  COMMERCE_SCHEMAS_LIVE,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  cancelOrder,
  confirmPayment,
  fulfillOrder,
  listOrders,
  markPaymentFailed,
  setFulfillmentStatus,
  type OrderRecord,
} from "@/lib/blocks/orders";
import { toast } from "@/lib/toast-store";
import { formatCurrency, formatDate } from "@/lib/format";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { SearchInput } from "@/components/ui/search-input";
import { Drawer } from "@/components/ui/drawer";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { TableSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

const PAGE_SIZE = 20;

/**
 * Orders admin.
 *
 * Not built on `ResourceListPage`/`createEntityApi` like every other entity here: those read
 * their shape from the generated `schema-meta.ts`, which has no `Order` in it because the
 * schema isn't imported yet. This page talks to the gateway directly through `lib/blocks/orders.ts`
 * and starts working the moment `COMMERCE_SCHEMAS_DRAFT.json` lands, with no regeneration step.
 */
export default function OrdersPage() {
  const { user } = useAuth();
  const isAdmin = useHasRole("admin");
  const [pageNo, setPageNo] = useState(1);
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 300);
  const [selected, setSelected] = useState<OrderRecord | null>(null);
  const [confirming, setConfirming] = useState<null | { title: string; body: string; run: () => Promise<void> }>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setPageNo(1), [status, paymentStatus, search]);

  const query = useQuery({
    queryKey: ["orders", { pageNo, status, paymentStatus, search }],
    queryFn: () => listOrders({ pageNo, pageSize: PAGE_SIZE, status, paymentStatus, search }),
    placeholderData: (prev) => prev,
    enabled: COMMERCE_SCHEMAS_LIVE,
  });

  const actor = useMemo(
    () =>
      user
        ? { type: "user" as const, id: user.itemId, name: `${user.firstName} ${user.lastName}`.trim() }
        : undefined,
    [user]
  );

  const orders = query.data?.items ?? [];
  const totalCount = query.data?.totalCount ?? 0;

  const refresh = useCallback(async () => {
    const fresh = await query.refetch();
    if (!selected) return;
    setSelected(fresh.data?.items.find((o) => o.ItemId === selected.ItemId) ?? null);
  }, [query, selected]);

  const runAction = useCallback(
    async (label: string, action: () => Promise<string>) => {
      setBusy(true);
      try {
        toast.success(await action());
        await refresh();
      } catch (error) {
        toast.error(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        setBusy(false);
        setConfirming(null);
      }
    },
    [refresh]
  );

  if (!COMMERCE_SCHEMAS_LIVE) {
    return (
      <div className="py-6">
        <PageHeader title="Orders" description="Customer orders placed through the storefront." />
        <EmptyState
          icon={ShoppingBag}
          title="The Order schema isn't live yet"
          description={
            "This screen is built and waiting. Import COMMERCE_SCHEMAS_DRAFT.json on the Data Gateway, " +
            "reload, then set VITE_COMMERCE_SCHEMAS_LIVE=true here and in the storefront."
          }
        />
      </div>
    );
  }

  return (
    <div className="py-6">
      <PageHeader
        title="Orders"
        description="Confirm payments, fulfil orders and release stock on cancellation."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search order number…"
          className="w-60"
        />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44">
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
        <Select value={paymentStatus} onChange={(e) => setPaymentStatus(e.target.value)} className="w-48">
          <option value="">All payment states</option>
          {PAYMENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {query.isLoading ? (
        <TableSkeleton />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="No orders match" description="Try clearing the filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-hairline">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-surface text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Order</th>
                <th className="px-4 py-3 font-semibold">Placed</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Payment</th>
                <th className="px-4 py-3 font-semibold">Fulfilment</th>
                <th className="px-4 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.ItemId}
                  onClick={() => setSelected(order)}
                  className="cursor-pointer border-t border-hairline-soft hover:bg-surface"
                >
                  <td className="px-4 py-3 font-medium text-ink">{order.OrderNumber ?? order.ItemId}</td>
                  <td className="px-4 py-3 text-steel">{formatDate(order.PlacedDate ?? order.CreatedDate)}</td>
                  <td className="px-4 py-3">{order.Status && <StatusBadge status={order.Status} />}</td>
                  <td className="px-4 py-3">{order.PaymentStatus && <StatusBadge status={order.PaymentStatus} />}</td>
                  <td className="px-4 py-3">{order.FulfillmentStatus && <StatusBadge status={order.FulfillmentStatus} />}</td>
                  <td className="px-4 py-3 text-right font-medium text-ink">
                    {formatCurrency(order.GrandTotal, order.Currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalCount > PAGE_SIZE && (
        <div className="mt-4 flex items-center justify-between text-sm text-steel">
          <span>
            Page {pageNo} of {Math.ceil(totalCount / PAGE_SIZE)} — {totalCount} orders
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={pageNo <= 1} onClick={() => setPageNo((n) => n - 1)}>
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pageNo * PAGE_SIZE >= totalCount}
              onClick={() => setPageNo((n) => n + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {selected && (
        <Drawer
          onClose={() => setSelected(null)}
          title={selected.OrderNumber ?? "Order"}
          description={`Placed ${formatDate(selected.PlacedDate ?? selected.CreatedDate)}`}
        >
          <OrderDetail
            order={selected}
            isAdmin={isAdmin}
            busy={busy}
            onConfirm={setConfirming}
            onFulfillmentChange={(next) =>
              void runAction("Fulfilment update", async () => {
                await setFulfillmentStatus(selected, next);
                return `Fulfilment set to ${next}.`;
              })
            }
            actorName={actor?.name}
          />
        </Drawer>
      )}

      {confirming && (
        <ConfirmDialog
          title={confirming.title}
          description={confirming.body}
          confirmLabel="Confirm"
          onCancel={() => setConfirming(null)}
          onConfirm={() => void confirming.run()}
        />
      )}
    </div>
  );
}

function Money({ label, value, currency, strong }: { label: string; value?: number; currency?: string; strong?: boolean }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className={strong ? "font-semibold text-ink" : "text-steel"}>{label}</span>
      <span className={strong ? "font-semibold text-ink" : "text-ink"}>{formatCurrency(value, currency)}</span>
    </div>
  );
}

function OrderDetail({
  order,
  isAdmin,
  busy,
  onConfirm,
  onFulfillmentChange,
  actorName,
}: {
  order: OrderRecord;
  isAdmin: boolean;
  busy: boolean;
  onConfirm: (c: { title: string; body: string; run: () => Promise<void> }) => void;
  onFulfillmentChange: (status: string) => void;
  actorName?: string;
}) {
  const address = order.ShippingAddress;
  const cancelled = order.Status === "Cancelled";
  const paid = order.PaymentStatus === "Paid";
  const shipped = order.FulfillmentStatus === "Shipped" || order.FulfillmentStatus === "Delivered";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        {order.Status && <StatusBadge status={order.Status} />}
        {order.PaymentStatus && <StatusBadge status={order.PaymentStatus} />}
        {order.FulfillmentStatus && <StatusBadge status={order.FulfillmentStatus} />}
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">Items</h3>
        <div className="divide-y divide-hairline-soft rounded-md border border-hairline">
          {(order.Items ?? []).map((item, i) => (
            <div key={`${item.VariantId}-${i}`} className="flex items-start justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{item.NameSnapshot ?? item.Sku ?? item.VariantId}</p>
                <p className="text-xs text-muted">
                  {item.Sku ?? item.VariantId} · {item.Quantity} × {formatCurrency(item.UnitPrice, order.Currency)}
                </p>
              </div>
              <span className="whitespace-nowrap text-sm text-ink">
                {formatCurrency(item.LineTotal ?? (item.UnitPrice ?? 0) * (item.Quantity ?? 0), order.Currency)}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-hairline px-3 py-2">
        <Money label="Subtotal" value={order.SubTotal} currency={order.Currency} />
        <Money label="Tax" value={order.TaxTotal} currency={order.Currency} />
        <Money label="Shipping" value={order.ShippingTotal} currency={order.Currency} />
        {(order.DiscountTotal ?? 0) > 0 && (
          <Money label={`Discount${order.CouponCode ? ` (${order.CouponCode})` : ""}`} value={-(order.DiscountTotal ?? 0)} currency={order.Currency} />
        )}
        <Money label="Total" value={order.GrandTotal} currency={order.Currency} strong />
      </section>

      {address && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-ink">Ship to</h3>
          <p className="text-sm text-steel">
            {[address.Line1, address.Line2, address.City, address.State, address.PostalCode, address.CountryCode]
              .filter(Boolean)
              .join(", ")}
          </p>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Actions</h3>

        {/*
          Payment is recorded by a person, not a webhook. This platform can't receive an
          inbound callback, so a staff member reconciles against the provider's dashboard and
          records the outcome here — the mitigation the architecture doc prescribes, and the
          reason this button exists at all. Admin-gated: it's a money decision.
        */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || paid || cancelled || !isAdmin}
            onClick={() =>
              onConfirm({
                title: "Record payment as received?",
                body:
                  `Confirm only after checking the payment provider's own dashboard for ${order.OrderNumber}. ` +
                  `This marks the order Confirmed and Paid${actorName ? `, recorded against ${actorName}` : ""}.`,
                run: async () => {
                  await confirmPayment(order);
                },
              })
            }
          >
            Record payment received
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || paid || cancelled || !isAdmin}
            onClick={() =>
              onConfirm({
                title: "Mark payment failed?",
                body: `Records payment for ${order.OrderNumber} as failed. The order's stock stays reserved until it's cancelled.`,
                run: async () => {
                  await markPaymentFailed(order);
                },
              })
            }
          >
            Mark payment failed
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={order.FulfillmentStatus ?? ""}
            onChange={(e) => onFulfillmentChange(e.target.value)}
            disabled={busy || cancelled}
            className="w-48"
          >
            <option value="" disabled>Fulfilment status…</option>
            {FULFILLMENT_STATUSES.filter((s) => s !== "Shipped").map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </Select>

          {/*
            Shipping is the one fulfilment step that moves stock rather than just labelling it,
            which is why it's a deliberate action and not another option in the dropdown above.
          */}
          <Button
            size="sm"
            disabled={busy || shipped || cancelled}
            onClick={() =>
              onConfirm({
                title: "Mark shipped and consume the reserved stock?",
                body:
                  `This reduces on-hand stock for every line on ${order.OrderNumber} — the goods are leaving. ` +
                  `It can't be undone from here; correcting it means a manual inventory adjustment.`,
                run: async () => {
                  const result = await fulfillOrder(order);
                  if (result.failures.length > 0) {
                    throw new Error(
                      `${result.failures.length} line(s) could not be committed: ` +
                        result.failures.map((f) => `${f.variantId} (${f.reason})`).join(", ")
                    );
                  }
                  if (result.noReservation) {
                    toast.error(
                      "Marked shipped, but this order had no active reservation — on-hand stock was not reduced. " +
                        "Adjust inventory by hand if it was."
                    );
                  }
                },
              })
            }
          >
            Mark shipped
          </Button>
        </div>

        <Button
          size="sm"
          variant="secondary"
          disabled={busy || cancelled || !isAdmin}
          onClick={() =>
            onConfirm({
              title: "Cancel this order?",
              body: `Releases any stock ${order.OrderNumber} is holding back to available, and marks the order cancelled.`,
              run: async () => {
                await cancelOrder(order);
              },
            })
          }
        >
          Cancel order
        </Button>
      </section>
    </div>
  );
}
