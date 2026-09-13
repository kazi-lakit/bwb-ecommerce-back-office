"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createEntityApi, runBatchList, type EntityListParams, type EntityRecord } from "./collections";

export function useEntityList(schemaName: string, params: EntityListParams, enabled = true) {
  return useQuery({
    queryKey: ["entity", schemaName, params],
    queryFn: () => createEntityApi(schemaName).list(params),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export interface EntityListBatchRequest {
  /** Result key — read back via `.data?.[key]`, independent of the GraphQL alias used on the wire. */
  key: string;
  schemaName: string;
  params?: EntityListParams;
  /** Same meaning as `useEntityList`'s `enabled` — an idle request is dropped from the combined query entirely, not sent as an empty one. */
  enabled?: boolean;
}

/**
 * The batched form of `useEntityList` — combines every *independent* request in
 * `requests` (different schemas, or the same schema with different `where`) into ONE
 * GraphQL round trip instead of one per request, via `collections.ts`'s
 * `runBatchList`. Use this wherever a component currently calls `useEntityList`
 * several times side by side for data that doesn't depend on another call's result —
 * `useReferenceLabels`, a dashboard's summary counts, a page loading two or three
 * unrelated lists on mount.
 *
 * Returns `.data` as `Record<key, ListResult>` — reads back exactly like N separate
 * `useEntityList().data` objects, just fetched together. A request with
 * `enabled: false` is left out of both the network call and (until re-enabled) the
 * returned record, the same way a disabled `useEntityList` never populates `.data`.
 */
export function useEntityListBatch(requests: EntityListBatchRequest[]) {
  const active = requests.filter((r) => r.enabled !== false);
  return useQuery({
    queryKey: ["entity-batch", active.map((r) => [r.key, r.schemaName, r.params])],
    queryFn: () => runBatchList(active.map(({ key, schemaName, params }) => ({ key, schemaName, params }))),
    placeholderData: (prev) => prev,
    enabled: active.length > 0,
  });
}

export function useEntityItem(schemaName: string, itemId?: string) {
  return useQuery({
    queryKey: ["entity-item", schemaName, itemId],
    queryFn: () => createEntityApi(schemaName).get(itemId!),
    enabled: Boolean(itemId),
  });
}

export function useEntityMutations(schemaName: string) {
  const qc = useQueryClient();
  const api = createEntityApi(schemaName);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["entity", schemaName] });
    qc.invalidateQueries({ queryKey: ["entity-item", schemaName] });
  };

  return {
    create: useMutation({ mutationFn: (payload: Record<string, unknown>) => api.create(payload), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ itemId, payload }: { itemId: string; payload: Record<string, unknown> }) => api.update(itemId, payload),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (record: EntityRecord) => api.remove((record.ItemId ?? record.itemId) as string), onSuccess: invalidate }),
  };
}
