import type { ComponentType } from "react";
import type { LucideProps } from "lucide-react";
import {
  ArrowLeftRight,
  Bookmark,
  Boxes,
  Building2,
  ClipboardList,
  FolderTree,
  Layers,
  LayoutDashboard,
  Package,
  ShoppingBag,
  Tag,
  Truck,
  Warehouse as WarehouseIcon,
} from "lucide-react";
import { ENTITY_ORDER } from "@/lib/blocks/schema-meta";
import { titleCase } from "@/lib/format";

export function slugFor(schemaName: string): string {
  return schemaName.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function pluralTitle(schemaName: string): string {
  const title = titleCase(schemaName);
  return title.endsWith("y") ? `${title.slice(0, -1)}ies` : `${title}s`;
}

const ICON_BY_SCHEMA: Record<string, ComponentType<LucideProps>> = {
  Product: Package,
  ProductVariant: Layers,
  Category: FolderTree,
  Brand: Tag,
  Warehouse: WarehouseIcon,
  WarehouseInventory: Boxes,
  InventoryReservation: Bookmark,
  InventoryMovement: ArrowLeftRight,
  StockTransfer: Truck,
  Supplier: Building2,
  PurchaseOrder: ClipboardList,
};

/** Friendlier nav labels than a bare pluralized schema name, for the sidebar/breadcrumbs. */
const LABEL_BY_SCHEMA: Record<string, string> = {
  ProductVariant: "Variants",
  WarehouseInventory: "Inventory",
  InventoryReservation: "Reservations",
  InventoryMovement: "Inventory Movements",
};

export interface NavItem {
  schemaName: string;
  slug: string;
  label: string;
  icon: ComponentType<LucideProps>;
}

/**
 * Orders isn't in ENTITY_ORDER because that comes from the generated `schema-meta.ts`, and the
 * `Order` schema isn't imported yet (see `lib/blocks/orders.ts`). It's listed by hand so the
 * screen is reachable now; fold it into the generated list once the schema is live and
 * `schema-meta.ts` has been regenerated.
 */
const COMMERCE_NAV_ITEMS: NavItem[] = [
  { schemaName: "Order", slug: "orders", label: "Orders", icon: ShoppingBag },
];

export const ADMIN_NAV_ITEMS: NavItem[] = [
  ...COMMERCE_NAV_ITEMS,
  ...ENTITY_ORDER.map((schemaName) => ({
    schemaName,
    slug: slugFor(schemaName),
    label: LABEL_BY_SCHEMA[schemaName] ?? pluralTitle(schemaName),
    icon: ICON_BY_SCHEMA[schemaName] ?? Package,
  })),
];

export const DASHBOARD_NAV_ITEM = { slug: "", label: "Dashboard", icon: LayoutDashboard };
