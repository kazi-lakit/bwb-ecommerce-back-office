import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { Providers } from "@/components/providers/providers";
import { useAuth } from "@/components/providers/auth-provider";
import { startLogin } from "@/lib/blocks/auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { Spinner } from "@/components/ui/spinner";
import AuthCallbackPage from "@/pages/AuthCallbackPage";
import LoginPage from "@/pages/LoginPage";
import DashboardPage from "@/pages/DashboardPage";
import WarehouseDetailPage from "@/pages/WarehouseDetailPage";
import ResourceListPage from "@/pages/ResourceListPage";
import OrdersPage from "@/pages/OrdersPage";
import StorefrontContentPage from "@/pages/StorefrontContentPage";

function Loading() {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center">
      <Spinner className="h-6 w-6" />
    </div>
  );
}

/** There's no standalone /login page — hitting a protected route while signed out goes straight into the SSO redirect. */
function RedirectToLogin({ returnTo }: { returnTo: string }) {
  useEffect(() => {
    void startLogin(returnTo);
  }, [returnTo]);
  return <Loading />;
}

/**
 * `/admin/*` is the entire app now — every entity's create/update/delete goes through
 * here, gated behind a validated IAM session (`useAuth`, backed by `GET /iam/v4/iam/me`
 * against the session cookie). An anonymous visitor is sent straight into the hosted
 * SSO flow (see RedirectToLogin above) before any admin query fires. The public product
 * catalog that used to live at "/" moved to its own app (`ecommerce-consumer`); "/" here
 * is now just LoginPage, so this guard is the actual security boundary for this app, not
 * just a convenience — though the server still enforces access per schema independently
 * of it.
 */
function ProtectedLayout() {
  const { status } = useAuth();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  if (status === "loading") return <Loading />;
  if (status === "unauthenticated") return <RedirectToLogin returnTo={location.pathname} />;
  return (
    <div className="flex min-h-screen flex-1 bg-admin-canvas">
      <Sidebar mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onOpenMobile={() => setMobileNavOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto px-4 pb-8 sm:px-6 lg:px-7">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Providers>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LoginPage />} />
          <Route path="/login/callback" element={<AuthCallbackPage />} />
          <Route path="/admin" element={<ProtectedLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="warehouse/:warehouseId" element={<WarehouseDetailPage />} />
            {/* Static segment, so it out-ranks the `:entity` catch-all below. Orders can't go
                through ResourceListPage — that reads its shape from the generated schema-meta,
                which has no Order in it until the Commerce schemas are imported. */}
            <Route path="orders" element={<OrdersPage />} />
            <Route path="storefront-content" element={<StorefrontContentPage />} />
            <Route path=":entity" element={<ResourceListPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Providers>
  );
}
