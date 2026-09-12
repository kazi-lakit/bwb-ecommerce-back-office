import { useState } from "react";
import type { EntityMeta, FieldMeta } from "@/lib/blocks/schema-meta";
import type { EntityRecord } from "@/lib/blocks/collections";
import { FIELD_SECTIONS } from "@/lib/blocks/field-sections";
import { fieldLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { FieldInput, isComplexField } from "./field-input";
import { FormSection } from "./form-section";
import { toFormValues, toPayload, validateFormValues, type FormValues } from "./form-values";

export interface ResourceFormProps {
  meta: EntityMeta;
  record?: EntityRecord | null;
  /** Only used in create mode (no `record`) — seeds specific fields (e.g. `{ WarehouseId: id }` when creating inventory from within a warehouse's own page) without changing the create/edit distinction. */
  initialValues?: Record<string, unknown>;
  submitting?: boolean;
  /**
   * Rendered after the schema-driven sections, inside the scrolling area but outside the
   * field grid — for things that belong to this record but aren't fields on it, like a
   * product's variants (separate entities pointing back at it).
   */
  extraSections?: React.ReactNode;
  /**
   * Render as a plain container instead of a `<form>`, for when this form sits inside
   * another one (the variants panel inside the product form).
   *
   * A `<form>` nested in a `<form>` is invalid HTML: the browser silently drops the inner
   * element, so its fields join the outer form and its submit button submits *that*. Saving a
   * variant would save the product instead — quietly, with no error anywhere. Native
   * validation and Enter-to-submit are lost in this mode; `handleSubmit` is wired to the
   * button directly and `validateFormValues` still runs, which is where the real validation
   * lives anyway.
   */
  nested?: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
}

/** Groups a schema's fields into named sections (see field-sections.ts), or one "General information" section for everything else. */
function sectionsFor(meta: EntityMeta): { title: string; description?: string; fields: FieldMeta[] }[] {
  const configured = FIELD_SECTIONS[meta.schemaName];
  if (!configured) return [{ title: "General information", fields: meta.fields }];

  const byName = new Map(meta.fields.map((f) => [f.name, f]));
  const used = new Set<string>();
  const sections = configured
    .map((section) => {
      const fields = section.fields.map((name) => byName.get(name)).filter((f): f is FieldMeta => Boolean(f));
      fields.forEach((f) => used.add(f.name));
      return { title: section.title, description: section.description, fields };
    })
    .filter((s) => s.fields.length > 0);

  // Defensive: a field schema-meta knows about but this config doesn't mention yet still gets shown.
  const leftover = meta.fields.filter((f) => !used.has(f.name));
  if (leftover.length > 0) sections.push({ title: "Other", description: undefined, fields: leftover });
  return sections;
}

export function ResourceForm({ meta, record, initialValues, submitting, extraSections, nested, onSubmit, onCancel }: ResourceFormProps) {
  const [values, setValues] = useState<FormValues>(() =>
    toFormValues(meta, record ?? (initialValues as EntityRecord | undefined))
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const sections = sectionsFor(meta);

  function setField(name: string, value: unknown) {
    setValues((prev) => ({ ...prev, [name]: value as string | boolean }));
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const nextErrors = validateFormValues(meta, values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstInvalid = meta.fields.find((f) => nextErrors[f.name]);
      document.getElementById(firstInvalid ? `field-${meta.schemaName}-${firstInvalid.name}` : "")?.scrollIntoView({ block: "center" });
      return;
    }
    onSubmit(toPayload(meta, values));
  }

  const Container = nested ? "div" : "form";

  return (
    <Container
      {...(nested ? {} : { onSubmit: handleSubmit, noValidate: true })}
      className={nested ? "flex flex-col" : "flex h-full min-h-0 flex-col"}
    >
      <div className={nested ? "space-y-7 px-4 py-4" : "min-h-0 flex-1 space-y-7 overflow-y-auto px-6 py-5"}>
        {sections.map((section) => (
          <FormSection key={section.title} title={section.title} description={section.description}>
            {section.fields.map((field) => {
              const complex = isComplexField(field);
              const wide = complex || field.isArray;
              const inputId = `input-${meta.schemaName}-${field.name}`;
              return (
                <div
                  key={field.name}
                  id={`field-${meta.schemaName}-${field.name}`}
                  className={wide ? "sm:col-span-2 flex flex-col gap-1.5" : "flex flex-col gap-1.5"}
                >
                  <label htmlFor={complex ? undefined : inputId} className="text-sm font-medium text-ink">
                    {fieldLabel(field.name)}
                    {field.required && (
                      <span className="text-brand-error" aria-label="required">
                        {" "}
                        *
                      </span>
                    )}
                  </label>
                  <FieldInput
                    id={inputId}
                    field={field}
                    value={values[field.name]}
                    onChange={(v) => setField(field.name, v)}
                    error={errors[field.name]}
                  />
                  {field.description && <p className="text-xs text-muted">{field.description}</p>}
                  {errors[field.name] && (
                    <p className="text-xs text-brand-error" role="alert">
                      {errors[field.name]}
                    </p>
                  )}
                </div>
              );
            })}
          </FormSection>
        ))}

        {extraSections}
      </div>

      <div
        className={
          nested
            ? "flex flex-none justify-end gap-2 border-t border-hairline px-4 py-3"
            : "flex flex-none justify-end gap-2 border-t border-hairline bg-canvas px-6 py-4"
        }
      >
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {/* Never type="submit" when nested — that would submit the enclosing form. */}
        <Button type={nested ? "button" : "submit"} onClick={nested ? () => handleSubmit() : undefined} disabled={submitting}>
          {submitting && <Spinner className="h-3.5 w-3.5" />}
          {submitting ? "Saving…" : record ? "Save changes" : "Create"}
        </Button>
      </div>
    </Container>
  );
}
