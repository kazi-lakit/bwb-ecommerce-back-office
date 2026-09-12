import { blocksClient } from "./client";
import { blocksDataCall } from "./http";
import { commitStock, releaseStock, type Actor, type StockLine } from "./inventory-ops";

/**
 * Orders admin, written against the `Order`/`OrderItem` schemas drafted in
 * `COMMERCE_SCHEMAS_DRAFT.json` and not yet imported — so this module is inert until that
 * happens, exactly like the storefront's `commerce.ts`.
 *
 * Hand-written GraphQL rather than `createEntityApi("Order")`: that helper reads its shape
 * from the generated `schema-meta.ts`, which deliberately has no `Order` in it yet
 * (regenerating before the schema is live would break every screen that uses it). This module
 * has no such dependency and works the moment the import lands.
 */

/** Same flag the storefront uses, so both halves of Commerce switch on together. */
export const COMMERCE_SCHEMAS_LIVE = import.meta.env.VITE_COMMERCE_SCHEMAS_LIVE === "true";

export const ORDER_STATUSES = ["Draft", "PendingPayment", "Confirmed", "Cancelled", "Completed"] as const;
export const PAYMENT_STATUSES = ["Pending", "Authorized", "Paid", "PartiallyRefunded", "Refunded", "Failed"] as const;
export const FULFILLMENT_STATUSES = [
  "Unallocated", "Allocated", "Picking", "Packed", "PartiallyShipped", "Shipped", "Delivered",
] as const;

export interface OrderItemRecord {
  ProductId?: string;
  VariantId?: string;
  Sku?: string;
  NameSnapshot?: string;
  UnitPrice?: number;
  Quantity?: number;
  TaxAmount?: number;
  DiscountAmount?: number;
  LineTotal?: number;
}

export interface OrderRecord {
  ItemId: string;
  OrderNumber?: string;
  CustomerId?: string;
  Status?: string;
  PaymentStatus?: string;
  FulfillmentStatus?: string;
  Items?: OrderItemRecord[];
  ShippingAddress?: Record<string, string | undefined>;
  BillingAddress?: Record<string, string | undefined>;
  Currency?: string;
  SubTotal?: number;
  TaxTotal?: number;
  DiscountTotal?: number;
  ShippingTotal?: number;
  GrandTotal?: number;
  CouponCode?: string;
  SalesChannelType?: string;
  PlacedDate?: string;
  ConfirmedDate?: string;
  CancelledDate?: string;
  CreatedDate?: string;
}

const ADDRESS_FIELDS = "Line1 Line2 City State PostalCode CountryCode";
const ORDER_FIELDS = `ItemId OrderNumber CustomerId Status PaymentStatus FulfillmentStatus Currency
  SubTotal TaxTotal DiscountTotal ShippingTotal GrandTotal CouponCode SalesChannelType
  PlacedDate ConfirmedDate CancelledDate CreatedDate
  Items { ProductId VariantId Sku NameSnapshot UnitPrice Quantity TaxAmount DiscountAmount LineTotal }
  ShippingAddress { ${ADDRESS_FIELDS} }
  BillingAddress { ${ADDRESS_FIELDS} }`;

const LIST_QUERY = `query getOrders($where: OrderFilterInput, $paging: PaginationInput) {
  getOrders(where: $where, paging: $paging) {
    items { ${ORDER_FIELDS} }
    totalCount
  }
}`;

const UPDATE_MUTATION = `mutation updateOrder($where: OrderFilterInput, $input: OrderUpdateInput!) {
  updateOrder(where: $where, input: $input) { acknowledged totalImpactedData message }
}`;

export interface OrderListParams {
  pageNo?: number;
  pageSize?: number;
  status?: string;
  paymentStatus?: string;
  /** Matched against OrderNumber. */
  search?: string;
}

