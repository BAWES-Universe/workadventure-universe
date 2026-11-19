Talk-over stop: where the time goes (8 trials each, local turn-end, one process). Tool: scenarios/probe_barge.ts
Times are p50, in ms after the person's speech starts (Silero-confirmed start inside the clip).
A (TypeScript):                      VAD start seen 194 | cut reported 203 | last bot audio heard 184
B (Pipecat default min_volume 0.6):  VAD start seen 316 | cut reported 330 | last bot audio heard 357
B (min_volume 0.0, same process run): VAD start seen 275 | cut reported 282 | last bot audio heard 217
B (min_volume 0.3):                  VAD start seen 276 | cut reported 282 | last bot audio heard 218
B temporary frame probe: first loud audio frame reaches the pipeline 94 ms after the nominal start (same offset the clip has for A), so
the transport/jitter buffer adds no measurable delay. The extra ~120 ms is VAD confirmation (start_secs 0.2 = 6 windows) beginning later
because the first soft frames fail Pipecat's smoothed-volume gate (VADParams.min_volume). The audio output tail after the cut adds ~50 ms.
S2 (10 trials) for B with --vad-min-volume 0.0, repeated: local 337/358, 218/337, 338/340 (p50/p95) in three runs; provider 238/357.
Default (0.6): local 337/377, provider 358/398. So the setting helps in some runs and not in others: it is NOT a clean fix.
