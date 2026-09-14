import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import type { LucideProps } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export interface SummaryCardProps {
  label: string;
  description?: string;
  value?: number;
  loading?: boolean;
  icon: ComponentType<LucideProps>;
  to?: string;
}

export function SummaryCard({ label, description, value, loading, icon: Icon, to }: SummaryCardProps) {
  const card = (
    <Card className="group flex min-h-36 items-start justify-between gap-4 border border-hairline p-5 shadow-[var(--shadow-card)] transition-all hover:-translate-y-0.5 hover:border-brand-accent/30">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{label}</p>
        {loading ? (
          <Skeleton className="mt-3 h-8 w-16" />
        ) : (
          <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-ink">{value ?? "—"}</p>
        )}
        {description && <p className="mt-2 text-xs leading-5 text-steel">{description}</p>}
      </div>
      <div className="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-brand-accent-soft text-brand-accent transition-transform group-hover:scale-105">
        <Icon size={19} />
      </div>
    </Card>
  );
  return to ? (
    <Link to={to} className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-admin-canvas">
      {card}
    </Link>
  ) : (
    card
  );
}
