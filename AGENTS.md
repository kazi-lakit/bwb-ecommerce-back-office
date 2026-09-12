# Ecommerce frontend

This is a Vite + React 19 single-page application, structured the same way as the
sibling `dms-app`: React Router for navigation and the Blocks SDK/cookie-backed OIDC
flow in `src/lib/blocks/`. Do not add a local authentication backend or persist Blocks
tokens in browser storage.

This app is the **staff console only** — every route requires a signed-in session
(`/` is `LoginPage`, everything else is under `/admin`, gated by `ProtectedLayout` in
`src/App.tsx`). The public product catalog that used to live here at `/` moved out into
its own sibling app, `ecommerce-consumer` (separate repo/deploy) — don't re-add a public
storefront route to this app; that functionality belongs there now.

Access-token expiry is handled by `onUnauthorized` on the SDK instance in
`src/lib/blocks/client.ts`: on a 401, it calls `blocksClient.auth.refresh()` (IAM's
AuthController, not the OIDC token endpoint — that one needs an explicit
`refresh_token` we never have in JS) so the browser's HttpOnly refresh-token cookie
does the work and IAM rotates the access-token cookie via `Set-Cookie`; the SDK then
retries the original call once. This applies to every call made through
`blocksClient.http.request` — IAM routes and Data Gateway GraphQL calls alike, since
`BlocksDataClient` is built on the same http client. `src/lib/blocks/auth.ts`'s
`withSessionRefresh` is the fallback for the one case this can't fix — the refresh
token itself has also expired — where it dispatches `SESSION_EXPIRED_EVENT` to sign
the user out.

## Deployment (Docker / Blocks OS)

The app builds and runs in a container via the standard Blocks OS convention
(same setup as `beef-app-react` — see its CLAUDE.md deployment notes).

- **`Dockerfile`** — multi-stage: a `node:22-alpine` builder stage runs `npm ci` then
  `npm run build:${ci_build}` (the `ci_build` build-arg selects the environment,
  e.g. `dev`), then copies the output into `nginxinc/nginx-unprivileged:1.29-alpine`,
  serving on port 8080 via `nginx.conf` (plain SPA config: gzip +
  `try_files $uri $uri/ /index.html`).
- Vite's default `dist/` output is what gets copied (`COPY --from=builder /app/dist`).
- **`set-env.cjs`** + `package.json`'s `build:dev`/`build:stg`/`build:prod` scripts:
  each sets `BUILD_ENV`, runs `set-env.cjs` (copies `.env.${BUILD_ENV}` to `.env`),
  then `tsc -b && vite build`. **Local-build caveat:** this repo's local env file is
  `.env.local`, which Vite ranks *above* `.env` — so running `npm run build:dev`
  locally bakes your `.env.local` values, not `.env.dev`'s. The Docker build is
  unaffected (`.dockerignore` excludes `.env.local`); don't run `build:*` locally
  expecting deployed values.
- **`.env.dev`** is tracked in git (un-ignored in `.gitignore` alongside
  `.env.example`) so fresh CI checkouts can build. It still has a placeholder
  `VITE_BLOCKS_APP_DOMAIN` — replace it with the real deployed domain and register
  `https://<deployed-domain>/login/callback` as a redirect URI on the OIDC client
  before the first deploy. If updating via `blocks auth oidc-clients save`, resend
  every field — it replaces, not merges.

## Data model