export async function listOrders(params: OrderListParams = {}): Promise<{ items: OrderRecord[]; totalCount: number }> {
  const where: Record<string, unknown> = {};
  if (params.status) where.Status = { eq: params.status };
  if (params.paymentStatus) where.PaymentStatus = { eq: params.paymentStatus };
  if (params.search) where.OrderNumber = { contains: params.search };

  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "getOrders",
      query: LIST_QUERY,
      variables: {
        where: Object.keys(where).length > 0 ? where : undefined,
        paging: { pageNo: params.pageNo ?? 1, pageSize: params.pageSize ?? 20 },
      },
    })
  )) as { data?: { getOrders?: { items?: OrderRecord[]; totalCount?: number } } };

  return {
    items: response.data?.getOrders?.items ?? [],
    totalCount: response.data?.getOrders?.totalCount ?? 0,
  };
}

async function patchOrder(itemId: string, input: Record<string, unknown>): Promise<void> {
  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "updateOrder",
      query: UPDATE_MUTATION,
      variables: { where: { ItemId: { eq: itemId } }, input },
    })
  )) as { data?: { updateOrder?: { totalImpactedData?: number } } };
  if ((response.data?.updateOrder?.totalImpactedData ?? 0) !== 1) {
    throw new Error("The order was not updated — it may have changed since this page loaded.");
  }
}

// --- The reservation an order is holding -------------------------------------------------
//
// Reservations point at their order through `Source.Id`, which is a sub-field of a composite
// type. Whether the generated `InventoryReservationFilterInput` exposes nested filtering
// isn't something to guess at without a live schema to check, and sub-fields provably can't
// be indexed anyway (see INDEX_PLAN.json's second hazard) — so this filters on the two
// top-level fields that definitely work and matches the order client-side over a bounded page.

const RESERVATION_QUERY = `query getInventoryReservations($where: InventoryReservationFilterInput, $paging: PaginationInput) {
  getInventoryReservations(where: $where, paging: $paging) {
    items {
      ItemId
      ReservationNumber
      Status
      Source { Type Id Number }
      Items { WarehouseId ProductId VariantId Sku Quantity }
    }
    totalCount
  }
}`;

const RESERVATION_UPDATE = `mutation updateInventoryReservation($where: InventoryReservationFilterInput, $input: InventoryReservationUpdateInput!) {
  updateInventoryReservation(where: $where, input: $input) { acknowledged totalImpactedData }
}`;

interface ReservationRecord {
  ItemId?: string;
  ReservationNumber?: string;
  Status?: string;
  Source?: { Type?: string; Id?: string; Number?: string };
  Items?: { WarehouseId?: string; ProductId?: string; VariantId?: string; Sku?: string; Quantity?: number }[];
}

export async function findActiveReservationForOrder(order: OrderRecord): Promise<ReservationRecord | null> {
  if (!order.CustomerId) return null;
  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "getInventoryReservations",
      query: RESERVATION_QUERY,
      variables: {
        where: { CustomerId: { eq: order.CustomerId }, Status: { eq: "active" } },
        paging: { pageNo: 1, pageSize: 50 },
      },
    })
  )) as { data?: { getInventoryReservations?: { items?: ReservationRecord[] } } };

  return (
    (response.data?.getInventoryReservations?.items ?? []).find(
      (row) => row.Source?.Type === "order" && row.Source?.Id === order.ItemId
    ) ?? null
  );
}

function toStockLines(reservation: ReservationRecord): StockLine[] {
  return (reservation.Items ?? [])
    .filter((item) => item.WarehouseId && item.VariantId && (item.Quantity ?? 0) > 0)
    .map((item) => ({
      warehouseId: item.WarehouseId as string,
      variantId: item.VariantId as string,
      productId: item.ProductId,
      sku: item.Sku,
      quantity: item.Quantity as number,
    }));
}

async function settleReservation(reservationId: string, status: "committed" | "released"): Promise<void> {
  await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "updateInventoryReservation",
      query: RESERVATION_UPDATE,
      variables: {
        where: { ItemId: { eq: reservationId }, Status: { eq: "active" } },
        input: {
          Status: status,
          ...(status === "committed"
            ? { CommittedDate: new Date().toISOString() }
            : { ReleasedDate: new Date().toISOString() }),
        },
      },
    })
  );
}

// --- Staff actions -----------------------------------------------------------------------

/**
 * Payment confirmation, by hand.
 *
 * This platform can't receive an inbound webhook (`BLOCKS_FEATURE_SUGGESTIONS.md` #1), so
 * there is nothing for a payment provider to call back into. A staff member reconciles
 * against the provider's own dashboard and records the result here — the mitigation
 * `ECOMMERCE_PLATFORM_ON_BLOCKS.md` §6.1/§6.3 prescribes, not a shortcut around one.
 */
