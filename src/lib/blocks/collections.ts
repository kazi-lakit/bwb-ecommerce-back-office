import { blocksClient } from "./client";
import { blocksDataCall } from "./http";
import { COMPLEX_TYPES, ENTITY_SCHEMAS, isComplexFieldType, type EntityMeta } from "./schema-meta";

export interface EntityRecord extends Record<string, unknown> {
  ItemId?: string;
  itemId?: string;
}

export interface ListResult {
  items: EntityRecord[];
  totalCount: number;
}

export interface ActionResponse {
  acknowledged?: boolean;
  itemId?: string;
  totalImpactedData?: number;
  message?: string;
}

export function getEntityMeta(schemaName: string): EntityMeta {
  const meta = ENTITY_SCHEMAS[schemaName];
  if (!meta) throw new Error(`Unknown entity schema: ${schemaName}`);
  return meta;
}

const SYSTEM_SCALAR_FIELDS = ["ItemId", "CreatedDate", "LastUpdatedDate", "CreatedBy", "LastUpdatedBy"];

/**
 * `blocksClient.data.collection()` (the SDK's own CRUD helper) only accepts flat
 * scalar field names — it rejects anything containing `{`/`}`. But composite fields
 * (Media, Attributes, Pricing, …) are real GraphQL object types on the generated
 * schema, not JSON scalars: selecting one bare fails with "A composite type always
 * needs to specify a selection set." So this builds the GraphQL query by hand via
 * `blocksClient.data.graphql()` instead, adding a `{ ... }` sub-selection (from
 * `COMPLEX_TYPES`) for every composite field — otherwise identical to what
 * `collection()` generates (same query/mutation names and shapes).
 */
function buildSelection(meta: EntityMeta): string {
  const lines = [...SYSTEM_SCALAR_FIELDS];
  for (const field of meta.fields) {
    const shape = isComplexFieldType(field.type) ? COMPLEX_TYPES[field.type] : undefined;
    if (shape?.length) {
      lines.push(`${field.name} { ${shape.map((f) => f.name).join(" ")} }`);
    } else {
      // Either a scalar, or a "composite" type with no definition in the schema export —
      // e.g. `WarehouseInventory.Version` is typed `Long`, which isn't in the gateway's
      // scalar list *and* isn't a declared schema. Emitting `Version { }` for it is a
      // GraphQL parse error that kills the entire query; selecting it bare is at worst the
      // same failure the server would raise for a genuinely composite field, and correct
      // for every scalar the generator doesn't know about.
      lines.push(field.name);
    }
  }
  return lines.join("\n");
}

/**
 * The Data Gateway's generated response shape isn't declared anywhere the SDK exposes
 * — it's `{data:{get<Schema>s:{items,totalCount,...}}}` for a list and
 * `{data:{<mutationField>:{acknowledged,itemId,...}}}` for a mutation. Unwrap
 * generically by shape/field name instead of guessing.
 */
function unwrapList(response: unknown): ListResult {
  const root = response as Record<string, unknown> | undefined;
  const dataObj = (root?.data ?? root) as Record<string, unknown> | undefined;
  if (dataObj && typeof dataObj === "object") {
    for (const value of Object.values(dataObj)) {
      if (value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).items)) {
        const v = value as { items: EntityRecord[]; totalCount?: number };
        return { items: v.items, totalCount: v.totalCount ?? v.items.length };
      }
    }
  }
  return { items: [], totalCount: 0 };
}

function unwrapMutation(response: unknown, fieldName: string): ActionResponse {
  const root = response as Record<string, unknown> | undefined;
  const dataObj = (root?.data ?? root) as Record<string, unknown> | undefined;
  return (dataObj?.[fieldName] as ActionResponse | undefined) ?? {};
}

export interface EntityListParams {
  pageNo?: number;
  pageSize?: number;
  /** A generated `<Schema>FilterInput` object — per-field operators (eq, neq, gt, gte, lt, lte, contains, in) plus and/or. */
  where?: Record<string, unknown>;
}

/** Equality filter on ItemId, matching the shape every `<Schema>FilterInput` uses for its id field. */
function itemIdWhere(itemId: string): Record<string, unknown> {
  return { ItemId: { eq: itemId } };
}

/**
 * CRUD for one entity schema, via `blocksClient.data.graphql()` — following the
 * gateway's current, documented `where`/`paging` shape (the older
 * `input: DynamicQueryInput` / mutation `filter: String` args are deprecated and don't
 * support operators like `contains`). See buildSelection above for the composite-field
 * fix this also carries.
 *
 * No `order`/sort support yet: the docs show `$order: [<Schema>SortInput!]`, but this
 * project's generated schema doesn't actually define a `ProductSortInput` type (a live
 * query declaring that variable fails with HotChocolate error HC0017, "Variable `order`
 * is not an input type" — confirmed 2026-09). Add it back once the real sort input type
 * name is confirmed live for the schema that needs it, rather than assuming the docs'
 * naming holds for every schema here.
 */
export function createEntityApi(schemaName: string) {
  const meta = getEntityMeta(schemaName);
  const listField = `get${schemaName}s`;
  const createField = `insert${schemaName}`;
  const updateField = `update${schemaName}`;
  const deleteField = `delete${schemaName}`;
  const selection = buildSelection(meta);

  const listQuery = `query ${listField}($where: ${schemaName}FilterInput, $paging: PaginationInput) {
  ${listField}(where: $where, paging: $paging) {
    items {
${selection}
    }
    totalCount
    pageNo
    pageSize
    totalPages
    hasNextPage
    hasPreviousPage
  }
}`;

  return {
    meta,

    list: (params: EntityListParams = {}): Promise<ListResult> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: listField,
          query: listQuery,
          variables: {
            where: params.where,
            paging: { pageNo: params.pageNo ?? 1, pageSize: params.pageSize ?? 20 },
          },
        })
      ).then(unwrapList),

    get: (itemId: string): Promise<EntityRecord | null> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: listField,
          query: listQuery,
          variables: { where: itemIdWhere(itemId), paging: { pageNo: 1, pageSize: 1 } },
        })
      ).then((res) => unwrapList(res).items[0] ?? null),

    create: (payload: Record<string, unknown>): Promise<ActionResponse> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: createField,
          query: `mutation ${createField}($input: ${schemaName}InsertInput!) {
  ${createField}(input: $input) {
    acknowledged
    itemId
    message
    totalImpactedData
  }
}`,
          variables: { input: payload },
        })
      ).then((res) => unwrapMutation(res, createField)),

    update: (itemId: string, payload: Record<string, unknown>): Promise<ActionResponse> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: updateField,
          query: `mutation ${updateField}($where: ${schemaName}FilterInput, $input: ${schemaName}UpdateInput!) {
  ${updateField}(where: $where, input: $input) {
    acknowledged
    itemId
    message
    totalImpactedData
  }
}`,
          variables: { where: itemIdWhere(itemId), input: payload },
        })
      ).then((res) => unwrapMutation(res, updateField)),

    remove: (itemId: string): Promise<ActionResponse> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: deleteField,
          query: `mutation ${deleteField}($where: ${schemaName}FilterInput) {
  ${deleteField}(where: $where) {
    acknowledged
    itemId
    message
    totalImpactedData
  }
}`,
          variables: { where: itemIdWhere(itemId) },
        })
      ).then((res) => unwrapMutation(res, deleteField)),
  };
}
