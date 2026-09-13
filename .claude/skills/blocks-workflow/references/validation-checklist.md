# Pre-send validation checklist (structure AND data)

**Why this exists:** the raw API gives you almost none of the safety net the browser UI has. The
client-side `Import` path (`flows/import-export-workflow.md`) runs preflight + sanitize checks
*before* ever calling the API — but `Create`/`Update` themselves do **no equivalent validation**.
A malformed node, a dangling edge, or a mistyped parameter key is silently **accepted and stored**
by `Create`/`Update`, then fails later — often silently (wrong default, trigger that never fires)
rather than with an error you'd notice. Run this checklist yourself, every time, before calling
`Create`/`Update`, and before trusting a hand-authored or externally-sourced import file.

## 1. Root shape

- [ ] `name` — non-empty string
- [ ] `nodes` — array (send `[]`, never omit)
- [ ] `edges` — array (send `[]`, never omit)
- [ ] `settings` — object, string values only

## 2. Every node

- [ ] `id`, `name`, `category`, `type`, `version` — all non-empty strings
- [ ] `id` is unique across the whole `nodes` array
- [ ] `position.x` / `position.y` — finite numbers (cosmetic only, but must be present and numeric or some clients choke rendering it)
- [ ] `(category, type)` is a real pair from [node-graph-schema.md §4](./node-graph-schema.md) — an unrecognized `type` is accepted by `Create`/`Update` with no complaint, then fails at execution with "no executor found." Never invent a node type.
- [ ] `parameters` is present (send `{}` if the type truly needs none) and its keys match **§4's exact casing** — see the sharper rule in §1 of that doc: trigger nodes' dispatch fields (`authType`, `httpResponseMode`, `httpResponseData`, `mailServerConfigurationId`, `testSubject`, `collectionName`, `operation`, `cronExpression`) are read via case-sensitive raw `BsonDocument` lookups — wrong casing there means the field reads as silently absent, not an error.
- [ ] Every enum-like string field uses one of its documented literal values, verbatim (see the per-type row in §4) — e.g. `httpMethod` is one of `GET/POST/PUT/PATCH/DELETE`; `authType` is `none`/`blocksAuthentication`/`blocksAuthorization`; a `dataGateway` node's `operation` is exactly `Inserted`/`Updated`/`Deleted` (case-sensitive per the rule above); an `if` node's `conditions[].operator` is one of the documented set for its `type`.
- [ ] Minimum fields actually load-bearing per type (absence doesn't error, it silently breaks the feature):

  | Type | Must be set correctly, or... |
  |---|---|
  | `schedule` | `cronExpression` non-blank — **this one does hard-fail**: publishing a workflow with a `schedule` trigger that has no `cronExpression` fails the whole `PublishNewVersion`/`PublishVersion` call. |
  | `webhook` | `authType` — if you meant `none` but left it unset/misspelled, it still behaves as `none` (safe default), but if you meant to require auth and mistype the value, the check silently never applies (endpoint stays open). |
  | `email` | `mailServerConfigurationId` — wrong/absent means the trigger never matches any inbound mail, with no error anywhere. |
  | `dataGateway` | `collectionName` + `operation` — same silent-never-matches failure mode. |
  | `httpRequest` | `httpMethod` + `url` — a blank/malformed `url` fails only when the node actually runs (execution-time error, not create/update-time). |
  | `if` | `conditions` non-empty array — an empty/missing `conditions` array makes every item's evaluation behavior unconfirmed; don't ship an `if` node with no conditions. |

## 3. Every edge

- [ ] `source` and `target` each reference a node `id` that exists **in this same payload** — `Create`/`Update` do not check this; a dangling edge is stored as-is and simply never routes any data (the target node just never becomes ready, since its only incoming edge's source never "completes" from its perspective... actually it does complete, the edge itself is just inert — treat a dangling edge as silently doing nothing, not as an error).
- [ ] `sourceHandle` is `"source"` for every node type except `if`, whose two outgoing edges must be `"if-true"` / `"if-false"` exactly (case-sensitive, matched verbatim against `Branch` — see node-graph-schema.md §5).
- [ ] `targetHandle` is `"target"` — every current node type has exactly one input port.
- [ ] An `if` node ideally has **both** an `if-true` and an `if-false` outgoing edge. Missing one isn't an error — that branch's downstream node still gets scheduled every run, just with zero input items whenever an item evaluates to the missing branch. Flag this to the user rather than shipping it silently if it looks unintentional.

## 4. Whole-graph sanity

- [ ] No two nodes share an `id`.
- [ ] Every edge resolves on both ends (§3).
- [ ] If this workflow is meant to run unattended, it has at least one `trigger` node — a graph with none can still be exercised manually (`StepExecute`/`TriggerListener`) but will never fire on its own via `Webhook`/schedule/email/data paths.

## Procedure

1. Build the JSON from the type catalog (`node-graph-schema.md` §4), copying field names and enum values **verbatim** — never paraphrase a key name or "clean up" casing you think looks wrong.
2. Walk every checkbox above against the JSON before calling `Create`/`Update`.
3. After the call, `GET /api/Workflow/Get?WorkflowId=<id>` and diff the response's `nodes`/`edges` against what you sent. `parameters`/`settings` are stored as opaque JSON with **no server-side schema enforcement**, so this round-trip is the only way to catch a typo after the fact — the write call itself will report success either way.
4. Before publishing, actually run it once (`StepExecute` or the test webhook — see `flows/build-and-publish-workflow.md` §4). Passing every check above proves the JSON is *well-formed*, not that the *values* are right — a syntactically valid but wrong `url`, or a `cronExpression` that parses but fires on the wrong schedule, only shows up in a real test run.
