# Flow: import / export a workflow definition

**When to use:** the user wants to move a workflow between tenants/environments, hand someone a workflow definition file, back one up, or programmatically create a workflow from a JSON definition they already have. **There is no `Import`/`Export` REST endpoint** — this is a client-side-only orchestration on top of the same `Get`/`Create`/`Update` endpoints from [build-and-publish-workflow.md](./build-and-publish-workflow.md).

Source: `client/app/modules/workflow/{utils/workflow-export.ts, utils/workflow-import.ts, hooks/use-import-workflow.ts}`.

## Export format

Exactly the graph, no wrapper, no `schemaVersion`:

```json
{
  "name": "string",
  "settings": { "...": "string values only" },
  "nodes": [ { "id","name","category","type","version","position":{"x":0,"y":0},"handle"?,"parameters":{},"settings":{},"pinData":null } ],
  "edges": [ { "id","source","target","sourceHandle","targetHandle" } ]
}
```

Same node/edge shape as `references/node-graph-schema.md` §2, minus every workflow-level field (`itemId`, `tenantId`, publish/audit/execution data — none of that is ever exported or expected on import).

**To export programmatically:** `GET /api/Workflow/Get?WorkflowId=<id>`, then keep only `name`, `settings`, `nodes`, `edges` from the response — that's the whole export step, there's nothing server-side to call.

## Import: two validation stages

**1. Preflight (hard fail → nothing is created):**

| Check | Failure code |
|---|---|
| File size ≤ 5 MB | `IMPORT_TOO_LARGE` |
| Parses as JSON, root is a plain object | `IMPORT_NOT_JSON` |
| `name` is a non-empty (trimmed) string | `IMPORT_BAD_SHAPE` |
| `nodes` is an array | `IMPORT_BAD_SHAPE` |
| `edges` is an array | `IMPORT_BAD_SHAPE` |
| `settings` is a plain object | `IMPORT_BAD_SHAPE` |

**2. Remap + sanitize (non-fatal — bad items are dropped and counted, the rest still imports):**

- A node survives only if it has non-empty string `id`/`name`/`type`/`category`/`version` **and** a numeric `position.x`/`position.y`. Anything else is dropped.
- Duplicate `id`s: first occurrence wins, later ones dropped.
- **Every surviving node's `id` is discarded and regenerated** (fresh random hex — never reuse ids from the file). Every whole-token occurrence of an old id is then rewritten wherever it appears — inside that node's `parameters`, `settings`, `pinData` (each stringified, substituted, reparsed), and inside workflow-level `settings` string values — so an expression or reference embedding another node's old id gets fixed up automatically.
- Edges are dropped if `source`/`target` doesn't resolve to a surviving (remapped) node id. Surviving edges get a regenerated `id` (`xy-edge__<newSource>-<newTarget>`, de-duplicated with a numeric suffix on collision) — everything else on the edge object is preserved as-is.

Note that stages 1–2 above only run when the file goes through the browser UI. If your agent is doing this programmatically — reading a file and calling the API directly — **you must replicate this validation yourself**, and it's worth going further than the client does: also run [../references/validation-checklist.md](../references/validation-checklist.md) against the remapped `nodes`/`edges`/`settings` before the `Update` call, since the client-side checks above only catch structural issues (missing fields, dangling edges), not wrong parameter casing or invalid enum values inside a node's `parameters`.

## What actually gets called

```
POST /api/Workflow/Create
{ "name": "<file's name>" }                                    → itemId

PUT /api/Workflow/Update
{ "itemId": "<itemId>", "nodes": <remapped>, "edges": <remapped>, "settings": <remapped> }
```

Same two-call sequence as building a workflow from scratch (§2–3 of the build/publish flow) — importing is not a distinct write path, it's this same pair with a validated, id-remapped body. If `Create` fails, nothing is saved. If `Update` fails afterward, an empty workflow named after the file already exists — that's a partial-failure state to handle explicitly (report it, don't retry blindly — retrying re-runs `Create` and produces a second empty workflow).

## Gotchas

- **No name-uniqueness check anywhere in this path.** Importing the same file twice creates two separate workflows with the same name and different ids.
- **Import always produces a fresh, unpublished draft.** Publish state, versions, and execution history are never part of an export and are never restored by an import — even if the source workflow was published, the imported copy starts at `isPublished:false` with no version history.
- **Node/edge ids from the file are never preserved**, even on an exact export→import round-trip. Don't rely on ids staying stable across an export/import cycle — only the graph's structure and node content do.
