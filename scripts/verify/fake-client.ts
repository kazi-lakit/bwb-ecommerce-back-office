export interface Row { ItemId: string; Version: unknown; AvailableToSell: number; Quantity: Record<string, number>; }
export const store: {
  rows: Row[];
  movements: Record<string, unknown>[];
  casResultOverride: (null | number)[];   // shift()ed; null = behave normally
  failMovement: boolean;
  rejectUnknownBuckets: boolean;
  denyWrites: boolean;
  onCas?: () => void;                      // simulate a concurrent writer
  reservations: Record<string, unknown>[];
  failReservationInsert: boolean;
  onReservationUpdate?: () => void;
  orders: Record<string, unknown>[];
  products: Record<string, unknown>[];
  variants: Record<string, unknown>[];
  warehouses: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  nextId: number;
  failInsertManyFor: string | null;        // schemaName whose next insertMany should error, atomically
} = {
  rows: [], movements: [], casResultOverride: [], failMovement: false, rejectUnknownBuckets: false, denyWrites: false,
  reservations: [], failReservationInsert: false, orders: [], products: [], variants: [], warehouses: [], categories: [],
  nextId: 1, failInsertManyFor: null,
};

export function reset(rows: Row[]) {
  store.rows = JSON.parse(JSON.stringify(rows));
  store.movements = []; store.casResultOverride = [];
  store.failMovement = false; store.denyWrites = false; store.onCas = undefined;
  store.reservations = []; store.failReservationInsert = false; store.onReservationUpdate = undefined;
  store.orders = [];
  store.products = []; store.variants = []; store.warehouses = []; store.categories = [];
  store.nextId = 1; store.failInsertManyFor = null;
}

function nextId(): string {
  return `fake${store.nextId++}`;
}

/** Same operator subset the real gateway's `where` clauses use — `eq`/`in`, matched per field. */
function matchesWhere(where: Record<string, unknown> | undefined, row: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([field, cond]) => {
    if (!cond || typeof cond !== "object") return true;
    if ("eq" in cond) return row[field] === (cond as { eq: unknown }).eq;
    if ("in" in cond) return ((cond as { in: unknown[] }).in).includes(row[field]);
    return true;
  });
}

function collectionFor(schemaName: string): Record<string, unknown>[] {
  switch (schemaName) {
    case "Product": return store.products;
    case "ProductVariant": return store.variants;
    case "Warehouse": return store.warehouses;
    case "WarehouseInventory": return store.rows as unknown as Record<string, unknown>[];
    case "Category": return store.categories;
    default: throw new Error(`fake-client: no collection wired for schema ${schemaName}`);
  }
}

const NEW_BUCKETS = ["Blocked", "Backordered", "InTransit"];

