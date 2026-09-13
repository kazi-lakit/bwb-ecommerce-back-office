import { reset, store } from "./fake-client";
import { applyRows, type ImportedStockEntry, type ImportedVariant, type RowResult } from "@/lib/blocks/bulk";
import { getEntityMeta } from "@/lib/blocks/collections";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

const productMeta = getEntityMeta("Product");

function stockEntry(warehouseCode: string, onHand: number, overrides: Partial<ImportedStockEntry> = {}): ImportedStockEntry {
  return { warehouseCode, quantity: { OnHand: onHand }, ...overrides };
}
function variant(sku: string, name: string, stock: ImportedStockEntry[] = []): ImportedVariant {
  return { sku, payload: { Sku: sku, Name: name }, stock };
}
function row(line: number, payload: Record<string, unknown>, opts: { itemId?: string; variants?: ImportedVariant[] } = {}): RowResult {
  return { line, itemId: opts.itemId, payload, errors: [], variants: opts.variants };
}

export async function run(): Promise<number> {
  console.log("\nP1. a brand new product with new variants and stock goes in as insertMany at every level");
  reset([]);
  store.warehouses = [{ ItemId: "WH1", Code: "WH-MAIN" }];
  let outcome = await applyRows(productMeta, [
    row(2, { Name: "Aspen Chair", Slug: "aspen-chair" }, {
      variants: [
        variant("SKU-A", "Oak", [stockEntry("WH-MAIN", 10)]),
        variant("SKU-B", "Walnut"),
      ],
    }),
  ]);
  check("no failures", outcome.failed.length === 0, JSON.stringify(outcome.failed));
  check("product created", outcome.created === 1);
  check("2 variants created", outcome.variantsCreated === 2, String(outcome.variantsCreated));
  check("1 stock row written", outcome.stockWritten === 1, String(outcome.stockWritten));
  check("product landed in the store", store.products.length === 1);
  check("variants landed in the store, linked to the real product id", store.variants.every((v) => v.ProductId === store.products[0]!.ItemId));
  check("stock landed, linked to the real variant id", (store.rows[0] as unknown as Record<string, unknown>).VariantId === store.variants.find((v) => v.Sku === "SKU-A")!.ItemId);

  console.log("\nP2. re-importing the same product (now with real ids) updates, not duplicates");
  const productId = store.products[0]!.ItemId as string;
  const variantAId = store.variants.find((v) => v.Sku === "SKU-A")!.ItemId as string;
  outcome = await applyRows(productMeta, [
    row(2, { Name: "Aspen Chair (renamed)", Slug: "aspen-chair" }, {
      itemId: productId,
      variants: [variant("SKU-A", "Oak (renamed)", [stockEntry("WH-MAIN", 25)])],
    }),
  ]);
  check("no failures", outcome.failed.length === 0, JSON.stringify(outcome.failed));
  check("product updated, not created", outcome.updated === 1 && outcome.created === 0);
  check("variant updated, not created", outcome.variantsUpdated === 1 && outcome.variantsCreated === 0);
  check("still only 1 product", store.products.length === 1);
  check("still only 2 variants", store.variants.length === 2);
  check("still only 1 stock row", store.rows.length === 1);
  check("product name really changed", store.products[0]!.Name === "Aspen Chair (renamed)");
  check("stock quantity really changed", (store.rows[0] as unknown as { Quantity: { OnHand: number } }).Quantity.OnHand === 25);
  check(
    "variant id stayed the same across the update",
    store.variants.find((v) => v.Sku === "SKU-A")!.ItemId === variantAId
  );

  console.log("\nP3. a product whose own create fails never attempts its variants");
  reset([]);
  store.warehouses = [{ ItemId: "WH1", Code: "WH-MAIN" }];
  store.failInsertManyFor = "Product";
  outcome = await applyRows(productMeta, [
    row(2, { Name: "Doomed Product", Slug: "doomed" }, { variants: [variant("SKU-X", "X")] }),
  ]);
  check("row reported as failed", outcome.failed.length === 1 && outcome.failed[0]!.line === 2, JSON.stringify(outcome.failed));
  check("no product landed", store.products.length === 0);
  check("no variant landed (never attempted)", store.variants.length === 0);
  check("nothing counted as created", outcome.created === 0 && outcome.variantsCreated === 0);

  console.log("\nP4. an unknown WarehouseCode fails just that stock entry, not the variant");
  reset([]);
  store.warehouses = [{ ItemId: "WH1", Code: "WH-MAIN" }];
  outcome = await applyRows(productMeta, [
    row(2, { Name: "Lamp", Slug: "lamp" }, { variants: [variant("SKU-L", "Brass", [stockEntry("WH-GHOST", 5)])] }),
  ]);
  check("variant still created", outcome.variantsCreated === 1, String(outcome.variantsCreated));
  check("stock entry failed, named by warehouse code", outcome.failed.some((f) => f.message.includes("WH-GHOST")), JSON.stringify(outcome.failed));
  check("no stock row written", outcome.stockWritten === 0 && store.rows.length === 0);

  console.log("\nP5. two products in one import, one new and one an update, both batch correctly");
  reset([]);
  store.warehouses = [{ ItemId: "WH1", Code: "WH-MAIN" }];
  store.products = [{ ItemId: "P-EXIST", Name: "Old Name", Slug: "existing-product" }];
  outcome = await applyRows(productMeta, [
    row(2, { Name: "Brand New", Slug: "brand-new" }, { variants: [variant("SKU-NEW", "New")] }),
    row(3, { Name: "Updated Name", Slug: "existing-product" }, { itemId: "P-EXIST", variants: [variant("SKU-UPD", "Updated")] }),
  ]);
  check("no failures", outcome.failed.length === 0, JSON.stringify(outcome.failed));
  check("one created, one updated", outcome.created === 1 && outcome.updated === 1);
  check("both variants created (both were new)", outcome.variantsCreated === 2);
  check("total 2 products", store.products.length === 2);
  const updatedProduct = store.products.find((p) => p.ItemId === "P-EXIST")!;
  check("the existing product's name actually changed", updatedProduct.Name === "Updated Name");
  const newProduct = store.products.find((p) => p.ItemId !== "P-EXIST")!;
  check(
    "each variant's ProductId points at its own real product",
    store.variants.find((v) => v.Sku === "SKU-NEW")!.ProductId === newProduct.ItemId &&
      store.variants.find((v) => v.Sku === "SKU-UPD")!.ProductId === "P-EXIST"
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
