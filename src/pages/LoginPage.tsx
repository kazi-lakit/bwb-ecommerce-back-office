import { Navigate } from "react-router-dom";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { startLogin } from "@/lib/blocks/auth";
import { CartioAnimatedLogo } from "@/components/brand/cartio-animated-logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * The only public route. This app is the staff console — the public catalog now lives
 * in its own app (`ecommerce-consumer`) — so an anonymous visitor here has nothing to
 * browse, just a way to sign in. Login stays user-initiated (click "Staff sign in")
 * rather than auto-redirecting; a signed-out visit to a protected `/admin` route still
 * auto-redirects on its own (see App.tsx's RedirectToLogin) since there's an explicit
 * destination to return to once signed in.
 */
export default function LoginPage() {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (status === "authenticated") return <Navigate to="/admin" replace />;

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-admin-canvas px-4 py-10">
      <div className="absolute right-4 top-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md rounded-xl border border-hairline bg-canvas p-7 shadow-[var(--shadow-card)] sm:p-10">
        <CartioAnimatedLogo className="h-11" />
        <div className="mt-8 border-t border-hairline-soft pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-accent">Back office</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Welcome to your commerce workspace</h1>
          <p className="mt-3 text-sm leading-6 text-steel">Manage catalog, inventory, warehouses, suppliers, and purchasing from one secure console.</p>
        </div>
        <Button className="mt-6 w-full" onClick={() => void startLogin()}>
          Staff sign in <ArrowRight size={16} />
        </Button>
        <p className="mt-5 flex items-center justify-center gap-2 text-xs text-muted">
          <BadgeCheck size={14} className="text-brand-accent" /> Authorized staff access only
        </p>
      </div>
    </div>
  );
}
