import { blocksClient } from "./client";
import { blocksDataCall } from "./http";

/**
 * Guarded compare-and-swap stock operations — the mechanism that prevents overselling.
 *
 * The Data Gateway has no atomic `$inc`, no multi-document transaction and no server-side
 * hook, so every stock change is: read the balance → compute the new one → write it with a
 * filter that makes the write conditional on nothing having changed underneath → check
 * `totalImpactedData`. `updateWarehouseInventory(where:, input:)` compiles to a single Mongo
 * `UpdateOne`, so the filter and the write are one atomic step. See
 * `bwb-ecommerce-docs/ECOMMERCE_PLATFORM_ON_BLOCKS.md` §5.1 for the design, and
 * `DATA_GATEWAY_STORAGE_FEATURES_AND_SECURITY.md` for why the alternatives don't exist.
 *
 * Hand-written GraphQL rather than `createEntityApi("WarehouseInventory")`: that helper
 * always filters by `ItemId` alone, which is exactly the guard-less write this module exists
 * to avoid, and it couples to the generated `schema-meta.ts`.
 *
 * **This file is mirrored byte-for-byte in `ecommerce-back-office`.** The storefront reserves
 * and releases; the backoffice commits, releases and expires. Same rules both sides, so
 * change both or neither — this workspace has no shared package (`collections.ts` and
 * `schema-meta.ts` are duplicated the same way).
 */

/**
 * Off by default, and it must stay that way until `P0_POLICY_FIXES.json` is imported.
 * `WarehouseInventory` currently has `WriteAccessLevel`/`EditAccessLevel = Custom` with **no**
 * allow policy, which the gateway evaluates as deny-for-everyone — admins included — so every
 * write below is rejected today (task breakdown §1.1). The flag keeps callers on their
 * existing non-reserving path rather than failing checkout with an access-denied error.
 */
export const INVENTORY_WRITES_LIVE = import.meta.env.VITE_INVENTORY_WRITES_LIVE === "true";

/** Bounded, per the §5.1 recommendation. Contention past this is reported, not retried forever. */
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 40;

export interface StockLine {
  warehouseId: string;
  variantId: string;
  productId?: string;
  sku?: string;
  /** Always positive. The operation decides the sign. */
  quantity: number;
}

export interface SourceReference {
  type: string;
  id: string;
  number?: string;
}

export interface Actor {
  type: "user" | "system" | "integration";
  id: string;
  name?: string;
}

export interface StockOpContext {
  reference: SourceReference;
  performedBy?: Actor;
  reasonCode?: string;
  notes?: string;
  /**
   * Stable across retries of the same business action. One key per operation; this module
   * derives a per-line key from it, so a retried multi-line reserve can't double-apply any
   * single line. Generate with `crypto.randomUUID()` once, then reuse.
   */
  idempotencyKey: string;
}

export type LineFailure =
  | "insufficient"
  | "contention"
  | "not-found"
  | "no-version"
  | "denied"
  | "error";

export interface Balance {
  itemId: string;
  version: number;
  onHand: number;
  reserved: number;
  damaged: number;
  qualityHold: number;
  blocked: number;
  backordered: number;
  inTransit: number;
  incoming: number;
  availableToSell: number;
}

export interface LineResult {
  line: StockLine;
  ok: boolean;
  reason?: LineFailure;
  message?: string;
  attempts: number;
  balanceAfter?: Balance;
  /** True when the balance moved but its ledger row could not be written. See writeMovement. */
  ledgerWriteFailed?: boolean;
}

export interface StockOpResult {
  ok: boolean;
  lines: LineResult[];
  /** Lines that succeeded and were then rolled back because a sibling line failed. */
  compensated: LineResult[];
}

type Op = "reserve" | "release" | "commit";

