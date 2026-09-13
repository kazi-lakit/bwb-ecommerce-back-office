import { csvRowToPayload, exportColumns, jsonRowToPayload, parseJsonRows } from "@/lib/blocks/bulk";
import type { EntityMeta } from "@/lib/blocks/schema-meta";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

const meta: EntityMeta = {
  schemaName: "Widget",
  collectionName: "blx_Widgets",
  readAccessLevel: 2, writeAccessLevel: 1, editAccessLevel: 1, deleteAccessLevel: 3,
  rowLevelPolicies: [],
  fields: [
    { name: "Name", type: "String", isArray: false, required: true },
    { name: "Sku", type: "String", isArray: false },
    { name: "Count", type: "Int", isArray: false },
    { name: "Price", type: "Float", isArray: false },
    { name: "Active", type: "Boolean", isArray: false },
    { name: "ReleasedOn", type: "DateTime", isArray: false },
    { name: "Pricing", type: "Pricing", isArray: false },
    { name: "Tagsy", type: "String", isArray: true },
  ],
};

export async function run(): Promise<number> {
  console.log("\nB1. an export round-trips as an update, not a duplicate");
  const columns = exportColumns(meta);
  check("ItemId first", columns[0] === "ItemId", columns.slice(0, 2).join(","));
  check("every field included", meta.fields.every((f) => columns.includes(f.name)));
  const asUpdate = csvRowToPayload(meta, { ItemId: "abc", Name: "Chair" }, 2);
  check("itemId carried", asUpdate.itemId === "abc");
  check("no errors", asUpdate.errors.length === 0, asUpdate.errors.join("; "));
  const asCreate = csvRowToPayload(meta, { ItemId: "", Name: "Chair" }, 2);
  check("blank ItemId means create", asCreate.itemId === undefined);

  console.log("\nB2. an empty cell is left alone, never sent as empty");
  // The destructive reading of an ambiguous blank is the one you can't undo.
  const partial = csvRowToPayload(meta, { ItemId: "abc", Name: "Chair", Sku: "", Count: "" }, 2);
  check("blank omitted from payload", !("Sku" in partial.payload), JSON.stringify(partial.payload));
  check("blank number omitted too", !("Count" in partial.payload));
  check("filled value kept", partial.payload.Name === "Chair");

  console.log("\nB3. numbers are coerced, and refused when they aren't numbers");
  check("int parsed", csvRowToPayload(meta, { Name: "x", Count: "42" }, 2).payload.Count === 42);
  check("float parsed", csvRowToPayload(meta, { Name: "x", Price: "12.5" }, 2).payload.Price === 12.5);
  let r = csvRowToPayload(meta, { Name: "x", Count: "12.5" }, 2);
  check("non-integer refused for Int", r.errors.some((e) => e.includes("whole number")), r.errors.join("; "));
  r = csvRowToPayload(meta, { Name: "x", Price: "cheap" }, 2);
  check("nonsense refused", r.errors.some((e) => e.includes("isn't a number")), r.errors.join("; "));

  console.log("\nB4. booleans accept what a spreadsheet actually writes");
  for (const yes of ["true", "TRUE", "yes", "1"]) {
    check(`"${yes}" is true`, csvRowToPayload(meta, { Name: "x", Active: yes }, 2).payload.Active === true);
  }
  for (const no of ["false", "no", "0"]) {
    check(`"${no}" is false`, csvRowToPayload(meta, { Name: "x", Active: no }, 2).payload.Active === false);
  }
  check("anything else refused", csvRowToPayload(meta, { Name: "x", Active: "maybe" }, 2).errors.length === 1);

  console.log("\nB5. dates are normalised, nonsense is refused");
  const dated = csvRowToPayload(meta, { Name: "x", ReleasedOn: "2026-03-04" }, 2);
  check("ISO produced", String(dated.payload.ReleasedOn).startsWith("2026-03-04"), String(dated.payload.ReleasedOn));
  check("garbage refused", csvRowToPayload(meta, { Name: "x", ReleasedOn: "someday" }, 2).errors.length === 1);

  console.log("\nB6. composite and array cells come back as structures");
  const composite = csvRowToPayload(meta, { Name: "x", Pricing: '{"Currency":"USD","RegularPrice":9}' }, 2);
  check("object parsed", (composite.payload.Pricing as Record<string, unknown>).RegularPrice === 9);
  const arr = csvRowToPayload(meta, { Name: "x", Tagsy: '["a","b"]' }, 2);
  check("array parsed", Array.isArray(arr.payload.Tagsy) && (arr.payload.Tagsy as string[]).length === 2);
  const broken = csvRowToPayload(meta, { Name: "x", Pricing: "not json" }, 2);
  check("malformed JSON refused", broken.errors.some((e) => e.includes("expected JSON")), broken.errors.join("; "));

  console.log("\nB7. required fields are enforced on create but not on update");
  // An update sheet legitimately carries only the columns being changed.
  check("missing Name fails a create", csvRowToPayload(meta, { Sku: "A" }, 2).errors.some((e) => e.includes("required")));
  check("missing Name is fine on update", csvRowToPayload(meta, { ItemId: "abc", Sku: "A" }, 2).errors.length === 0);

  console.log("\nB8. unknown columns are reported, not silently dropped");
  r = csvRowToPayload(meta, { Name: "x", Nonsense: "1" }, 2);
  check("reported", r.errors.some((e) => e.includes('unknown column "Nonsense"')), r.errors.join("; "));
  check("not in payload", !("Nonsense" in r.payload));

  console.log("\nB9. system columns from an export are ignored on the way back");
  r = csvRowToPayload(meta, { ItemId: "abc", Name: "x", CreatedDate: "2026-01-01", LastUpdatedBy: "someone" }, 2);
  check("no complaint", r.errors.length === 0, r.errors.join("; "));
  check("not written back", !("CreatedDate" in r.payload) && !("LastUpdatedBy" in r.payload));

  console.log("\nB10. line numbers match the spreadsheet");
  check("first data row is line 2", csvRowToPayload(meta, { Name: "x" }, 2).line === 2);

  console.log("\nB11. strings keep their whitespace");
  check("untrimmed", csvRowToPayload(meta, { Name: " Chair " }, 2).payload.Name === " Chair ");

  console.log("\nB12. JSON rows: real types need no coercion, strings still accepted");
  const jsonUpdate = jsonRowToPayload(meta, { ItemId: "abc", Name: "Chair", Count: 3, Price: 9.5, Active: true }, 1);
  check("no errors", jsonUpdate.errors.length === 0, jsonUpdate.errors.join("; "));
  check("itemId carried", jsonUpdate.itemId === "abc");
  check("real number kept", jsonUpdate.payload.Count === 3);
  check("real boolean kept", jsonUpdate.payload.Active === true);
  const jsonStringNumber = jsonRowToPayload(meta, { Name: "x", Count: "42" }, 1);
  check("string number still coerced", jsonStringNumber.payload.Count === 42, jsonStringNumber.errors.join("; "));

  console.log("\nB13. JSON rows: null/missing means \"don't touch\", same as an empty CSV cell");
  const jsonPartial = jsonRowToPayload(meta, { ItemId: "abc", Name: "Chair", Sku: null }, 1);
  check("null omitted from payload", !("Sku" in jsonPartial.payload), JSON.stringify(jsonPartial.payload));
  check("no complaint about null", jsonPartial.errors.length === 0, jsonPartial.errors.join("; "));

  console.log("\nB14. JSON rows: composite/array fields are real JSON, not a string to re-parse");
  const jsonComposite = jsonRowToPayload(meta, { Name: "x", Pricing: { Currency: "USD", RegularPrice: 9 } }, 1);
  check("object kept as-is", (jsonComposite.payload.Pricing as Record<string, unknown>).RegularPrice === 9);
  const jsonArr = jsonRowToPayload(meta, { Name: "x", Tagsy: ["a", "b"] }, 1);
  check("array kept as-is", Array.isArray(jsonArr.payload.Tagsy) && (jsonArr.payload.Tagsy as string[]).length === 2);

  console.log("\nB15. JSON rows: same refusals as CSV for nonsense values");
  check("bad number refused", jsonRowToPayload(meta, { Name: "x", Price: "cheap" }, 1).errors.some((e) => e.includes("number")));
  check("bad boolean refused", jsonRowToPayload(meta, { Name: "x", Active: "maybe" }, 1).errors.length === 1);
  check("bad date refused", jsonRowToPayload(meta, { Name: "x", ReleasedOn: "someday" }, 1).errors.length === 1);
  check(
    "unknown column reported",
    jsonRowToPayload(meta, { Name: "x", Nonsense: 1 }, 1).errors.some((e) => e.includes('unknown column "Nonsense"'))
  );
  check("missing Name fails a create", jsonRowToPayload(meta, { Sku: "A" }, 1).errors.some((e) => e.includes("required")));

  console.log("\nB16. a JSON import file is an array, same shape a JSON export writes");
  const parsed = parseJsonRows(meta, JSON.stringify([{ ItemId: "abc", Name: "Chair" }, { Name: "Table" }]));
  check("two rows", parsed.length === 2);
  check("line numbers are 1-based array positions", parsed[0].line === 1 && parsed[1].line === 2);
  check("first is an update", parsed[0].itemId === "abc");
  check("second is a create", parsed[1].itemId === undefined);
  let threw = false;
  try {
    parseJsonRows(meta, "not json");
  } catch {
    threw = true;
  }
  check("malformed JSON throws instead of silently importing nothing", threw);
  threw = false;
  try {
    parseJsonRows(meta, JSON.stringify({ Name: "not an array" }));
  } catch {
    threw = true;
  }
  check("a JSON object (not array) throws, doesn't guess", threw);

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
