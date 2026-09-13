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

export interface BulkActionResponse {
  acknowledged?: boolean;
  /** One id per input payload, in the same order — confirmed live against the Data Gateway. */
  itemIds?: string[];
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

/**
 * `insertMany<Schema>`'s atomic failure (one bad row rejects the whole batch, confirmed live)
 * leaves its field `null` in `data` and puts the real reason only in the top-level GraphQL
 * `errors` array — a shape `unwrapMutation` above doesn't look at, since a plain single
 * create/update/delete has never needed it (their failures show up as an ordinary business
 * object with its own `message`, confirmed live). Used only by `createMany` below.
 */
function unwrapBulkMutation(response: unknown, fieldName: string): BulkActionResponse {
  const root = response as { data?: Record<string, unknown>; errors?: { message?: string }[] } | undefined;
  const result = root?.data?.[fieldName] as BulkActionResponse | undefined;
  if (result) return result;
  const message = root?.errors?.map((e) => e.message).filter(Boolean).join("; ");
  return message ? { message } : {};
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
  const createManyField = `insertMany${schemaName}`;
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

    /**
     * One request creates every payload, via the Data Gateway's own `insertMany<Schema>`
     * mutation — confirmed live (introspection shows it's generated for every schema, not
     * just this project's). This is atomic on the server's side: a single invalid payload
     * (e.g. a duplicate unique field) fails the *entire* batch with no partial writes, rather
     * than skipping just that one row — confirmed by testing a duplicate-slug row sandwiched
     * between two valid ones, which left all three uncreated. Callers that need per-row
     * fault isolation should fall back to sequential `create()` calls instead.
     */
    createMany: (payloads: Record<string, unknown>[]): Promise<BulkActionResponse> =>
      blocksDataCall(() =>
        blocksClient.data.graphql({
          operationName: createManyField,
          query: `mutation ${createManyField}($input: [${schemaName}InsertInput!]) {
  ${createManyField}(input: $input) {
    acknowledged
    itemIds
    message
    totalImpactedData
  }
}`,
          variables: { input: payloads },
        })
      ).then((res) => unwrapBulkMutation(res, createManyField)),

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

export interface BatchListRequest {
  /** Caller-chosen key the result comes back under — need not be a valid GraphQL name. */
  key: string;
  schemaName: string;
  params?: EntityListParams;
}

/**
 * Combines N independent list reads (different schemas, or the same schema with
 * different `where`/`paging`) into ONE GraphQL request via aliased root fields —
 * `f0: getBrands(...) { ... } f1: getCategorys(...) { ... }` — instead of N separate
 * round trips to `/data/v4/gateway`. GraphQL has no restriction on how many root
 * fields one query selects, or on reusing variable *names* across aliases (each alias
 * gets its own `$where_f0`/`$paging_f0` pair), so this is exactly the request the
 * gateway would receive if a caller wrote the combined query by hand — see
 * BLOCKS_FEATURE_SUGGESTIONS.md-adjacent guidance: batch independent reads (and,
 * the same way, independent mutations) into one request rather than firing them
 * one at a time.
 *
 * Only ever combines requests that don't depend on each other's result — a request
 * needing another's output (e.g. "variants of this product" once the product id is
 * known) still has to wait for that response and stays a separate call.
 */
export function buildBatchListQuery(requests: BatchListRequest[]): { query: string; variables: Record<string, unknown> } {
  const varDecls: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};

  requests.forEach((req, index) => {
    const alias = `f${index}`;
    const meta = getEntityMeta(req.schemaName);
    const listField = `get${req.schemaName}s`;
    const selection = buildSelection(meta);
    const whereVar = `${alias}_where`;
    const pagingVar = `${alias}_paging`;

    varDecls.push(`$${whereVar}: ${req.schemaName}FilterInput`, `$${pagingVar}: PaginationInput`);
    fields.push(`  ${alias}: ${listField}(where: $${whereVar}, paging: $${pagingVar}) {
    items {
${selection}
    }
    totalCount
    pageNo
    pageSize
    totalPages
    hasNextPage
    hasPreviousPage
  }`);
    variables[whereVar] = req.params?.where;
    variables[pagingVar] = { pageNo: req.params?.pageNo ?? 1, pageSize: req.params?.pageSize ?? 20 };
  });

  const query = `query BatchList(${varDecls.join(", ")}) {
${fields.join("\n")}
}`;
  return { query, variables };
}

/** Runs `buildBatchListQuery` and unwraps each alias back to the caller's own `key`. */
export function runBatchList(requests: BatchListRequest[]): Promise<Record<string, ListResult>> {
  if (requests.length === 0) return Promise.resolve({});

  const { query, variables } = buildBatchListQuery(requests);
  return blocksDataCall(() =>
    blocksClient.data.graphql({ operationName: "BatchList", query, variables })
  ).then((response) => {
    const root = response as Record<string, unknown> | undefined;
    const dataObj = (root?.data ?? root) as Record<string, unknown> | undefined;
    const result: Record<string, ListResult> = {};
    requests.forEach((req, index) => {
      const value = dataObj?.[`f${index}`] as { items?: EntityRecord[]; totalCount?: number } | undefined;
      result[req.key] = { items: value?.items ?? [], totalCount: value?.totalCount ?? 0 };
    });
    return result;
  });
}

export interface BatchUpdateRequest {
  /** Caller-chosen key the result comes back under — need not be a valid GraphQL name. */
  key: string;
  schemaName: string;
  itemId: string;
  payload: Record<string, unknown>;
}

/**
 * Combines N independent `update<Schema>` mutations — different rows, generally different
 * payloads — into ONE GraphQL request via aliased root fields, the same aliasing technique
 * `buildBatchListQuery` uses for reads, extended to mutations. There's no native bulk-update
 * primitive for "N rows, N different payloads" the way `insertMany<Schema>` covers bulk
 * create (an `updateMany<Schema>` mutation exists, but it applies *one* input to every row
 * matching a filter — not what an import's per-row updates need); this is the batching this
 * shape of write actually gets.
 *
 * Each aliased field resolves independently: a bad payload in one row fails only that row.
 * GraphQL only throws away the HTTP layer on a non-2xx status (confirmed against the SDK's
 * own `http-client.js` — it never inspects a 200 response's `errors` array), so a per-row
 * business failure just leaves that alias's data `null` in an otherwise-200 response; it
 * doesn't take down the rest of the batch the way `insertMany`'s all-or-nothing atomicity
 * would.
 */
export function buildBatchUpdateQuery(requests: BatchUpdateRequest[]): { query: string; variables: Record<string, unknown> } {
  const varDecls: string[] = [];
  const fields: string[] = [];
  const variables: Record<string, unknown> = {};

  requests.forEach((req, index) => {
    const alias = `f${index}`;
    const updateField = `update${req.schemaName}`;
    const whereVar = `${alias}_where`;
    const inputVar = `${alias}_input`;

    varDecls.push(`$${whereVar}: ${req.schemaName}FilterInput`, `$${inputVar}: ${req.schemaName}UpdateInput!`);
    fields.push(`  ${alias}: ${updateField}(where: $${whereVar}, input: $${inputVar}) {
    acknowledged
    itemId
    message
    totalImpactedData
  }`);
    variables[whereVar] = itemIdWhere(req.itemId);
    variables[inputVar] = req.payload;
  });

  const query = `mutation BatchUpdate(${varDecls.join(", ")}) {
${fields.join("\n")}
}`;
  return { query, variables };
}

/** Runs `buildBatchUpdateQuery` and unwraps each alias back to the caller's own `key`. */
export function runBatchUpdate(requests: BatchUpdateRequest[]): Promise<Record<string, ActionResponse>> {
  if (requests.length === 0) return Promise.resolve({});

  const { query, variables } = buildBatchUpdateQuery(requests);
  return blocksDataCall(() =>
    blocksClient.data.graphql({ operationName: "BatchUpdate", query, variables })
  ).then((response) => {
    const root = response as Record<string, unknown> | undefined;
    const dataObj = (root?.data ?? root) as Record<string, unknown> | undefined;
    const result: Record<string, ActionResponse> = {};
    requests.forEach((req, index) => {
      result[req.key] = (dataObj?.[`f${index}`] as ActionResponse | undefined) ?? {};
    });
    return result;
  });
}
