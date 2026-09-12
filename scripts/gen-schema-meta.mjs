import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Regenerates src/lib/blocks/schema-meta.ts from the sibling docs repo's schema export.
// Usage: node scripts/gen-schema-meta.mjs [sourceJsonPath] [outTsPath]
const SRC = process.argv[2] || resolve(__dirname, "../../bwb-ecommerce-docs/ECOMMERCE_INVENTORY_SCHEMAS.json");
const OUT = process.argv[3] || resolve(__dirname, "../src/lib/blocks/schema-meta.ts");

// The Data Gateway's own scalar list, verified against
// blocks-data/server/DataGateway.DomainService/Helpers/GraphQlTypeHelper.cs's IsScalar.
// Anything else is a composite type declared elsewhere in the same schema export (and
// collected into COMPLEX_TYPES) — or, if it appears in neither, an invalid field type
// that the gateway's SchemaImportValidator would reject today. buildSelection() in
// collections.ts handles that second case defensively rather than emitting `Field { }`.
const PRIMITIVE_FIELD_TYPES = ["String", "Int", "Float", "Boolean", "DateTime", "ID"];

const SYSTEM_FIELDS = new Set([
  "ItemId",
  "CreatedDate",
  "LastUpdatedDate",
  "CreatedBy",
  "Language",
  "LastUpdatedBy",
  "OrganizationId",
  "Tags",
]);

const raw = JSON.parse(readFileSync(SRC, "utf8"));

function mapValidation(rules) {
  const out = {};
  for (const r of rules || []) {
    if (!r.IsActive) continue;
    if (r.Type === 0) out.required = true;
    else if (r.Type === 1) out.pattern = r.Value;
    else if (r.Type === 2) out.min = Number(r.Value);
    if (r.ErrorMessage) {
      out.errorMessages = out.errorMessages || {};
      if (r.Type === 0) out.errorMessages.required = r.ErrorMessage;
      if (r.Type === 1) out.errorMessages.pattern = r.ErrorMessage;
      if (r.Type === 2) out.errorMessages.min = r.ErrorMessage;
    }
  }
  return out;
}

function mapField(f) {
  const v = mapValidation(f.ValidationRules);
  return {
    name: f.Name,
    type: f.Type,
    isArray: !!f.IsArray,
    isUnique: !!f.IsUniqueData,
    description: f.Description || undefined,
    ...v,
  };
}

const entities = [];
const complexTypes = {};

for (const schema of raw) {
  const topFields = (schema.Fields || []).filter((f) => !f.Name.includes(".") && !SYSTEM_FIELDS.has(f.Name));
  const fields = topFields.map(mapField);

  if (schema.CollectionName) {
    entities.push({
      schemaName: schema.SchemaName,
      collectionName: schema.CollectionName,
      readAccessLevel: schema.ReadAccessLevel,
      writeAccessLevel: schema.WriteAccessLevel,
      editAccessLevel: schema.EditAccessLevel,
      deleteAccessLevel: schema.DeleteAccessLevel,
      rowLevelPolicies: (schema.RowLevelPolicies || []).map((p) => p.PolicyName),
      fields,
    });
  } else {
    complexTypes[schema.SchemaName] = fields;
  }
}

function jsStr(s) {
  return JSON.stringify(s);
}

function fieldToTs(f) {
  const parts = [
    `name: ${jsStr(f.name)}`,
    `type: ${jsStr(f.type)}`,
    `isArray: ${f.isArray}`,
  ];
  if (f.isUnique) parts.push(`isUnique: true`);
  if (f.description) parts.push(`description: ${jsStr(f.description)}`);
  if (f.required) parts.push(`required: true`);
  if (f.pattern) parts.push(`pattern: ${jsStr(f.pattern)}`);
  if (typeof f.min === "number") parts.push(`min: ${f.min}`);
  if (f.errorMessages) {
    const em = Object.entries(f.errorMessages)
      .map(([k, v]) => `${k}: ${jsStr(v)}`)
      .join(", ");
    parts.push(`errorMessages: { ${em} }`);
  }
  return `{ ${parts.join(", ")} }`;
}

let ts = "";
ts += "// AUTO-GENERATED from ECOMMERCE_INVENTORY_SCHEMAS.json — do not hand-edit.\n";
ts += "// Regenerate with scripts/gen-schema-meta.mjs if the source schema file changes.\n\n";

