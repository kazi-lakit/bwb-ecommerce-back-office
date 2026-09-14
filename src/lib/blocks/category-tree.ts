import type { EntityRecord } from "./collections";

interface CategoryAncestorSnapshot {
  CategoryId?: string;
}

/**
 * A product's `CategoryIds` must carry the full path — every directly-assigned category plus
 * all of *its* ancestors — not just the leaf. The Data Gateway has no joins: filtering
 * "everything under Living Room" only finds a product assigned to "Sofas" if that product's
 * own `CategoryIds` array already contains the Living Room id too, since `where` can only ever
 * inspect the array actually stored on the record being queried.
 *
 * `Category.Ancestors` (an ordered snapshot of `{CategoryId, Name, Slug}` from root down to,
 * but not including, the category itself — already returned on every fetched `Category`
 * record, no extra query needed) is exactly the lookup this needs.
 *
 * Recomputed from `selectedIds` every time, not merged with whatever a product's `CategoryIds`
 * already held — the leaf ids a person actually picked are the source of truth; ancestors are
 * always re-derived, never hand-edited.
 */
export function expandCategoryIds(selectedIds: string[], categories: EntityRecord[]): string[] {
  const byId = new Map(categories.map((c) => [(c.ItemId ?? c.itemId) as string | undefined, c]));
  const expanded: string[] = [];
  const seen = new Set<string>();

  for (const id of selectedIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    expanded.push(id);

    const category = byId.get(id);
    const ancestors = Array.isArray(category?.Ancestors) ? (category.Ancestors as CategoryAncestorSnapshot[]) : [];
    for (const ancestor of ancestors) {
      if (ancestor.CategoryId && !seen.has(ancestor.CategoryId)) {
        seen.add(ancestor.CategoryId);
        expanded.push(ancestor.CategoryId);
      }
    }
  }

  return expanded;
}
