# Workflow REST API Reference

Source: `server/Api/Controllers/WorkflowController.cs` (namespace `Utilities.Api.Controllers`, class `WorkflowController`), `server/Workflow.DomainService/Dtos/*.cs`, `server/Workflow.DomainService/Entities/*.cs`, `server/Workflow.DomainService/Enums/*.cs`, `server/Workflow.DomainService/Services/*.cs` in `blocks-logic`.

## 1. Basics

- Base route: `[Route("[controller]/[action]")]` on `WorkflowController` → controller segment resolves to `Workflow`, action segment is the C# action name (or its `[ActionName(...)]` override). `GlobalApiRoutePrefixConvention` (`server/Api/GlobalApiRoutePrefixConvention.cs`, registered as `new GlobalApiRoutePrefixConvention("api")` in `server/Api/Program.cs`) prepends `api/` to every controller route. So a plain action is `POST|GET|PUT|DELETE /api/Workflow/{ActionName}`, e.g. `POST /api/Workflow/GetAll`, `GET /api/Workflow/Get`. The four webhook entry points have their own `[HttpPost("...")]` route templates appended after `[action]`, e.g. `POST /api/Workflow/Webhook/{tenantId}/{workflowId}/{webhookId}` (full path derivations are in section 4).
- Every action except `Webhook`, `TestWebhook`, `WebhookByHeader`, `TestWebhookByHeader` carries `[Authorize]` and requires a bearer token (`Authorization: Bearer <jwt>`). None of these authorized actions take a `tenantId` field in their request DTOs — the controller always resolves tenant server-side via `GetTenantId()`, which calls `BlocksContext.GetContext()` and returns `context.TenantId` (empty string if `GetContext()` returns null). **Never send a `tenantId` in the body for authenticated endpoints — it would be ignored even if you did.**
- `BlocksContext.GetContext()` (in `Blocks.Genesis`, `blocks-genesis-net/src/Genesis/Auth/BlocksContext.cs`) reads the current `HttpContext.User` claims principal set up by JWT bearer authentication (`services.JwtBearerAuthentication()` in `ApplicationConfigurations.ConfigureApi`). When the request carries a valid bearer token, ASP.NET Core populates `HttpContext.User` as a `ClaimsIdentity`, and `BlocksContext.CreateFromClaimsIdentity` extracts `TenantId` from the `tenant_id` claim (plus `UserId` from `user_id`, `Roles` from role claims, etc.). In other words: **the tenant is whatever tenant the caller's JWT was issued for — there is no way to act cross-tenant from these endpoints.** Outside of an HTTP request (background/worker context) the same type falls back to an `AsyncLocal` value set via `BlocksContext.SetContext(...)`, which is not relevant to callers of this REST API.
- Exception: the four webhook actions are anonymous at the framework level (no `[Authorize]`). The two path-based ones (`Webhook`, `TestWebhook`) take `tenantId` as a route segment and pass it straight through to the execution service — there is no token check on tenant identity at this layer (the workflow's own trigger `authType`, e.g. `blocksAuthentication`/`blocksAuthorization`, decides whether the underlying trigger execution requires an authenticated/authorized caller; a failed check throws `UnauthorizedAccessException`, which the controller catches and turns into `401 { "message": "Unauthorized" }`). The two header-based twins (`WebhookByHeader`, `TestWebhookByHeader`) instead read the tenant from an `x-blocks-key` request header via `TryGetTenantIdFromBlocksKey()`; a missing or whitespace-only header short-circuits with `400 { "message": "x-blocks-key header is required" }` before the execution service is even called, while the same downstream `authType` check still applies and still surfaces as `401` on failure.
- JSON casing: no `AddJsonOptions`/`JsonSerializerOptions` override was found anywhere in `blocks-logic`'s startup path (`Program.cs`, `ApplicationConfigurations.ConfigureApi`, `AddApplicationServices`), so ASP.NET Core's MVC default applies — camelCase property names on the wire (`WorkflowId` ↔ `workflowId`), case-insensitive on the way in. All field names below are given as declared in C#; convert to camelCase for the actual JSON body/response.
- `[FromBody]` actions take a JSON object body; `[FromQuery]` actions (`Get`, `Delete`, `GetExecutions`, `GetExecution`, `LastSuccessfullExecution`) take the same fields as URL query-string parameters instead of a body.

## 2. Workflow CRUD & lifecycle

| Method | Path | Action | Auth |
|---|---|---|---|
| POST | `/api/Workflow/GetAll` | `GetAll` | Bearer |
| GET | `/api/Workflow/Get` | `Get` | Bearer |
| POST | `/api/Workflow/Create` | `Create` | Bearer |
| POST | `/api/Workflow/Duplicate` | `Duplicate` | Bearer |
| PUT | `/api/Workflow/Update` | `Update` | Bearer |
| DELETE | `/api/Workflow/Delete` | `Delete` | Bearer |
| POST | `/api/Workflow/Restore` | `Restore` | Bearer |

### GetAll — `POST /api/Workflow/GetAll`
Calls `IWorkflowService.GetAllAsync`. Body = `WorkflowGetsRequestDto`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `Search` | `string?` | optional | free-text filter |
| `IsPublished` | `bool?` | optional | filter by publish state |
| `PageSize` | `int` | optional, default `10` | `[Range(1, int.MaxValue)]` — must be > 0 |
| `PageNumber` | `int` | optional, default `0` | `[Range(0, int.MaxValue)]` — 0-based |

Response: `200 OK`, body `WorkflowGetsResponseDto` (extends `BaseQueryListResponse<List<WorkflowListItemDto>>` — **no `IsSuccess` field**, only `Data`, `Errors`, `TotalCount`):

| Field | Type | Notes |
|---|---|---|
| `Data` | `List<WorkflowListItemDto>?` | page of results |
| `Errors` | `IDictionary<string,string>?` | |
| `TotalCount` | `long` | total matching rows, not page size |

`WorkflowListItemDto`:

| Field | Type | Notes |
|---|---|---|
| `ItemId` | `string` (required) | workflow id |
| `Name` | `string` (required) | |
| `IsDirty` | `bool` (required) | has unpublished edits |
| `IsPublished` | `bool` (required) | |
| `Settings` | `Dictionary<string,string>` | default `{}` |
| `CreatedDate` | `DateTime` | |
| `LastUpdatedDate` | `DateTime` | |
| `CreatedBy` | `string?` | |
| `LastUpdatedBy` | `string?` | |
| `Language` | `string?` | |
| `Tags` | `List<string>` | default `[]` |

### Get — `GET /api/Workflow/Get`
Calls `IWorkflowService.GetAsync`. Query params = `WorkflowGetRequestDto`: `WorkflowId` (`string`, required).

Response: `200 OK`, body `WorkflowGetResponseDto` (extends `BaseResponse`: `IsSuccess` (`bool`), `Errors` (`IDictionary<string,string>?`)) plus its own field, declared in source as lowercase `data` (`WorkflowResponseDto`). On a not-found or error path, `IsSuccess=false`, `Errors={"Message": "..."}"`, `data=null` — the controller still returns `200 OK` (the service never throws; it returns an error-shaped DTO, and the action always calls `Ok(...)`).

`WorkflowResponseDto` (extends `BaseEntity`: `ItemId`, `CreatedDate`, `LastUpdatedDate`, `CreatedBy`, `Language`, `LastUpdatedBy`, `OrganizationId` (default `"default"`), `Tags`) plus:

| Field | Type | Notes |
|---|---|---|
| `Name` | `string` | |
| `TenantId` | `string` (required) | |
| `Nodes` | `List<NodeDto>` | see below |
| `Edges` | `List<EdgeEnity>` | class name is literally `EdgeEnity` (typo in source, preserved) |
| `Settings` | `Dictionary<string,string>` | |
| `IsPublished` | `bool` | workflow-level flag: does it have any published version at all |
| `Description` | `string` | default `""` |
| `PublishedVersion` | `WorkflowVersionDto?` | populated only when `IsPublished && PublishedVersionId` set; see Publishing section |
| `IsDirty` | `bool` | |

`NodeDto`:

| Field | Type | Notes |
|---|---|---|
| `Id` | `string` (required) | |
| `Name` | `string` (required) | |
| `Category` | `string` (required) | e.g. `"trigger"` |
| `Type` | `string` (required) | node-type identifier, e.g. `"schedule"`, `"email"`, `"dataGateway"` |
| `Version` | `string` (required) | node schema version |
| `Position` | `Position` (required) | `{ X: double, Y: double }` |
| `Handle` | `Handle?` | `{ Sources: List<string>, Targets: List<string> }` — **`Sources`/`Targets` are public C# fields, not properties**; with no `IncludeFields` override in this codebase, System.Text.Json's default (`IncludeFields=false`) means these are **not serialized to/from JSON** — treat `Handle` as effectively opaque/empty over HTTP. Not verified against a running instance; confirm before relying on it. |
| `Parameters` | `JsonElement` | arbitrary JSON object, node-type-specific schema (out of scope here) |
| `Settings` | `JsonElement` | arbitrary JSON object |
| `PinData` | `JsonElement?` | arbitrary JSON, pinned test data for the node |

`WorkflowVersionDto` (nested inside `WorkflowGetResponseDto.cs`, distinct from the `WorkflowVersionEntity` used elsewhere): `VersionId` (`string`), `Name` (`string`), `Description` (`string`).

### Create — `POST /api/Workflow/Create`
Calls `IWorkflowService.CreateAsync`. Body = `WorkflowCreateRequestDto`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `Name` | `string` | required | |
| `Description` | `string` | optional, default `""` | |
| `Nodes` | `JsonElement` | optional, default `[]` | **raw JSON array**, not `List<NodeDto>` — deserialized server-side via `JsonConvert.DeserializeObject<List<NodeEntity>>`, so each element must match the `NodeEntity`/`NodeDto` shape (`Id`, `Name`, `Category`, `Type`, `Version`, `Position`, `Handle`, `Parameters`, `Settings`, `PinData`) |
| `Edges` | `List<EdgeEnity>` | optional, default `[]` | each: `Id`, `Source`, `Target`, `SourceHandle`, `TargetHandle` (all required strings) |
| `Settings` | `Dictionary<string,string>` | optional, default `{}` | |
| `CreatedAt` | `DateTime` | optional, default now | accepted but not read by `CreateAsync` (server stamps its own `CreatedDate`) |
| `UpdatedAt` | `DateTime` | optional, default now | same — not read |

Response: `201 Created`, body `BaseMutationResponse` (`IsSuccess: bool`, `ItemId: string?`, `Errors: IDictionary<string,string>?`). Note the **201 status is unconditional** — the controller always returns `StatusCode(201, result)` even when `IsSuccess=false` (e.g. tenant-not-found produces a 201 with `IsSuccess=false` and an `Errors["Message"]`). Callers must check `IsSuccess`, not just the HTTP status.

### Duplicate — `POST /api/Workflow/Duplicate`
Calls `IWorkflowService.DuplicateAsync`. Body = `WorkflowDuplicateRequestDto`: `Name` (`string`, required — name for the copy), `WorkflowId` (`string`, required — source workflow to copy). Copies `Nodes`, `Edges`, `Settings`, `Description`, `Language`, `OrganizationId`, `Tags` from the source; does **not** copy publish state (new workflow always starts unpublished, since those fields aren't set on the new entity).

Response: `201 Created` (unconditional, same caveat as `Create`), body `BaseMutationResponse`. `IsSuccess=false` with `Errors={"Message":"Workflow not found"}` if `WorkflowId` doesn't resolve.

### Update — `PUT /api/Workflow/Update`
Calls `IWorkflowService.UpdateAsync`. Body = `WorkflowUpdateRequestDto`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `ItemId` | `string` | required | workflow to update |
| `Name` | `string?` | optional | replaces if provided |
| `Nodes` | `List<NodeDto>?` | optional | **typed list here** (unlike `Create`'s raw `JsonElement`); replaces the whole node list if provided |
| `Edges` | `List<EdgeEnity>?` | optional | replaces the whole edge list if provided |
| `Settings` | `Dictionary<string,string>?` | optional | replaces if provided |
| `IsPublished` | `bool?` | optional | accepted on the DTO but **not read** by `UpdateAsync` — publish state can only change via the Publishing endpoints below; do not rely on this field |

Any update sets `IsDirty=true` server-side regardless of what changed. Response: `200 OK`, body `BaseMutationResponse`. `IsSuccess=false` with `Errors={"Message":"Workflow not found"}` if `ItemId` doesn't resolve.

### Delete — `DELETE /api/Workflow/Delete`
Calls `IWorkflowService.DeleteAsync`. Query params = `WorkflowDeleteRequestDto`: `Id` (`string`, required). Also deletes all of the workflow's versions (`DeleteWorkflowVersionsByWorkflowIdAsync`) and best-effort deletes any schedules recorded in `PublishedMeta` (a scheduler-deletion failure is logged but does not block the delete).

Response: `200 OK`, body `BaseMutationResponse`. `IsSuccess=false` with `Errors={"Message":"Workflow not found"}` if `Id` doesn't resolve.

### Restore — `POST /api/Workflow/Restore`
Calls `IWorkflowService.RestoreAsync`. Body = `WorkflowRestoreRequestDto`: `WorkflowId` (`string`, required), `VersionId` (`string`, required — a version from `GetVersions`/`CreateVersion`/`PublishNewVersion` history).

Behavior: overwrites the **live/draft** workflow's `Nodes`/`Edges`/`Settings`/etc. with that version's snapshot, but keeps the *current* workflow's `ItemId`, `IsPublished`, `PublishedVersionId`, `LastPublishedVersionId`, and `PublishedMeta` untouched — i.e. restoring a version only resets the draft graph and always sets `IsDirty=true`; it never changes what's currently published.

Response: `200 OK`, body `BaseMutationResponse`. `Errors={"Message":"Workflow not found"}` or `{"Message":"Version to restore not found"}` on the respective not-found cases.

## 3. Publishing

| Method | Path | Action | Auth |
|---|---|---|---|
| POST | `/api/Workflow/PublishNewVersion` | `PublishNewVersion` | Bearer |
| POST | `/api/Workflow/PublishVersion` | `PublishVersion` | Bearer |
| POST | `/api/Workflow/Unpublish` | `Unpublish` | Bearer |

`WorkflowEntity` carries four publish-related fields: `IsPublished` (`bool`), `PublishedVersionId` (`string?`), `LastPublishedVersionId` (`string?`), `PublishedMeta` (`PublishedWorkflowMeta?` = `{ TriggerNodes: List<NodeEntity> }`, a snapshot of the published graph's trigger nodes, used so the webhook/schedule dispatch path doesn't need to re-read the whole snapshot). `Webhook` (production trigger) only executes when `IsPublished==true` and `PublishedVersionId` resolves to a real `WorkflowVersionEntity`.

### PublishNewVersion — `POST /api/Workflow/PublishNewVersion`
Calls `IWorkflowService.PublishNewVersionAsync`. Body = `WorkflowPublishNewVersionRequestDto`: `WorkflowId` (`string`, required), `Name` (`string`, required — name for the new version), `Description` (`string`, optional, default `""`).

Snapshots the **current draft** graph into a brand-new `WorkflowVersionEntity`, then publishes it in one step: deletes any schedules from the previously-published trigger nodes, re-creates schedules for the new snapshot's `schedule`-type trigger nodes (fails the whole call if a schedule trigger node has no `cronExpression`), sets `IsDirty=false`, `IsPublished=true`, `PublishedVersionId=<new version id>`, and `PublishedMeta.TriggerNodes` to the new snapshot's cloned trigger nodes.

**Note (verified from source, likely unintended):** the assignment order is `PublishedVersionId = version.ItemId` followed immediately by `LastPublishedVersionId = workflow.PublishedVersionId` — since `PublishedVersionId` was just overwritten, `LastPublishedVersionId` ends up equal to the **new** version id here, not the previous one, despite the inline comment "Store the previous published version ID". Contrast with `PublishVersion` below, where the order is correct.

Response: `201 Created` (unconditional status, same caveat as `Create`), body `BaseMutationResponse` with `ItemId` = the new version's id on success.

### PublishVersion — `POST /api/Workflow/PublishVersion`
Calls `IWorkflowService.PublishVersionAsync`. Body = `WorkflowPublishVersionRequestDto`: `WorkflowId` (`string`, required), `VersionId` (`string?`, optional).

If `VersionId` is omitted/empty, the service republishes `workflow.LastPublishedVersionId` instead (fails with `Errors={"Message":"No version to publish"}` if that's also empty). Otherwise publishes the given `VersionId` (must be an existing version row, else `Errors={"Message":"Version not found"}"`). Recreates schedules the same way as `PublishNewVersion`. Sets `IsDirty=false`, `IsPublished=true`, and — correctly here — `LastPublishedVersionId = <old PublishedVersionId>` **before** `PublishedVersionId = <the version just published>`.

Response: `200 OK`, body `BaseMutationResponse` with `ItemId` = the **workflow's** id (not the version id, unlike `PublishNewVersion`).

### Unpublish — `POST /api/Workflow/Unpublish`
Calls `IWorkflowService.UnpublishAsync`. Body = `WorkflowUnpublishRequestDto`: `WorkflowId` (`string`, required).

Deletes schedules tied to the current `PublishedMeta`, then sets `IsPublished=false`, `PublishedVersionId=null`, `PublishedMeta=null`. **Does not clear `LastPublishedVersionId`** — so a subsequent `PublishVersion` call with no `VersionId` will republish whatever was last published before this unpublish.

Response: `200 OK`, body `BaseMutationResponse`.

## 4. Versions

| Method | Path | Action | Auth |
|---|---|---|---|
| POST | `/api/Workflow/CreateVersion` | `CreateVersion` | Bearer |
| POST | `/api/Workflow/UpdateVersion` | `UpdateVersion` | Bearer |
| POST | `/api/Workflow/GetVersions` | `GetVersions` | Bearer |
| POST | `/api/Workflow/GetWorkflowByVersion` | `GetWorkflowByVersion` | Bearer |

`WorkflowVersionEntity` (extends `BaseEntity`): `WorkflowId` (`string`, required), `TenantId` (`string`, required), `Name` (`string`, required), `Description` (`string`, default `""`), `Snapshot` (`WorkflowEntity`, required — a full copy of the workflow at the time the version was taken).

### CreateVersion — `POST /api/Workflow/CreateVersion`
Calls `IWorkflowVersionService.CreateVersionAsync`. Body = `WorkflowVersionCreateRequestDto`: `WorkflowId` (`string`, required), `Name` (`string`, required), `Description` (`string`, optional, default `""`).

Snapshots the current draft workflow into a new version row **without** touching publish state (unlike `PublishNewVersion`, this does not set `IsPublished`/`PublishedVersionId` — it's a pure "save a checkpoint" action).

Response: `201 Created` (unconditional), body `BaseMutationResponse`, `ItemId` = new version id.

### UpdateVersion — `POST /api/Workflow/UpdateVersion`
Calls `IWorkflowVersionService.UpdateVersionAsync`. Body = `WorkflowVersionUpdateRequestDto`: `VersionId` (`string`, required), `Name` (`string`, required), `Description` (`string`, optional, default `""`).

Only edits the version row's `Name`/`Description` metadata — does not touch `Snapshot`. Response: `200 OK`, body `BaseMutationResponse`. `Errors={"Message":"Workflow version not found"}` if `VersionId` doesn't resolve.

### GetVersions — `POST /api/Workflow/GetVersions`
Calls `IWorkflowVersionService.GetWorkflowVersionsAsync`. Body = `WorkflowGetVersionsRequestDto`: `WorkflowId` (`string`, required).

Response: `200 OK`, body `WorkflowGetVersionsResponseDto` (extends `BaseQueryListResponse<List<WorkflowGetVersionSummary>>` — no `IsSuccess`, only `Data`/`Errors`/`TotalCount`). `TotalCount` here is simply `versionSummaries.Count` (not a separate DB count).

`WorkflowGetVersionSummary`:

| Field | Type | Notes |
|---|---|---|
| `ItemId` | `string` (required) | version id |
| `WorkflowId` | `string` (required) | |
| `TenantId` | `string` (required) | |
| `Name` | `string` (required) | |
| `Description` | `string` | default `""` |
| `IsPublished` | `bool` (required) | **per-version** flag: `true` iff `workflow.PublishedVersionId == this version's ItemId` — i.e. this is the one currently live, not merely "was ever published" |
| `CreatedDate` | `DateTime` | |
| `LastUpdatedDate` | `DateTime` | |
| `CreatedBy` | `string?` | |
| `LastUpdatedBy` | `string?` | |

### GetWorkflowByVersion — `POST /api/Workflow/GetWorkflowByVersion`
Calls `IWorkflowService.GetWorkflowByVersionAsync`. Body = `GetWorkflowByVersionRequestDto`: `WorkflowId` (`string`, required), `VersionId` (`string`, required).

Returns the workflow graph exactly as captured in that version's `Snapshot` (its own `Nodes`/`Edges`/`Settings`/etc., stamped with the *snapshot's* `ItemId`/dates), **except** `IsPublished` on the response, which is read from the **live** workflow (`workflow.IsPublished`), not derived from whether this particular version is the published one — use `GetVersions`' per-summary `IsPublished` for that. **Caveat (from source):** the live `workflow` is fetched by `WorkflowId` but never null-checked before `workflow.IsPublished` is read; if `WorkflowId` doesn't match any workflow while `VersionId` still resolves, this can throw an unhandled exception. Not verified against a running instance — treat a mismatched `WorkflowId`/`VersionId` pair as an unverified error path.

Response: `200 OK`, body `GetWorkflowByVersionResponseDto` (extends `BaseResponse`) with lowercase `data` field (`WorkflowResponseDto`, same shape as in `Get`). `Errors={"Message":"Version not found"}`, `data=null` if `VersionId` doesn't resolve.

## 5. Triggering & testing

| Method | Path | Action | Auth |
|---|---|---|---|
| POST | `/api/Workflow/Webhook/{tenantId}/{workflowId}/{webhookId}` | `Webhook` | Anonymous (trigger-level `authType`) |
| POST | `/api/Workflow/webhook-test/{tenantId}/{workflowId}/{webhookId}` | `TestWebhook` (`[ActionName("webhook-test")]`) | Anonymous (trigger-level `authType`) |
| POST | `/api/Workflow/Webhook/{workflowId}/{webhookId}` | `WebhookByHeader` (`[ActionName("Webhook")]`) | Anonymous + `x-blocks-key` header |
| POST | `/api/Workflow/webhook-test/{workflowId}/{webhookId}` | `TestWebhookByHeader` (`[ActionName("webhook-test")]`) | Anonymous + `x-blocks-key` header |
| POST | `/api/Workflow/StepExecute` | `StepExecute` | Bearer |
| POST | `/api/Workflow/TriggerListener` | `TriggerListener` | Bearer |

All four webhook actions take the same body shape: raw JSON (`System.Text.Json.JsonElement input`) — either a single JSON object or a JSON array of objects; both are normalized server-side into a `BsonArray` of one-or-more documents before being handed to the workflow as trigger input. There is no fixed request DTO — the body is whatever the trigger node's downstream nodes expect.

### Webhook vs TestWebhook — the key distinction
- **`Webhook`** (`TriggerWebhookAsync`) runs the **published** graph: it looks up the live `WorkflowEntity`, requires `IsPublished==true` and a resolvable `PublishedVersionId`, then executes the `WorkflowVersionEntity.Snapshot` for that published version (i.e., whatever graph was captured at last publish — *not* the current draft). If the workflow isn't published, or the published version can't be loaded, it returns `200 OK` with `WorkflowWebhookResponseDto.Status = "Workflow is not published"` (or `"Something went wrong"`) and `ExecutionId=null` — **not an HTTP error**.
- **`TestWebhook`** (`TriggerTestWebhookAsync`) runs the **current draft** graph directly off the live `WorkflowEntity` (no version lookup), but only if the workflow has an active test listener: `workflow.TestMeta != null && TestMeta.IsListening == true && TestMeta.ListenerTriggerNodes` contains a node with `Id == webhookId`. `TestMeta.IsListening` is turned on by `TriggerListener` (below) or by `StepExecute` when stepping through un-pinned trigger ancestors. If not listening, returns `200 OK` with `Status = "The requested webhook {webhookId} is not listening for test executions. Please activate the test mode in the workflow"`.
- In both cases, if the workflow's trigger node has `Parameters.authType == "blocksAuthentication"` or `"blocksAuthorization"`, the service performs its own auth check against the incoming request (`IWorkflowAuthService`); failure throws `UnauthorizedAccessException`, caught by the controller as `401 { "message": "Unauthorized" }`. If the trigger node itself can't be found on the workflow, both return `200 OK` with `Status = "Workflow not found"` (yes — that literal message, even though the *workflow* was found and only the *trigger node* is missing).
- If the trigger node's `Parameters.httpResponseMode == "last"`, the webhook runs the node graph in-process and waits for it to finish before responding (rather than queuing to a worker), and the response `Data` is shaped by `Parameters.httpResponseData`: `"none"` → no body at all (controller still returns `200`, this is `null` from the service so effectively an empty `200 OK`), `"all"` → full array of the last node's output items, anything else (default, "first") → just the first output item. Otherwise (no `"last"` mode), the call is queued asynchronously and responds immediately with `Status = "Queued"`.

`WorkflowWebhookResponseDto` (all four webhook actions):

| Field | Type | Notes |
|---|---|---|
| `ExecutionId` | `string?` | null on any "not found"/"not published"/"not listening" case |
| `Status` | `string` | one of: `"Queued"`, `"Completed"`, `"Workflow not found"`, `"Workflow is not published"`, `"Something went wrong"`, or the "not listening for test executions" message above |
| `Data` | `JsonElement?` | only populated for `httpResponseMode == "last"` |

### StepExecute — `POST /api/Workflow/StepExecute`
Calls `IWorkflowExecutionService.StepExecuteAsync`. Body = `StepExecuteRequestDto`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `WorkflowId` | `string` | required | |
| `NodeId` | `string` | required | the node to execute/inspect |
| `SourceExecutionId` | `string?` | optional | an existing execution to resume/replay from |
| `TriggerNodeId` | `string?` | optional | pick a specific trigger among the node's ancestors when there's more than one candidate |

Runs (or arranges to run) a single node for the node-inspector/test panel. If `NodeId` has no trigger-category ancestor at all, it executes immediately in a triggerless test run. If it does have trigger ancestors and none has pinned data and no `SourceExecutionId` was given, the call instead **arms test-mode listening** on the workflow (sets `TestMeta.IsListening=true` for those trigger nodes) and returns without executing — the actual run happens later when `TestWebhook`/`TestWebhookByHeader` (or the matching non-webhook trigger path) fires. Response: `200 OK`, body `StepExecuteResponseDto` (extends `BaseMutationResponse`, i.e. `IsSuccess`, `ItemId`, `Errors`) plus `Message` (`string?`) and `Code` (`string?`) — `Code = "101"` with `Message = "Trigger nodes Listining"` [sic] signals the "now armed and waiting" case described above. `Errors` keys used: `"Workflow"` ("Workflow not found"), `"Node"` ("Node not found"), `"Message"` (trigger-node-related failures).

### TriggerListener — `POST /api/Workflow/TriggerListener`
Calls `IWorkflowService.TriggerListenerAsync`. Body = `TriggerListenerRequestDto`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `WorkflowId` | `string` | required | |
| `TriggerId` | `string?` | optional | required (validated) only when `EnableListener=true` |
| `CompletionNodeId` | `string?` | optional | if given, must match a real node id on the workflow |
| `EnableListener` | `bool` | optional, default `false` | |

`EnableListener=false` clears `workflow.TestMeta` (turns off test listening) unconditionally. `EnableListener=true` requires `TriggerId` (else `Errors={"Message":"TriggerId is required when enabling listener"}"`), the id must resolve to a `Category=="trigger"` node (else `"Trigger node not found"`), and if `CompletionNodeId` is set it must resolve to a real node (else `"Completion node not found"`). On success sets `workflow.TestMeta = { ListenerTriggerNodes: [triggerNode], UserIds: [callingUserId], IsListening: true, CompletionNodeId }`. Response: `200 OK`, body `BaseMutationResponse`.

## 6. Execution history

| Method | Path | Action | Auth |
|---|---|---|---|
| GET | `/api/Workflow/GetExecutions` | `GetExecutions` | Bearer |
| GET | `/api/Workflow/GetExecution` | `GetExecution` | Bearer |
| GET | `/api/Workflow/LastSuccessfullExecution` | `LastSuccessfullExecution` | Bearer |

Enum values, verbatim (`server/Workflow.DomainService/Enums/`):

```
WorkflowExecutionStatus: Init = 0, Queued = 1, Pending = 2, Running = 3, Completed = 4, Failed = 5
NodeExecutionStatus:                            Pending = 2, Running = 3, Completed = 4, Failed = 5   (no Init/Queued)
```

The execution-mode enum lives in a file named `WorkflowExecutionStatusMode.cs`, but the actual C# type declared in it is `WorkflowExecutionMode` (not `WorkflowExecutionStatusMode`) — the DTOs reference it as `WorkflowExecutionMode`:

```
WorkflowExecutionMode: Test = 0, Production = 1   (implicit values; Test declared first)
```

### GetExecutions — `GET /api/Workflow/GetExecutions`
Calls `IWorkflowExecutionService.GetExecutionsByWorkflowIdAsync`. Query params = `WorkflowExecutionsGetRequestDto`: `WorkflowId` (`string`, required).

Response: `200 OK`, body `WorkflowExecutionsGetResponseDto` (extends `BaseQueryListResponse<List<WorkflowExecutionItemDto>>` — no `IsSuccess`). `TotalCount` = `executionItems.Count` (i.e., count of what's returned, not a separate total — this endpoint does not appear to paginate).

`WorkflowExecutionItemDto`:

| Field | Type | Notes |
|---|---|---|
| `Id` | `string` (required) | execution id |
| `WorkflowId` | `string` (required) | |
| `WorkflowName` | `string` (required) | |
| `Status` | `WorkflowExecutionStatus` (required) | |
| `ExecutionMode` | `WorkflowExecutionMode` (required) | |
| `StartedAt` | `DateTime` (required) | |
| `FinishedAt` | `DateTime?` | |
| `ErrorMessage` | `string?` | |
| `AttemptNumber` | `int` | |

### GetExecution — `GET /api/Workflow/GetExecution`
Calls `IWorkflowExecutionService.GetExecutionByIdAsync`. Query params = `WorkflowExecutionGetRequestDto`: `ExecutionId` (`string`, required).

**Not found behavior differs from the rest of the controller:** the service does `?? throw new InvalidOperationException($"Execution {ExecutionId} not found")` — there is no try/catch around this in the controller action, so a bad `ExecutionId` propagates as an unhandled `InvalidOperationException` rather than a `200 OK` with `IsSuccess=false`. Not verified against a running instance for the resulting HTTP status (likely a `500` from default ASP.NET Core exception handling, since no explicit filter for this exception type was found — the only registered filter is `SecretExceptionFilter`).

Response (success path): `200 OK`, body `WorkflowExecutionGetResponseDto` (extends `BaseResponse`, i.e. `IsSuccess`/`Errors`) plus `Data` (`WorkflowExecutionDto?`, uppercase — unlike `WorkflowGetResponseDto.data`/`GetWorkflowByVersionResponseDto.data`, this one is PascalCase in source; irrelevant on the wire since camelCase policy applies to both).

`WorkflowExecutionDto`:

| Field | Type | Notes |
|---|---|---|
| `Id` | `string` (required) | |
| `WorkflowId` | `string` (required) | |
| `WorkflowName` | `string` (required) | |
| `Status` | `WorkflowExecutionStatus` (required) | |
| `ExecutionMode` | `WorkflowExecutionMode` (required) | |
| `StartedAt` | `DateTime` (required) | |
| `FinishedAt` | `DateTime?` | |
| `Duration` | `TimeSpan?` | present on the DTO but **not populated** by either `GetExecutionByIdAsync` or `LastSuccessfullExecutionAsync` (always default/null on the wire) |
| `ErrorMessage` | `string?` | |
| `AttemptNumber` | `int` | |
| `Context` | `JsonElement` | arbitrary JSON, includes at least an `Input` key holding the normalized trigger payload |
| `ActiveNodeIds` | `List<string>` | |
| `NodeExecutions` | `List<NodeExecutionResponseDto>` | per-node run metadata, see below |
| `WorkflowSnapshot` | `WorkflowResponseDto?` | the graph as it was at execution time; note only `ItemId`, `Name`, `Nodes`, `Edges`, `IsPublished`, `Settings`, `TenantId` are populated here — `Description`, dates, `PublishedVersion`, `IsDirty` are left at their type defaults |
| `Items` | `List<WorkflowItemExecutionDto>` | every data item that flowed through the execution, for building input/output visualizations |

`NodeExecutionResponseDto` (extends `NodeExecutionEntity`: `Id`, `NodeId`, `NodeName`, `NodeType`, `NodeVersion`, `RunIndex` (`int`), `Status` (`NodeExecutionStatus`), `InputItemCount` (`int`), `OutputItemCount` (`int`), `OutputCountsByBranch` (`Dictionary<string,int>`), `StartedAt` (`DateTime`), `EndedAt` (`DateTime?`), `Error` (`string?`), `AttemptNumber` (`int`)) plus its own: `Parameters` (`JsonDocument` — that node's `Parameters` as configured on the workflow snapshot), `Input` (`JsonArray` — output payloads of this node's parent items), `Output` (`JsonArray` — this node's own output payloads).

`WorkflowItemExecutionDto`:

| Field | Type | Notes |
|---|---|---|
| `ItemId` | `string` (required) | |
| `NodeId` | `string` (required) | |
| `NodeExecutionId` | `string` (required) | |
| `Branch` | `string` (required) | e.g. which IF-branch produced this item |
| `Data` | `JsonDocument` (required) | the item's payload (input/output wrapper) |
| `ParentItemIds` | `List<string>` | default `[]` |
| `ItemIndex` | `int` | |
| `CreatedAt` | `DateTime` | |

Note: `WorkflowExecutionEntity.TriggerMetadata` (`{ TriggerNodeId, TriggerType, TriggerData }`) exists on the underlying entity but is commented out of both `WorkflowExecutionDto` and the `GetExecutionByIdAsync`/`LastSuccessfullExecutionAsync` mapping code — **it is not exposed by any endpoint response** despite being on the entity.

### LastSuccessfullExecution — `GET /api/Workflow/LastSuccessfullExecution`
Calls `IWorkflowExecutionService.LastSuccessfullExecutionAsync`. Query params = `LastSuccessfullExecutionRequestDto`: `WorkflowId` (`string`, required). Note the method/action name's spelling (`LastSuccessfullExecution`, double "l") is exactly as declared — do not "fix" it when building the URL.

Returns the most recent **completed** execution (used to prefill node inputs from real data in the editor). Response shape is identical to `GetExecution`'s (`WorkflowExecutionGetResponseDto` / `WorkflowExecutionDto`), except: unlike `GetExecution`, a not-found case here is handled gracefully — `200 OK` with `IsSuccess=false`, `Data=null`, `Errors={"Message":"No Execution"}"` — no exception is thrown. `WorkflowExecutionDto.AttemptNumber` is populated here too, but note this method's own mapping code does not set `NodeExecutions`... — actually check: it does set `NodeExecutions` the same way as `GetExecutionByIdAsync`; the two mapping blocks are effectively identical aside from the `Duration` field never being set in either.

## 7. Error shapes

| Case | Status | Body | Verified? |
|---|---|---|---|
| Webhook/TestWebhook/WebhookByHeader/TestWebhookByHeader: trigger's `authType` check fails | `401` | `{ "message": "Unauthorized" }` | Yes — controller code + `WorkflowControllerTests` (`Webhook_Unauthorized_Returns401` etc.) |
| WebhookByHeader/TestWebhookByHeader: missing or whitespace-only `x-blocks-key` header | `400` | `{ "message": "x-blocks-key header is required" }` | Yes — controller code + `WebhookByHeader_MissingHeader_Returns400`/`WhitespaceHeader_Returns400` tests |
| Any `[Authorize]` action called without a valid bearer token | `401` (framework-level, before the action runs) | ASP.NET Core default challenge response, not a custom body | Not verified from source (this is default JWT bearer middleware behavior, not controller code) — confirm against a running instance |
| Malformed JSON body / a `[Required]`-annotated field missing on a `[FromBody]`/`[FromQuery]` DTO (e.g. `Name` on `WorkflowCreateRequestDto`, `WorkflowId` on `WorkflowGetRequestDto`) | `400`, standard ASP.NET Core `ValidationProblemDetails` | Because `[ApiController]` is applied to `WorkflowController`, automatic model-state validation (`400` with the standard problem-details JSON) applies to every action by default | Not verified from source beyond confirming `[ApiController]` is present and DTOs carry `[Required]`/`[Range]` attributes — confirm the exact `ValidationProblemDetails` shape against a running instance |
| `GetExecution` with an `ExecutionId` that doesn't resolve | Not verified — service throws an uncaught `InvalidOperationException`; no controller-level try/catch or exception filter for this type was found (only `SecretExceptionFilter` is registered) | none known | Not verified from source — confirm against a running instance (likely default ASP.NET Core `500`) |
| Most other business-rule failures (not-found workflow/version/node, publish failures, etc.) on non-webhook actions | `200 OK` (the controller always calls `Ok(...)`, or unconditionally `201 Created` for `Create`/`Duplicate`/`CreateVersion`/`PublishNewVersion`) | `BaseMutationResponse`-shaped body with `IsSuccess=false` and `Errors: { "Message": "..." }` | Yes — confirmed across `WorkflowService`/`WorkflowVersionService`/`WorkflowExecutionService` source |

## Open questions / ambiguities flagged during review

- Whether the ASP.NET Core default is truly camelCase with no override is inferred from the absence of any `AddJsonOptions`/`JsonSerializerOptions` call in the traced startup path (`Program.cs` → `ApplicationConfigurations.ConfigureApi` → `AddApplicationServices`), not from an explicit configuration statement — confirm against a running instance if exact wire casing matters.
- `Handle.Sources`/`Handle.Targets` being plain C# fields (not properties) means they are very likely dropped by System.Text.Json under default settings; this could not be confirmed by running the service, only by reading the serializer defaults and the absence of `IncludeFields`/`[JsonInclude]` anywhere in this codebase.
- `PublishNewVersionAsync`'s `LastPublishedVersionId` assignment (documented in section 3) reads as a bug against its own inline comment; documented as observed, not as intended.
- `GetWorkflowByVersionAsync`'s missing null-check on the live `workflow` (section 4) is a plausible unhandled-exception path but was not exercised against a running instance.
- `GetExecution`'s not-found path throwing an uncaught exception (vs. every other query action returning a `200`/`IsSuccess=false` shape) is inconsistent with the rest of the controller; flagged rather than guessed at for exact status code.
