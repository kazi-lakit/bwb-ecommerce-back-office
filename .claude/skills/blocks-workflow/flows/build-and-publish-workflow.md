# Flow: build, test, and publish a workflow

**When to use:** the user wants a new automation (or a change to an existing one) — "when X happens, do Y", "add a step that calls our API", "publish this workflow". **Preconditions:** you have a bearer token valid for the target tenant, and the base URL of the tenant's `blocks-logic` deployment (ask the user — never guess a host).

All request/response field details referenced below live in [../references/api-endpoints.md](../references/api-endpoints.md) and [../references/node-graph-schema.md](../references/node-graph-schema.md). This flow sequences the calls; it does not restate their shapes.

## 1. Design the graph before writing JSON

Pick a trigger (`webhook`, `schedule`, `email`, or `dataGateway`) and the action/logic/transform nodes downstream, from the node type catalog (`references/node-graph-schema.md` §4). Sketch node ids, and which edges connect them — every edge needs `sourceHandle`/`targetHandle`; only the `if` node has more than one `sourceHandle` (`if-true`/`if-false`).

Before sending any JSON in steps 2–3, run it through [../references/validation-checklist.md](../references/validation-checklist.md) — `Create`/`Update` do not validate node/edge shape or parameter correctness themselves; a mistake is stored as-is and fails later, often silently.

## 2. Create the workflow

```
POST /api/Workflow/Create
{ "name": "...", "description": "...", "nodes": [...], "edges": [...], "settings": {} }
```

You can send the full graph in this one call (`Create`'s `nodes` field accepts the same shape `Update` does) or create with empty `nodes`/`edges` and populate them in a follow-up `Update`. Either works.

**Check `IsSuccess` in the response body, not just the HTTP status** — `Create` always returns `201`, even on failure (e.g., malformed tenant context). On success, `ItemId` is the new workflow's id — save it, every following call needs it.

## 3. Edit the graph

```
PUT /api/Workflow/Update
{ "itemId": "<workflowId>", "nodes": [...], "edges": [...] }
```

`nodes`/`edges` are replaced **wholesale** — there is no per-node patch endpoint. Always send the complete arrays, including nodes you aren't changing. Every `Update` call sets the workflow's `isDirty=true` regardless of what changed; `isPublished` in this DTO is accepted but silently ignored — publish state only changes via step 5.

## 4. Test before publishing

The **published** graph and the **draft** graph are executed by different endpoints (`Webhook` vs `TestWebhook`) — testing never touches what's currently live in production. Two ways to run the draft:

**A. Fire the test webhook directly**, once a trigger is listening:
```
POST /api/Workflow/TriggerListener
{ "workflowId": "<id>", "triggerId": "<trigger node id>", "enableListener": true }
```
then:
```
POST /api/Workflow/webhook-test/{tenantId}/{workflowId}/{webhookId}
   (or, fixed-tenant integration: POST /api/Workflow/webhook-test/{workflowId}/{webhookId}  with header x-blocks-key: <tenantId>)
Body: <your sample payload — a JSON object or array>
```
`webhookId` is the **trigger node's `id`**, not the workflow id. Watch the `status` field in the response — `"The requested webhook ... is not listening for test executions"` means step A's `TriggerListener` call didn't happen or targeted the wrong node.

**B. Step through one node at a time** (node-inspector style):
```
POST /api/Workflow/StepExecute
{ "workflowId": "<id>", "nodeId": "<node to test>" }
```
If that node has no trigger ancestor, it executes immediately and returns output. If it does have a trigger ancestor with no pinned data, this call instead **arms** test listening for you (`code: "101"`) — no execution happens until you separately fire the test webhook (path A) for that trigger.

After either path, inspect the run: `GET /api/Workflow/GetExecutions?WorkflowId=<id>` for the list, then `GET /api/Workflow/GetExecution?ExecutionId=<id>` for per-node detail (`nodeExecutions`, `items`). A bad/unresolvable `ExecutionId` here throws server-side rather than returning a clean error — only pass ids you got back from `GetExecutions`.

## 5. Publish

```
POST /api/Workflow/PublishNewVersion
{ "workflowId": "<id>", "name": "v1", "description": "..." }
```

This snapshots the **current draft** into a new version row and publishes it in one step — sets `isPublished=true`, `publishedVersionId=<new version id>`, and (for `schedule` triggers) creates the backing cron schedule. After this call, production `Webhook`/schedule/email/data triggers start firing against this snapshot; the draft graph can keep changing independently without affecting what's live.

To checkpoint without publishing (e.g., a save point mid-edit), use `POST /api/Workflow/CreateVersion` instead — same body shape, but it does not touch publish state.

To re-publish a specific earlier version instead of the current draft: `POST /api/Workflow/PublishVersion` with `{"workflowId": "<id>", "versionId": "<version id>"}`. **Always pass `versionId` explicitly** — omitting it republishes `lastPublishedVersionId`, and `Unpublish` does not clear that field, so an omitted `versionId` after an unpublish can silently republish a stale old version.

## 6. Verify

`GET /api/Workflow/Get?WorkflowId=<id>` — check `isPublished: true` and `publishedVersion` is populated. `POST /api/Workflow/GetVersions` with `{"workflowId": "<id>"}` — the version whose `isPublished: true` is the one currently live (this is a per-version flag, distinct from the workflow-level one).

## Gotchas specific to this flow

- `Create`, `Duplicate`, `CreateVersion`, and `PublishNewVersion` all return HTTP `201` **unconditionally** — a failed call still gets `201` with `isSuccess: false`. Always branch on `isSuccess`.
- `Restore` (`POST /api/Workflow/Restore`, body `{"workflowId","versionId"}`) overwrites the **draft** graph from an old version snapshot but never touches what's currently published — use it to revert in-progress edits, not to roll back production.
- `Unpublish` (`{"workflowId"}`) stops production triggers but does not clear `lastPublishedVersionId` — see the `PublishVersion` warning above.
