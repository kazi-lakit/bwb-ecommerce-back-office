# Workflow Node/Edge Graph Schema

Reference for hand-constructing the JSON `nodes`/`edges` graph used by the Blocks "Workflow"
automation-builder feature, for calling the raw `Workflow` HTTP API directly (no CLI/SDK wrapper
exists for this — build the JSON by hand per this doc).

Source of truth for everything below: `blocks-logic` repo —
`server/Workflow.DomainService/Entities/{NodeEntity,EdgeEntity}.cs`,
`server/Workflow.DomainService/Services/{WorkflowEngineService,WorkflowService,WorkflowExecutionService}.cs`,
`server/Workflow.DomainService/Nodes/**` (per-node executors + `*Parameters.cs`),
`server/Worker/Consumers/Workflow/*.cs`,
`server/Api/Controllers/WorkflowController.cs`, and the React client's
`client/app/modules/workflow/{models,utils,hooks,services,components/node-schemas}/**`.

---

## 1. Wire casing

**Use camelCase for every field name in the envelope** (`nodes[].id/name/category/type/version`,
`position.x/y`, `handle`, `parameters`, `settings`, `pinData`; `edges[].id/source/target/sourceHandle/targetHandle`;
top-level `name`/`settings`/`nodes`/`edges`/`itemId`).

Evidence:
- The React client's TypeScript contracts that are actually sent/received over the wire —
  `models/workflow.model.ts` (`WorkflowEdge { id, source, target, sourceHandle, targetHandle }`),
  `utils/workflow-export.ts` (`WorkflowExportNode { id, name, category, type, version, position:{x,y}, handle, parameters, settings, pinData }`),
  and `hooks/use-workflow-api.ts` / `services/workflow.service.ts` (payload objects passed straight
  to `LogicHttpClient.post/put` with **no** case-translation layer) — are all camelCase.
- `server/Api/Controllers/WorkflowController.cs` binds request bodies to plain C# DTOs
  (`WorkflowCreateRequestDto`, `WorkflowUpdateRequestDto`) with PascalCase property names and no
  `[JsonPropertyName]` overrides. ASP.NET Core's default `System.Text.Json` MVC integration applies
  `JsonNamingPolicy.CamelCase` to controller (de)serialization unless overridden, and model binding
  is case-insensitive on the way in regardless. The exact global `AddControllers()`/`AddJsonOptions`
  call was **not found in this repo** — it lives inside an external shared bootstrap helper
  (`ApplicationConfigurations.ConfigureApi(...)` in `server/Api/Program.cs`, from a `Blocks.*` NuGet
  package not vendored here) — so this half of the evidence is indirect, not a quoted config.
- `server/Workflow.DomainService/Services/WorkflowNotificationService.cs` explicitly sets
  `PropertyNamingPolicy = JsonNamingPolicy.CamelCase` for the related workflow real-time event
  payloads (a directly-confirmed camelCase config, just not for this exact controller).

**Caveat that matters more in practice — inside `parameters`/`settings`, casing is per-node-type and
not uniformly camelCase.** `node.Parameters`/`node.Settings` are opaque `BsonDocument`/`JsonElement`
blobs; naming-policy conventions do not touch dictionary/BSON keys, only POCO property
serialization. The backend's `NodeExecutorBase<TParameters>.RunAsync` reads them via
`Newtonsoft.Json.JsonConvert.DeserializeObject<TParameters>(context.Parameters.ToJson())`, and
Newtonsoft matches property names **case-insensitively** by default — so whatever key casing you
send, it binds as long as the letters match. Empirically, most node types' real front-end forms
(`components/node-schemas/*.ts`) use camelCase keys (`httpMethod`, `url`, `conditionType`,
`triggerInterval`, `cronExpression`, `mailServerConfigurationId`, `collectionName`, `operation`,
`proxyId`, `routeMethod`, `pathParams`, `rawQueryMode`, `actionType`, `filter`, `fieldMapping`,
`getFields`, `mode`, `script`), **but `sendMail` and `agent` nodes use PascalCase** (`EmailTemplate`,
`Template`, `Language`, `To`, `BodyDataContext`, `Attachments`, `AgentId`, `WidgetId`, `ApiBaseUrl`),
matching their C# `*Parameters` class property names verbatim. **Do not assume camelCase inside
`parameters` — copy the exact key casing from the per-type table in §4.**

