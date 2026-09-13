---
name: blocks-workflow
description: "Author, publish, trigger, monitor, and import/export SELISE Blocks 'Workflow' automations (the visual node/edge workflow builder implemented in blocks-logic) by calling its REST API directly at /api/Workflow/* — there is no `blocks` CLI command or `@seliseblocks/client` SDK namespace for this feature yet, so raw HTTP is the deliberate, correct surface here (unlike every other blocks-* skill, which forbids raw HTTP in favor of CLI/SDK). Use for: 'create/build a workflow', 'add a node to this workflow', 'wire a webhook/schedule/email/data trigger', 'publish this workflow', 'call this workflow from my app', 'why did this workflow execution fail', 'what node types are available', 'import/export a workflow definition file'. This is a project-local skill grounded in blocks-logic's source (server/Api/Controllers/WorkflowController.cs, Workflow.DomainService/**, the React client's workflow module) — not part of the public blocks-skills/blocks-cli distribution, and not live-verified against a running instance; treat flagged unverified details as such and confirm against a real deployment when it matters. Does not cover: data schemas/CRUD (blocks-data-gateway-*), notifications (blocks-notifier/blocks-notification), mail server config (blocks-mail) — a workflow's sendMail/dataAction nodes call into those, but configuring those services themselves is out of scope here."
---

# Blocks Workflow — automation graphs via the raw REST API

## Surface

**Raw HTTP against `/api/Workflow/*`** on the tenant's `blocks-logic` deployment. This is the one deliberate exception among blocks-* skills: the feature has no CLI or SDK wrapper today, so there is no supported surface to defer to. Ask the user for (or read from their app's existing config) the base URL of their `blocks-logic` API — never guess a host, gateway path, or port.

**Auth:** every management/testing/execution endpoint requires `Authorization: Bearer <jwt>` for a token issued to the target tenant — tenant is always resolved server-side from the token's claims, never from a field you send. Obtaining that token is out of scope for this skill (it's whatever your app already uses to call other Blocks services — see `blocks-iam-sso-oidc-implementation` if the app doesn't have a login flow yet). The four production/test **webhook** trigger endpoints are the exception: they're anonymous at the framework level, and instead take tenant either from the URL path or an `x-blocks-key` header (see `references/api-endpoints.md` §1 and the trigger flow below).

## Key concepts

- **A workflow** is a graph of **nodes** (typed steps: triggers, actions, logic, transforms) and **edges** (directed connections between them), plus a name/description/settings. Stored as a mutable **draft**; `Update` replaces the whole node/edge arrays, there's no per-node patch.
- **Versions** are immutable snapshots of the draft graph (`CreateVersion`/`PublishNewVersion`). **Publishing** marks one version as the one production triggers execute — the draft can keep changing after that without affecting what's live.
- **Triggers** (`category:"trigger"`) start a run: `webhook` (HTTP call), `schedule` (cron), `email` (inbound mail match), `dataGateway` (collection change). A run is a `WorkflowExecutionEntity`; **executions** are queryable history with per-node detail.
- **Testing** runs the current **draft** graph via a parallel `webhook-test` path, gated by an explicit "listening" flag (`TriggerListener`/`StepExecute`) — production and test are fully separate execution paths, never mixed.

## Routing

| Job | Go to |
|---|---|
| Design a graph: what node types exist, exact `parameters` shape per type, how edges/branching work | [references/node-graph-schema.md](references/node-graph-schema.md) |
| Exact request/response fields for every endpoint, enums, error shapes | [references/api-endpoints.md](references/api-endpoints.md) |
| Step-by-step: create → edit → test → publish a workflow | [flows/build-and-publish-workflow.md](flows/build-and-publish-workflow.md) |
| Step-by-step: fire a published workflow from app code and check the result | [flows/trigger-and-monitor-execution.md](flows/trigger-and-monitor-execution.md) |
| Import/export a workflow definition file (there is no dedicated endpoint — it's `Get`/`Create`/`Update` plus client-side id-remapping) | [flows/import-export-workflow.md](flows/import-export-workflow.md) |
| **Before every `Create`/`Update` call, and before trusting any import/hand-authored JSON** — the structural + data checklist | [references/validation-checklist.md](references/validation-checklist.md) |

Start at the graph reference before writing any JSON by hand — node `parameters` casing is inconsistent across node types (mostly camelCase, but `sendMail`/`agent` nodes are PascalCase) and guessing it wrong fails silently rather than erroring. **Then run `references/validation-checklist.md` against the JSON before sending it** — `Create`/`Update` accept a malformed graph without complaint and it fails later, often silently.

## Hard rules

- **Never invent a base URL, tenant id, or bearer token.** Ask the user, or read it from their app's existing Blocks client config.
- **Check `isSuccess` in the response body, not just the HTTP status.** `Create`, `Duplicate`, `CreateVersion`, and `PublishNewVersion` all return `201` unconditionally, even on business-rule failure.
- **`nodes`/`edges` are replaced wholesale on `Update`** — always send the complete arrays, never a partial patch.
- **`{webhookId}` in a webhook URL is the trigger *node's* id, not the workflow id.**
- **Only poll `GetExecution` with an `executionId` you actually received** — an unresolvable id throws server-side instead of a clean error.
- **Test (`webhook-test`) and production (`webhook`) are separate graphs and separate URLs** (draft vs. published snapshot) — don't point a real integration at the test path, and don't expect `webhook-test` to work without first arming test listening.
- **Every node/edge you send must pass `references/validation-checklist.md` first.** The API does not validate node/edge shape or parameter correctness for you — a bad node type, a dangling edge, or a mistyped parameter key is stored as-is and fails later (often silently: a trigger that never fires, a field that's silently absent) rather than rejected up front. This applies equally to a graph you build by hand and one you're about to import.
- **Trigger-node `parameters` keys are case-sensitive in practice, not just convention** — `authType`, `httpResponseMode`, `httpResponseData`, `mailServerConfigurationId`, `testSubject`, `collectionName`, `operation`, `cronExpression` are read via exact-key `BsonDocument` lookups server-side. Wrong casing means the field reads as silently missing, not an error.

## Known source quirks worth knowing about (not bugs to "fix" when calling the API — just behavior to expect)

- `PublishNewVersion` sets `lastPublishedVersionId` equal to the version it just published (a source-level ordering bug against its own intent) — don't rely on `lastPublishedVersionId` reflecting the *previous* version after calling it; always pass `versionId` explicitly to `PublishVersion` rather than relying on that fallback.
- `Unpublish` does not clear `lastPublishedVersionId` — an omitted `versionId` on a later `PublishVersion` call can republish a stale old version.
- `GetExecution` throws on an unresolvable `executionId` instead of returning `isSuccess:false` like every other query endpoint; `LastSuccessfullExecution` handles the not-found case gracefully.
- The action is spelled `LastSuccessfullExecution` (double "l") — use that exact spelling in the URL.
- `WorkflowExecutionDto.duration` is never populated; compute elapsed time from `startedAt`/`finishedAt` yourself.
