import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { EntityMeta } from "@/lib/blocks/schema-meta";
import type { EntityListParams } from "@/lib/blocks/collections";
import { applyRows, exportEntity, parseRows, type ImportOutcome, type RowResult } from "@/lib/blocks/bulk";
import { downloadCsv, parseCsv } from "@/lib/csv";
import { toast } from "@/lib/toast-store";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

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

  const invalid = preview?.filter((r) => r.errors.length > 0) ?? [];
  const valid = preview?.filter((r) => r.errors.length === 0) ?? [];

  async function handleExport() {
    setBusy(true);
    try {
      const result = await exportEntity(meta, where);
      downloadCsv(`${meta.schemaName}-${new Date().toISOString().slice(0, 10)}.csv`, result.csv);
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
    try {
      setPreview(parseRows(meta, parseCsv(await file.text())));
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
      if (result.failed.length === 0) {
        toast.success(`Imported ${result.created} new and ${result.updated} updated.`);
        onDone();
      } else {
        toast.error(`${result.failed.length} row(s) failed — see below.`);
        onDone();
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
          Everything currently matching your filters, as CSV. Composite fields (pricing, media,
          addresses) are written as JSON in a single cell so they survive the round trip.
        </p>
        <Button className="mt-3" size="sm" variant="secondary" disabled={busy} onClick={() => void handleExport()}>
          <Download size={14} /> Export {meta.schemaName}
        </Button>
      </section>

      <section className="border-t border-hairline pt-5">
        <h3 className="text-sm font-semibold text-ink">Import</h3>
        <p className="mt-1 text-xs text-muted">
          Rows with an <code className="text-ink">ItemId</code> update that record; rows without one create a
          new record. <strong className="text-ink">Empty cells are left alone, not cleared</strong> — so a
          partly-filled sheet won't wipe fields you didn't touch.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = "";
          }}
        />
        <Button className="mt-3" size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <Upload size={14} /> Choose a CSV
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
          </div>
        )}

        {outcome && (
          <div className="mt-4 rounded-md border border-hairline p-3 text-xs">
            <p className="text-ink">
              {outcome.created} created · {outcome.updated} updated
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
