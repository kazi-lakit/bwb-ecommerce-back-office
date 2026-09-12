import { blocksClient } from "./client";
import { blocksDataCall } from "./http";
import { INVENTORY_WRITES_LIVE, releaseStock, type Actor, type StockLine } from "./inventory-ops";

/**
 * Releases stock held by reservations that have passed their expiry.
 *
 * There is no scheduler on this platform — no cron, no TTL index, no background worker, and
 * building one is explicitly out of scope (`ECOMMERCE_PLATFORM_ON_BLOCKS.md` §6.3). So expiry
 * is lazy and client-triggered: whoever next looks at reservations, or starts a checkout,
 * does a small bounded sweep first. Abandoned carts therefore hold stock until *someone*
 * shows up, not forever — which is the honest ceiling on what's achievable here, and why
 * `RESERVATION_TTL_MINUTES` in `checkout-inventory.ts` is short.
 *
 * **This file is mirrored byte-for-byte in `ecommerce-back-office`**, like `inventory-ops.ts`.
 */

/** Small on purpose: this runs in front of a page load and must never be what makes it slow. */
const DEFAULT_LIMIT = 25;
/** Per session, so a busy list page doesn't sweep on every render. */
const MIN_INTERVAL_MS = 60_000;

let lastSweepAt = 0;

export interface SweepResult {
  scanned: number;
  expired: number;
  releasedLines: number;
  /**
   * Reservations claimed as expired whose stock could not then be released. The record says
   * expired but carries no `ReleasedDate`, which is the signal to reconcile by hand — see the
   * ordering note on `sweepExpiredReservations`.
   */
  needsAttention: string[];
  skipped?: "writes-disabled" | "throttled";
}

interface ReservationRow {
  ItemId?: string;
  ReservationNumber?: string;
  Items?: { WarehouseId?: string; ProductId?: string; VariantId?: string; Sku?: string; Quantity?: number }[];
}

const EXPIRED_QUERY = `query getInventoryReservations($where: InventoryReservationFilterInput, $paging: PaginationInput) {
  getInventoryReservations(where: $where, paging: $paging) {
    items {
      ItemId
      ReservationNumber
      Items { WarehouseId ProductId VariantId Sku Quantity }
    }
    totalCount
  }
}`;

const CLAIM_MUTATION = `mutation updateInventoryReservation($where: InventoryReservationFilterInput, $input: InventoryReservationUpdateInput!) {
  updateInventoryReservation(where: $where, input: $input) {
    acknowledged
    totalImpactedData
  }
}`;

/**
 * Take ownership of one expired reservation, conditionally.
 *
 * This is the same compare-and-swap idea as the balance writes, applied to the reservation's
 * own status: the filter requires `Status` to still be `active`, so of two clients sweeping at
 * once exactly one gets `totalImpactedData === 1` and the other gets 0 and moves on. Without
 * it, both would release the same lines — and because `releaseStock` clamps to whatever is
 * currently reserved rather than to this reservation's share, the second release would eat
 * into stock held by *other* people's reservations. That's a silent oversell, arriving by a
 * different route than the one the CAS module guards.
 */
async function claimExpired(reservationId: string): Promise<boolean> {
  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "updateInventoryReservation",
      query: CLAIM_MUTATION,
      variables: {
        where: { ItemId: { eq: reservationId }, Status: { eq: "active" } },
        // Deliberately no ReleasedDate yet — that's set once the stock is actually back.
        input: { Status: "expired" },
      },
    })
  )) as { data?: { updateInventoryReservation?: { totalImpactedData?: number } } };
  return (response.data?.updateInventoryReservation?.totalImpactedData ?? 0) === 1;
}

async function markReleased(reservationId: string): Promise<void> {
  await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "updateInventoryReservation",
      query: CLAIM_MUTATION,
      variables: {
        where: { ItemId: { eq: reservationId } },
        input: { ReleasedDate: new Date().toISOString() },
      },
    })
  );
}

function toStockLines(row: ReservationRow): StockLine[] {
  return (row.Items ?? [])
    .filter((item) => item.WarehouseId && item.VariantId && (item.Quantity ?? 0) > 0)
    .map((item) => ({
      warehouseId: item.WarehouseId as string,
      variantId: item.VariantId as string,
      productId: item.ProductId,
      sku: item.Sku,
      quantity: item.Quantity as number,
    }));
}

/**
 * Sweep, claim, release.
 *
 * Claim *before* releasing, not after. Releasing first and marking afterwards would let two
 * concurrent sweepers double-release (see `claimExpired`). The cost of claiming first is the
 * opposite failure: if the release then fails, the record reads `expired` while its stock is
 * still held. That case is reported in `needsAttention` and is visible in the data as an
 * expired reservation with no `ReleasedDate` — recoverable, and strictly better than
 * corrupting other reservations' stock.
 */
export async function sweepExpiredReservations(options: {
  limit?: number;
  actor?: Actor;
  /** Ignore the per-session throttle. For an explicit "run it now" action. */
  force?: boolean;
} = {}): Promise<SweepResult> {
  const empty: SweepResult = { scanned: 0, expired: 0, releasedLines: 0, needsAttention: [] };
  if (!INVENTORY_WRITES_LIVE) return { ...empty, skipped: "writes-disabled" };
  if (!options.force && Date.now() - lastSweepAt < MIN_INTERVAL_MS) {
    return { ...empty, skipped: "throttled" };
  }
  lastSweepAt = Date.now();

  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "getInventoryReservations",
      query: EXPIRED_QUERY,
      variables: {
        where: { Status: { eq: "active" }, ExpiresDate: { lt: new Date().toISOString() } },
        paging: { pageNo: 1, pageSize: options.limit ?? DEFAULT_LIMIT },
      },
    })
  )) as { data?: { getInventoryReservations?: { items?: ReservationRow[] } } };

  const rows = response.data?.getInventoryReservations?.items ?? [];
  const result: SweepResult = { ...empty, scanned: rows.length, needsAttention: [] };

  for (const row of rows) {
    const reservationId = row.ItemId;
    if (!reservationId) continue;

    let claimed = false;
    try {
      claimed = await claimExpired(reservationId);
    } catch {
      continue; // Someone else's problem this round; the next sweep will find it again.
    }
    if (!claimed) continue; // Another sweeper got there first.

    result.expired += 1;
    const lines = toStockLines(row);
    if (lines.length === 0) {
      await markReleased(reservationId).catch(() => undefined);
      continue;
    }

    const released = await releaseStock(lines, {
      reference: { type: "reservation", id: reservationId, number: row.ReservationNumber },
      performedBy: options.actor,
      reasonCode: "reservation_expired",
      idempotencyKey: `expire:${reservationId}`,
    });

    if (released.ok) {
      result.releasedLines += lines.length;
      await markReleased(reservationId).catch(() => undefined);
    } else {
      result.needsAttention.push(reservationId);
    }
  }

  return result;
}

/** Fire-and-forget, for page-load triggers where nothing should wait on the result. */
export function sweepExpiredReservationsInBackground(actor?: Actor): void {
  void sweepExpiredReservations({ actor }).catch(() => undefined);
}
