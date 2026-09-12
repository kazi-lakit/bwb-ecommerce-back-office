import { toCsv, parseCsv } from "@/lib/csv";

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

export async function run(): Promise<number> {
  console.log("\nV1. plain values round-trip");
  let csv = toCsv([{ Name: "Chair", Sku: "CH-1" }], ["Name", "Sku"]);
  check("header first", csv.split("\r\n")[0] === "Name,Sku", csv);
  check("row follows", csv.split("\r\n")[1] === "Chair,CH-1");
  let back = parseCsv(csv);
  check("headers parsed", back.headers.join(",") === "Name,Sku");
  check("row parsed", back.rows[0].Name === "Chair" && back.rows[0].Sku === "CH-1");

  console.log("\nV2. a value containing a comma survives");
  csv = toCsv([{ Name: "Chair, oak" }], ["Name"]);
  check("quoted on write", csv.includes('"Chair, oak"'), csv);
  check("intact on read", parseCsv(csv).rows[0].Name === "Chair, oak");

  console.log("\nV3. quotes are doubled, not dropped");
  csv = toCsv([{ Name: 'The "good" one' }], ["Name"]);
  check("doubled on write", csv.includes('""good""'), csv);
  check("intact on read", parseCsv(csv).rows[0].Name === 'The "good" one');

  console.log("\nV4. an embedded newline doesn't split the row");
  // The case a line-by-line parser gets wrong, and the one most likely to occur in real data.
  csv = toCsv([{ Description: "Line one\nLine two", Sku: "A" }], ["Description", "Sku"]);
  back = parseCsv(csv);
  check("one row, not two", back.rows.length === 1, JSON.stringify(back.rows));
  check("newline preserved", back.rows[0].Description === "Line one\nLine two");
  check("following column intact", back.rows[0].Sku === "A");

  console.log("\nV5. composite fields travel as JSON and come back whole");
  csv = toCsv([{ Pricing: { Currency: "USD", RegularPrice: 12.5 } }], ["Pricing"]);
  const raw = parseCsv(csv).rows[0].Pricing;
  check("parses as JSON", JSON.parse(raw).RegularPrice === 12.5, raw);
  csv = toCsv([{ Media: [{ Url: "a,b" }, { Url: "c" }] }], ["Media"]);
  check("arrays too", JSON.parse(parseCsv(csv).rows[0].Media).length === 2);

  console.log("\nV6. empty and missing values are distinguishable from nothing");
  csv = toCsv([{ A: "", B: null, C: undefined, D: 0, E: false }], ["A", "B", "C", "D", "E"]);
  back = parseCsv(csv);
  check("empty string stays empty", back.rows[0].A === "");
  check("null becomes empty", back.rows[0].B === "");
  check("zero is not empty", back.rows[0].D === "0", back.rows[0].D);
  check("false is not empty", back.rows[0].E === "false", back.rows[0].E);

  console.log("\nV7. real-world file shapes are tolerated");
  check("CRLF input", parseCsv("A,B\r\n1,2\r\n").rows[0].B === "2");
  check("LF input", parseCsv("A,B\n1,2\n").rows[0].B === "2");
  check("no trailing newline", parseCsv("A,B\n1,2").rows[0].B === "2");
  check("Excel BOM stripped", parseCsv("﻿A,B\n1,2").headers[0] === "A", parseCsv("﻿A,B\n1,2").headers[0]);
  check("no phantom trailing row", parseCsv("A,B\n1,2\n").rows.length === 1);
  check("short row pads", parseCsv("A,B,C\n1,2").rows[0].C === "");

  console.log("\nV8. leading and trailing spaces are preserved");
  // A SKU with a stray space is a different SKU; silently trimming would hide a data problem
  // rather than surface it.
  csv = toCsv([{ Sku: " CH-1 " }], ["Sku"]);
  check("quoted", csv.includes('" CH-1 "'), csv);
  check("preserved", parseCsv(csv).rows[0].Sku === " CH-1 ");

  console.log("\nV9. an empty export is still a valid file");
  csv = toCsv([], ["Name", "Sku"]);
  check("headers only", csv === "Name,Sku", JSON.stringify(csv));
  check("parses to no rows", parseCsv(csv).rows.length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}
