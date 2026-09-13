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
- **`.env.dev`** is tracked in git (un-ignored in `.gitignore` alongside `.env.example`) so
  fresh CI checkouts can build — briefly gitignored 2026-09-13, reverted the same day once a
  deploy broke on a fresh checkout with no other provisioning step in place for it. It holds
  this project's real (non-secret) values already: `VITE_BLOCKS_APP_DOMAIN` is the live
  `https://dwyxlp-ekqyt.slsblx.com`, already registered as a redirect URI on the OIDC client.
  If the deployed domain ever changes, register the new one via `blocks auth oidc-clients
  save --item-id <id> --redirect-uris "<full list incl. the new one>"` — it replaces the
  whole list, so include every URI still needed, not just the new one.
  `set-env.cjs` also now falls back to `process.env` (the deployment platform's own
  Key-Vault-backed env vars) when `.env.dev` is missing, rather than hard-failing — so either
  path works, but the tracked file remains the default.

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

## Bulk import / export

Every entity list has an Import / export drawer (`components/resource/bulk-panel.tsx`). Export
honours the list's current filters and writes composite fields as JSON in one cell so they
survive the round trip; `ItemId` is the first column, which is what makes a re-import an update
rather than a duplicated catalog.

Two rules worth knowing before changing it: **an empty cell is skipped, never sent as empty**
(a partly-filled sheet must not wipe fields nobody touched — so clearing a field deliberately
isn't expressible, which is the right side of that trade), and **rows with problems are
skipped rather than blocking the file**, with per-line reasons. There's no batch mutation and
no transaction, so an import applies row by row and failures are reported per line — knowing
row 34 broke and 1–33 landed is the difference between fixing a cell and re-importing blind.

`lib/blocks/low-stock.ts` answers "which rows need attention" client-side over a bounded page,
and the panel states its own bound. That isn't only the missing aggregation: the question is
"is `AvailableToSell` below *this row's own* `ReorderPoint`", a comparison between two fields
of one document, which a `where` clause can't express at any scale.

`lib/blocks/inventory-ops.ts` and `lib/blocks/reservation-sweep.ts` are **mirrored
byte-for-byte** with `ecommerce-consumer` — this workspace has no shared package, the same way
`collections.ts` and `schema-meta.ts` are duplicated. Change both or neither.

<!-- blocks-skills:start -->
## SELISE Blocks

These rules govern Blocks work in this repo. Skills are vendored at `.codex/skills/<name>/SKILL.md`
(Claude Code discovers the same set via `.claude/skills/`). Read the vendored copy directly; there is
no CLI command that serves a skill. Re-vendor with BOOTSTRAP.md.

<!-- Everything between these markers is what BOOTSTRAP.md vendors into consumer repos.
     Keep it free of anything true only of this repo or only of a given checkout. -->

## Routing is your job, not the user's

**Never expect the user to name a skill.** There is no `/skill` invocation, no slash command, no menu. Users describe what they want in plain language — "let users upload a profile picture", "why does login redirect back to the login page", "add German translations" — and **you** map that to the right skill and execute it.

- Do **not** ask "which skill should I use?" or list skills for the user to pick from. Reading the request and choosing is your work.
- Do **not** wait to be told. Once the request matches a row in the routing table, load that skill and proceed.
- If the request genuinely spans several skills, pick the one that owns the *first* concrete step, run it, then move to the next. Sequence them yourself.
- If nothing matches, check the vendored skill directories on disk before concluding no skill applies — the table below can lag the vendored set. The published catalog is [`blocks-cli/blocks-skills/`](https://github.com/SELISEdigitalplatforms/blocks-cli/tree/main/blocks-skills).
- Ask the user only about things the routing table cannot settle: a destructive confirmation, a missing credential, or an ambiguous *goal* — never about which skill to run.

The routing table exists so you can decide unaided. Treat a request that names no skill as the normal case, because it is.

## Workflow

1. Understand the objective.
2. If login/project/app state is unknown, probe (below) and start with **`blocks-bootstrap`**.
3. Match the request against the **Skill routing table** yourself, then load the skill by reading its vendored `SKILL.md` (see **Loading a skill** below).
4. Inspect the existing implementation before changing it.
5. Make the smallest correct change, then verify it.

## Prerequisites

The `blocks` CLI is required for terminal/admin work:

```bash
npm install -g @seliseblocks/cli-os@latest
blocks --version
```

**Do not install it automatically.** If `blocks --version` fails, ask first. The SDK for app code is `npm install @seliseblocks/client@latest`.

Read-only probe when state is unknown:

```bash
blocks --version
blocks auth status --json
blocks doctor --json
```

If `blocks` is missing, stop the probe and ask before installing. Don't claim bootstrap is runnable until the CLI exists.

**Never guess a command or a flag — ask the CLI.** `blocks help <command>` prints one command's exact positionals, flags, scope, and whether it mutates; `blocks help <family>` lists a family; `blocks --help --json` lists every command. Read that before running anything unfamiliar, and prefer it over any command spelling you remember, including one from this file. Set `BLOCKS_STRICT_FLAGS=1` in scripted runs so an unrecognized flag hard-fails instead of being warned and ignored.

## Loading a skill

**Skills are vendored files, not a CLI command.** They live on disk as `.codex/skills/<name>/SKILL.md`, with Claude Code discovering the same set through `.claude/skills/`. Read the vendored copy directly.

There is **no `blocks skill list`/`show`/`add`**, and the package does not bundle the skill tree. Don't reach for those commands, and don't treat their absence as a broken install.

If a skill named in the routing table isn't vendored here, the fix is to re-run the vendoring runbook (`BOOTSTRAP.md` in this repo's source) — not to fetch the file ad hoc or write a replacement from memory. The published catalog is [`blocks-cli/blocks-skills/`](https://github.com/SELISEdigitalplatforms/blocks-cli/tree/main/blocks-skills); read from there only to confirm a name, never as a substitute for vendoring.

## Hard rules

- **Never raw `fetch`/`curl` against `api.seliseblocks.com`.** Use the `blocks` CLI or the `@seliseblocks/client` SDK. Every skill states which surface it uses. Bypassing them with raw HTTP is the failure mode these skills exist to prevent.
- **`--dry-run` before `--yes`** on every mutating CLI command. Get human confirmation before destructive or cloud-mutating operations.
- **Never read the CLI's local storage files** (config/token/secret files on disk) or print anything inside them — client ids, root tenant id, account names, tokens. Interact only through `blocks` commands. To repair broken state use `blocks login`, `blocks auth remove <account>`, `blocks projects list --json`, `blocks use <tenantId>`.
- **`blocks projects create` accepts the Blocks terms on the user's behalf** (`isAcceptBlocksTerms`, `isUseBlocksExclusively`). Never run it without explicit consent to that, and never to "try something" — it provisions real cloud tenancy. Run `--dry-run --json` first, then `--yes` only after approval. It creates exactly one app in the `dev` environment; further environments are portal-only.
- **Never expose secrets or credentials.** The former generic `blocks secrets` commands were removed because their backing API no longer accepts the CLI's authentication mode; do not work around their absence with raw HTTP.
- **Don't attribute work to an AI tool** anywhere in this repo — no assistant names in docs, comments, or commit messages.

## Skill routing table

Surface: **CLI** = terminal/admin, project-scoped · **SDK** = `@seliseblocks/client` in app code · **Both** = each surface covers part of the job.

### Start here

| Skill | Use when | Surface |
|---|---|---|
| `blocks-bootstrap` | New user, or `not_logged_in` / `project_not_selected`. Detects state via `blocks auth status --json` / `doctor --json`, closes install/login/project gaps, resolves the app OIDC client, scaffolds with `blocks new web`, and runs `blocks init` inside the app dir only when the work needs project-local Blocks files. **Run before any other skill when state is unknown.** | CLI |

### Data

| Skill | Use when | Surface |
|---|---|---|
| `blocks-data-gateway-configuration` | Defining, editing, securing, validating, or reloading the **data model** — schema fields, access policies, validation rules. `data config/schema/rules/validation/reload`, or the composed `data sync`. | CLI |
| `blocks-data-gateway-crud` | Reading or writing **actual records** through a Data schema from app code. `data.collection(name)` for per-item CRUD, `data.graphql()` for joins/custom shapes. | SDK |
| `blocks-data-storage` | File and document features: upload/download, directory trees, paginated browse/search, versions, rename/move/copy, trash/restore, sharing, ACLs, inheritance. | Both |
| `blocks-storage-configuration` | Choosing/rotating which **provider** backs the file tree (Azure Blob, S3-compatible, local/SFTP) — hosts, credentials, region/endpoint, strategy. Not file operations. | CLI |

### IAM

| Skill | Use when | Surface |
|---|---|---|
| `blocks-iam-account` | The signed-in user's **own** account: activation, forgot/reset/change password, logout(-all), profile bootstrap (`iam.me`/`updateMe`), signup, login-options discovery. | SDK |
| `blocks-iam-users` | Managing **other** users: invite, edit, activate/deactivate, list/search, grant/revoke roles and org access. | Both |
| `blocks-iam-access-control` | RBAC. Two facets: read-only feature-gating by the current user's roles/permissions (common, safe), and creating/editing role & permission definitions (sensitive, human-confirmed only). | Both |
| `blocks-iam-organizations` | Multi-tenant workspaces: org switcher, switching active org context (SDK-only), public signup policy, and — human-confirmed — creating/editing orgs and signup config. | Both |
| `blocks-iam-mfa` | Self-service MFA for the signed-in user (TOTP enroll/verify, OTP, method switch, disable, backup codes) plus tenant-wide MFA **policy** admin. Not admin-forcing MFA onto another user. | Both |
| `blocks-iam-sso-oidc-configuration` | **Enabling** SSO: register an OIDC client and identity provider. Portal remains a valid alternative, especially for federated providers (Google/Azure/Okta). Not `blocks login` — that's the CLI's own login. | CLI |
| `blocks-iam-sso-oidc-implementation` | Extending or debugging the hosted login flow the scaffold already ships: `redirectToProvider` → `/login/callback` → session, `AuthProvider`, `RequireAuth` guards, token refresh, redirect loops, sessions that don't stick. | SDK |

### Localization

| Skill | Use when | Surface |
|---|---|---|
| `blocks-localization-configuration` | **Authoring** translations: local i18n JSON dictionaries, validate/push/pull, languages and modules, glossary terms, AI translation suggestions. | CLI |
| `blocks-localization-implementation` | **Consuming** translations at runtime: language/module discovery, loading dictionaries, `t()` lookup, a language switcher that reloads and re-renders. | SDK |

### Messaging

| Skill | Use when | Surface |
|---|---|---|
| `blocks-mail` | Transactional email — `mail.send()`/`sendToAny()` from app code, or administering SMTP/inbound config, templates, and mailbox history. | Both |
| `blocks-notifier` | **Sending** real-time/offline notifications and managing a user's own notification inbox (notify, list, unread, mark-read). | Both |
| `blocks-notification` | **Configuring** tenant notification *channels* — a different backing service from `notifier`, and not for sending. No SDK path exists. | CLI |

### Platform operations

| Skill | Use when | Surface |
|---|---|---|
| `blocks-release-deployment` | Triggering and inspecting Release builds/deploys: `release deploy`, `release status`, `builds get/list`. Triggers a configured pipeline only — no artifact upload. | CLI |

### Local development

| Skill | Use when | Surface |
|---|---|---|
| `blocks-frontend-local-https` | Running a scaffolded app over HTTPS on its real project domain — required for hosted login, since plain HTTP and `localhost` never receive the session cookie. Covers `npm run cert`, trusting the cert, the hosts entry, and "SSO cookie not set" / Vite "Blocked request" errors. | Scaffold |

### Routing notes

- **Own account vs. other users vs. role definitions** — `blocks-iam-account` / `blocks-iam-users` / `blocks-iam-access-control`. Pick by whose record changes.
- **Configuration vs. implementation** — most areas split in two: a CLI skill that defines the thing and an SDK skill that consumes it at runtime. "Create a schema" is configuration; "fetch products" is implementation.
- **`notifier` sends, `notification` configures.** Different services.
- **`blocks-data-storage` operates on files; `blocks-storage-configuration` chooses the provider underneath.**
- Dependencies: schema work must be reloaded before CRUD sees it; SSO implementation needs a registered OIDC client and HTTPS on the real domain to test.

<!-- blocks-skills:end -->
