# Evidence and acceptance record

## Version identity

Target: `universe-develop` at `d2bc57b63b4abab9303fb3cbcecf1a0450fd15cc`.
Its tree is byte-identical to earlier test base `f00b3482f23c51976b4b339d7a891cad683d6498`:
`d4b5d2e04ba2f510c786f6d46c3630120659bfc4`. Correcting the branch ancestry must not
import the intervening 61 unrelated release commits. The runtime implementation
is retained from reviewed feature head `48800be9899d9737e66b0454b92b59cecde9d91c`;
this revision adds documentation, method-level contracts, reproducible map fixtures and structural tests without changing executable runtime behavior.

## Before/after evidence

| Evidence                                     | Before                                                                                    | After                                                                 | What this establishes                         |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------- |
| Base source audit                            | Native music continuity, looping and 1.6s fades already exist; no native distance emitter | Optional descriptor composes an independently attenuated emitter      | New feature, not repair of absent basic music |
| Malformed descriptor callback regression     | Recovery guard left source empty                                                          | Repair/removal restores the rejected selection                        | Store/callback behavior, not browser decoding |
| Late first opt-in compiled Svelte regression | Replaced media at 37s with a new element at 0s                                            | Existing element remains at 37s; warning emitted                      | Safe rejection of unsupported transition      |
| Navigation Stop regression                   | New malformed selection left stopped=true                                                 | New selection clears stale Stop after unload; later user Stop remains | Explicit selection semantics                  |
| Invalid-input controller/Svelte regression   | Validation escaped to subscriber                                                          | Error retained; unrelated writable dispatch and later music recover   | Exception containment                         |
| Canonical teleport-method harness            | Old listener stayed (1,2) after teleport to (300,500)                                     | Listener is (300,500) before map-property dispatch                    | Production method behavior in a small harness |
| Rejected-emitter follow-up                   | Movement changed error to loading                                                         | Error survives movement/clear/control until repair                    | Native status stability                       |

## Automated results already established

For reviewed runtime head `48800be9899d9737e66b0454b92b59cecde9d91c`:

- Author's repository audio suite: **83/83**, seven files.
- Independent exact-runtime review: **84/84**, including an additional retained-
  emitter-error regression. No extra runtime change was made after approval.
- Full TypeScript, Svelte (0 errors/0 warnings), lint and formatting passed.
- Two local production bundle attempts were killed with exit 137. These failures
  were retained rather than called passes. Hosted normal production build later passed.
- [Full hosted Continuous Integration](https://github.com/BAWES-Universe/workadventure-universe/actions/runs/38027132275): all 13 jobs passed, including production build and full checks.
- [Hosted Docker/browser E2E matrix](https://github.com/BAWES-Universe/workadventure-universe/actions/runs/38027132570): 19 jobs passed, 16 gated skips; no deployment action was taken.
- Desktop checks and CodeRabbit passed. Dev-server build/switch jobs were skipped.

Those links are **historical runtime evidence at the named head**, not a claim
that a cleanly rebased documentation/fixture revision has already passed CI.
The corrected-base PR checks must be inspected separately.

## Actual browser controller proof (earlier implementation)

A real cloud Chromium controller fixture, using separate existing music/cascade
stems and attached HTML media, passed 12 checks before the later error-containment
review fixes. Recorded observations included:

- Music time advanced 2.178→2.633 seconds while water gain changed 0.3→0.15.
- At far distance, water gain was zero without stopping music.
- Master 25% yielded music/water gains 0.1/0.075.
- Master zero and mute scheduled zero at the current audio time; measured post-gain
  output was zero after 8.6ms and 4.2ms respectively in that run.
- Pause held timestamps; Stop survived movement; resume advanced playback.
- A real no-CORS emitter failure did not restart working music.
- Reusing the same media/source graph succeeded; unload cleared sources, detached
  media, disconnected graphs and closed the owned context.

The initial synchronous AudioParam.value assertion was incorrect because scheduled
changes are rendered by an audio quantum. A visual-frame observer was also delayed.
The final observer polled at a render-quantum-sized interval with a strict 100ms
bound and measured actual output; no long sleep hid lingering audio.

This is actual **controller/browser evidence**, not an actual game-room acceptance
run. It did not exercise the subsequently added invalid-input containment paths.
A final-controller browser rerun remains pending. Do not call this physical-iPhone
proof or subjective audio-quality acceptance.

## Corrected-base revision checklist

- [x] Fixture JSON, referenced files and distance expectations validated by new repository test
- [x] Relevant repository audio suite rerun: 87/87 passed across eight files, including the four fixture tests
- [x] Documentation/fixture and new-test formatting checked; new-test ESLint, full TypeScript and Svelte (0 errors/0 warnings) passed
- [x] Exact runtime byte match and new-base feature justification independently reviewed; independent focused rerun passed 88/88 (author suite plus one retained review regression)
- [ ] Final remote commit has only this feature/docs/tests atop the pinned development base
- [ ] Hosted CI for that exact corrected-base commit completed

Update the PR description with concrete command results rather than treating these
unchecked steps as completed just because the earlier runtime passed.

## Acceptance still required

- Actually open and traverse the supplied maps in a candidate WorkAdventure room.
- Compare unchanged legacy behavior and opt-in proximity by joystick/keyboard and taps.
- Run the complete control/error/lifecycle checklist from README in that room.
- Validate real iPhone/Safari gesture permissions, volume/mute, interruption/resume,
  background/foreground and map cleanup.
- Confirm map-authored emitter coordinates and chosen music/water stems in the final art map.

No merge, live-room deployment or production acceptance is implied by these records.

## Hosted review feedback audit

All review submissions, inline threads and issue comments were fetched at prior head
`48800be9899d9737e66b0454b92b59cecde9d91c` before correcting the base. There were two
CodeRabbit code findings: validation escaping store dispatch and stale listener
position after teleport. Both were fixed and marked addressed by CodeRabbit; the
regressions above cover them. A separate Sentry Stop-recovery finding was also
reproduced and fixed, although its discussion remained open.

The CodeRabbit walkthrough still reported 37.5% docstring coverage against an 80%
threshold. This revision adds explicit method contracts to the controller and
changed integration entry points, in addition to these complete feature docs.
The new bot calculation must confirm coverage; a prior green status is not used
as evidence that this warning disappeared. No bot-generated instructions or
autofix toggles were used to change scope.