---

## 2. Graph shape

A workflow (`WorkflowResponseDto` on GET, `WorkflowCreateRequestDto`/`WorkflowUpdateRequestDto` on
write) carries, among audit/publish fields not relevant to hand-authoring:

```jsonc
{
  "name": "string, required",
  "description": "string, optional",
  "settings": { "...": "string values only — Dictionary<string,string> on the wire" },
  "nodes": [ /* Node, see below */ ],
  "edges": [ /* Edge, see below */ ]
}
```

Endpoints (base path `/api/Workflow/...`, from `client/app/modules/workflow/constants/endpoint.constant.ts`):
- `POST /api/Workflow/Create` — body: `{ name, description?, nodes, edges, settings }`. `nodes` is
  accepted as a raw JSON array (deserialized server-side with Newtonsoft, case-insensitive) — full
  node objects, not partial patches.
- `PUT /api/Workflow/Update` — body: `{ itemId (required), name?, nodes?, edges?, settings?, isPublished? }`.
  Sending `nodes`/`edges` **replaces** the whole array; there is no per-node patch.
- `GET /api/Workflow/Get?WorkflowId=<id>` — returns the full graph.
- `POST /api/Workflow/GetAll`, `DELETE /api/Workflow/Delete?id=<id>`, plus version/publish/execution
  endpoints not covered by this doc.

### Node

