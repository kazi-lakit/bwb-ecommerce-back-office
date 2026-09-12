import { classify, summarizeStockRows } from "@/lib/blocks/low-stock";
import type { EntityRecord } from "@/lib/blocks/collections";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}
function inv(sku: string, available: number, reorderPoint = 0, onHand = available): EntityRecord {
  return {
    ItemId: "I-" + sku, WarehouseId: "W1", VariantId: "V-" + sku, Sku: sku,
    AvailableToSell: available, ReorderPoint: reorderPoint,
    Quantity: { OnHand: onHand, Reserved: 0 },
  } as unknown as EntityRecord;
}

export async function run(): Promise<number> {
  console.log("\nL1. classification");
  check("zero is out", classify(0, 5) === "out");
  check("negative is out", classify(-3, 5) === "out");
  check("at the reorder point is low", classify(5, 5) === "low");
  check("below it is low", classify(2, 5) === "low");
  check("above it is ok", classify(9, 5) === "ok");

  console.log("\nL2. an unset reorder point is not a threshold");
  // ReorderPoint defaults to 0 on a record nobody has configured. Treating that as "reorder
  // at zero" would mark the whole catalog low the moment it was at zero — and healthy stock
  // as fine-but-borderline. Unset means unset.
  check("stock with no reorder point is ok", classify(3, 0) === "ok");
  check("but zero stock is still out", classify(0, 0) === "out");

  console.log("\nL3. rows are split and sorted worst-first");
  const summary = summarizeStockRows(
    [inv("A", 4, 10), inv("B", 0, 10), inv("C", 50, 10), inv("D", 9, 10), inv("E", -2, 3)],
    5
  );
  check("two out of stock", summary.out.length === 2, JSON.stringify(summary.out.map((r) => r.sku)));
  check("two low", summary.low.length === 2, JSON.stringify(summary.low.map((r) => r.sku)));
  check("healthy row excluded", !summary.out.concat(summary.low).some((r) => r.sku === "C"));
  check("most negative first", summary.out[0].sku === "E", summary.out[0].sku);
  check("furthest below threshold first", summary.low[0].sku === "A", summary.low[0].sku);

  console.log("\nL4. a full scan doesn't claim to be partial");
  check("not partial", summarizeStockRows([inv("A", 1, 5)], 1).isPartial === false);
  check("scanned reported", summarizeStockRows([inv("A", 1, 5)], 1).scanned === 1);

  console.log("\nL5. a bounded scan says so");
  const partial = summarizeStockRows([inv("A", 0), inv("B", 0)], 900);
  check("partial", partial.isPartial === true);
  check("scanned is what was seen", partial.scanned === 2);
  check("total is what exists", partial.totalCount === 900);

  console.log("\nL6. missing fields are read as zero, not as errors");
  const sparse = summarizeStockRows([{ ItemId: "X", Sku: "X" } as unknown as EntityRecord], 1);
  check("counted as out of stock", sparse.out.length === 1);
  check("available zero", sparse.out[0].available === 0);
  check("on-hand zero", sparse.out[0].onHand === 0);

  console.log("\nL7. nothing wrong produces empty lists, not noise");
  const healthy = summarizeStockRows([inv("A", 100, 10), inv("B", 40, 5)], 2);
  check("no out", healthy.out.length === 0);
  check("no low", healthy.low.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
