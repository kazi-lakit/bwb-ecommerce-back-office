import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { getEntityMeta, type EntityRecord } from "@/lib/blocks/collections";
import { useEntityList, useEntityMutations } from "@/lib/blocks/hooks";
import { formatCurrency } from "@/lib/format";
import { toast } from "@/lib/toast-store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { StatusBadge } from "@/components/ui/status-badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ResourceForm } from "./resource-form";

function itemId(record: EntityRecord): string {
  return (record.ItemId ?? record.itemId) as string;
}

/**
 * Manage a product's variants without leaving the product.
 *
 * Variants were a wholly separate screen, so adding a size to a product meant leaving the
 * product you were editing, creating a variant elsewhere, and hand-typing its `ProductId` —
 * a foreign key a person should never be asked to copy.
 *
 * **Edit mode only, deliberately.** A variant points at a product by id, and a product being
 * created doesn't have one yet. Collecting variants during create and inserting them after
 * the product insert returns would mean a multi-document write with no transaction behind it
 * (the same constraint that shapes the inventory code) — a failure partway leaves a product
 * with some of its variants and no signal about which. Asking the user to save first is the
 * honest version of a flow the data model can actually support.
 *
 * The add/edit form is the same `ResourceForm` the standalone Variants screen uses, driven by
 * the same schema metadata — so validation, sub-forms and field sections stay in one place,
 * and a variant created here is identical to one created there.
 */
export function ProductVariantsPanel({ productId }: { productId: string }) {
  const meta = getEntityMeta("ProductVariant");
  const variants = useEntityList(
    "ProductVariant",
    { pageNo: 1, pageSize: 50, where: { ProductId: { eq: productId } } },
    Boolean(productId)
  );
  const mutations = useEntityMutations("ProductVariant");

  const [editing, setEditing] = useState<EntityRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<EntityRecord | null>(null);

  const items = variants.data?.items ?? [];
  const open = creating || Boolean(editing);

  function close() {
    setCreating(false);
    setEditing(null);
  }

  function handleCreate(payload: Record<string, unknown>) {
    // Stamped here rather than left to the form: the whole point of this panel is that nobody
    // types a ProductId. It's set even if the form somehow carries one.
    mutations.create.mutate(
      { ...payload, ProductId: productId },
      {
        onSuccess: () => {
          toast.success("Variant created.");
          close();
        },
      }
    );
  }

  function handleUpdate(payload: Record<string, unknown>) {
    if (!editing) return;
    mutations.update.mutate(
      { itemId: itemId(editing), payload: { ...payload, ProductId: productId } },
      {
        onSuccess: () => {
          toast.success("Variant updated.");
          close();
        },
      }
    );
  }

  function handleDelete() {
    if (!deleting) return;
    mutations.remove.mutate(deleting, {
      onSuccess: () => {
        toast.success("Variant deleted.");
        setDeleting(null);
      },
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Variants</h3>
          <p className="text-xs text-muted">
            {items.length === 0
              ? "No variants yet — a product needs at least one to be sellable."
              : `${items.length} variant${items.length === 1 ? "" : "s"}`}
          </p>
        </div>
        {!open && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
            <Plus size={14} /> Add variant
          </Button>
        )}
      </div>

      {variants.isLoading ? (
        <div className="flex justify-center py-6">
          <Spinner className="h-5 w-5" />
        </div>
      ) : (
        items.length > 0 && (
          <ul className="divide-y divide-hairline-soft rounded-md border border-hairline">
            {items.map((variant) => {
              const pricing = (variant.Pricing ?? {}) as Record<string, number | string | undefined>;
              const price = (pricing.SalePrice as number) || (pricing.RegularPrice as number);
              return (
                <li key={itemId(variant)} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink">{(variant.Name as string) || (variant.Sku as string)}</p>
                    <p className="text-xs text-muted">
                      {(variant.Sku as string) || "no SKU"}
                      {price ? ` · ${formatCurrency(price, pricing.Currency as string)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-none items-center gap-2">
                    {variant.Status ? <StatusBadge status={variant.Status as string} /> : null}
                    <button
                      type="button"
                      aria-label="Edit variant"
                      onClick={() => {
                        setCreating(false);
                        setEditing(variant);
                      }}
                      className="text-muted hover:text-ink"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      type="button"
                      aria-label="Delete variant"
                      onClick={() => setDeleting(variant)}
                      className="text-muted hover:text-brand-error"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      )}

      {open && (
        <div className="rounded-md border border-brand-accent">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
            <p className="text-sm font-medium text-ink">{editing ? "Edit variant" : "New variant"}</p>
            <button type="button" aria-label="Close" onClick={close} className="text-muted hover:text-ink">
              <X size={15} />
            </button>
          </div>
          {/*
            Rendered inline rather than in a nested drawer: this form already lives inside the
            product's drawer, and stacking a second one over it makes "which thing does Cancel
            close?" genuinely ambiguous.

            `nested` matters more than it looks. A <form> inside a <form> is invalid HTML — the
            browser drops the inner element, so these fields would join the product form and
            this Save would submit the product instead, silently. See ResourceForm.

            ProductId is hidden — it's this product, by construction, and showing an editable
            foreign key here would invite exactly the mistake this panel exists to prevent.
          */}
          <ResourceForm
            nested
            meta={{ ...meta, fields: meta.fields.filter((f) => f.name !== "ProductId") }}
            record={editing}
            submitting={mutations.create.isPending || mutations.update.isPending}
            onSubmit={editing ? handleUpdate : handleCreate}
            onCancel={close}
          />
        </div>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete this variant?"
          description="This can't be undone. Any inventory recorded against it will be left pointing at a variant that no longer exists."
          confirmLabel="Delete"
          danger
          loading={mutations.remove.isPending}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
