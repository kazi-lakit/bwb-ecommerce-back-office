// AUTO-GENERATED from ECOMMERCE_INVENTORY_SCHEMAS.json — do not hand-edit.
// Regenerate with scripts/gen-schema-meta.mjs if the source schema file changes.

const PRIMITIVE_FIELD_TYPES = new Set(["String", "Int", "Float", "Boolean", "DateTime", "ID"]);

/**
 * Everything not in this set is a schema-defined composite/object type (Media,
 * Attribute, Pricing, …). On the Data Gateway's generated GraphQL schema those are
 * real object types, not JSON scalars — a query selecting one bare (no `{ ... }`
 * sub-selection) fails with "A composite type always needs to specify a selection
 * set." `src/lib/blocks/collections.ts` uses this to build that sub-selection from
 * `COMPLEX_TYPES`; the resource form UI uses it to decide which fields render as a
 * JSON textarea.
 */
export function isComplexFieldType(type: string): boolean {
  return !PRIMITIVE_FIELD_TYPES.has(type);
}

export interface FieldMeta {
  name: string;
  type: string;
  isArray: boolean;
  isUnique?: boolean;
  description?: string;
  required?: boolean;
  pattern?: string;
  min?: number;
  errorMessages?: { required?: string; pattern?: string; min?: string };
}

export interface EntityMeta {
  schemaName: string;
  collectionName: string;
  readAccessLevel: number;
  writeAccessLevel: number;
  editAccessLevel: number;
  deleteAccessLevel: number;
  rowLevelPolicies: string[];
  fields: FieldMeta[];
}

