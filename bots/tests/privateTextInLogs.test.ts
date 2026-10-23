/**
 * Hide bot conversations (#1166): what a bot said and what it remembers must not reach the bot server's console
 * lines outside debug. Every console line rides to Sentry as a breadcrumb on the next event (the gen_ai.agent
 * transactions are sampled at 100%), and warn/error lines also go to Sentry Logs, for private bots too.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { inspect } from "node:util";
import axios, { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios";
import { ResponseProcessor } from "../ai/ResponseProcessor";
import { MemoryStorage } from "../memory/MemoryStorage";
import type { BotPlayerMemory } from "../memory/ConversationMemory";

const REPLY = "So sorry to hear about the divorce, Sara. Oslo will be a fresh start.";
const FACT = "Sara is divorcing and moving to Oslo";

/** Everything a console spy was given, as Sentry would serialize it. */
function printed(spy: ReturnType<typeof vi.spyOn>): string {
    return spy.mock.calls.map((args) => args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: null }))).join(" ")).join("\n");
}

function processor(): ResponseProcessor {
    const metrics = { recordResponseQuality: vi.fn() };
    const monitor = { monitorResponse: vi.fn() };
    return new ResponseProcessor(metrics as any, monitor as any);
}

function memory(): BotPlayerMemory {
    return {
        playerId: 7,
        userUuid: "user-uuid-1",
        playerName: "Sara",
        isGuest: false,
        personalInfo: { name: "Sara", facts: new Map([["life", FACT]]) },
        relationship: { totalConversations: 3 },
        conversationHistory: [{ role: "user", content: FACT }],
        emotions: { lastEmotionUpdate: Date.now() },
        lastUpdated: Date.now(),
        createdAt: Date.now(),
    } as unknown as BotPlayerMemory;
}

describe("private text stays out of console lines", () => {
    let log: ReturnType<typeof vi.spyOn>;
    let error: ReturnType<typeof vi.spyOn>;
    const env = { ...process.env };

    beforeEach(() => {
        delete process.env.ENABLE_BOT_DEBUG;
        process.env.NODE_ENV = "production";
        log = vi.spyOn(console, "log").mockImplementation(() => {});
        error = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        process.env = { ...env };
    });

    it("does not print the bot's replies when checking for repetition", () => {
        const responses = processor();
        responses.processResponse("bot-1", 7, REPLY, "Be kind");
        responses.processResponse("bot-1", 7, REPLY, "Be kind");
        responses.processResponse("bot-1", 7, `${REPLY}!`, "Be kind");

        expect(printed(log)).not.toContain("divorce");
    });

    it("still finds the repetition, so only the logging changed", () => {
        const responses = processor();
        responses.processResponse("bot-1", 7, REPLY, "Be kind");
        const again = responses.processResponse("bot-1", 7, REPLY, "Be kind");

        expect(again.metrics.repetitionScore).toBe(1);
        expect(again.issues).toContain("BLOCKED: Exact duplicate");
    });

    it("keeps printing the replies with debug on, as before", () => {
        process.env.ENABLE_BOT_DEBUG = "true";
        const responses = processor();
        responses.processResponse("bot-1", 7, REPLY, "Be kind");
        responses.processResponse("bot-1", 7, REPLY, "Be kind");

        expect(printed(log)).toContain("divorce");
    });

    it("logs a failed memory save without what the bot remembers", async () => {
        let sent = "";
        vi.spyOn(axios, "post").mockImplementation(async (_url, body) => {
            sent = JSON.stringify(body);
            const config = { data: sent, headers: {} } as unknown as InternalAxiosRequestConfig;
            const response = { status: 503, data: { error: "Service unavailable" }, config } as unknown as AxiosResponse;
            throw new AxiosError("Request failed with status code 503", "ERR_BAD_RESPONSE", config, {}, response);
        });
        const storage = new MemoryStorage({ adminApiUrl: "http://orbit.test", botServiceToken: "token", saveInterval: 1000, maxRetries: 1 });

        await storage.saveMemories("bot-1", [memory()], "periodic");

        // The save did carry it: this is what the old line printed along with the error
        expect(sent).toContain(FACT);
        const line = printed(error);
        expect(line).toContain("Failed to save memories for bot bot-1");
        expect(line).toContain("status=503");
        expect(line).not.toContain("divorcing");
    });

    it("logs a save that got no answer at all by its code", async () => {
        vi.spyOn(axios, "post").mockRejectedValue(new AxiosError("connect ECONNREFUSED 127.0.0.1:9", "ECONNREFUSED", { data: FACT } as any));
        const storage = new MemoryStorage({ adminApiUrl: "http://orbit.test", botServiceToken: "token", saveInterval: 1000, maxRetries: 1 });

        await storage.saveMemories("bot-1", [memory()], "periodic");

        const line = printed(error);
        expect(line).toContain("ECONNREFUSED");
        expect(line).not.toContain("divorcing");
    });
});
