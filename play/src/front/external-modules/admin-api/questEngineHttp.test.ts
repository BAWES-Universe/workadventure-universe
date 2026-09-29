import { describe, expect, it } from "vitest";
import { createQuestEngineHttpClient, engineStatusOf, parseEngineLog } from "./questEngineHttp";

const LOG = {
    quests: [
        {
            id: "p2",
            key: "welcome.meet",
            status: "COMPLETED",
            acceptedAt: "2026-09-29T10:00:00Z",
            completedAt: "2026-09-29T10:05:00Z",
        },
        { id: "p1", key: "welcome.meet", status: "STOPPED", acceptedAt: "2026-09-28T10:00:00Z", completedAt: null },
        { id: "p3", key: "welcome.explore", status: "PAUSED", acceptedAt: "2026-09-29T11:00:00Z", completedAt: null },
        { id: "p4", key: "room.other", status: "ACCEPTED", acceptedAt: "2026-09-29T11:00:00Z", completedAt: null },
    ],
    tracked: { progressId: "p3", revision: 4 },
};

function recorder(answers: Record<string, unknown> = {}, refusals: Record<string, Error> = {}) {
    const calls: Array<{ endpoint: string; method?: string; body?: unknown }> = [];
    const request = (endpoint: string, init?: RequestInit) => {
        calls.push({
            endpoint,
            method: init?.method,
            body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
        });
        const key = `${init?.method} ${endpoint.split("?")[0]}`;
        const refusal = refusals[key];
        if (refusal) return Promise.reject(refusal);
        return Promise.resolve(new Response(JSON.stringify(answers[key] ?? {}), { status: 200 }));
    };
    return { calls, request };
}

describe("engineStatusOf", () => {
    it("puts the engine's statuses in the game's three words", () => {
        expect(engineStatusOf("COMPLETED")).toBe("done");
        expect(engineStatusOf("ACCEPTED")).toBe("in-progress");
        expect(engineStatusOf("PAUSED")).toBe("in-progress");
        expect(engineStatusOf("STOPPED")).toBe("not-started");
        expect(engineStatusOf("EXPIRED")).toBe("not-started");
    });
});

describe("parseEngineLog", () => {
    it("keeps the newest row per Welcome quest and marks the tracked one", () => {
        const log = parseEngineLog(LOG);
        expect(log?.quests).toEqual([
            {
                id: "welcome.meet",
                status: "done",
                tracked: false,
                acceptedAt: Date.parse("2026-09-29T10:00:00Z"),
                doneAt: Date.parse("2026-09-29T10:05:00Z"),
            },
            {
                id: "welcome.explore",
                status: "in-progress",
                tracked: true,
                acceptedAt: Date.parse("2026-09-29T11:00:00Z"),
                doneAt: null,
            },
        ]);
        expect(log?.progressIds.get("meet")).toBe("p2");
        expect(log?.tracked).toEqual({ progressId: "p3", revision: 4 });
        expect(parseEngineLog({})).toBeNull();
    });
});