export const COMPLEX_TYPES: Record<string, FieldMeta[]> = {
  "Address": [
    { name: "Line1", type: "String", isArray: false, description: "Primary street address." },
    { name: "Line2", type: "String", isArray: false, description: "Additional address information." },
    { name: "City", type: "String", isArray: false, description: "City or locality." },
    { name: "State", type: "String", isArray: false, description: "State, province, or region." },
    { name: "PostalCode", type: "String", isArray: false, description: "Postal or ZIP code." },
    { name: "CountryCode", type: "String", isArray: false, description: "ISO 3166-1 alpha-2 country code.", pattern: "^[A-Z]{2}$", errorMessages: { pattern: "Must be a two-letter uppercase country code" } },
  ],
  "Contact": [
    { name: "Name", type: "String", isArray: false, description: "Contact person name." },
    { name: "Email", type: "String", isArray: false, description: "Contact email address.", pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\\\.[a-zA-Z]{2,}$", errorMessages: { pattern: "Must be a valid email address" } },
    { name: "Phone", type: "String", isArray: false, description: "Contact telephone number." },
  ],
  "Media": [
    { name: "MediaId", type: "String", isArray: false, description: "Unique media item identifier." },
    { name: "Type", type: "String", isArray: false, description: "Media type such as image or video." },
    { name: "Url", type: "String", isArray: false, description: "Public or signed media URL." },
    { name: "AltText", type: "String", isArray: false, description: "Accessible alternative text." },
    { name: "Position", type: "Int", isArray: false, description: "Display order.", min: 0, errorMessages: { min: "Position cannot be negative" } },
    { name: "IsPrimary", type: "Boolean", isArray: false, description: "Whether this is the primary media item." },
  ],
  "Attribute": [
    { name: "Code", type: "String", isArray: false, description: "Stable machine-readable attribute code." },
    { name: "Name", type: "String", isArray: false, description: "Display name." },
    { name: "Value", type: "String", isArray: false, description: "Attribute value." },
  ],
  "VariantOption": [
    { name: "Code", type: "String", isArray: false, description: "Stable option code such as color or size." },
    { name: "Name", type: "String", isArray: false, description: "Option display name." },
    { name: "Values", type: "String", isArray: true, description: "Allowed option values." },
  ],
  "OptionValue": [
    { name: "Code", type: "String", isArray: false, description: "Option code." },
    { name: "Name", type: "String", isArray: false, description: "Option display name." },
    { name: "Value", type: "String", isArray: false, description: "Selected value." },
  ],
  "Pricing": [
    { name: "Currency", type: "String", isArray: false, description: "ISO 4217 currency code.", pattern: "^[A-Z]{3}$", errorMessages: { pattern: "Must be a three-letter uppercase currency code" } },
    { name: "RegularPrice", type: "Float", isArray: false, description: "Standard selling price.", min: 0, errorMessages: { min: "Price cannot be negative" } },
    { name: "SalePrice", type: "Float", isArray: false, description: "Optional discounted selling price.", min: 0, errorMessages: { min: "Price cannot be negative" } },
    { name: "CostPrice", type: "Float", isArray: false, description: "Internal acquisition or production cost.", min: 0, errorMessages: { min: "Cost cannot be negative" } },
  ],
  "Dimensions": [
    { name: "Weight", type: "Float", isArray: false, description: "Weight value.", min: 0, errorMessages: { min: "Weight cannot be negative" } },
    { name: "WeightUnit", type: "String", isArray: false, description: "Weight unit such as kg or lb." },
    { name: "Length", type: "Float", isArray: false, description: "Length value.", min: 0, errorMessages: { min: "Length cannot be negative" } },
    { name: "Width", type: "Float", isArray: false, description: "Width value.", min: 0, errorMessages: { min: "Width cannot be negative" } },
    { name: "Height", type: "Float", isArray: false, description: "Height value.", min: 0, errorMessages: { min: "Height cannot be negative" } },
    { name: "DimensionUnit", type: "String", isArray: false, description: "Dimension unit such as cm or in." },
  ],
  "InventoryQuantity": [
    { name: "OnHand", type: "Float", isArray: false, description: "Physical quantity currently present." },
    { name: "Reserved", type: "Float", isArray: false, description: "Quantity reserved for open carts or orders." },
    { name: "Damaged", type: "Float", isArray: false, description: "Quantity unavailable because it is damaged." },
    { name: "QualityHold", type: "Float", isArray: false, description: "Quantity unavailable pending inspection." },
    { name: "Incoming", type: "Float", isArray: false, description: "Confirmed quantity expected from purchase orders or transfers." },
  ],
  "BinLocation": [
    { name: "Zone", type: "String", isArray: false, description: "Warehouse zone." },
    { name: "Aisle", type: "String", isArray: false, description: "Warehouse aisle." },
    { name: "Rack", type: "String", isArray: false, description: "Rack identifier." },
    { name: "Shelf", type: "String", isArray: false, description: "Shelf identifier." },
    { name: "Bin", type: "String", isArray: false, description: "Bin identifier." },
  ],
  "SourceReference": [
    { name: "Type", type: "String", isArray: false, description: "Source entity type such as order, cart, or purchase_order." },
    { name: "Id", type: "String", isArray: false, description: "Source entity identifier." },
    { name: "Number", type: "String", isArray: false, description: "Human-readable source number." },
  ],
  "Actor": [
    { name: "Type", type: "String", isArray: false, description: "Actor type: user, system, or integration." },
    { name: "Id", type: "String", isArray: false, description: "Actor identifier." },
    { name: "Name", type: "String", isArray: false, description: "Actor display name." },
  ],
  "ReservationItem": [
    { name: "WarehouseId", type: "String", isArray: false, description: "Warehouse reserving the stock." },
    { name: "ProductId", type: "String", isArray: false, description: "Parent product identifier." },
    { name: "VariantId", type: "String", isArray: false, description: "Reserved variant identifier." },
    { name: "Sku", type: "String", isArray: false, description: "SKU snapshot." },
    { name: "Quantity", type: "Float", isArray: false, description: "Reserved quantity.", min: 0, errorMessages: { min: "Quantity cannot be negative" } },
  ],
  "MovementQuantity": [
    { name: "OnHand", type: "Float", isArray: false, description: "Signed change to on-hand quantity." },
    { name: "Reserved", type: "Float", isArray: false, description: "Signed change to reserved quantity." },
    { name: "Damaged", type: "Float", isArray: false, description: "Signed change to damaged quantity." },
    { name: "QualityHold", type: "Float", isArray: false, description: "Signed change to quality-hold quantity." },
  ],
  "InventoryBalance": [
    { name: "OnHand", type: "Float", isArray: false, description: "On-hand balance after the movement." },
    { name: "Reserved", type: "Float", isArray: false, description: "Reserved balance after the movement." },
    { name: "AvailableToSell", type: "Float", isArray: false, description: "Sellable balance after the movement." },
  ],
  "TransferItem": [
    { name: "ProductId", type: "String", isArray: false, description: "Parent product identifier." },
    { name: "VariantId", type: "String", isArray: false, description: "Variant being transferred." },
    { name: "Sku", type: "String", isArray: false, description: "SKU snapshot." },
    { name: "RequestedQuantity", type: "Float", isArray: false, description: "Requested transfer quantity." },
    { name: "ShippedQuantity", type: "Float", isArray: false, description: "Quantity dispatched." },
    { name: "ReceivedQuantity", type: "Float", isArray: false, description: "Quantity received." },
    { name: "DamagedQuantity", type: "Float", isArray: false, description: "Quantity damaged during transfer." },
  ],
  "CategoryAncestor": [
    { name: "CategoryId", type: "String", isArray: false, description: "Ancestor category identifier." },
    { name: "Name", type: "String", isArray: false, description: "Ancestor category name snapshot." },
    { name: "Slug", type: "String", isArray: false, description: "Ancestor category slug snapshot." },
  ],
  "SupplierItem": [
    { name: "VariantId", type: "String", isArray: false, description: "Supplied product variant." },
    { name: "SupplierSku", type: "String", isArray: false, description: "Supplier-specific SKU." },
    { name: "UnitCost", type: "Float", isArray: false, description: "Current quoted unit cost." },
    { name: "Currency", type: "String", isArray: false, description: "ISO 4217 currency code." },
    { name: "MinimumOrderQuantity", type: "Float", isArray: false, description: "Minimum quantity accepted by the supplier." },
    { name: "LeadTimeDays", type: "Int", isArray: false, description: "Expected lead time in days." },
  ],
  "PurchaseOrderItem": [
    { name: "ProductId", type: "String", isArray: false, description: "Parent product identifier." },
    { name: "VariantId", type: "String", isArray: false, description: "Ordered variant identifier." },
    { name: "Sku", type: "String", isArray: false, description: "SKU snapshot." },
    { name: "OrderedQuantity", type: "Float", isArray: false, description: "Quantity ordered." },
    { name: "ReceivedQuantity", type: "Float", isArray: false, description: "Quantity received to date." },
    { name: "UnitCost", type: "Float", isArray: false, description: "Agreed unit cost." },
    { name: "TaxAmount", type: "Float", isArray: false, description: "Tax amount for this line." },
    { name: "LineTotal", type: "Float", isArray: false, description: "Total line amount." },
  ],
};

export const ENTITY_SCHEMAS: Record<string, EntityMeta> = {
  "Brand": {
    schemaName: "Brand",
    collectionName: "blx_Brands",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "Name", type: "String", isArray: false, description: "Brand display name.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Slug", type: "String", isArray: false, isUnique: true, description: "URL-safe unique brand slug.", required: true, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", errorMessages: { required: "This field is required", pattern: "Must be a lowercase URL-safe slug" } },
      { name: "Description", type: "String", isArray: false, description: "Brand description." },
      { name: "LogoUrl", type: "String", isArray: false, description: "Brand logo URL." },
      { name: "WebsiteUrl", type: "String", isArray: false, description: "Official brand website." },
      { name: "Status", type: "String", isArray: false, description: "Lifecycle status: active, inactive, or archived." },
    ],
  },
  "Category": {
    schemaName: "Category",
    collectionName: "blx_Categories",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "Name", type: "String", isArray: false, description: "Category display name.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Slug", type: "String", isArray: false, isUnique: true, description: "URL-safe unique category slug.", required: true, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", errorMessages: { required: "This field is required", pattern: "Must be a lowercase URL-safe slug" } },
      { name: "ParentId", type: "String", isArray: false, description: "Immediate parent category identifier." },
      { name: "Ancestors", type: "CategoryAncestor", isArray: true, description: "Ordered ancestor path." },
      { name: "Level", type: "Int", isArray: false, description: "Depth in the category tree.", min: 0, errorMessages: { min: "Level cannot be negative" } },
      { name: "ImageUrl", type: "String", isArray: false, description: "Category image URL." },
      { name: "Status", type: "String", isArray: false, description: "Lifecycle status." },
      { name: "SortOrder", type: "Int", isArray: false, description: "Display order." },
    ],
  },
  "Product": {
    schemaName: "Product",
    collectionName: "blx_Products",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "Name", type: "String", isArray: false, description: "Product display name.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Slug", type: "String", isArray: false, isUnique: true, description: "URL-safe unique product slug.", required: true, pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", errorMessages: { required: "This field is required", pattern: "Must be a lowercase URL-safe slug" } },
      { name: "ProductType", type: "String", isArray: false, description: "Product type: physical, digital, or service." },
      { name: "Status", type: "String", isArray: false, description: "Lifecycle status: draft, active, inactive, or archived." },
      { name: "ShortDescription", type: "String", isArray: false, description: "Short catalog description." },
      { name: "LongDescription", type: "String", isArray: false, description: "Full product description." },
      { name: "CategoryIds", type: "String", isArray: true, description: "Assigned category identifiers." },
      { name: "BrandId", type: "String", isArray: false, description: "Associated brand identifier." },
      { name: "Media", type: "Media", isArray: true, description: "Product media gallery." },
      { name: "Attributes", type: "Attribute", isArray: true, description: "Shared product attributes." },
      { name: "VariantOptions", type: "VariantOption", isArray: true, description: "Options used to construct variants." },
      { name: "DefaultVariantId", type: "String", isArray: false, description: "Default sellable variant." },
      { name: "IsInventoryTracked", type: "Boolean", isArray: false, description: "Whether stock is tracked." },
      { name: "AllowBackorder", type: "Boolean", isArray: false, description: "Whether orders may exceed available inventory." },
      { name: "SeoTitle", type: "String", isArray: false, description: "Search result title." },
      { name: "SeoDescription", type: "String", isArray: false, description: "Search result description." },
      { name: "SeoKeywords", type: "String", isArray: true, description: "SEO keywords." },
      { name: "SchemaVersion", type: "Int", isArray: false, description: "Product document schema version." },
    ],
  },
  "ProductVariant": {
    schemaName: "ProductVariant",
    collectionName: "blx_ProductVariants",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "ProductId", type: "String", isArray: false, description: "Parent product identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Name", type: "String", isArray: false, description: "Variant display name." },
      { name: "Sku", type: "String", isArray: false, isUnique: true, description: "Organization-unique stock keeping unit.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Barcode", type: "String", isArray: false, isUnique: true, description: "UPC, EAN, ISBN, or internal barcode." },
      { name: "OptionValues", type: "OptionValue", isArray: true, description: "Selected option values." },
      { name: "Pricing", type: "Pricing", isArray: false, description: "Variant pricing." },
      { name: "Dimensions", type: "Dimensions", isArray: false, description: "Shipping dimensions." },
      { name: "TaxCode", type: "String", isArray: false, description: "Tax classification code." },
      { name: "Status", type: "String", isArray: false, description: "Lifecycle status." },
      { name: "IsInventoryTracked", type: "Boolean", isArray: false, description: "Whether stock is tracked for this variant." },
      { name: "AllowBackorder", type: "Boolean", isArray: false, description: "Whether backorders are permitted." },
      { name: "ReorderPoint", type: "Float", isArray: false, description: "Default low-stock threshold." },
      { name: "ReorderQuantity", type: "Float", isArray: false, description: "Default replenishment quantity." },
    ],
  },
  "Warehouse": {
    schemaName: "Warehouse",
    collectionName: "blx_Warehouses",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "Code", type: "String", isArray: false, isUnique: true, description: "Organization-unique warehouse code.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Name", type: "String", isArray: false, description: "Warehouse display name.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Type", type: "String", isArray: false, description: "warehouse, store, fulfillment_center, or virtual." },
      { name: "Status", type: "String", isArray: false, description: "Lifecycle status." },
      { name: "Address", type: "Address", isArray: false, description: "Warehouse address." },
      { name: "Contact", type: "Contact", isArray: false, description: "Warehouse contact." },
      { name: "AllowPickup", type: "Boolean", isArray: false, description: "Whether customer pickup is allowed." },
      { name: "AllowShipping", type: "Boolean", isArray: false, description: "Whether outbound shipping is allowed." },
      { name: "FulfillmentPriority", type: "Int", isArray: false, description: "Lower values are selected first." },
      { name: "Timezone", type: "String", isArray: false, description: "IANA timezone identifier." },
    ],
  },
  "WarehouseInventory": {
    schemaName: "WarehouseInventory",
    collectionName: "blx_WarehouseInventory",
    readAccessLevel: 2,
    writeAccessLevel: 3,
    editAccessLevel: 3,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "WarehouseId", type: "String", isArray: false, description: "Warehouse identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "ProductId", type: "String", isArray: false, description: "Denormalized parent product identifier." },
      { name: "VariantId", type: "String", isArray: false, description: "Variant identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Sku", type: "String", isArray: false, description: "Denormalized SKU." },
      { name: "Quantity", type: "InventoryQuantity", isArray: false, description: "Inventory quantity buckets." },
      { name: "AvailableToSell", type: "Float", isArray: false, description: "OnHand minus unavailable and reserved quantities." },
      { name: "BinLocation", type: "BinLocation", isArray: false, description: "Primary storage bin." },
      { name: "ReorderPoint", type: "Float", isArray: false, description: "Low-stock threshold." },
      { name: "ReorderQuantity", type: "Float", isArray: false, description: "Suggested replenishment quantity." },
      { name: "LastCountedDate", type: "DateTime", isArray: false, description: "Most recent physical stock count timestamp." },
      { name: "Version", type: "Long", isArray: false, description: "Optimistic concurrency version." },
    ],
  },
  "InventoryReservation": {
    schemaName: "InventoryReservation",
    collectionName: "blx_InventoryReservations",
    readAccessLevel: 2,
    writeAccessLevel: 2,
    editAccessLevel: 3,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "ReservationNumber", type: "String", isArray: false, isUnique: true, description: "Organization-unique reservation number.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Source", type: "SourceReference", isArray: false, description: "Cart, checkout, or order that owns the reservation." },
      { name: "CustomerId", type: "String", isArray: false, description: "Customer identifier." },
      { name: "Status", type: "String", isArray: false, description: "active, committed, released, or expired." },
      { name: "Items", type: "ReservationItem", isArray: true, description: "Reserved inventory lines." },
      { name: "ExpiresDate", type: "DateTime", isArray: false, description: "Expiration timestamp for an active reservation." },
      { name: "CommittedDate", type: "DateTime", isArray: false, description: "Timestamp when stock was committed." },
      { name: "ReleasedDate", type: "DateTime", isArray: false, description: "Timestamp when stock was released." },
    ],
  },
  "InventoryMovement": {
    schemaName: "InventoryMovement",
    collectionName: "blx_InventoryMovements",
    readAccessLevel: 2,
    writeAccessLevel: 3,
    editAccessLevel: 3,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "MovementNumber", type: "String", isArray: false, isUnique: true, description: "Organization-unique movement number.", required: true, errorMessages: { required: "This field is required" } },
      { name: "WarehouseId", type: "String", isArray: false, description: "Affected warehouse identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "ProductId", type: "String", isArray: false, description: "Denormalized product identifier." },
      { name: "VariantId", type: "String", isArray: false, description: "Affected variant identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Sku", type: "String", isArray: false, description: "SKU snapshot." },
      { name: "MovementType", type: "String", isArray: false, description: "purchase_receipt, sale, return, reservation, adjustment, damage, transfer_out, transfer_in, or stock_count." },
      { name: "QuantityChange", type: "MovementQuantity", isArray: false, description: "Signed quantity changes." },
      { name: "BalanceAfter", type: "InventoryBalance", isArray: false, description: "Inventory balance after applying the movement." },
      { name: "Reference", type: "SourceReference", isArray: false, description: "Business document that caused the movement." },
      { name: "ReasonCode", type: "String", isArray: false, description: "Machine-readable reason." },
      { name: "Notes", type: "String", isArray: false, description: "Operator notes." },
      { name: "IdempotencyKey", type: "String", isArray: false, isUnique: true, description: "Unique key preventing duplicate processing.", required: true, errorMessages: { required: "This field is required" } },
      { name: "PerformedBy", type: "Actor", isArray: false, description: "User, system, or integration responsible." },
      { name: "OccurredDate", type: "DateTime", isArray: false, description: "Business occurrence timestamp." },
    ],
  },
  "StockTransfer": {
    schemaName: "StockTransfer",
    collectionName: "blx_StockTransfers",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "TransferNumber", type: "String", isArray: false, isUnique: true, description: "Organization-unique transfer number.", required: true, errorMessages: { required: "This field is required" } },
      { name: "SourceWarehouseId", type: "String", isArray: false, description: "Origin warehouse.", required: true, errorMessages: { required: "This field is required" } },
      { name: "DestinationWarehouseId", type: "String", isArray: false, description: "Destination warehouse.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Status", type: "String", isArray: false, description: "draft, approved, in_transit, partially_received, received, or cancelled." },
      { name: "Items", type: "TransferItem", isArray: true, description: "Transferred inventory lines." },
      { name: "ExpectedArrivalDate", type: "DateTime", isArray: false, description: "Expected arrival timestamp." },
      { name: "ApprovedBy", type: "String", isArray: false, description: "Approver user identifier." },
      { name: "ApprovedDate", type: "DateTime", isArray: false, description: "Approval timestamp." },
    ],
  },
  "Supplier": {
    schemaName: "Supplier",
    collectionName: "blx_Suppliers",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "Code", type: "String", isArray: false, isUnique: true, description: "Organization-unique supplier code.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Name", type: "String", isArray: false, description: "Supplier legal or trading name.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Status", type: "String", isArray: false, description: "active, inactive, or blocked." },
      { name: "Contact", type: "Contact", isArray: false, description: "Primary supplier contact." },
      { name: "Address", type: "Address", isArray: false, description: "Supplier address." },
      { name: "TaxNumber", type: "String", isArray: false, description: "Supplier tax or VAT number." },
      { name: "PaymentTermsDays", type: "Int", isArray: false, description: "Default payment term in days." },
      { name: "Currency", type: "String", isArray: false, description: "Default ISO 4217 settlement currency." },
      { name: "Items", type: "SupplierItem", isArray: true, description: "Supplier catalog and terms." },
    ],
  },
  "PurchaseOrder": {
    schemaName: "PurchaseOrder",
    collectionName: "blx_PurchaseOrders",
    readAccessLevel: 2,
    writeAccessLevel: 1,
    editAccessLevel: 1,
    deleteAccessLevel: 3,
    rowLevelPolicies: ["only admin can delete data"],
    fields: [
      { name: "PurchaseOrderNumber", type: "String", isArray: false, isUnique: true, description: "Organization-unique purchase order number.", required: true, errorMessages: { required: "This field is required" } },
      { name: "SupplierId", type: "String", isArray: false, description: "Supplier identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "WarehouseId", type: "String", isArray: false, description: "Receiving warehouse identifier.", required: true, errorMessages: { required: "This field is required" } },
      { name: "Status", type: "String", isArray: false, description: "draft, submitted, approved, partially_received, received, cancelled, or closed." },
      { name: "OrderDate", type: "DateTime", isArray: false, description: "Date placed with the supplier." },
      { name: "ExpectedDeliveryDate", type: "DateTime", isArray: false, description: "Expected receipt date." },
      { name: "Currency", type: "String", isArray: false, description: "ISO 4217 currency code." },
      { name: "Items", type: "PurchaseOrderItem", isArray: true, description: "Purchase order lines." },
      { name: "Subtotal", type: "Float", isArray: false, description: "Sum before tax and shipping." },
      { name: "TaxAmount", type: "Float", isArray: false, description: "Total tax." },
      { name: "ShippingAmount", type: "Float", isArray: false, description: "Shipping and handling charges." },
      { name: "GrandTotal", type: "Float", isArray: false, description: "Final payable amount." },
      { name: "Notes", type: "String", isArray: false, description: "Buyer or receiving notes." },
      { name: "ApprovedBy", type: "String", isArray: false, description: "Approver user identifier." },
      { name: "ApprovedDate", type: "DateTime", isArray: false, description: "Approval timestamp." },
    ],
  },
};

export const ENTITY_ORDER: string[] = ["Brand","Category","Product","ProductVariant","Warehouse","WarehouseInventory","InventoryReservation","InventoryMovement","StockTransfer","Supplier","PurchaseOrder"];
