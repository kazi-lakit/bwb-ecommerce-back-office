import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { EntityMeta } from "@/lib/blocks/schema-meta";
import type { EntityListParams } from "@/lib/blocks/collections";
import { applyRows, exportEntity, parseImportFile, type BulkFormat, type ImportOutcome, type RowResult } from "@/lib/blocks/bulk";
import { importProductsViaWorkflow, type WorkflowImportOutcome } from "@/lib/blocks/workflow-import";
import { downloadFile } from "@/lib/csv";
import { toast } from "@/lib/toast-store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** The file's own extension decides how to read it — `.json` is unambiguous, and anything
 * else (including a plain `.csv`) is read as CSV, matching what `accept` below offers. */
function formatFromFilename(name: string): BulkFormat {
  return name.toLowerCase().endsWith(".json") ? "json" : "csv";
}

/**
 * Bulk export and import for one entity. Export honours whatever filters the list is showing,
 * so "export what I'm looking at" means what it says.
 *
 * Import always previews before it writes. There is no transaction behind these writes (see
 * `bulk.ts`), so an import that turns out to be wrong halfway can't be rolled back — which
 * makes looking before writing the only safety there is.
 */
export function BulkPanel({
  meta,
  where,
  onDone,
}: {
  meta: EntityMeta;
  where: EntityListParams["where"];
  onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<RowResult[] | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [workflowOutcome, setWorkflowOutcome] = useState<WorkflowImportOutcome | null>(null);

  const invalid = preview?.filter((r) => r.errors.length > 0) ?? [];
  const valid = preview?.filter((r) => r.errors.length === 0) ?? [];

  async function handleExport(format: BulkFormat) {
    setBusy(true);
    try {
      const result = await exportEntity(meta, where, format);
      downloadFile(result.filename, result.content, result.mimeType);
      toast.success(
        result.truncated
          ? `Exported the first ${result.rowCount} of ${result.totalCount} — the rest weren't included.`
          : `Exported ${result.rowCount} row${result.rowCount === 1 ? "" : "s"}.`
      );
    } catch (error) {
      toast.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFile(file: File) {
    setOutcome(null);
    setWorkflowOutcome(null);
    try {
      setPreview(parseImportFile(meta, formatFromFilename(file.name), await file.text()));
    } catch (error) {
      toast.error(`Couldn't read that file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await applyRows(meta, valid);
      setOutcome(result);
      const variantNote =
        result.variantsCreated || result.variantsUpdated
          ? ` (${result.variantsCreated ?? 0} variant${result.variantsCreated === 1 ? "" : "s"} created, ` +
            `${result.variantsUpdated ?? 0} updated, ${result.stockWritten ?? 0} stock row${result.stockWritten === 1 ? "" : "s"} written)`
          : "";
      if (result.failed.length === 0) {
        toast.success(`Imported ${result.created} new and ${result.updated} updated.${variantNote}`);
        onDone();
      } else {
        toast.error(`${result.failed.length} row(s) failed — see below.`);
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * The alternate path: one Blocks Workflow webhook call instead of this app's own sequential
   * writes. Create-only (see `workflow-import.ts`'s doc comment for the full list of what it
   * can't do that the regular Import button can) — offered alongside, not instead of, the
   * normal path.
   */
  async function handleWorkflowImport() {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await importProductsViaWorkflow(valid);
      setWorkflowOutcome(result);
      if (result.ok) {
        toast.success(`Sent ${result.attempted} product(s) to the import workflow (${result.status ?? "queued"}).`);
        onDone();
      } else {
        toast.error(`Workflow import failed: ${result.error ?? "unknown error"}`);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6 px-6 py-5">
      <section>
        <h3 className="text-sm font-semibold text-ink">Export</h3>
        <p className="mt-1 text-xs text-muted">
          Everything currently matching your filters, as CSV or JSON. CSV writes composite fields
          (pricing, media, addresses) as JSON in a single cell so they survive the round trip;
          JSON writes them as real nested objects/arrays instead — pick whichever the next step
          (a spreadsheet, or a script) actually wants.
          {meta.schemaName === "Product" && (
            <>
              {" "}A product's <code className="text-ink">Variants</code> column carries its full
              variant list, each with an optional <code className="text-ink">Stock</code> array
              (per-warehouse quantities, by <code className="text-ink">WarehouseCode</code>) — so
              re-importing this file recreates or updates those too, not just the product itself.
            </>
          )}
        </p>
        <div className="mt-3 flex gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleExport("csv")}>
            <Download size={14} /> Export CSV
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleExport("json")}>
            <Download size={14} /> Export JSON
          </Button>
        </div>
      </section>

      <section className="border-t border-hairline pt-5">
        <h3 className="text-sm font-semibold text-ink">Import</h3>
        <p className="mt-1 text-xs text-muted">
          CSV or JSON — same shape a matching export writes; the file's own extension decides
          which reader is used. Rows with an <code className="text-ink">ItemId</code> update that
          record; rows without one create a new record.{" "}
          <strong className="text-ink">Empty (or, in JSON, <code className="text-ink">null</code>) fields are left
          alone, not cleared</strong> — so a partly-filled file won't wipe fields you didn't touch.
          {meta.schemaName === "Product" && (
            <>
              {" "}A row's <code className="text-ink">Variants</code> column, when present, is
              applied right after that product: each variant is matched to an existing one by{" "}
              <code className="text-ink">Sku</code> (updated) or created new, and each variant's{" "}
              <code className="text-ink">Stock</code> entries are matched by warehouse (updated) or
              created — so providing complete product info, including stock, is optional but
              supported. A <code className="text-ink">WarehouseCode</code> that doesn't match an
              existing warehouse fails just that stock entry, not the whole row.
            </>
          )}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,.json,text/csv,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <Button className="mt-3" size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Choose a CSV or JSON file
        </Button>

        {preview && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-ink">
              {valid.length} row{valid.length === 1 ? "" : "s"} ready
              {invalid.length > 0 && <span className="text-brand-error"> · {invalid.length} with problems</span>}
            </p>

            {invalid.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-hairline p-3 text-xs">
                {invalid.slice(0, 20).map((row) => (
                  <li key={row.line} className="text-brand-error">
                    Line {row.line}: {row.errors.join("; ")}
                  </li>
                ))}
                {invalid.length > 20 && <li className="text-muted">and {invalid.length - 20} more</li>}
              </ul>
            )}

            {/* Rows with problems are skipped rather than blocking the whole file: a
                thousand-row sheet with three bad cells should import 997 and tell you which
                three, not refuse everything. */}
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={busy || valid.length === 0} onClick={() => void handleApply()}>
                {busy && <Spinner className="h-3.5 w-3.5" />}
                Import {valid.length} row{valid.length === 1 ? "" : "s"}
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPreview(null)}>
                Clear
              </Button>
            </div>

            {meta.schemaName === "Product" && (
              <div className="rounded-md border border-hairline p-3">
                <p className="text-xs text-muted">
                  Or send the new (non-update) rows through the <strong className="text-ink">Import Product With
                  Variants And Stock</strong> workflow instead — one webhook call inserts each product, then its
                  variants, then their stock, using a workflow-embedded credential so stock writes don&apos;t need
                  your own session to hold the <code className="text-ink">inventory-operator</code> role. Create-only
                  (rows with an <code className="text-ink">ItemId</code> are skipped, not duplicated), and it can&apos;t
                  set <code className="text-ink">CategoryIds</code>/<code className="text-ink">Media</code> — a
                  platform limit on what a workflow can write, not this app.
                </p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="secondary"
                  disabled={busy || valid.length === 0}
                  onClick={() => void handleWorkflowImport()}
                >
                  {busy && <Spinner className="h-3.5 w-3.5" />}
                  Import via Workflow
                </Button>
                {workflowOutcome && (
                  <p className={`mt-2 text-xs ${workflowOutcome.ok ? "text-ink" : "text-brand-error"}`}>
                    {workflowOutcome.ok
                      ? `Sent ${workflowOutcome.attempted} product(s) — ${workflowOutcome.status ?? "queued"}` +
                        (workflowOutcome.skippedExisting > 0
                          ? ` (${workflowOutcome.skippedExisting} update row(s) skipped — this path is create-only)`
                          : "")
                      : workflowOutcome.error}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {outcome && (
          <div className="mt-4 rounded-md border border-hairline p-3 text-xs">
            <p className="text-ink">
              {outcome.created} created · {outcome.updated} updated
              {(outcome.variantsCreated || outcome.variantsUpdated) ? (
                <> · {outcome.variantsCreated ?? 0} variant{(outcome.variantsCreated ?? 0) === 1 ? "" : "s"} created ·{" "}
                  {outcome.variantsUpdated ?? 0} variant{(outcome.variantsUpdated ?? 0) === 1 ? "" : "s"} updated ·{" "}
                  {outcome.stockWritten ?? 0} stock row{(outcome.stockWritten ?? 0) === 1 ? "" : "s"} written</>
              ) : null}
              {outcome.failed.length > 0 && <span className="text-brand-error"> · {outcome.failed.length} failed</span>}
            </p>
            {/* Named per line, because there's no transaction: rows before the failure are
                already written, and knowing which one broke is the difference between fixing
                a cell and re-importing blind. */}
            {outcome.failed.length > 0 && (
              <ul className="mt-2 space-y-1">
                {outcome.failed.slice(0, 20).map((f) => (
                  <li key={f.line} className="text-brand-error">
                    Line {f.line}: {f.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
