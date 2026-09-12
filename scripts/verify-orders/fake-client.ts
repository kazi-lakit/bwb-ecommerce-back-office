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
} = { rows: [], movements: [], casResultOverride: [], failMovement: false, rejectUnknownBuckets: false, denyWrites: false, reservations: [], failReservationInsert: false, orders: [] };

export function reset(rows: Row[]) {
  store.rows = JSON.parse(JSON.stringify(rows));
  store.movements = []; store.casResultOverride = [];
  store.failMovement = false; store.denyWrites = false; store.onCas = undefined;
  store.reservations = []; store.failReservationInsert = false; store.onReservationUpdate = undefined;
  store.orders = [];
}

const NEW_BUCKETS = ["Blocked", "Backordered", "InTransit"];

export const blocksClient = {
  data: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async graphql(req: any): Promise<any> {
      const { operationName, query, variables } = req;

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
