import { reset, store } from "./fake-client";
import { cancelOrder, confirmPayment, fulfillOrder, listOrders, type OrderRecord } from "@/lib/blocks/orders";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}
function row(id: string, wh: string, v: string, onHand: number, reserved: number) {
  return { ItemId: id, WarehouseId: wh, VariantId: v, Version: 1,
           AvailableToSell: onHand - reserved,
           Quantity: { OnHand: onHand, Reserved: reserved, Damaged: 0, QualityHold: 0, Incoming: 0, Blocked: 0, Backordered: 0, InTransit: 0 } } as never;
}
function order(overrides: Partial<OrderRecord> = {}): OrderRecord {
  return {
    ItemId: "O1", OrderNumber: "ORD-1", CustomerId: "CUST1", Status: "PendingPayment",
    PaymentStatus: "Pending", FulfillmentStatus: "Allocated", Currency: "USD", GrandTotal: 100,
    Items: [{ VariantId: "V1", Sku: "SKU-V1", Quantity: 3, UnitPrice: 10 }], ...overrides,
  };
}
function reservation(orderItemId: string, status = "active", items = [{ WarehouseId: "W1", VariantId: "V1", Sku: "SKU-V1", Quantity: 3 }]) {
  return { ItemId: "R1", ReservationNumber: "RSV-1", Status: status, CustomerId: "CUST1",
           Source: { Type: "order", Id: orderItemId }, Items: items };
}
const actor = { type: "user" as const, id: "STAFF1", name: "Sam" };
/** The fake store holds plain documents; OrderRecord is the app's view of the same shape. */
const setOrders = (...orders: OrderRecord[]) => {
  store.orders = orders as unknown as Record<string, unknown>[];
};
const stored = (i = 0) => store.orders[i] as Record<string, unknown>;

export async function run(): Promise<number> {
  console.log("\nO1. listing filters by status and order number");
  reset([]);
  setOrders(order(), order({ ItemId: "O2", OrderNumber: "ORD-2", Status: "Confirmed" }));
  check("all", (await listOrders()).items.length === 2);
  check("by status", (await listOrders({ status: "Confirmed" })).items[0].ItemId === "O2");
  check("by number", (await listOrders({ search: "ORD-1" })).items.length === 1);

  console.log("\nO2. recording payment confirms the order");
  reset([]);
  setOrders(order());
  await confirmPayment(order());
  check("paid", stored().PaymentStatus === "Paid");
  check("confirmed", stored().Status === "Confirmed");
  check("timestamped", typeof stored().ConfirmedDate === "string");

  console.log("\nO3. a cancelled order does not get resurrected by recording payment");
  reset([]);
  setOrders(order({ Status: "Cancelled" }));
  await confirmPayment(order({ Status: "Cancelled" }));
  check("still cancelled", stored().Status === "Cancelled");
  check("payment still recorded", stored().PaymentStatus === "Paid");

  console.log("\nO4. shipping consumes the reserved stock");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order({ PaymentStatus: "Paid" }));
  store.reservations = [reservation("O1")];
  const beforeAvailable = store.rows[0].AvailableToSell;
  let result = await fulfillOrder(order({ PaymentStatus: "Paid" }), actor);
  check("one line committed", result.committedLines === 1, JSON.stringify(result));
  check("on-hand 10 -> 7", store.rows[0].Quantity.OnHand === 7);
  check("reserved 3 -> 0", store.rows[0].Quantity.Reserved === 0);
  check("available unchanged", store.rows[0].AvailableToSell === beforeAvailable);
  check("reservation committed", store.reservations[0].Status === "committed");
  check("committed date set", typeof store.reservations[0].CommittedDate === "string");
  check("order shipped", stored().FulfillmentStatus === "Shipped");
  check("paid order completes", stored().Status === "Completed");
  check("movement is a sale", store.movements[0].MovementType === "sale");

  console.log("\nO5. an unpaid order ships without being marked complete");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [reservation("O1")];
  await fulfillOrder(order(), actor);
  check("shipped", stored().FulfillmentStatus === "Shipped");
  check("not completed while unpaid", stored().Status === "PendingPayment");

  console.log("\nO6. an order holding nothing still ships, and says so");
  reset([row("B1", "W1", "V1", 10, 0)]);
  setOrders(order());
  store.reservations = [];
  result = await fulfillOrder(order(), actor);
  check("flagged", result.noReservation === true);
  check("nothing committed", result.committedLines === 0);
  check("on-hand untouched", store.rows[0].Quantity.OnHand === 10);
  check("still marked shipped", stored().FulfillmentStatus === "Shipped");

  console.log("\nO7. another customer's reservation is never consumed");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [{ ...reservation("O1"), CustomerId: "SOMEONE-ELSE" }];
  result = await fulfillOrder(order(), actor);
  check("treated as no reservation", result.noReservation === true);
  check("their stock untouched", store.rows[0].Quantity.Reserved === 3);

  console.log("\nO8. a reservation for a different order is never consumed");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [reservation("SOME-OTHER-ORDER")];
  result = await fulfillOrder(order(), actor);
  check("treated as no reservation", result.noReservation === true);
  check("other order's stock untouched", store.rows[0].Quantity.Reserved === 3);

  console.log("\nO9. a failed commit leaves the order un-shipped");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [reservation("O1")];
  store.denyWrites = true;
  result = await fulfillOrder(order(), actor);
  check("failure reported", result.failures.length === 1, JSON.stringify(result));
  check("order not marked shipped", stored().FulfillmentStatus === "Allocated");
  check("reservation still active", store.reservations[0].Status === "active");

  console.log("\nO10. cancelling releases the held stock");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [reservation("O1")];
  const cancelResult = await cancelOrder(order(), actor);
  check("one line released", cancelResult.releasedLines === 1);
  check("reserved back to 0", store.rows[0].Quantity.Reserved === 0);
  check("available restored", store.rows[0].AvailableToSell === 10);
  check("on-hand untouched", store.rows[0].Quantity.OnHand === 10);
  check("reservation released", store.reservations[0].Status === "released");
  check("order cancelled", stored().Status === "Cancelled");
  check("cancelled date set", typeof stored().CancelledDate === "string");

  console.log("\nO11. cancelling an order that holds nothing still cancels it");
  reset([row("B1", "W1", "V1", 10, 0)]);
  setOrders(order());
  store.reservations = [];
  check("no lines released", (await cancelOrder(order(), actor)).releasedLines === 0);
  check("still cancelled", stored().Status === "Cancelled");

  console.log("\nO12. shipping twice does not consume the stock twice");
  reset([row("B1", "W1", "V1", 10, 3)]);
  setOrders(order());
  store.reservations = [reservation("O1")];
  await fulfillOrder(order(), actor);
  const afterFirst = store.rows[0].Quantity.OnHand;
  result = await fulfillOrder(order(), actor);
  check("second ship finds nothing to commit", result.noReservation === true, JSON.stringify(result));
  check("on-hand unchanged by the second", store.rows[0].Quantity.OnHand === afterFirst, String(store.rows[0].Quantity.OnHand));

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
