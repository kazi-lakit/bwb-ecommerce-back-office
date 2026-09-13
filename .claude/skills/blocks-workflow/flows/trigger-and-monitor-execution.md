# Flow: trigger a published workflow and monitor its execution

**When to use:** the user's application needs to fire an existing, published workflow from app code (or a webhook consumer/cron/inbound email/data-change already does), and/or check whether a run succeeded. **Precondition:** the workflow is published (see [build-and-publish-workflow.md](./build-and-publish-workflow.md)) — an unpublished workflow's production webhook responds with `status: "Workflow is not published"`, not an error.

Field details: [../references/api-endpoints.md](../references/api-endpoints.md) §5–6.

## 1. Pick the trigger path

| Situation | Call |
|---|---|
| Tenant is known from the route itself (e.g., a multi-tenant public webhook consumer) | `POST /api/Workflow/Webhook/{tenantId}/{workflowId}/{webhookId}` |
| Tenant is fixed for this integration (e.g., a single app calling its own tenant's workflow) | `POST /api/Workflow/Webhook/{workflowId}/{webhookId}` with header `x-blocks-key: <tenantId>` |

Both are **anonymous at the framework level** — no bearer token. The workflow's own trigger node (`authType`: `none`/`blocksAuthentication`/`blocksAuthorization`) decides whether the caller still needs to be authenticated; a failed check surfaces as `401 {"message":"Unauthorized"}` from either path. The header path additionally requires the `x-blocks-key` header itself, or you get `400` before the trigger even runs.

`{workflowId}` is the workflow's `itemId`. `{webhookId}` is the **trigger node's `id`** inside the graph — not the workflow id, and not arbitrary; it must match a `category:"trigger", type:"webhook"` node's `id` on the *published* snapshot.

Body is your own JSON — a single object or an array of objects — becoming the trigger's input `Context.Input`. There is no fixed schema; it's whatever your downstream nodes expect (e.g., `{{$json.foo}}` expressions in later nodes' parameters).

## 2. Read the immediate response

```json
{ "executionId": "...", "status": "...", "data": null }
```

| `status` | Meaning | Next step |
|---|---|---|
| `"Queued"` | Normal case — the run was handed to the worker asynchronously. | Poll with `executionId` (step 3). |
| present with `data` populated | The trigger node had `httpResponseMode:"last"` — the graph ran in-process and this **is** the final answer. | Nothing further needed; `data` shape depends on the trigger's `httpResponseData` (`"all"`, `"first"`, or `"none"`). |
| `"Workflow is not published"` | No published version exists yet. | Go publish it (previous flow), then retry. |
| `"Workflow not found"` | Either the workflow id is wrong, **or** the workflow exists but no trigger node with that `webhookId` was found on the published graph — the message is the same for both. | Re-check `workflowId` and that `webhookId` matches a real trigger node id. |
| `"Something went wrong"` | Internal failure loading the published snapshot. | Check execution history / logs; not self-diagnosing from this response alone. |

## 3. Poll for completion

```
GET /api/Workflow/GetExecution?ExecutionId=<executionId>
```

Check `data.status` — one of `Init`(0) `Queued`(1) `Pending`(2) `Running`(3) `Completed`(4) `Failed`(5). Re-poll while `Running`/`Pending`/`Queued`; stop at `Completed` or `Failed`. On `Failed`, `data.errorMessage` and each entry in `data.nodeExecutions[].error` name what broke and at which node.

**Only pass an `executionId` you actually received** — an id that doesn't resolve throws server-side instead of returning a clean not-found response (unlike the rest of this API). If you don't have one (e.g., a fire-and-forget integration that discarded the trigger response), list recent runs instead:

```
GET /api/Workflow/GetExecutions?WorkflowId=<workflowId>
```

This returns the workflow's execution history (no pagination — it returns what it has), each with `status`, `startedAt`, `finishedAt`, `errorMessage`. Match by timestamp/recency to find the run you just triggered.

## 4. Use `LastSuccessfullExecution` for sample data, not for polling

```
GET /api/Workflow/LastSuccessfullExecution?WorkflowId=<workflowId>
```

Note the double-`l` spelling — it's exact, not a typo to "fix" in the URL. This returns the most recent **completed** run, primarily useful for prefilling a new node's test inputs from real prior data while editing the graph. Unlike `GetExecution`, a not-found case here returns cleanly (`isSuccess:false`, `errors:{"Message":"No Execution"}`) rather than throwing.

## Gotchas specific to this flow

- Testing a **draft** graph (before publish) uses the parallel `webhook-test` path, not `Webhook` — see the previous flow's step 4. Don't point production callers at `webhook-test`; it silently no-ops unless the editor has armed test listening for that trigger.
- `data.duration` on an execution is never populated by this API (always null/default) — compute elapsed time yourself from `startedAt`/`finishedAt` if needed.
- `httpResponseMode:"last"` on the trigger node makes the webhook call **synchronous** (it blocks until the graph finishes) — only use it for short-running graphs; everything else should stay `"immediate"` and poll.