describe("createQuestEngineHttpClient", () => {
    it("accepts by key, where the player is", async () => {
        const { calls, request } = recorder();
        const client = createQuestEngineHttpClient(request, () => "room-1");
        expect(await client.send({ action: "accept", questId: "welcome.build" })).toBe(true);
        expect(calls).toEqual([
            { endpoint: "/api/me/quests/accept", method: "POST", body: { key: "welcome.build", roomId: "room-1" } },
        ]);
    });

    it("tracks and stops by progress id, with the tracked revision", async () => {
        const { calls, request } = recorder({
            "GET /api/me/quests": LOG,
            "PUT /api/me/quests/tracked": { revision: 5 },
        });
        const client = createQuestEngineHttpClient(request, () => null);
        await client.send({ action: "track", questId: "welcome.explore" });
        await client.send({ action: "stop", questId: "welcome.explore" });
        expect(calls.map((call) => `${call.method} ${call.endpoint}`)).toEqual([
            "GET /api/me/quests",
            "PUT /api/me/quests/tracked",
            "POST /api/me/quests/p3/stop",
        ]);
        expect(calls[1].body).toEqual({ progressId: "p3", revision: 4 });
    });

    it("reports a finished quest as the action its objective waits for, once per event id", async () => {
        const { calls, request } = recorder();
        const client = createQuestEngineHttpClient(request, () => "x".repeat(65));
        await client.send({
            action: "observe",
            questId: "welcome.meet",
            observedAt: Date.parse("2026-09-29T12:00:00Z"),
        });
        const body = calls[0].body as Record<string, unknown>;
        expect(calls[0].endpoint).toBe("/api/me/quests/observations");
        expect(body).toMatchObject({ action: "hello-exchanged", occurredAt: "2026-09-29T12:00:00.000Z" });
        expect(body.roomId).toBeUndefined();
        expect(body.eventId).toMatch(/^game:[A-Za-z0-9._:-]+$/);
    });

    it("says false when Orbit refuses, and keeps going", async () => {
        const { request } = recorder({}, { "POST /api/me/quests/accept": new Error("API error: 500") });
        const client = createQuestEngineHttpClient(request, () => null);
        expect(await client.send({ action: "accept", questId: "welcome.meet" })).toBe(false);
        expect(await client.send({ action: "observe", questId: "welcome.meet", observedAt: 1 })).toBe(true);
    });

    it("tracks a quest just accepted by the id the accept answered with", async () => {
        const { calls, request } = recorder({
            "GET /api/me/quests": LOG,
            "POST /api/me/quests/accept": { id: "p9", key: "welcome.build" },
            "PUT /api/me/quests/tracked": { revision: 5 },
        });
        const client = createQuestEngineHttpClient(request, () => null);
        await client.list();
        await client.send({ action: "accept", questId: "welcome.build" });
        expect(await client.send({ action: "track", questId: "welcome.build" })).toBe(true);
        expect(calls.map((call) => `${call.method} ${call.endpoint}`)).toEqual([
            "GET /api/me/quests",
            "POST /api/me/quests/accept",
            "PUT /api/me/quests/tracked",
        ]);
        expect(calls[2].body).toEqual({ progressId: "p9", revision: 4 });
    });

    it("reads the log again when a quest to track is not in it, and says false if it still is not", async () => {
        const { calls, request } = recorder({ "GET /api/me/quests": LOG });
        const client = createQuestEngineHttpClient(request, () => null);
        expect(await client.send({ action: "track", questId: "welcome.build" })).toBe(false);
        expect(calls.map((call) => `${call.method} ${call.endpoint}`)).toEqual([
            "GET /api/me/quests",
            "GET /api/me/quests",
        ]);
    });

    it("stops a quest the log it held did not have yet, after reading the log again", async () => {
        const calls: string[] = [];
        let reads = 0;
        const request = (endpoint: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${endpoint}`);
            if (init?.method === "GET") {
                reads += 1;
                const quests =
                    reads === 1
                        ? LOG.quests
                        : [
                              ...LOG.quests,
                              {
                                  id: "p9",
                                  key: "welcome.build",
                                  status: "ACCEPTED",
                                  acceptedAt: null,
                                  completedAt: null,
                              },
                          ];
                return Promise.resolve(new Response(JSON.stringify({ ...LOG, quests })));
            }
            return Promise.resolve(new Response("{}"));
        };
        const client = createQuestEngineHttpClient(request, () => null);
        await client.list();
        expect(await client.send({ action: "stop", questId: "welcome.build" })).toBe(true);
        expect(calls).toEqual(["GET /api/me/quests", "GET /api/me/quests", "POST /api/me/quests/p9/stop"]);
    });

    it("reads the log in turn with the reports, never between them", async () => {
        const calls: string[] = [];
        let accepted = false;
        const request = (endpoint: string, init?: RequestInit) => {
            calls.push(`${init?.method} ${endpoint}`);
            if (init?.method === "GET") {
                const build = {
                    id: "p9",
                    key: "welcome.build",
                    status: "ACCEPTED",
                    acceptedAt: null,
                    completedAt: null,
                };
                const quests = accepted ? [...LOG.quests, build] : LOG.quests;
                return Promise.resolve(new Response(JSON.stringify({ ...LOG, quests })));
            }
            if (endpoint.endsWith("/accept")) {
                accepted = true;
                return Promise.resolve(new Response(JSON.stringify({ id: "p9" })));
            }
            return Promise.resolve(new Response("{}"));
        };
        const client = createQuestEngineHttpClient(request, () => null);
        await client.list();
        const results = await Promise.all([
            client.send({ action: "accept", questId: "welcome.build" }),
            client.list(),
            client.send({ action: "stop", questId: "welcome.build" }),
        ]);
        expect(results[0]).toBe(true);
        expect(results[2]).toBe(true);
        expect(calls).toEqual([
            "GET /api/me/quests",
            "POST /api/me/quests/accept",
            "GET /api/me/quests",
            "POST /api/me/quests/p9/stop",
        ]);
    });

    it("lists nothing when Orbit cannot answer", async () => {
        const client = createQuestEngineHttpClient(
            () => Promise.reject(new Error("offline")),
            () => null
        );
        expect(await client.list()).toBeNull();
    });
});