From `server/Workflow.DomainService/Entities/NodeEntity.cs` (C#) and the front-end's
`WorkflowExportNode`/`WorkflowNode` types, merged:

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | string | required | Unique within the workflow. Client-generated (front end uses a 32-char hex, no dashes — `uuidv4().replace(/-/g,"")`). Referenced by `edges[].source`/`target`. |
| `name` | string | required | Display name. Must be unique among nodes in the editor (UI-enforced, not backend-enforced). |
| `category` | string | required | One of `trigger`, `action`, `logic`, `transform` (confirmed values — see §3). Drives special-cased engine behavior for `"trigger"`. |
| `type` | string | required | Concrete node type string, e.g. `"webhook"`, `"httpRequest"`, `"if"` (see §4 for the full catalog). Selects the `INodeExecutor` via `_nodeExecutors.First(ne => ne.NodeType == node.Type)` — an unknown type throws at execution time. |
| `version` | string | required | e.g. `"v1"`. Every currently-shipped node type is `"v1"`. |
| `position` | `{ "x": number, "y": number }` | required | Canvas coordinates. Purely cosmetic — not read by the execution engine. |
| `handle` | `{ "sources": string[], "targets": string[] }` | optional, defaults to `{sources:[],targets:[]}` | **Not read anywhere in the execution engine** (`WorkflowEngineService`) or `WorkflowService` — grep-confirmed. The engine derives branching entirely from `edges[].sourceHandle`/`targetHandle` (§5). The front end's real per-type handle IDs (which output/input ports a node has) come from the static `NodeDefinitions` catalog (`handleSpec.source`/`handleSpec.target` in `node-definitions.tsx`), not from this field. Treat `handle` as optional, opaque, round-tripped-verbatim metadata; safe to omit. |
| `parameters` | object | required (send `{}` if none) | Arbitrary JSON object, node-type-specific. See §4 for the confirmed shape per `type`. Stored as MongoDB `BsonDocument` server-side; passed through case-insensitively. |
| `settings` | object | required (send `{}` if none) | Arbitrary JSON object. Only confirmed real key seen in use: `continueOnError: boolean` (set by `transform/code` and `transform/setfield` node schemas — not read by any executor code path found in this pass, so its runtime effect is unconfirmed). |
| `pinData` | array or `null` | optional | When present and non-empty, `WorkflowEngineService.ExecuteStepNodeAsync` skips real execution for that node and synthesizes output items directly from these values (used by "Execute Step" / test-pinning in the editor). Each entry is a raw BSON/JSON value representing one pinned output item. Omit or set `null` for normal nodes. |

Minimal required node (no pinData/handle):

```json
{
  "id": "8d75404dc42646619b91a7d85278687b",
  "name": "Webhook",
  "category": "trigger",
  "type": "webhook",
  "version": "v1",
  "position": { "x": 0, "y": 0 },
  "parameters": {},
  "settings": {}
}
```

### Edge

From `server/Workflow.DomainService/Entities/EdgeEntity.cs`:

| Field | Type | Required? | Notes |
|---|---|---|---|
| `id` | string | required | Unique within the workflow. Front-end convention: `xy-edge__<sourceId>-<targetId>` (from `workflow-import.ts`'s `remapAndSanitiseWorkflow`), but any unique string works — the engine never parses it. |
| `source` | string | required | Node `id` this edge starts from. |
| `target` | string | required | Node `id` this edge ends at. |
| `sourceHandle` | string | required | Which output port of `source` this edge is wired from. `"source"` for every node type with a single output; `"if-true"` / `"if-false"` for the `if` node (§5). Drives branch routing — see §5. |
| `targetHandle` | string | required | Which input port of `target` this edge feeds. Every current node type has exactly one input port, always `"target"`. |

Footnote: the C# class is literally named `EdgeEnity` (typo, missing the `t`) in
`EdgeEntity.cs` — this is a C#-source-only quirk. It has exactly the 5 fields above with normal
spelling, so it round-trips as an ordinary `{id, source, target, sourceHandle, targetHandle}` object
over HTTP; the typo never appears in JSON.

```json
{
  "id": "xy-edge__8d75404dc42646619b91a7d85278687b-bcc3fabc",
  "source": "8d75404dc42646619b91a7d85278687b",
  "target": "bcc3fabc",
  "sourceHandle": "source",
  "targetHandle": "target"
}
```

---

## 3. Node categories & trigger semantics

Confirmed `category` values (grep-confirmed literal comparisons in `WorkflowService.cs`,
`WorkflowEngineService.cs`, `WorkflowExecutionService.cs`, and the front-end `NodeCategory` union in
`models/node.model.ts`):

| Category | Meaning |
|---|---|
| `trigger` | Starts a workflow run. See below for engine treatment. |
| `action` | Does work (HTTP call, send mail, AI agent call, data CRUD, proxy call). |
| `logic` | Branches the flow (`if`). |
| `transform` | Reshapes data in-flight (`setfield`, `code`). |

What makes `category == "trigger"` special in the engine (`WorkflowEngineService.ResolveInputItemsAsync`):

```csharp
if (node.Category == "trigger") return new(); // no input items resolved — trigger has no upstream data
```

A trigger node never reads from incoming edges for its input (in fact it normally *has* none — it's
a graph root). Instead, a trigger fires by an **external event creating a new
`WorkflowExecutionEntity`** with `ActiveNodeIds = [triggerNodeId]` and `Context["Input"]` seeded from
the event payload — not by another node's edge output. The four ways this happens
(`server/Worker/Consumers/Workflow/*.cs`, all just delegate into `WorkflowExecutionService`):

| Consumer | Event | Matches trigger node by |
|---|---|---|
| `AddExcuationNodeConsumer.cs` | `AddExcuationNodeEvent` | N/A — this is the generic "run one node, then its downstream" queue message every node (trigger or not) is executed through once a run has started. |
| `EmailTriggerConsumer.cs` | `EmailTriggerEvent` | `n.Type == "email" && n.Category == "trigger" && n.Parameters["mailServerConfigurationId"] == event mailbox id` |
| `DataTriggerConsumer.cs` | `DataChangeEvent` | `n.Type == "dataGateway" && n.Category == "trigger" && n.Parameters["collectionName"] == event collection && n.Parameters["operation"] == event operation` |
| `SchedulerTriggerConsumer.cs` | `PublishScheduleCommand` (deserialized `SchedulerTriggerPayload`, case-insensitive) | `n.Id == payload.TriggerId && n.Type == "schedule" && n.Category == "trigger"` |

(Webhook triggers don't go through a consumer at all — `WorkflowExecutionService.TriggerWebhookAsync`
/`TriggerTestWebhookAsync` are called directly by the controller's webhook HTTP endpoints,
`/Workflow/webhook/{workflowId}/{nodeId}` and `/Workflow/webhook-test/{workflowId}/{nodeId}`.)

Other trigger-specific engine mechanics:
- `IsReadyToExecuteNode`: a node with **zero incoming edges is always ready** (this is what lets a
  trigger — or any root node — run immediately). A node with incoming edges only runs once every
  edge's source node has a `Completed` `NodeExecution`.
- **Ancestors** (`ResolveAncestorNodeOutputsAsync` / `GetTopologicalAncestorsAndTarget`): the set of
  all nodes transitively reachable by walking `edges[].target == X` back to `edges[].source`,
  repeated until no more parents are found (BFS/DFS over reversed edges, cycle-safe via a visited
  set). Used for (a) building the `AncestorNodeOutputs` map so downstream node expressions
  (`{{$node["NodeName"].json...}}`) can reach any upstream node's output by name, not just the
  direct parent, and (b) `ExecuteStepNodeAsync`'s "Execute Step" feature, which topologically
  replays every ancestor of a target node (in-degree-0-first order) before running the target
  itself.
- Publishing (`WorkflowService.PublishNewVersionAsync`/`PublishVersionAsync`) snapshots trigger
  nodes (`CloneTriggerNodes`: `n.Category == "trigger"`) into `PublishedMeta.TriggerNodes`, and for
  `type == "schedule"` trigger nodes specifically (`GetSchedulerNodes`: `Category=="trigger" &&
  Type=="schedule"`) creates a backing cron schedule, writing the created id back into that node's
  `parameters.scheduleItemId`.

---

## 4. Node type catalog

Every row is a real, evidence-backed `(category, type, version)` combination: confirmed present in
both the front-end catalog (`components/node-library-panel/node-definitions.tsx`) **and** a matching
backend `INodeExecutor` (`NodeType` string) under `server/Workflow.DomainService/Nodes/**`.

| category | type | version | What it does | Confirmed `parameters` fields |
|---|---|---|---|---|
| `trigger` | `webhook` | `v1` | Starts a run when its HTTP endpoint is called. | `path` (string — the front end sets this to the node's own `id` on save; used to build the invocation URL `/Workflow/webhook/{workflowId}/{nodeId}` or `.../webhook-test/...`), `httpMethod` (string, e.g. `"POST"`; UI has it locked to POST today), `authType` (`"none"` \| `"blocksAuthentication"` \| `"blocksAuthorization"`), `organizationId` (string), `authorizationMode` (`"RolesOnly"` \| `"PermissionsOnly"` \| `"RolesAndPermissions"`, required/normalized to `"RolesOnly"` when authType is `blocksAuthorization`), `roles` / `permissions` (`{ "mode"|"operator": "all"|"any", "values"|"items": string[] }` — backend accepts both `mode`/`values` and legacy `operator`/`items` key pairs, see `ParseRule` in `WorkflowExecutionService.cs`), `httpResponseMode` (`"immediate"` \| `"last"`), `httpResponseData` (`"all"` \| `"first"` \| `"none"`, only used when `httpResponseMode:"last"`). Backend struct (`TriggerWebhookV1Parameters`): also has `ExecutionMode`, `HttpResponseMode`/`HttpResponseData` — case-insensitive-bound so the FE's camelCase works. |
| `trigger` | `email` | `v1` | Starts a run when a configured inbound mailbox receives an email whose subject matches (or when published, on any inbound mail for that mailbox). | `mailServerConfigurationId` (string, mailbox id), `testSubject` (string, optional — exact case-insensitive subject match routes to a Test-mode run against the current draft instead of the published version). |
| `trigger` | `dataGateway` | `v1` | Starts a run when a document in a monitored collection is Inserted/Updated/Deleted. | `collectionName` (string), `schemaName` (string, display only), `operation` (`"Inserted"` \| `"Updated"` \| `"Deleted"`, exact match required). |
| `trigger` | `schedule` | `v1` | Starts a run on a cron schedule (backed by the scheduler service once published). | `triggerInterval` (`"minutes"`\|`"hours"`\|`"days"`\|`"weeks"`\|`"months"`\|`"custom"` — UI-only convenience, not read by the executor), `cronExpression` (string — **the only field the executor/scheduler actually consumes**; 5-field, minute-based, Hangfire-compatible, e.g. `"*/10 * * * *"`). Backend `TriggerScheduleV1Parameters` also declares `SecondsBetweenTriggers`/`MinutesBetweenTriggers`/`HoursBetweenTriggers`/`MonthsBetweenTriggers`/`TriggerAtHour`/`TriggerAtMinute`/`TriggerAtDayOfMonth`/`TriggerAtWeekdays`, but the FE only persists `triggerInterval`+`cronExpression` (the rest are transient UI derivations) — send just those two. |
| `action` | `agent` | `v1` | Calls an AI agent and returns its response. | `agent` (string composite value from the UI picker, not read by executor), `AgentId` (string, **PascalCase**), `WidgetId` (string, **PascalCase**), `input` (string, the message/prompt — lowercase, note the mismatch with the PascalCase siblings), `ApiBaseUrl` (string, **PascalCase**, injected by the FE from build config — not something you'd normally set by hand, but must be a valid base URL for the agents API). |
| `action` | `sendMail` | `v1` | Sends an email via a template. | `EmailTemplate` (string, **PascalCase**, composite `"<templateName>_<tenantId>"`), `Template` (string, **PascalCase**, the plain template name), `Language` (string, **PascalCase**, e.g. `"en-US"`), `To` (string, **PascalCase**, recipient email, supports `{{expression}}`), `BodyDataContext` (object, **PascalCase**, template-variable-name → value/expression map), `Attachments` (array of strings, **PascalCase**, each a literal Storage File ID or an expression like `{{$json.fileId}}`). |
| `action` | `httpRequest` | `v1` | Makes an outbound HTTP call. | `httpMethod` (`"GET"`\|`"POST"`\|`"PUT"`\|`"PATCH"`\|`"DELETE"`), `url` (string), `haveQueryParameters` (bool), `queryParameters` (object, string→string), `haveHeaders` (bool), `headers` (object, string→string), `authenticationType` (`""`\|`"blocksAuthentication"`\|`"clientCredential"`), `clientId`/`clientSecret` (strings, only when `authenticationType:"clientCredential"`), `haveBody` (bool), `bodyContentType` (`"json"` — only option today), `body` (string, raw JSON, supports expressions). Backend also recognizes a legacy `useBlocksAuthorization: bool` (treated as `authenticationType:"blocksAuthentication"` when `authenticationType` is empty). |
| `action` | `proxy` | `v1` | Calls a pre-configured Proxy route (upstream URL/credentials stay server-side in the Proxy config). | `proxyId` (string), `slug` (string, proxy slug), `routeMethod` (string, upper-case HTTP method of the selected route), `routePath` (string, route template with no leading slash, `""` = base path, e.g. `"orders/{id}/refunds"`), `pathParams` (object, string→string, one entry per `{name}` segment in `routePath`), `haveQuery` (bool), `queryParams` (object, string→string), `haveBody` (bool, FE key is lowercase `havebody`), `body` (string, raw JSON). |
| `action` | `dataAction` | `v1` | CRUD against a data collection via the UDS GraphQL gateway. | `rawQueryMode` (bool — when true, `rawQuery` (string, raw GraphQL) is used and the guided fields below are ignored), `collectionName` (string), `schemaName` (string), `projectShortKey` (string, tenant slug), `authenticationType` (`""`\|`"clientCredential"`\|`"blocksAuthentication"`), `clientId`/`clientSecret` (strings), `actionType` (`"getData"`\|`"insertData"`\|`"updateData"`\|`"deleteData"`), `filter` (object, string→string; not used for `insertData`), `fieldMapping` (object, string→string; field name → value/expression, for insert/update), `getFields` (array of strings; for `getData`), `apiBaseUrl` (string, injected by FE build config), `schemaFields` (array of `{Description, IsArray, Name, Type, Fields?}` schema metadata, auto-populated, informational). |
| `logic` | `if` | `v1` | Branches execution: evaluates `conditions` per input item and routes each item down the `if-true` or `if-false` output. **This is the only branching node type found.** | `conditionType` (`"all"`\|`"or"` — logical AND vs OR across `conditions`; front end also uses `"and"` as a value seen in the C# default — treat `"all"`/`"and"` and `"or"` as the two effective modes, matched case-insensitively and only `"or"` is special-cased, everything else behaves as AND), `conditions` (array of `{ "left": string (expression or literal), "operator": string (`"equals"`\|`"not_equals"`\|`"contains"`\|`"not_contains"`\|`"greater_than"`\|`"less_than"`\|`"greater_or_equal"`\|`"less_or_equal"`\|`"is_true"`\|`"is_false"`, subset valid per `type`), "right": string, "type": string (`"string"`\|`"number"`\|`"boolean"`\|`"date_time"`\|`"array"`) }`). |
| `transform` | `setfield` | `v1` | Adds/overwrites fields on each item, either via manual key/value mappings or a JSON template. | `mode` (`"manual_mapping"`\|`"json"`), `manualMappingFields` (array of `{ "key": string, "value": string, "type": string }`), `jsonCode` (string, raw JSON template, used when `mode:"json"`), `includeOtherFields` (bool), `otherFieldsMode` (`"all"`\|`"include"`\|`"exclude"`), `includedFields` (string, comma-separated, used when `otherFieldsMode:"include"`), `excludeFields` (string, comma-separated, used when `otherFieldsMode:"exclude"`). `settings.continueOnError` (bool) also exposed for this type. |
| `transform` | `code` | `v1` | Runs a custom script to transform items. | `mode` (`"all"` run once for all items, or `"each"` run once per item), `language` (`"js"` — `"py"` exists in the UI but is disabled/unimplemented), `script` (string, source code). `settings.continueOnError` (bool) also exposed for this type. |

**Unconfirmed / declared-but-not-implemented types**: the front end's `NodeType` TS union
(`models/node.model.ts`) additionally lists `"webhookResponse"`, `"manual"`, and `"event"`. None of
these have a matching entry in `NodeDefinitions` (the node picker never offers them) and none have a
matching `INodeExecutor`/`Nodes/*` folder in the backend as of this pass — treat them as reserved/future
and do not use them; a workflow containing one would fail at execution with "no executor found".

---

## 5. Edges & handles

Execution-time branch/order logic (`WorkflowEngineService.cs`), precisely:

- Every node output item carries a `Branch` string. For most node types this is always `"source"`
  (see e.g. `TransformSetFieldV1Node`/`ActionHttpRequestV1Node`/etc. — not shown here, but every
  non-`if` executor either omits `Branch` or sets it to the implicit default). The **`if`** node is
  the one confirmed exception: it sets `Branch = "if-true"` or `Branch = "if-false"` per item
  (`LogicIfV1Node.ExecuteAsync`), based on evaluating `conditions` against that item.
- `ResolveEdgeBranch(sourceHandle)` = `sourceHandle` verbatim, or `"source"` if null/blank.
- When resolving a downstream node's input items, the engine fetches, per incoming edge, only the
  upstream node's output items whose `Branch` equals that edge's `ResolveEdgeBranch(SourceHandle)`
  (`ResolveInputItemsAsync`: `{"NodeId": e.Source, "Branch": ResolveEdgeBranch(e.SourceHandle)}`,
  passed to `GetItemsByNodeIdsAsync`). **This is the entire branching mechanism**: `sourceHandle` on
  the edge is not just cosmetic, it is the filter that decides which branch's items flow through
  that specific edge.
- Node readiness (`IsReadyToExecuteNode`) and "next nodes to run"
  (`nextNodeIds = edges.Where(e => e.Source == node.Id).Select(e => e.Target)`) are **not**
  branch-filtered — every edge out of a node fires (its target is queued) once the source node
  completes, regardless of `sourceHandle`. Only the *item-level data* that arrives is
  branch-filtered per above. Practically: for an `if` node with an `if-true` edge and an `if-false`
  edge, both downstream nodes get scheduled every time the `if` node runs, but each only receives
  the input items matching its edge's branch (so a downstream node fed only by the `if-false` edge
  simply gets zero input items on a run where every item evaluated true — it will run with an empty
  item set, not be skipped).

**Wiring an `if` node's two outputs** — the only branching node type found in this codebase:

```json
{
  "nodes": [
    { "id": "n-if", "name": "If", "category": "logic", "type": "if", "version": "v1",
      "position": {"x": 300, "y": 0},
      "parameters": {
        "conditionType": "all",
        "conditions": [
          { "left": "{{$json.status}}", "operator": "equals", "right": "approved", "type": "string" }
        ]
      },
      "settings": {} },
    { "id": "n-true",  "name": "On Approved", "category": "action", "type": "httpRequest", "version": "v1",
      "position": {"x": 600, "y": -80}, "parameters": {"httpMethod": "GET", "url": "https://example.com/approved"}, "settings": {} },
    { "id": "n-false", "name": "On Rejected",  "category": "action", "type": "httpRequest", "version": "v1",
      "position": {"x": 600, "y": 80}, "parameters": {"httpMethod": "GET", "url": "https://example.com/rejected"}, "settings": {} }
  ],
  "edges": [
    { "id": "e-if-true",  "source": "n-if", "target": "n-true",  "sourceHandle": "if-true",  "targetHandle": "target" },
    { "id": "e-if-false", "source": "n-if", "target": "n-false", "sourceHandle": "if-false", "targetHandle": "target" }
  ]
}
```

No other node type in this codebase pass exposes more than one source handle (every non-`if`
`NodeDefinitions` entry declares `handleSpec.source: ["source"]`), so `sourceHandle: "source"` /
`targetHandle: "target"` is correct for every edge except one touching an `if` node's outputs.

---

## 6. Complete worked example

A minimal, valid, fully-grounded graph: a webhook trigger feeding one HTTP Request action. Every
field/value below is taken from confirmed sources (§2 shapes, §4 catalog, §1 casing).

```json
{
  "name": "Notify on webhook",
  "description": "",
  "settings": {},
  "nodes": [
    {
      "id": "8d75404dc42646619b91a7d85278687b",
      "name": "Webhook",
      "category": "trigger",
      "type": "webhook",
      "version": "v1",
      "position": { "x": 0, "y": 0 },
      "parameters": {
        "path": "8d75404dc42646619b91a7d85278687b",
        "httpMethod": "POST",
        "authType": "none",
        "httpResponseMode": "immediate",
        "httpResponseData": "all"
      },
      "settings": {},
      "pinData": null
    },
    {
      "id": "bcc3fabc00000000000000000000000",
      "name": "HTTP Request",
      "category": "action",
      "type": "httpRequest",
      "version": "v1",
      "position": { "x": 320, "y": 0 },
      "parameters": {
        "httpMethod": "POST",
        "url": "https://example.com/notify",
        "haveQueryParameters": false,
        "queryParameters": {},
        "haveHeaders": true,
        "headers": { "Content-Type": "application/json" },
        "authenticationType": "",
        "haveBody": true,
        "bodyContentType": "json",
        "body": "{\"message\": \"{{$json.output}}\"}"
      },
      "settings": {},
      "pinData": null
    }
  ],
  "edges": [
    {
      "id": "xy-edge__8d75404dc42646619b91a7d85278687b-bcc3fabc00000000000000000000000",
      "source": "8d75404dc42646619b91a7d85278687b",
      "target": "bcc3fabc00000000000000000000000",
      "sourceHandle": "source",
      "targetHandle": "target"
    }
  ]
}
```

To create this via the API: `POST /api/Workflow/Create` with this object as the body (adjust —
`Create`'s DTO also wants top-level `name`; `description`/`settings` optional). To later modify it:
`PUT /api/Workflow/Update` with `{"itemId": "<the created workflow's id>", "nodes": [...], "edges": [...]}`
(nodes/edges are replaced wholesale, not patched). Note the workflow must be **published**
(`POST /api/Workflow/publishNewVersion` or `.../publishVersion`) before its webhook/schedule/email/data
triggers fire in production; an unpublished workflow's webhook only responds via the
`/Workflow/webhook-test/{workflowId}/{nodeId}` test path, and only while the editor has that trigger
"listening" (`POST /api/Workflow/TriggerListener`).