export async function confirmPayment(order: OrderRecord): Promise<void> {
  await patchOrder(order.ItemId, {
    PaymentStatus: "Paid",
    Status: order.Status === "Cancelled" ? order.Status : "Confirmed",
    ConfirmedDate: new Date().toISOString(),
  });
}

export async function markPaymentFailed(order: OrderRecord): Promise<void> {
  await patchOrder(order.ItemId, { PaymentStatus: "Failed" });
}

export interface FulfillResult {
  committedLines: number;
  /** Set when the order had no reservation to commit — not an error, but worth saying. */
  noReservation?: boolean;
  /** Lines whose stock could not be committed, with the reason from inventory-ops. */
  failures: { variantId: string; reason?: string }[];
}

/**
 * Ship an order: consume the stock it has been holding, then record the fulfilment.
 *
 * This is where `commitStock` belongs and the only place it's called. Committing reduces
 * on-hand, which is what happens when goods physically leave the building — the storefront
 * can't know that, so checkout only ever reserves (see `checkout-inventory.ts`). This closes
 * that loop.
 *
 * Stock first, order second. If the commit half-fails the order stays un-shipped and the
 * failures are reported, which is recoverable; marking it Shipped and then failing to move
 * the stock would leave the balances quietly wrong with nothing pointing at why.
 */
export async function fulfillOrder(order: OrderRecord, actor?: Actor): Promise<FulfillResult> {
  const reservation = await findActiveReservationForOrder(order);
  if (!reservation?.ItemId) {
    // Nothing held — an order placed before reservations were switched on, or one whose hold
    // already expired. Recording the shipment is still right; the stock just isn't ours to
    // consume here, and a manual adjustment is the honest way to correct on-hand.
    await patchOrder(order.ItemId, { FulfillmentStatus: "Shipped" });
    return { committedLines: 0, noReservation: true, failures: [] };
  }

  const lines = toStockLines(reservation);
  const result = await commitStock(lines, {
    reference: { type: "order", id: order.ItemId, number: order.OrderNumber },
    performedBy: actor,
    reasonCode: "order_fulfilled",
    idempotencyKey: `fulfill:${order.ItemId}`,
  });

  const failures = result.lines
    .filter((line) => !line.ok)
    .map((line) => ({ variantId: line.line.variantId, reason: line.message ?? line.reason }));

  if (failures.length > 0) return { committedLines: result.lines.length - failures.length, failures };

  await settleReservation(reservation.ItemId, "committed");
  await patchOrder(order.ItemId, {
    FulfillmentStatus: "Shipped",
    Status: order.PaymentStatus === "Paid" ? "Completed" : order.Status,
  });
  return { committedLines: lines.length, failures: [] };
}

/**
 * Cancel an order and give back whatever it was holding.
 *
 * Release first, then cancel. A release only ever increases availability and is safe to
 * repeat, so the worst case of failing between the two steps is an order that still reads
 * as open — visible, and fixable by cancelling again. The reverse order risks a cancelled
 * order silently holding stock nobody will ever collect.
 */
export async function cancelOrder(order: OrderRecord, actor?: Actor): Promise<{ releasedLines: number }> {
  const reservation = await findActiveReservationForOrder(order);
  let releasedLines = 0;

  if (reservation?.ItemId) {
    const lines = toStockLines(reservation);
    const result = await releaseStock(lines, {
      reference: { type: "order", id: order.ItemId, number: order.OrderNumber },
      performedBy: actor,
      reasonCode: "order_cancelled",
      idempotencyKey: `cancel:${order.ItemId}`,
    });
    releasedLines = result.lines.filter((line) => line.ok).length;
    await settleReservation(reservation.ItemId, "released");
  }

  await patchOrder(order.ItemId, { Status: "Cancelled", CancelledDate: new Date().toISOString() });
  return { releasedLines };
}

/** Plain status edits that carry no stock or money consequences. */
export async function setFulfillmentStatus(order: OrderRecord, status: string): Promise<void> {
  await patchOrder(order.ItemId, { FulfillmentStatus: status });
}