// The Data Gateway's generated GraphQL treats every schema-defined composite as a real
// object type, so `collections.ts` has to build a sub-selection for those fields and the
// resource form UI has to pick a different control for them. That distinction is derived
// from the same schema export as everything else below, so it belongs in this generated
// file — it used to be hand-maintained here despite the "do not hand-edit" banner, which
// meant every regeneration silently deleted it out from under its two importers.
ts += `const PRIMITIVE_FIELD_TYPES = new Set([${PRIMITIVE_FIELD_TYPES.map(jsStr).join(", ")}]);\n\n`;
ts += `/**\n`;
ts += ` * Everything not in this set is a schema-defined composite/object type (Media,\n`;
ts += ` * Attribute, Pricing, …). On the Data Gateway's generated GraphQL schema those are\n`;
ts += ` * real object types, not JSON scalars — a query selecting one bare (no \`{ ... }\`\n`;
ts += ` * sub-selection) fails with "A composite type always needs to specify a selection\n`;
ts += ` * set." \`src/lib/blocks/collections.ts\` uses this to build that sub-selection from\n`;
ts += ` * \`COMPLEX_TYPES\`; the resource form UI uses it to decide which fields render as a\n`;
ts += ` * JSON textarea.\n`;
ts += ` */\n`;
ts += `export function isComplexFieldType(type: string): boolean {\n`;
ts += `  return !PRIMITIVE_FIELD_TYPES.has(type);\n`;
ts += `}\n\n`;
ts += `export interface FieldMeta {\n`;
ts += `  name: string;\n`;
ts += `  type: string;\n`;
ts += `  isArray: boolean;\n`;
ts += `  isUnique?: boolean;\n`;
ts += `  description?: string;\n`;
ts += `  required?: boolean;\n`;
ts += `  pattern?: string;\n`;
ts += `  min?: number;\n`;
ts += `  errorMessages?: { required?: string; pattern?: string; min?: string };\n`;
ts += `}\n\n`;
ts += `export interface EntityMeta {\n`;
ts += `  schemaName: string;\n`;
ts += `  collectionName: string;\n`;
ts += `  readAccessLevel: number;\n`;
ts += `  writeAccessLevel: number;\n`;
ts += `  editAccessLevel: number;\n`;
ts += `  deleteAccessLevel: number;\n`;
ts += `  rowLevelPolicies: string[];\n`;
ts += `  fields: FieldMeta[];\n`;
ts += `}\n\n`;

ts += `export const COMPLEX_TYPES: Record<string, FieldMeta[]> = {\n`;
for (const [name, fields] of Object.entries(complexTypes)) {
  ts += `  ${jsStr(name)}: [\n`;
  for (const f of fields) ts += `    ${fieldToTs(f)},\n`;
  ts += `  ],\n`;
}
ts += `};\n\n`;

ts += `export const ENTITY_SCHEMAS: Record<string, EntityMeta> = {\n`;
for (const e of entities) {
  ts += `  ${jsStr(e.schemaName)}: {\n`;
  ts += `    schemaName: ${jsStr(e.schemaName)},\n`;
  ts += `    collectionName: ${jsStr(e.collectionName)},\n`;
  ts += `    readAccessLevel: ${e.readAccessLevel},\n`;
  ts += `    writeAccessLevel: ${e.writeAccessLevel},\n`;
  ts += `    editAccessLevel: ${e.editAccessLevel},\n`;
  ts += `    deleteAccessLevel: ${e.deleteAccessLevel},\n`;
  ts += `    rowLevelPolicies: ${jsStr(e.rowLevelPolicies)},\n`;
  ts += `    fields: [\n`;
  for (const f of e.fields) ts += `      ${fieldToTs(f)},\n`;
  ts += `    ],\n`;
  ts += `  },\n`;
}
ts += `};\n\n`;

ts += `export const ENTITY_ORDER: string[] = ${jsStr(entities.map((e) => e.schemaName))};\n`;

writeFileSync(OUT, ts);
console.log("Wrote", OUT);
console.log("Entities:", entities.map((e) => `${e.schemaName} (${e.fields.length} fields, R${e.readAccessLevel}/W${e.writeAccessLevel}/E${e.editAccessLevel}/D${e.deleteAccessLevel})`).join("\n"));
console.log("Complex types:", Object.keys(complexTypes).join(", "));
