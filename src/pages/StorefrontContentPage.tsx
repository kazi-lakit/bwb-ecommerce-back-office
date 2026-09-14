import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, DatabaseZap, Image as ImageIcon, RefreshCw, Save, UploadCloud } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/lib/toast-store";
import { uploadPublicImage } from "@/lib/blocks/storage";
import {
  DEFAULT_STOREFRONT_HERO,
  getHomeHero,
  saveHomeHero,
  STOREFRONT_CONTENT_LIVE,
  type StorefrontHeroContent,
} from "@/lib/blocks/storefront-content";

const DEFAULT_PREVIEW_IMAGE = "/images/cartio-home-hero.jpg";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      {hint && <span className="ml-2 text-xs font-normal text-muted">{hint}</span>}
      <span className="mt-2 block">{children}</span>
    </label>
  );
}

export default function StorefrontContentPage() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<StorefrontHeroContent>({ ...DEFAULT_STOREFRONT_HERO });
  const [uploading, setUploading] = useState(false);

  const heroQuery = useQuery({
    queryKey: ["storefront-content", "home-hero", "admin"],
    queryFn: getHomeHero,
    enabled: STOREFRONT_CONTENT_LIVE,
  });

  useEffect(() => {
    if (heroQuery.data) setForm({ ...DEFAULT_STOREFRONT_HERO, ...heroQuery.data });
  }, [heroQuery.data]);

  const saveMutation = useMutation({
    mutationFn: saveHomeHero,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["storefront-content"] });
      toast.success(form.Status === "published" ? "Homepage hero published." : "Homepage hero saved as draft.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "The hero content could not be saved."),
  });

  function update<K extends keyof StorefrontHeroContent>(key: K, value: StorefrontHeroContent[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function uploadImage(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadPublicImage(file);
      setForm((current) => ({ ...current, ImageUrl: uploaded.url, ImageFileId: uploaded.fileId }));
      toast.success("Hero image uploaded. Save the page to publish it.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image could not be uploaded.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.Heading.trim() || !form.Description.trim() || !form.PrimaryCtaLabel.trim()) {
      toast.error("Heading, description, and primary button label are required.");
      return;
    }
    if (!form.PrimaryCtaHref.startsWith("/") || (form.SecondaryCtaHref && !form.SecondaryCtaHref.startsWith("/"))) {
      toast.error("Button links must be storefront paths beginning with /.");
      return;
    }
    if (form.ImageUrl && !form.ImageAltText.trim()) {
      toast.error("Add alternative text for the hero image.");
      return;
    }
    saveMutation.mutate(form);
  }

  if (!STOREFRONT_CONTENT_LIVE) {
    return (
      <div className="pb-3 pt-1">
        <PageHeader title="Storefront content" description="Manage the public homepage hero content and image." />
        <section className="rounded-xl border border-hairline bg-canvas px-6 py-12 text-center shadow-[var(--shadow-card)]">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-brand-accent-soft text-brand-accent">
            <DatabaseZap size={24} />
          </span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">Storefront content schema is ready to connect</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-steel">
            Import and reload the prepared StorefrontHero schema, then enable VITE_STOREFRONT_CONTENT_LIVE in both apps. Until then, the storefront safely keeps its current hero.
          </p>
        </section>
      </div>
    );
  }

  if (heroQuery.isLoading) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center">
        <Spinner className="h-8 w-8" />
        <p className="mt-4 text-sm font-medium text-muted">Loading storefront content</p>
      </div>
    );
  }

  if (heroQuery.isError) {
    return (
      <div className="pb-3 pt-1">
        <PageHeader title="Storefront content" description="Manage the public homepage hero content and image." />
        <section className="rounded-xl border border-hairline bg-canvas px-6 py-12 text-center shadow-[var(--shadow-card)]">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-brand-error/10 text-brand-error">
            <AlertCircle size={24} />
          </span>
          <h2 className="mt-5 text-xl font-semibold tracking-tight text-ink">The hero content could not be loaded</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-steel">
            Check that the StorefrontHero schema is available and that this account has access, then try again.
          </p>
          <Button type="button" variant="secondary" className="mt-6" onClick={() => void heroQuery.refetch()}>
            <RefreshCw size={16} /> Try again
          </Button>
        </section>
      </div>
    );
  }

  const highlights = [form.HighlightOne, form.HighlightTwo, form.HighlightThree].filter(Boolean);

  return (
    <div className="pb-3 pt-1">
      <PageHeader
        title="Storefront content"
        description="Manage the public homepage hero content, calls to action, highlights, and image."
        actions={
          <div className="flex items-center gap-2 rounded-full bg-brand-success/10 px-3 py-1.5 text-xs font-semibold text-status-positive-text">
            <CheckCircle2 size={14} /> Connected
          </div>
        }
      />

      <form onSubmit={submit} className="grid items-start gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(460px,1.1fr)]">
        <div className="space-y-6">
          <section className="rounded-xl border border-hairline bg-canvas p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline-soft pb-5">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Publishing</p>
                <h2 className="mt-1 text-base font-semibold text-ink">Hero status</h2>
              </div>
              <Select value={form.Status} onChange={(event) => update("Status", event.target.value as "draft" | "published")} className="w-36" aria-label="Hero status">
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </Select>
            </div>

            <div className="mt-6 space-y-5">
              <Field label="Eyebrow" hint={`${form.Eyebrow.length}/80`}>
                <Input value={form.Eyebrow} onChange={(event) => update("Eyebrow", event.target.value)} maxLength={80} placeholder="Autumn collection · 2026" />
              </Field>
              <Field label="Heading" hint={`${form.Heading.length}/100`}>
                <Textarea value={form.Heading} onChange={(event) => update("Heading", event.target.value)} maxLength={100} rows={3} />
              </Field>
              <Field label="Description" hint={`${form.Description.length}/240`}>
                <Textarea value={form.Description} onChange={(event) => update("Description", event.target.value)} maxLength={240} rows={4} />
              </Field>
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-canvas p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Navigation</p>
            <h2 className="mt-1 text-base font-semibold text-ink">Calls to action</h2>
            <div className="mt-5 grid gap-5 sm:grid-cols-2">
              <Field label="Primary label"><Input value={form.PrimaryCtaLabel} onChange={(event) => update("PrimaryCtaLabel", event.target.value)} maxLength={50} /></Field>
              <Field label="Primary path" hint="Starts with /"><Input value={form.PrimaryCtaHref} onChange={(event) => update("PrimaryCtaHref", event.target.value)} placeholder="/products" /></Field>
              <Field label="Secondary label"><Input value={form.SecondaryCtaLabel} onChange={(event) => update("SecondaryCtaLabel", event.target.value)} maxLength={50} /></Field>
              <Field label="Secondary path" hint="Starts with /"><Input value={form.SecondaryCtaHref} onChange={(event) => update("SecondaryCtaHref", event.target.value)} placeholder="/products" /></Field>
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-canvas p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Reassurance</p>
            <h2 className="mt-1 text-base font-semibold text-ink">Highlight labels</h2>
            <div className="mt-5 space-y-4">
              <Input value={form.HighlightOne} onChange={(event) => update("HighlightOne", event.target.value)} maxLength={60} aria-label="First highlight" />
              <Input value={form.HighlightTwo} onChange={(event) => update("HighlightTwo", event.target.value)} maxLength={60} aria-label="Second highlight" />
              <Input value={form.HighlightThree} onChange={(event) => update("HighlightThree", event.target.value)} maxLength={60} aria-label="Third highlight" />
            </div>
          </section>

          <Button type="submit" className="w-full sm:w-auto" disabled={saveMutation.isPending || uploading}>
            {saveMutation.isPending ? <Spinner className="h-4 w-4" /> : <Save size={16} />}
            {saveMutation.isPending ? "Saving…" : form.Status === "published" ? "Save and publish" : "Save draft"}
          </Button>
        </div>

        <div className="space-y-6 xl:sticky xl:top-5">
          <section className="overflow-hidden rounded-xl border border-hairline bg-canvas shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline-soft px-5 py-5 sm:px-6">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-accent">Hero media</p>
                <h2 className="mt-1 text-base font-semibold text-ink">Background image</h2>
                <p className="mt-1 text-xs text-muted">Use a wide image, ideally 2000 × 1100 px or larger.</p>
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => void uploadImage(event.target.files?.[0])} />
              <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? <Spinner className="h-4 w-4" /> : <UploadCloud size={15} />}
                {uploading ? "Uploading…" : form.ImageUrl ? "Replace image" : "Upload image"}
              </Button>
            </div>
            <div className="p-4 sm:p-5">
              <div className="aspect-[16/9] overflow-hidden rounded-lg bg-surface">
                <img src={form.ImageUrl || DEFAULT_PREVIEW_IMAGE} alt={form.ImageAltText || "Hero preview"} className="h-full w-full object-cover" />
              </div>
              {form.ImageUrl && (
                <button type="button" onClick={() => setForm((current) => ({ ...current, ImageUrl: "", ImageFileId: "" }))} className="mt-3 text-xs font-semibold text-brand-error hover:underline">
                  Remove custom image
                </button>
              )}
              <div className="mt-4">
                <Field label="Alternative text" hint="Required for uploaded images">
                  <Input value={form.ImageAltText} onChange={(event) => update("ImageAltText", event.target.value)} maxLength={180} placeholder="Describe the image for screen readers" />
                </Field>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-hairline bg-canvas p-4 shadow-[var(--shadow-card)]">
            <div className="mb-3 flex items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2 text-xs font-semibold text-ink"><ImageIcon size={14} className="text-brand-accent" /> Live preview</div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">Desktop</span>
            </div>
            <div className="relative isolate min-h-[430px] overflow-hidden rounded-lg bg-[#1c1917] p-8 text-white">
              <img src={form.ImageUrl || DEFAULT_PREVIEW_IMAGE} alt="" className="absolute inset-0 -z-20 h-full w-full object-cover" />
              <div className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,rgba(12,10,9,0.96)_0%,rgba(28,25,23,0.84)_55%,rgba(28,25,23,0.24)_100%)]" />
              <div className="max-w-[70%]">
                {form.Eyebrow && <span className="inline-flex rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-white/80">{form.Eyebrow}</span>}
                <h3 className="mt-5 text-4xl font-medium leading-[1.02] tracking-tight">{form.Heading || "Your hero heading"}</h3>
                <p className="mt-4 text-xs leading-5 text-white/65">{form.Description || "Your supporting description will appear here."}</p>
                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="rounded-full bg-brand-accent px-4 py-2 text-[10px] font-semibold">{form.PrimaryCtaLabel || "Primary action"}</span>
                  {form.SecondaryCtaLabel && <span className="rounded-full border border-white/25 px-4 py-2 text-[10px] font-semibold">{form.SecondaryCtaLabel}</span>}
                </div>
                {highlights.length > 0 && <p className="mt-7 text-[9px] text-white/50">{highlights.join("  ·  ")}</p>}
              </div>
            </div>
          </section>
        </div>
      </form>
    </div>
  );
}
