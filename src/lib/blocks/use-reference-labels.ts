"use client";

import { useMemo } from "react";
import { useEntityListBatch } from "./hooks";
import { entityLabel } from "@/lib/format";
import { REFERENCE_FIELD_TARGETS } from "./reference-fields";
import type { EntityMeta } from "./schema-meta";
import type { EntityRecord } from "./collections";

/** Every possible reference target, in a fixed order so the batch's shape stays stable. */
const REFERENCE_TARGET_SCHEMAS = ["Brand", "Category", "Warehouse", "Product", "ProductVariant", "Supplier"] as const;

/**
 * Resolves every reference field (WarehouseId, ProductId, VariantId, BrandId,
 * CategoryIds, ParentId, SupplierId, …) on the given rows to the target record's name,
 * instead of a raw ItemId. Rather than fetching an arbitrary page of the target
 * collection (which silently misses whatever doesn't happen to be in it once a
 * collection is bigger than one lookup page), this collects the *actual* ids
 * referenced by `items` and fetches exactly those via `where: {ItemId: {in: [...]}}` —
 * correct no matter how large the target collection is. A fixed set of hooks, one per
 * possible target schema, each only firing when `items` actually reference it.
 */
export function useReferenceLabels(meta: EntityMeta | undefined, items: EntityRecord[]) {
  const neededIdsByTarget = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const field of meta?.fields ?? []) {
      const target = REFERENCE_FIELD_TARGETS[field.name];
      if (!target) continue;
      const ids = map[target] ?? (map[target] = new Set<string>());
      for (const item of items) {
        const raw = item[field.name];
        if (Array.isArray(raw)) {
          for (const v of raw) if (typeof v === "string" && v) ids.add(v);
        } else if (typeof raw === "string" && raw) {
          ids.add(raw);
        }
      }
    }
    return map;
  }, [meta, items]);

  function idsFor(target: string): string[] {
    return Array.from(neededIdsByTarget[target] ?? []);
  }

  // One combined request instead of up to 6 separate ones — see `useEntityListBatch`.
  // Every target schema is still its own aliased root field on the wire (still exactly
  // the ids each target actually needs, via `where: {ItemId: {in: [...]}}`), just sent
  // together rather than as N round trips.
  const batch = useEntityListBatch(
    REFERENCE_TARGET_SCHEMAS.map((schemaName) => {
      const ids = idsFor(schemaName);
      return {
        key: schemaName,
        schemaName,
        params: { pageSize: 200, where: ids.length > 0 ? { ItemId: { in: ids } } : undefined },
        enabled: ids.length > 0,
      };
    })
  );

  const lookupsBySchema = useMemo(() => {
    function nameMap(records: EntityRecord[]): Record<string, string> {
      const byId: Record<string, string> = {};
      for (const record of records) {
        const id = (record.ItemId ?? record.itemId) as string | undefined;
        if (id) byId[id] = entityLabel(record);
      }
      return byId;
    }
    const result: Record<string, Record<string, string>> = {};
    for (const schemaName of REFERENCE_TARGET_SCHEMAS) {
      result[schemaName] = nameMap(batch.data?.[schemaName]?.items ?? []);
    }
    return result;
  }, [batch.data]);

  const referenceLabels = useMemo(() => {
    const result: Record<string, Record<string, string>> = {};
    for (const field of meta?.fields ?? []) {
      const target = REFERENCE_FIELD_TARGETS[field.name];
      if (target) result[field.name] = lookupsBySchema[target];
    }
    return result;
  }, [meta, lookupsBySchema]);

  return { referenceLabels, lookupsBySchema };
}