export const blocksClient = {
  data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async graphql(req: any): Promise<any> {
      const { operationName, query, variables } = req;

      if (operationName === "getProducts" || operationName === "getProductVariants" || operationName === "getWarehouses" || operationName === "getCategorys") {
        const schemaName =
          operationName === "getProducts" ? "Product" :
          operationName === "getProductVariants" ? "ProductVariant" :
          operationName === "getWarehouses" ? "Warehouse" : "Category";
        const items = collectionFor(schemaName).filter((r) => matchesWhere(variables.where, r));
        return { data: { [operationName]: { items, totalCount: items.length } } };
      }

      if (operationName?.startsWith("insertMany")) {
        const schemaName = operationName.slice("insertMany".length);
        if (store.failInsertManyFor === schemaName) {
          store.failInsertManyFor = null; // one-shot, like a real validation error would only hit once
          return { errors: [{ message: `A record with the same value already exists.` }], data: { [operationName]: null } };
        }
        const collection = collectionFor(schemaName);
        const itemIds: string[] = [];
        for (const input of variables.input as Record<string, unknown>[]) {
          const id = nextId();
          collection.push({ ItemId: id, ...input });
          itemIds.push(id);
        }
        return { data: { [operationName]: { acknowledged: true, itemIds, message: null, totalImpactedData: itemIds.length } } };
      }

      if (operationName === "BatchUpdate") {
        const aliasSchema: Record<string, string> = {};
        const re = /(\w+): update(\w+)\(/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(query))) aliasSchema[m[1]] = m[2];
        const result: Record<string, unknown> = {};
        for (const [alias, schemaName] of Object.entries(aliasSchema)) {
          const itemId = (variables[`${alias}_where`] as { ItemId?: { eq?: string } } | undefined)?.ItemId?.eq;
          const input = variables[`${alias}_input`] as Record<string, unknown>;
          const row = collectionFor(schemaName).find((r) => r.ItemId === itemId);
          if (!row) {
            result[alias] = { acknowledged: false, itemId: null, message: "No data found to UPDATE or you don't have permission to UPDATE this record.", totalImpactedData: 0 };
            continue;
          }
          Object.assign(row, input);
          result[alias] = { acknowledged: true, itemId: row.ItemId, message: null, totalImpactedData: 1 };
        }
        return { data: result };
      }

      if (operationName === "getWarehouseInventorys") {
        if (store.rejectUnknownBuckets && NEW_BUCKETS.some((b) => query.includes(b))) {
          throw new Error('Unknown field "Blocked" on type "InventoryQuantity".');
        }
        // Supports the two filter shapes the app actually issues: inventory-ops reads one
        // balance by {WarehouseId:{eq}, VariantId:{eq}}, checkout-inventory reads many by
        // {VariantId:{in:[...]}}.
        const w = variables.where ?? {};
        const matches = (field: any, value: unknown) => {
          if (!field) return true;
          if ("eq" in field) return field.eq === value;
          if ("in" in field) return (field.in as unknown[]).includes(value);
          return true;
        };
        const items = store.rows.filter(
          (r) => matches(w.WarehouseId, (r as any).WarehouseId) && matches(w.VariantId, (r as any).VariantId)
        );
        return { data: { getWarehouseInventorys: { items, totalCount: items.length } } };
      }

      if (operationName === "updateWarehouseInventory") {
        if (store.denyWrites) throw new Error("Access denied for operation EDIT on WarehouseInventory");
        store.onCas?.();
        const forced = store.casResultOverride.shift();
        if (forced !== undefined && forced !== null) {
          return { data: { updateWarehouseInventory: { acknowledged: true, totalImpactedData: forced } } };
        }
        const w = variables.where;
        const row = store.rows.find((r) => r.ItemId === w.ItemId.eq);
        // The real guard, evaluated the way Mongo would in one UpdateOne.
        if (!row) return { data: { updateWarehouseInventory: { totalImpactedData: 0 } } };
        if (row.Version !== w.Version.eq) return { data: { updateWarehouseInventory: { totalImpactedData: 0 } } };
        if (w.AvailableToSell && row.AvailableToSell < w.AvailableToSell.gte)
          return { data: { updateWarehouseInventory: { totalImpactedData: 0 } } };
        row.Quantity = { ...row.Quantity, ...variables.input.Quantity };
        row.AvailableToSell = variables.input.AvailableToSell;
        row.Version = variables.input.Version;
        return { data: { updateWarehouseInventory: { acknowledged: true, totalImpactedData: 1 } } };
      }

      if (operationName === "getOrders") {
        const w = variables.where ?? {};
        const items = store.orders.filter((o: any) => {
          if (w.Status && o.Status !== w.Status.eq) return false;
          if (w.PaymentStatus && o.PaymentStatus !== w.PaymentStatus.eq) return false;
          if (w.OrderNumber?.contains && !String(o.OrderNumber ?? "").includes(w.OrderNumber.contains)) return false;
          return true;
        });
        return { data: { getOrders: { items, totalCount: items.length } } };
      }

      if (operationName === "updateOrder") {
        const target: any = store.orders.find((o: any) => o.ItemId === variables.where.ItemId.eq);
        if (!target) return { data: { updateOrder: { totalImpactedData: 0 } } };
        Object.assign(target, variables.input);
        return { data: { updateOrder: { acknowledged: true, totalImpactedData: 1 } } };
      }

      if (operationName === "insertInventoryReservation") {
        if (store.failReservationInsert) throw new Error("reservation insert failed");
        const id = "RES" + (store.reservations.length + 1);
        store.reservations.push({ ItemId: id, ...variables.input });
        return { data: { insertInventoryReservation: { acknowledged: true, itemId: id } } };
      }

      if (operationName === "getInventoryReservations") {
        const w = variables.where ?? {};
        const items = store.reservations.filter((r: any) => {
          if (w.Status && r.Status !== w.Status.eq) return false;
          if (w.CustomerId && r.CustomerId !== w.CustomerId.eq) return false;
          if (w.ExpiresDate?.lt && !(r.ExpiresDate < w.ExpiresDate.lt)) return false;
          return true;
        });
        return { data: { getInventoryReservations: { items, totalCount: items.length } } };
      }

      if (operationName === "updateInventoryReservation") {
        const target: any = store.reservations.find((r) => (r as any).ItemId === variables.where.ItemId.eq);
        if (!target) return { data: { updateInventoryReservation: { totalImpactedData: 0 } } };
        // Fires before the filter is evaluated, not between the check and the write: a real
        // UpdateOne matches and writes atomically, so a competing update either lands wholly
        // before this one or wholly after. Firing it in the middle would invent a
        // check-then-act gap the gateway doesn't have, and would let this fake "pass" code
        // that a real race would break.
        store.onReservationUpdate?.();
        // The conditional part: a filter naming Status only matches while it still holds,
        // which is what makes the sweep's claim a real compare-and-swap.
        if (variables.where.Status && target.Status !== variables.where.Status.eq) {
          return { data: { updateInventoryReservation: { acknowledged: true, totalImpactedData: 0 } } };
        }
        Object.assign(target, variables.input);
        return { data: { updateInventoryReservation: { acknowledged: true, totalImpactedData: 1 } } };
      }

      if (operationName === "insertInventoryMovement") {
        if (store.failMovement) throw new Error("ledger write failed");
        store.movements.push(variables.input);
        return { data: { insertInventoryMovement: { acknowledged: true, itemId: "mov1" } } };
      }
      throw new Error("unexpected operation " + operationName);
    },
  },
};
