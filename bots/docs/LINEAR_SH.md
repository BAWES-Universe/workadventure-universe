# Linear SH — one employee at a time (off)

Companion: `BAWES-Universe/workadventure-universe-admin`, `feat/linear-sh`, `docs/LINEAR_SH.md`. The stationary bot is physically separate from other bots. The owner's single-employee model supersedes shared replies. Source/fixture acceptance is not live activation approval.

## Interaction and delivery

Only `LINEAR_SH_BOT_ID` is enrolled. Persist `behaviorConfig.linearSh: true` on that bot alone; reservation restricts it even with missing configuration. Retain the existing Deepseek provider. Other bots retain normal guest access, prompts, media, memories and retries.

Pusher's `Space` owns `LinearShInteraction`. It counts ALL_USERS membership and actual local sockets; only the enrolled bot's signed socket identity is exempt. Guests, a second employee, another bot and unknown/remote members prevent admission. Editable names/tags/SpaceUser UUIDs cannot exempt a participant. Both the employee and bot must be on the same pusher. **A verified single-pusher topology is a read-activation prerequisite**: replicated cross-pusher membership is not an atomic occupancy guarantee.

Local join/leave invalidates before awaiting back; back init/add/remove events also invalidate the generation. Rapid join/leave cannot resurrect old work. Exact socket object, token, subject, disconnect state and space membership are rechecked. A data-free pause notice is deduplicated. No queue or automatic resume exists: the sole employee must send a fresh request.

SocketManager attests the actual socket through Admin. Encrypted request proofs bind bot, original subject/account, sender, conversation, interaction generation, original message and request ID. The enrolled bot-only websocket interaction query gates work, planning, tool rounds, pre-dispatch and delivery. Failed checks discard late results and the old interaction's references/confirmation shortcut. A changed request while busy interrupts the old work without queuing a replacement.

Replies remain encrypted through bot/back/public watcher transport. Admin checks the original recipient/account/generation; pusher checks sole occupancy again after authorization and immediately before synchronous socket queueing. Guests and later visitors get no task data. Lists/yes-shortcuts become usable only after the request's receipt from this final queue. This is **queue acceptance, not browser-render acknowledgement**; live browser/disconnect acceptance is still required. Same-generation envelope replay still requires current authorization and the original employee; later generations fail. No new server chat history exists. Ordinary employee-authored public messages are not redacted, and delivered text cannot be retracted.

The existing Admin AES-GCM mechanism protects envelopes, not against trusted servers. Bots/Admin/pusher see plaintext; browsers receive no key. Deployed key distribution remains an operator verification item.

## Task usability

`my tasks`, `my issues`, `my tasks today`: own assigned **In Progress**, across joined teams intersected with the administrator-verified directory. No creator or due-today filter. Deterministic lists show trusted employee name, matching displayed count, numbered issue links/titles and list code. Partial pages/limits disclose a partial count. Verified absence of the exact status skips that team with disclosure; malformed, incomplete or failed state calls fail closed. In Review/other started states are never substituted.

The trusted team directory resolves names/keys such as Tech without UUID questions; duplicate names require clarification. Explicit issue identifiers and numbered references both use the owned-issue adapter. Numbers resolve to exact stable IDs from the list queued in this generation, expire in five minutes, and require the displayed code if several lists remain.

Simple one-team/one-page lists: zero model calls, two issue tool calls. Initialize, initialized notification and tools discovery add three MCP posts (five total). Interaction checks/receipts add websocket/internal-service calls, not MCP/model calls. Production latency, cost and actual protocol compatibility are unmeasured. Other natural language uses the existing provider for one bounded intent parse; tools/results cannot become unrestricted model capabilities.

Creates self-assign. Allowed edits: title, description, priority, due date, status. No deletion, reassignment, team moves, others' issues or administration. Exact original-text `yes`/`confirm` confirms one current queued preview; changed input, ambiguity, interruption, expiry or another identity invalidates the shortcut. Model/quoted/ambiguous text is not consent. Operation IDs remain for explicit reconciliation/replay handling.

## Writes are technically held

Admin `WRITE_CONTRACT_ACCEPTED=false` forces previews/writes off even if `LINEAR_SH_WRITES_ENABLED=true`. Tests inject synthetic enabled contexts only. Removing this hold requires reviewed contract changes and separate acceptance.

The durable journal binds requester/app attribution and encrypted fields/targets to the interaction, consumes once, and records dispatch before the external call. Interruption detected before sending records skipped. Already-sent calls may finish with a bounded timeout; outcomes remain durable and cannot be shown to the next visitor. Expired proofs can record only terminal outcomes for their own consumed operation, never prepare/claim/dispatch or retrieve task data. Unknown/dispatched markers never reopen automatically.

External Linear edits remain allowed. `LinearAssistant.confirm` reads owner/team/updatedAt, then `LinearAdapter.save` sends a separate MCP `save_issue` without a verified provider condition. External reassignment/version changes can race these calls. Local locks/journals/read-before-write cannot prevent this. A distributed interval also exists between the pusher interaction check and actual provider dispatch. Writes remain held on both boundaries.

