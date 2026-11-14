/**
 * The allowlist every PostHog event goes through (#1841): only listed properties, only values of the right shape, and
 * the real PostHog client (SDK capture mocked) is the one place that sends.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { sanitizedError, providerFailureLine } from "../utils/sanitizedError";
import { allowed, AI_EVENT, spaceName, SERVER_EVENTS, errorClassOf, errorStatusOf, address, toolNames, id, label } from "../ai/telemetryAllowlist";

const capture = vi.fn();
vi.mock("posthog-node", () => ({ PostHog: vi.fn(() => ({ capture, flush: vi.fn() })) }));

const WORDS = "my password is hunter2 and my email is a.b@example.com";

describe("the allowlist", () => {
    beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));

    it("drops a property that is not listed, whatever it holds", () => {
        const kept = allowed("$ai_generation", AI_EVENT, { $ai_input: [{ content: WORDS }], $ai_output_choices: WORDS, note: WORDS, $ai_model: "gpt-4o" });
        expect(kept).toEqual({ $ai_model: "gpt-4o" });
    });

    it("keeps a listed property only when its value has the right shape", () => {
        const kept = allowed("$ai_generation", AI_EVENT, {
            $ai_model: WORDS,
            $ai_provider: "openai",
            bot_id: "bot-1",
            player_id: 42,
            space: "!dm:matrix.test",
            $ai_input_tokens: "12 tokens",
            $ai_output_tokens: 7.4,
            $ai_latency: -1,
            $ai_cost: 0.0021,
        });
        expect(kept).toEqual({ $ai_provider: "openai", bot_id: "bot-1", player_id: "42", space: "!dm:matrix.test", $ai_output_tokens: 7, $ai_cost: 0.0021 });
    });

    it("logs the name of a property it left out, never its value", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        allowed("probe_event", AI_EVENT, { never_listed_property: WORDS, $ai_model: WORDS });
        const logged = warn.mock.calls.map((call) => String(call[0])).join("\n");
        expect(logged).toContain("probe_event.never_listed_property");
        expect(logged).toContain("probe_event.$ai_model");
        expect(logged).not.toContain("hunter2");
        expect(logged).not.toContain("example.com");
    });

    it("lists tool names that look like names, and 'other' for anything else", () => {
        expect(toolNames(["read_mail", "gmail.search", WORDS, "x".repeat(200), 5])).toEqual(["read_mail", "gmail.search", "other", "other", "other"]);
        expect((toolNames(Array.from({ length: 80 }, () => "t")) as string[]).length).toBe(25);
        expect(toolNames("read_mail")).toBeUndefined();
    });

    it("sends the class of an error and its status, never the line", () => {
        expect(errorClassOf("the provider failed (429)")).toBe("provider_failed");
        expect(errorStatusOf("the provider failed (429)")).toBe(429);
        expect(errorClassOf("no words and no tool call: it reached the longest reply, 4000 tokens used of 4000 allowed, 4000 on thinking")).toBe("no_answer_reached_limit");
        expect(errorClassOf("no words and no tool call: it stopped (stop), 0 tokens used, 0 on thinking")).toBe("no_answer");
        expect(errorClassOf(`the provider failed (400): ${WORDS}`)).toBe("other");
        expect(errorStatusOf(`the provider failed (400): ${WORDS}`)).toBeUndefined();
        expect(errorClassOf(WORDS)).toBe("other");
    });

    it("keeps an address to its host and plain path, and drops one that carries anything else", () => {
        expect(address("https://play.example.com/@/uni/world/room?token=abc#frag")).toBe("https://play.example.com/@/uni/world/room");
        expect(address("https://user:pw@play.example.com/@/uni/world/room")).toBe("https://play.example.com/@/uni/world/room");
        expect(address(`https://play.example.com/@/uni/${encodeURIComponent(WORDS)}`)).toBeUndefined();
        expect(address("javascript:alert(1)")).toBeUndefined();
        expect(address("not a url")).toBeUndefined();
    });

    it("keeps the space of a universe room, with its own @, and of a direct-message room, and drops one with an email in it", () => {
        for (const room of ["/@/acme/main/lobby#group-1#1730830000000", "/_/global/play.example.com/maps/town.tmj#g#1", "@/acme/main/lobby", "acme.@/main/lobby", "https:@/x", "!abc123:matrix.example.com", "space-1", "@/acme/main/lobby.7f3a-bubble"]) {
            expect(spaceName(room)).toBe(room);
        }
        for (const bad of ["a.b@example.com", "user@host:room", "@alice", "two words", "room@", "x@@y"]) {
            expect(spaceName(bad)).toBeUndefined();
        }
        const kept = allowed("$ai_generation", AI_EVENT, { space: "@/acme/main/lobby", bot_id: "bot-1" });
        expect(kept).toEqual({ space: "@/acme/main/lobby", bot_id: "bot-1" });
    });

    it("takes ids that the system makes and nothing with spaces or an @", () => {
        expect(id("conversation-bot-1-player-42")).toBe("conversation-bot-1-player-42");
        expect(id("voice-worker:bot-server-1")).toBe("voice-worker:bot-server-1");
        expect(id("a.b@example.com")).toBeUndefined();
        expect(id("two words")).toBeUndefined();
        expect(id("")).toBeUndefined();
        expect(label("deepseek-v4-flash")).toBe("deepseek-v4-flash");
        expect(label("my private universe")).toBeUndefined();
    });
});

describe("sanitizedError", () => {
    it("drops the original's words and keeps where it failed", () => {
        const original = new Error(`no mailbox for ${WORDS}`);
        const safe = sanitizedError(original, "MCP tool read_mail failed (Error)");
        expect(safe.message).toBe("MCP tool read_mail failed (Error)");
        expect(safe.stack).not.toContain("hunter2");
        expect(safe.stack).not.toContain("example.com");
        expect(safe.stack).toContain("telemetryAllowlist.test");
        expect(safe.stack!.startsWith("Error: MCP tool read_mail failed (Error)\n")).toBe(true);
    });

    it("works for something that is not an error", () => {
        expect(sanitizedError("boom " + WORDS, "x").stack).not.toContain("hunter2");
    });
});

describe("the real client sends only what the allowlist keeps", () => {
    beforeEach(() => {
        capture.mockReset();
        vi.resetModules();
        process.env.POSTHOG_API_KEY = "phc_test";
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    const base = { distinctId: "bot-1", traceId: "t", sessionId: "s", model: "m", provider: "openai", inputTokens: 10, outputTokens: 2 };

    it("sends a generation with the figures, the tool names and the error class", async () => {
        const { captureAiGeneration } = await import("../ai/PostHogClient");
        captureAiGeneration({ ...base, cost: 0.01, latency: 1.5, botId: "bot-1", playerId: "42", space: "@/acme/main/lobby", toolNames: ["read_mail", "read_mail"], error: "the provider failed (503)" });
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls[0][0].properties).toEqual({
            $ai_session_id: "s", $ai_trace_id: "t", $ai_model: "m", $ai_provider: "openai",
            $ai_input_tokens: 10, $ai_output_tokens: 2, $ai_latency: 1.5, $ai_cost: 0.01,
            bot_id: "bot-1", player_id: "42", space: "@/acme/main/lobby", tool_names: ["read_mail", "read_mail"], tool_call_count: 2,
            $ai_is_error: true, $ai_error: "provider_failed", error_status: 503,
        });
    });

    it("sends nothing for an id that is not an id, or when text is passed in a field that should hold a model", async () => {
        const { captureAiGeneration } = await import("../ai/PostHogClient");
        captureAiGeneration({ ...base, distinctId: `bot-${WORDS}` });
        expect(capture).not.toHaveBeenCalled();
        captureAiGeneration({ ...base, model: WORDS, error: `the provider failed (400): ${WORDS}` });
        const sent = JSON.stringify(capture.mock.calls);
        expect(sent).not.toContain("hunter2");
        expect(sent).not.toContain("example.com");
    });

    it("sends the voice events with their figures, and the room address trimmed", async () => {
        const { captureServerEvent } = await import("../ai/PostHogClient");
        const { pausedAtCapacityEvent } = await import("../voice/VoiceLoad");
        captureServerEvent("bot:bot-1", "voice_paused_at_capacity", pausedAtCapacityEvent("bot-1", "https://play.example.com/@/uni/world/room?token=secret", "room"));
        expect(capture.mock.calls[0][0].properties).toEqual({
            bot_id: "bot-1", universe: "uni", room_url: "https://play.example.com/@/uni/world/room", turned_away: "room", $process_person_profile: false,
        });
        captureServerEvent("voice-worker:srv", "voice_worker_stats", {
            bot_connections: 3, sessions: 2, audio_connections: 2, peak_audio_connections: 4, max_audio_connections: 10,
            capacity_used_percent: 20, turned_away: 0, turned_away_total: 1, cpu_percent: 12.5, memory_mb: 310, bot_server: "srv",
        });
        expect(Object.keys(capture.mock.calls[1][0].properties).sort()).toEqual([...Object.keys(SERVER_EVENTS.voice_worker_stats), "$process_person_profile"].sort());
    });

    it("puts only the kind of failure and the status of a provider call on its Sentry span, never the provider's words", () => {
        expect(providerFailureLine(new Error(`OpenAI API error: 400 {"error":{"message":"${WORDS}"}}`))).toBe("provider failed (400)");
        expect(providerFailureLine(new Error(`Anthropic API error: 402 ${WORDS}`))).toBe("provider failed (402)");
        expect(providerFailureLine(new Error("OpenAI request timeout after 30000ms"))).toBe("OpenAI request timeout after 30000ms");
        const odd = new TypeError(`Unexpected token in ${WORDS}`);
        expect(providerFailureLine(odd)).toBe("provider failed (TypeError)");
        expect(providerFailureLine(odd)).not.toContain("hunter2");
        expect(providerFailureLine(WORDS)).toBe("provider failed (Error)");
    });

    it("keeps the voice worker's answer times per provider (#1865) as numbers, and nothing else under that name", () => {
        const kept = allowed("voice_worker_stats", SERVER_EVENTS.voice_worker_stats, {
            latency_hear_soniox_p50_ms: 640,
            latency_total_soniox_to_elevenlabs_p95_ms: 2100,
            latency_hear_soniox_turns: 12,
            latency_hear_soniox_p50_text: WORDS,
            "latency_my password is hunter2_p50_ms": 5,
            latency_hear_soniox_p95_ms: WORDS,
            latency_unlisted_suffix: 1,
        });
        expect(kept).toEqual({ latency_hear_soniox_p50_ms: 640, latency_total_soniox_to_elevenlabs_p95_ms: 2100, latency_hear_soniox_turns: 12 });
        // The pattern belongs to that one event
        expect(allowed("$ai_generation", AI_EVENT, { latency_hear_soniox_p50_ms: 640 })).toEqual({});
    });

    it("sends no event that is not in the allowlist, and drops properties added to one that is", async () => {
        const { captureServerEvent } = await import("../ai/PostHogClient");
        captureServerEvent("bot:bot-1", "user_said_something", { text: WORDS });
        captureServerEvent("bot:bot-1", "voice_paused_at_capacity", { bot_id: "bot-1", transcript: WORDS, turned_away: "bubble" });
        expect(capture).toHaveBeenCalledTimes(1);
        expect(capture.mock.calls[0][0].properties).toEqual({ bot_id: "bot-1", turned_away: "bubble", $process_person_profile: false });
    });

    it("does not hand out the raw client", async () => {
        const mod = await import("../ai/PostHogClient");
        expect(Object.keys(mod).sort()).toEqual(["captureAiGeneration", "captureAiTrace", "captureServerEvent", "flushPostHog"]);
    });
});