interface GraphqlResponse {
  data?: Record<string, unknown>;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * `AvailableToSell` is stored rather than derived, because the CAS guard has to filter on it
 * — a computed field can't appear in a `where`. That makes drift possible, so this is the one
 * authoritative definition and every write recomputes from the buckets rather than adjusting
 * the stored number, which self-heals any drift it finds.
 *
 * `Blocked` only exists once `SCHEMA_BATCH_2.json` is imported; until then it reads as 0,
 * which is the correct behaviour for a bucket nothing can populate yet.
 */
function computeAvailable(b: Omit<Balance, "availableToSell" | "itemId" | "version">): number {
  return b.onHand - b.reserved - b.damaged - b.qualityHold - b.blocked;
}

const BALANCE_QUERY = `query getWarehouseInventorys($where: WarehouseInventoryFilterInput, $paging: PaginationInput) {
  getWarehouseInventorys(where: $where, paging: $paging) {
    items {
      ItemId
      Version
      AvailableToSell
      Quantity { OnHand Reserved Damaged QualityHold Incoming Blocked Backordered InTransit }
    }
    totalCount
  }
}`;

/**
 * Selects the three batch-2 buckets, which don't exist on the gateway yet. A GraphQL query
 * naming a field the schema doesn't have fails outright, so this falls back to the pre-batch-2
 * selection on the first such failure and remembers the answer for the session.
 */
let balanceQuery = BALANCE_QUERY;
const LEGACY_BALANCE_QUERY = BALANCE_QUERY.replace(" Blocked Backordered InTransit", "");

async function readBalance(warehouseId: string, variantId: string): Promise<Balance | null> {
  const run = (query: string) =>
    blocksDataCall(() =>
      blocksClient.data.graphql({
        operationName: "getWarehouseInventorys",
        query,
        variables: {
          where: { WarehouseId: { eq: warehouseId }, VariantId: { eq: variantId } },
          paging: { pageNo: 1, pageSize: 1 },
        },
      })
    ) as Promise<GraphqlResponse>;

  let response: GraphqlResponse;
  try {
    response = await run(balanceQuery);
  } catch (error) {
    if (balanceQuery === BALANCE_QUERY) {
      balanceQuery = LEGACY_BALANCE_QUERY;
      response = await run(balanceQuery);
    } else {
      throw error;
    }
  }

  const list = response.data?.getWarehouseInventorys as { items?: Record<string, unknown>[] } | undefined;
  const row = list?.items?.[0];
  if (!row) return null;

  const q = (row.Quantity ?? {}) as Record<string, unknown>;
  const buckets = {
    onHand: num(q.OnHand),
    reserved: num(q.Reserved),
    damaged: num(q.Damaged),
    qualityHold: num(q.QualityHold),
    blocked: num(q.Blocked),
    backordered: num(q.Backordered),
    inTransit: num(q.InTransit),
    incoming: num(q.Incoming),
  };

  return {
    itemId: String(row.ItemId ?? ""),
    // NaN rather than 0 when absent: 0 is a legitimate version and would silently produce an
    // unguarded-in-effect write. applyLine refuses to proceed on a non-finite version.
    version: typeof row.Version === "number" ? row.Version : Number.NaN,
    ...buckets,
    availableToSell: num(row.AvailableToSell),
  };
}

const UPDATE_MUTATION = `mutation updateWarehouseInventory($where: WarehouseInventoryFilterInput, $input: WarehouseInventoryUpdateInput!) {
  updateWarehouseInventory(where: $where, input: $input) {
    acknowledged
    totalImpactedData
    message
  }
}`;

/**
 * One conditional write. Returns how many documents it actually changed — 0 means the guard
 * rejected it (someone else moved the version, or availability dropped below the requested
 * quantity) and the caller should re-read and try again.
 */
async function casWrite(
  current: Balance,
  next: Omit<Balance, "itemId" | "version">,
  guardAvailableAtLeast: number | null
): Promise<number> {
  const where: Record<string, unknown> = {
    ItemId: { eq: current.itemId },
    Version: { eq: current.version },
  };
  // The oversell guard proper. Release and commit omit it: both only ever give stock back,
  // and gating them on availability would make a release fail exactly when stock is tightest.
  if (guardAvailableAtLeast !== null) {
    where.AvailableToSell = { gte: guardAvailableAtLeast };
  }

  const quantity: Record<string, number> = {
    OnHand: next.onHand,
    Reserved: next.reserved,
    Damaged: next.damaged,
    QualityHold: next.qualityHold,
    Incoming: next.incoming,
  };
  // Only send the batch-2 buckets once they're known to exist, for the same reason the read
  // query has a fallback: naming an unknown field fails the whole mutation.
  if (balanceQuery === BALANCE_QUERY) {
    quantity.Blocked = next.blocked;
    quantity.Backordered = next.backordered;
    quantity.InTransit = next.inTransit;
  }

  const response = (await blocksDataCall(() =>
    blocksClient.data.graphql({
      operationName: "updateWarehouseInventory",
      query: UPDATE_MUTATION,
      variables: {
        where,
        input: {
          Quantity: quantity,
          AvailableToSell: computeAvailable(next),
          Version: current.version + 1,
        },
      },
    })
  )) as GraphqlResponse;

  const result = response.data?.updateWarehouseInventory as { totalImpactedData?: number } | undefined;
  return num(result?.totalImpactedData);
}

const MOVEMENT_MUTATION = `mutation insertInventoryMovement($input: InventoryMovementInsertInput!) {
  insertInventoryMovement(input: $input) {
    acknowledged
    itemId
    message
  }
}`;

/** The deployed schema's own MovementType values — there is no "release" or "commit" member. */
const MOVEMENT_TYPE: Record<Op, string> = {
  reserve: "reservation",
  release: "reservation",
  commit: "sale",
};

const DEFAULT_REASON: Record<Op, string> = {
  reserve: "reservation_created",
  release: "reservation_released",
  commit: "reservation_committed",
};

/**
 * Appends to the immutable ledger, after the balance has already moved.
 *
 * Order matters and there is no transaction to hide it behind. Balance first, ledger second:
 * the balance is what availability is computed from, so a failed ledger write leaves an
 * auditing gap (recoverable by reconciliation) whereas a failed balance write after a
 * successful ledger row would leave the ledger claiming a change that never happened. A
 * compensating rollback of the balance could itself fail, so it isn't attempted — the caller
 * gets `ledgerWriteFailed` and can surface it.
 *
 * The per-line idempotency key is what makes retrying this safe, and what the unique index in
 * `INDEX_PLAN.json` tier 1 turns into a real guarantee rather than a convention.
 */
async function writeMovement(
  op: Op,
  line: StockLine,
  ctx: StockOpContext,
  after: Balance,
  delta: { onHand: number; reserved: number }
): Promise<boolean> {
  const input: Record<string, unknown> = {
    MovementNumber: `MOV-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
    WarehouseId: line.warehouseId,
    ProductId: line.productId,
    VariantId: line.variantId,
    Sku: line.sku,
    MovementType: MOVEMENT_TYPE[op],
    QuantityChange: { OnHand: delta.onHand, Reserved: delta.reserved, Damaged: 0, QualityHold: 0 },
    BalanceAfter: {
      OnHand: after.onHand,
      Reserved: after.reserved,
      AvailableToSell: after.availableToSell,
    },
    Reference: { Type: ctx.reference.type, Id: ctx.reference.id, Number: ctx.reference.number },
    ReasonCode: ctx.reasonCode ?? DEFAULT_REASON[op],
    Notes: ctx.notes,
    IdempotencyKey: lineKey(op, line, ctx.idempotencyKey),
    OccurredDate: new Date().toISOString(),
  };
  if (ctx.performedBy) {
    input.PerformedBy = {
      Type: ctx.performedBy.type,
      Id: ctx.performedBy.id,
      Name: ctx.performedBy.name,
    };
  }

  try {
    await blocksDataCall(() =>
      blocksClient.data.graphql({
        operationName: "insertInventoryMovement",
        query: MOVEMENT_MUTATION,
        variables: { input },
      })
    );
    return true;
  } catch {
    return false;
  }
}

/** Distinct per operation *and* per line, so one retried multi-line reserve can't double-apply. */
function lineKey(op: Op, line: StockLine, key: string): string {
  return `${key}:${op}:${line.warehouseId}:${line.variantId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Read → compute → guarded write → verify, retried on contention.
 *
 * `reserve` moves stock from available into reserved; `release` moves it back; `commit`
 * consumes reserved stock for real (on-hand drops, availability is unchanged because that
 * stock was already spoken for).
 */
async function applyLine(op: Op, line: StockLine, ctx: StockOpContext): Promise<LineResult> {
  if (line.quantity <= 0) {
    return { line, ok: false, reason: "error", message: "Quantity must be positive.", attempts: 0 };
  }

  let lastFailure: LineFailure = "contention";
  let lastMessage: string | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let current: Balance | null;
    try {
      current = await readBalance(line.warehouseId, line.variantId);
    } catch (error) {
      return { line, ok: false, reason: "error", message: describe(error), attempts: attempt };
    }

    if (!current) {
      return {
        line,
        ok: false,
        reason: "not-found",
        message: "No inventory record for this variant at this warehouse.",
        attempts: attempt,
      };
    }

    if (!Number.isFinite(current.version)) {
      // Deliberately fatal rather than falling back to an unguarded write: without a version
      // to compare against there is no compare-and-swap, and a blind write here is precisely
      // the lost update this module exists to prevent. See task breakdown §1.5 — the field is
      // typed `Long`, which is not a Data Gateway scalar.
      return {
        line,
        ok: false,
        reason: "no-version",
        message:
          "WarehouseInventory.Version is missing or unreadable, so this write cannot be guarded. " +
          "Fix the schema before enabling inventory writes (docs §1.5).",
        attempts: attempt,
      };
    }

    // Recomputed, not trusted: if the stored AvailableToSell has drifted above what the
    // buckets actually support, the gateway-side `gte` guard would happily pass and oversell.
    const trueAvailable = computeAvailable(current);

    if (op === "reserve" && trueAvailable < line.quantity) {
      return {
        line,
        ok: false,
        reason: "insufficient",
        message: `Only ${Math.max(trueAvailable, 0)} available.`,
        attempts: attempt,
      };
    }

    // Never drive a bucket negative, whatever the caller asked for. Releasing or committing
    // more than is reserved is a caller bug, but clamping keeps it from corrupting the balance.
    const effective =
      op === "reserve" ? line.quantity : Math.min(line.quantity, current.reserved);

    if (effective <= 0) {
      return {
        line,
        ok: true,
        attempts: attempt,
        balanceAfter: current,
        message: "Nothing reserved to settle; treated as already done.",
      };
    }

    const next = { ...current } as Balance;
    if (op === "reserve") {
      next.reserved = current.reserved + effective;
    } else if (op === "release") {
      next.reserved = current.reserved - effective;
    } else {
      next.reserved = current.reserved - effective;
      next.onHand = current.onHand - effective;
    }
    next.availableToSell = computeAvailable(next);

    let impacted: number;
    try {
      impacted = await casWrite(current, next, op === "reserve" ? line.quantity : null);
    } catch (error) {
      const message = describe(error);
      // The P0 policy gap (§1.1) surfaces here until it's imported, and it will never
      // succeed on retry — fail fast and say so rather than burning five attempts.
      const denied = /denied|forbidden|unauthor|permission/i.test(message);
      if (denied) return { line, ok: false, reason: "denied", message, attempts: attempt };
      lastFailure = "error";
      lastMessage = message;
      continue;
    }

    if (impacted === 1) {
      const delta =
        op === "reserve"
          ? { onHand: 0, reserved: effective }
          : op === "release"
            ? { onHand: 0, reserved: -effective }
            : { onHand: -effective, reserved: -effective };
      const after: Balance = { ...next, version: current.version + 1 };
      const ledgerOk = await writeMovement(op, { ...line, quantity: effective }, ctx, after, delta);
      return {
        line,
        ok: true,
        attempts: attempt,
        balanceAfter: after,
        ledgerWriteFailed: ledgerOk ? undefined : true,
      };
    }

    // 0 impacted: the version moved, or availability fell below the guard, between the read
    // and the write. Both are ordinary contention — back off and re-read.
    lastFailure = "contention";
    lastMessage = "Another change landed first.";
    if (attempt < MAX_ATTEMPTS) {
      await sleep(BASE_BACKOFF_MS * attempt + Math.random() * BASE_BACKOFF_MS);
    }
  }

  return { line, ok: false, reason: lastFailure, message: lastMessage, attempts: MAX_ATTEMPTS };
}

function flagDisabled(lines: StockLine[]): StockOpResult {
  return {
    ok: false,
    compensated: [],
    lines: lines.map((line) => ({
      line,
      ok: false,
      reason: "denied" as const,
      message: "Inventory writes are disabled (VITE_INVENTORY_WRITES_LIVE is not true).",
      attempts: 0,
    })),
  };
}

/**
 * Reserve every line, or none of them.
 *
 * A multi-line cart is N independent compare-and-swap writes — the gateway has no
 * cross-document transaction — so atomicity is built by compensation instead: if any line
 * fails, the lines already reserved are released again. The release is itself a guarded write
 * and only ever increases availability, so it is always safe to retry and effectively always
 * succeeds. §5.1.
 */
export async function reserveStock(lines: StockLine[], ctx: StockOpContext): Promise<StockOpResult> {
  if (!INVENTORY_WRITES_LIVE) return flagDisabled(lines);

  const results: LineResult[] = [];
  for (const line of lines) {
    const result = await applyLine("reserve", line, ctx);
    results.push(result);
    if (!result.ok) break;
  }

  const succeeded = results.filter((r) => r.ok);
  if (results.every((r) => r.ok) && results.length === lines.length) {
    return { ok: true, lines: results, compensated: [] };
  }

  const compensated: LineResult[] = [];
  for (const done of succeeded) {
    compensated.push(
      await applyLine("release", done.line, {
        ...ctx,
        reasonCode: "reservation_rolled_back",
        notes: "Automatic rollback: a sibling line in the same reservation could not be reserved.",
        idempotencyKey: `${ctx.idempotencyKey}:rollback`,
      })
    );
  }

  const unattempted = lines.slice(results.length).map((line) => ({
    line,
    ok: false,
    reason: "error" as const,
    message: "Not attempted — an earlier line failed.",
    attempts: 0,
  }));

  return { ok: false, lines: [...results, ...unattempted], compensated };
}

/**
 * Give reserved stock back. Best-effort across lines and deliberately not all-or-nothing:
 * releasing what it can is strictly better than releasing nothing, and a line that fails here
 * is stock that stays reserved until it expires — recoverable, unlike an oversell.
 */
export async function releaseStock(lines: StockLine[], ctx: StockOpContext): Promise<StockOpResult> {
  if (!INVENTORY_WRITES_LIVE) return flagDisabled(lines);
  const results: LineResult[] = [];
  for (const line of lines) results.push(await applyLine("release", line, ctx));
  return { ok: results.every((r) => r.ok), lines: results, compensated: [] };
}

/**
 * Consume reserved stock for real — on-hand drops, reserved drops, availability is unchanged
 * because that stock stopped being available when it was reserved. Best-effort per line for
 * the same reason as release: this runs after the customer has already been charged, so
 * partial progress plus a reported failure beats refusing to record what did ship.
 */
export async function commitStock(lines: StockLine[], ctx: StockOpContext): Promise<StockOpResult> {
  if (!INVENTORY_WRITES_LIVE) return flagDisabled(lines);
  const results: LineResult[] = [];
  for (const line of lines) results.push(await applyLine("commit", line, ctx));
  return { ok: results.every((r) => r.ok), lines: results, compensated: [] };
}

/** Lines that couldn't be satisfied, for reporting "X is no longer available" at checkout. */
export function unavailableLines(result: StockOpResult): LineResult[] {
  return result.lines.filter((r) => !r.ok && (r.reason === "insufficient" || r.reason === "not-found"));
}