Bounded review (2026-09-17): [official MCP docs](https://linear.app/docs/mcp) describe tools/bearer access but establish no atomic ownership/version precondition for this path. [GraphQL examples](https://linear.app/developers/graphql) and [SDK mutations](https://linear.app/developers/sdk-fetching-and-modifying-data) are different contracts and do not establish an MCP guarantee. No authenticated schema/provider call was performed. The boundary is **unverified**, not proven impossible. No invented condition/idempotency parameter or auto-rollback is used. Adapter v1 remains synthetic.

## Shared effects and deferred R1

Shared hooks: optional proof/query protobuf fields; BotManager enrollment; BaseBehavior no-op hook; BotClient dedicated dispatch/output guard/query; AIService dedicated planner/guard; AdminApiService internal call; SocketManager/IoSocketController; Space/forwarder/dispatcher membership invalidation and protected delivery. Ordinary separate-bubble paths retain their existing behavior once, with no Linear authorization dependency. Existing provider/gallery/vision/repetition/MCP suites and guest/employee routing fixtures cover regressions.

**Deferred R1:** a bubble containing Linear SH plus another bot/conversation can delay/drop ordinary messages while Linear authorization runs or fails. The new gate rejects this arrangement. General mixed-bot/world-chat routing is not fixed in this release. Keep Linear SH separate; never reserve another bot.

Coordinated rollout may restart Admin, bots, back and pushers, disconnect sockets and temporarily interrupt other bots. It does not change their prompts/models/media configuration. Older pushers see only an encrypted-reply placeholder and cannot implement the new query. Drain before rollout. No deployment is performed by this change.

## Ordered operator setup (future authorized work)

1. Identify the stationary bot's real stable ID, separate location and existing Deepseek reference. Persist only its restrictive reservation. Keep activation and writes false.
2. Follow the Admin runbook for application registration/client-credentials enablement, encrypted server provisioning, workspace/connection/app actor pins, verified team directory and OIDC/member bindings, including the private exception. Never paste a permanent expiring token.
3. Capture real `tools/list` **and sanitized result shapes/cursors** with the dedicated app under separate approval. Accept exact states, ownership, membership, pagination and protocol negotiation. Pin the complete sorted tool name/input-schema digest; a hash alone is not acceptance.
4. Run the named disposable PostgreSQL acceptance test. Review journal backup/reconciliation requirements and apply the additive migration only in an approved rollout. No production migration has run.
5. Generate matching protobufs and deploy compatible Admin/bots/back/pushers under separate approval. Require a verified single-pusher topology and ALL_USERS proximity bubble; accept browser delivery, rapid joins/leaves and socket replacement before activation. Multi-pusher occupancy remains unaccepted.
6. **Bots and every pusher, server only:** `LINEAR_SH_BOT_ID=<verified ID>`, `LINEAR_SH_ENABLED=false`, existing `ADMIN_API_URL` and `ADMIN_API_TOKEN`. Admin needs the companion settings. Back needs compatible generated protocol, no new environment variable. No frontend credentials/settings.
7. Separately approve read acceptance: own list/details, A -> B -> A, guest/nonmember denial, second-human pause during lookup/planning/preview/delivery, rapid join/leave, replay, replacement sockets, multiple teams/pages/absent states, and guests with ordinary bots in separate bubbles. Only then enable reads together on matching services. Writes stay false and code-held.
8. Resolve both write boundaries with owner-reviewed provider/interaction evidence, then obtain separate designated-test-issue write acceptance. This PR cannot activate writes; real employee tasks are not acceptance fixtures.

Rollback: activation false on Admin/bots/pushers; writes false; retain reservation. Stop the dedicated bot, drain dispatched calls and record/reconcile outcomes, then disable/revoke its managed connection if approved. Roll back compatible binaries only after draining. Retain operation table, consumed markers, recoverable encryption keys and backups; never reset replay records.

## Local and CI checks

Universe root: `npm test --workspace=@workadventure/bots -- --run`; `npx tsc -p bots/linear-sh/tsconfig.json --noEmit false --outDir bots/dist/linear-sh-check`.

`play`: `npx vitest run --config ../bots/vitest.config.ts tests/pusher/LinearSH.delivery.test.ts tests/pusher/LinearSH.dispatcher.test.ts tests/pusher/LinearSH.interaction.test.ts tests/pusher/SpaceToFrontDispatcher.test.ts tests/pusher/SpaceToBackForwarder.test.ts`.

`messages`: `npm run ts-proto`. Windows uses `grpc_tools_node_protoc.cmd --plugin=protoc-gen-ts_proto=.\node_modules\.bin\protoc-gen-ts_proto.cmd --ts_proto_out=..\libs\messages\src\ts-proto-generated --ts_proto_opt=outputServices=grpc-js --ts_proto_opt=oneof=unions --ts_proto_opt=esModuleInterop=true -I .\protos protos\*.proto`, then prepends `// @ts-nocheck` as the package script does. Generated output stays ignored; source API version hash stays `dev`.

The nine existing skips in `SpaceToFrontDispatcher.test.ts` remain. The new read-only CI job runs bot/pusher fixtures independently of broad builds. Equivalent-prerequisite diagnostic comparisons are not successful full builds. Provider/model fixtures are synthetic; live acceptance remains pending.