`src/lib/blocks/schema-meta.ts` is generated from `../ECOMMERCE_INVENTORY_SCHEMAS.json`
(the project's Data schema export) via `scripts/gen-schema-meta.mjs` — regenerate it
with `node scripts/gen-schema-meta.mjs` if that source file changes. Do not hand-edit
`schema-meta.ts`.

The exported JSON's numeric access-level fields (`ReadAccessLevel` etc.) don't map to
fixed labels documented anywhere in this repo — treat the live project config as the
source of truth, not the export. Product reads are configured Public on the Data
Gateway (the separate `ecommerce-consumer` app relies on that to browse the catalog
with no session), but this app doesn't use that — every route here, Product included,
sits behind the authenticated session enforced by `ProtectedLayout` in `src/App.tsx`.
Every write, and every read/write on the other ten entities (`Brand`, `Category`,
`ProductVariant`, `Warehouse`, `WarehouseInventory`, `InventoryReservation`,
`InventoryMovement`, `StockTransfer`, `Supplier`, `PurchaseOrder`), requires that same
session server-side regardless of this app's own guard.

`src/components/resource/` is a generic, schema-driven CRUD table/form used for all
eleven entities under `/admin` so field lists stay in sync with the schema instead of
being hand-maintained per entity. Nested/complex fields (`Media`, `Attributes`,
`Pricing`, `Dimensions`, etc.) get one input per sub-field (`object-fieldset.tsx` for a
single complex field, `repeater-field.tsx` for an array of them), not raw JSON —
`sub-field-input.tsx` renders each control by sub-field type.

**Edit/Delete actions are permission-gated, not shown identically to every signed-in user.**
`lib/blocks/access.ts`'s `useHasRole`/`useHasPermission` read the IAM `roles`/`permissions`
already fetched by `AuthProvider` (previously unused). `lib/blocks/list-config.ts`'s
`NO_EDIT_SCHEMAS`/`NO_DELETE_SCHEMAS`/`ADMIN_ONLY_EDIT_SCHEMAS` mirror the real (or
`P0_POLICY_FIXES.json`-drafted) Data Gateway policies per schema — `InventoryMovement` never
offers Edit/Delete at all (immutable ledger), `WarehouseInventory`/`InventoryReservation`
gate Edit on the `admin` role, and Delete is `admin`-gated everywhere else. `ResourceTable`,
`ProductTable`, `WarehouseCardGrid`, and `WarehouseDetailPage`'s scoped views all take
`canEdit`/`canDelete` props (default `true`, so nothing regresses if a caller doesn't pass
them) and hide the corresponding row action via the shared `row-actions.ts` helper. This only
checks whatever roles a token already carries — no custom IAM roles have necessarily been
created for this project yet (that's `blocks iam roles create` work, left to the user).

**`Media.Url` specifically is a real image upload, not a text field.** `sub-field-input.tsx`
special-cases it (matching on `parentTypeName === "Media" && field.name === "Url"`) to render
`image-upload-field.tsx` instead of a plain `Input` — picking a file calls
`lib/blocks/storage.ts`'s `uploadProductImage()` (presign → PUT bytes → read back the served
URL, via `blocksClient.data.files`), then writes the real URL into the same field the way
every other sub-field control does. Uploads go in as `accessModifier: "Public"` since product
images need to render on the unauthenticated storefront. The platform enforces no server-side
size limit or content verification yet (`DATA_GATEWAY_STORAGE_FEATURES_AND_SECURITY.md`
items A5/A6) — `storage.ts` has a client-side size/type check as a courtesy, not a substitute.

## Feature-flagged Commerce code

`lib/blocks/orders.ts` and `pages/OrdersPage.tsx` are written against the `Order`/`OrderItem`
schemas drafted in the docs repo's `COMMERCE_SCHEMAS_DRAFT.json`, which isn't imported yet, so
they sit behind `VITE_COMMERCE_SCHEMAS_LIVE` (off by default — the Orders screen shows a
"schema isn't live yet" state instead). `lib/blocks/inventory-ops.ts` and
`lib/blocks/reservation-sweep.ts` sit behind `VITE_INVENTORY_WRITES_LIVE`, because
`WarehouseInventory` writes are currently denied to everyone including admins until
`P0_POLICY_FIXES.json` is imported.

Orders deliberately does **not** go through `ResourceListPage`/`createEntityApi`: those read
their shape from the generated `schema-meta.ts`, which has no `Order` in it and mustn't until
the schema is actually live. `orders.ts` uses hand-written GraphQL and needs no regeneration.

**A plain `npm run build` doesn't compile the flagged paths** — with the flags off, Rollup
dead-code-eliminates them. `tsc -b` and `eslint` always cover them; to check they bundle:

```bash
VITE_COMMERCE_SCHEMAS_LIVE=true VITE_INVENTORY_WRITES_LIVE=true npm run build
```

The parts of this app that decide something rather than just render it are covered by a
harness, the same pattern as the storefront's — the Orders actions that move stock (fulfil
consumes reserved inventory, cancel releases it) against a simulated gateway, and the
low-stock classification directly:

```bash
npm run verify
```

`lib/blocks/low-stock.ts` answers "which rows need attention" client-side over a bounded page,
and the panel states its own bound. That isn't only the missing aggregation: the question is
"is `AvailableToSell` below *this row's own* `ReorderPoint`", a comparison between two fields
of one document, which a `where` clause can't express at any scale.

`lib/blocks/inventory-ops.ts` and `lib/blocks/reservation-sweep.ts` are **mirrored
byte-for-byte** with `ecommerce-consumer` — this workspace has no shared package, the same way
`collections.ts` and `schema-meta.ts` are duplicated. Change both or neither.
