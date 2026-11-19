import { beforeEach, describe, expect, it, vi } from "vitest";
import { BotApiService, isBotAiOptions, isOrbitSessionResponse, myAiKeyNames } from "./BotApiService";

const mocks = vi.hoisted(() => ({
    getAuthToken: vi.fn((): string | null => null),
    setAuthToken: vi.fn(),
    pusherGet: vi.fn(),
}));

vi.mock("../../../Connection/LocalUserStore", () => ({
    localUserStore: { getAuthToken: mocks.getAuthToken, setAuthToken: mocks.setAuthToken },
}));

vi.mock("../../../Connection/AxiosUtils", () => ({
    axiosToPusher: { get: mocks.pusherGet },
}));

function authToken(accessToken: string): string {
    return `header.${btoa(JSON.stringify({ accessToken }))}.signature`;
}

describe("BotApiService Orbit session contract", () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("accepts only the exact opaque v2 response", () => {
        expect(isOrbitSessionResponse({ version: 2, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            true
        );
        expect(
            isOrbitSessionResponse({ version: 2, sessionToken: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })
        ).toBe(false);
        expect(isOrbitSessionResponse({ version: 2, sessionId: "eyJ1c2VySWQiOiJmb3JnZWQifQ==", expiresAt: 123 })).toBe(
            false
        );
        expect(isOrbitSessionResponse({ version: 1, sessionId: `orb_sess_v2_${"a".repeat(64)}`, expiresAt: 123 })).toBe(
            false
        );
    });

    it("keeps a valid bot-server target when the Admin target is rejected", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ botsSpawned: 1 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        const service = new BotApiService();

        service.initialize(
            authToken("oidc-token"),
            "http://insecure.example.com",
            "room-1",
            "http://bot-server.workadventure.localhost"
        );

        await expect(service.notifyRoomEnter()).resolves.toEqual({ botsSpawned: 1 });
        expect(fetchMock).toHaveBeenCalledWith(
            "http://bot-server.workadventure.localhost/api/bots/room-enter",
            expect.objectContaining({ method: "POST" })
        );
    });

    it("sends the player's game token so the bot server lets guests open a room", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ botsSpawned: 0 }), {
                status: 200,
                headers: { "Content-Type": "application/json" },
            })
        );
        const service = new BotApiService();
        const token = authToken("oidc-token");
        service.initialize(token, undefined, "room-1", "http://bot-server.workadventure.localhost");

        await service.notifyRoomEnter();

        expect(fetchMock).toHaveBeenCalledWith(
            "http://bot-server.workadventure.localhost/api/bots/room-enter",
            expect.objectContaining({ headers: expect.objectContaining({ "X-WA-Auth": token }) })
        );
    });

    it("clears a cached Orbit session when the authenticated token changes", () => {
        const service = new BotApiService();
        const firstToken = authToken("first-oidc-token");

        service.initialize(firstToken, "https://admin.example.com", "room-1");
        sessionStorage.setItem("orbit_admin_session_v2", `orb_sess_v2_${"a".repeat(64)}`);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60_000));

        service.initialize(firstToken, "https://admin.example.com", "room-1");
        expect(sessionStorage.getItem("orbit_admin_session_v2")).not.toBeNull();

        service.initialize(authToken("second-oidc-token"), "https://admin.example.com", "room-1");
        expect(sessionStorage.getItem("orbit_admin_session_v2")).toBeNull();
        expect(sessionStorage.getItem("orbit_admin_session_v2_expires")).toBeNull();
    });
});

describe("BotApiService once the OIDC access token has run out", () => {
    const ADMIN = "https://admin.example.com";
    const SESSION = `orb_sess_v2_${"b".repeat(64)}`;
    const nowSeconds = () => Math.floor(Date.now() / 1000);

    function b64u(input: unknown): string {
        return btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    /** An OIDC access token (itself a JWT) that runs out at `exp` (seconds), or never says. */
    function oidcToken(name: string, exp?: number): string {
        return `${b64u({ alg: "none" })}.${b64u(exp === undefined ? { sub: name } : { sub: name, exp })}.sig`;
    }

    function meAnswer(gameToken: string) {
        return {
            data: {
                status: "ok",
                authToken: gameToken,
                userUuid: "user-1",
                isCharacterTexturesValid: true,
                isCompanionTextureValid: true,
            },
        };
    }

    /** Orbit accepts only `accepted` for a session, then lists no bots with it. */
    function orbitAccepting(accepted: string) {
        return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
            if (url === `${ADMIN}/api/auth/session`) {
                return Promise.resolve(
                    authorization === `Bearer ${accepted}`
                        ? new Response(
                              JSON.stringify({ version: 2, sessionId: SESSION, expiresAt: Date.now() + 3600_000 })
                          )
                        : new Response(JSON.stringify({ error: "Invalid or expired access token" }), { status: 401 })
                );
            }
            if (url.startsWith(`${ADMIN}/api/bots`) && authorization === `Bearer ${SESSION}`) {
                return Promise.resolve(new Response("[]"));
            }
            return Promise.resolve(new Response("unexpected", { status: 500 }));
        });
    }

    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
        mocks.getAuthToken.mockReset();
        mocks.setAuthToken.mockReset();
        mocks.pusherGet.mockReset();
    });

    it("renews an expired token through /me before asking Orbit for a session", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        const renewedAccess = oidcToken("new", nowSeconds() + 3600);
        const renewed = authToken(renewedAccess);
        mocks.getAuthToken.mockReturnValue(expired);
        mocks.pusherGet.mockResolvedValue(meAnswer(renewed));
        orbitAccepting(renewedAccess);
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", {
            timeout: 10_000,
            params: { token: expired, playUri: "room-1" },
        });
        expect(mocks.setAuthToken).toHaveBeenCalledWith(renewed);
        expect(sessionStorage.getItem("orbit_admin_session_v2")).toBe(SESSION);
    });

    it("forces a renewal and tries again when Orbit refuses a token that doesn't look expired", async () => {
        const refused = authToken(oidcToken("old"));
        const renewedAccess = oidcToken("new", nowSeconds() + 3600);
        mocks.getAuthToken.mockReturnValue(refused);
        mocks.pusherGet.mockResolvedValue(meAnswer(authToken(renewedAccess)));
        orbitAccepting(renewedAccess);
        const service = new BotApiService();
        service.initialize(refused, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).toHaveBeenCalledTimes(1);
        expect(mocks.pusherGet).toHaveBeenCalledWith("me", {
            timeout: 10_000,
            params: { token: refused, playUri: "room-1", refresh: "true" },
        });
    });

    it("starts from the game's newest token when Orbit's frame already renewed it", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        const newerAccess = oidcToken("new", nowSeconds() + 3600);
        mocks.getAuthToken.mockReturnValue(authToken(newerAccess));
        orbitAccepting(newerAccess);
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).resolves.toEqual([]);
        expect(mocks.pusherGet).not.toHaveBeenCalled();
    });

    it("still reports the missing session when the token can't be renewed", async () => {
        const expired = authToken(oidcToken("old", nowSeconds() - 10));
        mocks.getAuthToken.mockReturnValue(expired);
        mocks.pusherGet.mockRejectedValue(new Error("pusher down"));
        orbitAccepting("nothing-matches");
        const service = new BotApiService();
        service.initialize(expired, ADMIN, "room-1");

        await expect(service.listBots()).rejects.toThrow("Missing Orbit session");
        expect(mocks.setAuthToken).not.toHaveBeenCalled();
    });
});

describe("BotApiService bot chat telemetry", () => {
    function serviceWithSession() {
        const service = new BotApiService();
        service.initialize(authToken("oidc-token"), "https://orbit.example.com", "room-1");
        sessionStorage.setItem("orbit_admin_session_v2", `orb_sess_v2_${"a".repeat(64)}`);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 60 * 60 * 1000));
        return service;
    }

    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
    });

    it("reads telemetry as on when Orbit does not hide the bot's chats", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response(JSON.stringify({ universeHides: false, choice: "follow", hidden: false })));
        await expect(serviceWithSession().getBotTelemetry("bot-1")).resolves.toEqual({
            universeHides: false,
            on: true,
        });
        expect(fetchMock.mock.calls[0][0]).toBe("https://orbit.example.com/api/bots/bot-1/privacy");
    });

    it("reads telemetry as locked off when the universe hides every bot", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response(JSON.stringify({ universeHides: true, choice: "follow", hidden: true }))
        );
        await expect(serviceWithSession().getBotTelemetry("bot-1")).resolves.toEqual({
            universeHides: true,
            on: false,
        });
    });

    it("turns it off with the bot's own choice, and back on by following the universe", async () => {
        const fetchMock = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ universeHides: false, choice: "private", hidden: true }))
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ universeHides: false, choice: "follow", hidden: false }))
            );
        const service = serviceWithSession();
        await expect(service.saveBotTelemetry("bot-1", false)).resolves.toEqual({ universeHides: false, on: false });
        await expect(service.saveBotTelemetry("bot-1", true)).resolves.toEqual({ universeHides: false, on: true });
        expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toEqual({ choice: "private" });
        expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ choice: "follow" });
        expect(fetchMock.mock.calls[0][1]?.method).toBe("PUT");
    });

    it("refuses an answer it does not understand", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ hello: "world" })));
        await expect(serviceWithSession().getBotTelemetry("bot-1")).rejects.toThrow(/does not understand/);
    });
});

describe("isBotAiOptions", () => {
    it("takes an answer with a key list and a Universe AI answer", () => {
        expect(isBotAiOptions({ keys: [], universeAi: { available: true } })).toBe(true);
        expect(isBotAiOptions({ keys: [{ id: "k" }], universeAi: { available: false } })).toBe(true);
    });

    it("treats an answer without the Universe AI part as no answer, so the page keeps its provider list", () => {
        expect(isBotAiOptions({ keys: [] })).toBe(false);
        expect(isBotAiOptions({ keys: [], universeAi: {} })).toBe(false);
        expect(isBotAiOptions({ keys: "none", universeAi: { available: true } })).toBe(false);
        expect(isBotAiOptions(null)).toBe(false);
        expect(isBotAiOptions("keys")).toBe(false);
    });
});

describe("myAiKeyNames", () => {
    it("keeps only each key's id and name", () => {
        expect(
            myAiKeyNames({
                keys: [
                    { id: "key-1", name: "Opus 5.5", kind: "openrouter", lentTo: [] },
                    { id: "key-2", name: "My DeepSeek", lentTo: [{ universeId: "u1" }] },
                ],
            })
        ).toEqual([
            { id: "key-1", name: "Opus 5.5" },
            { id: "key-2", name: "My DeepSeek" },
        ]);
    });

    it("skips a key without an id or name, and answers null for anything that isn't a key list", () => {
        expect(myAiKeyNames({ keys: [{ id: "key-1" }, null, { id: "key-2", name: "Ok" }] })).toEqual([
            { id: "key-2", name: "Ok" },
        ]);
        expect(myAiKeyNames({ error: "Unauthorized" })).toBeNull();
        expect(myAiKeyNames(null)).toBeNull();
    });
});

describe("BotApiService voice switch", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    /** A service whose Orbit calls are stubbed: the PUT answers as saved, and the room-enter call is watched */
    function voiceService(
        putAnswer: () => Promise<Response> = () => Promise.resolve(new Response("{}", { status: 200 }))
    ) {
        const service = new BotApiService();
        service.initialize(authToken("oidc-token"), undefined, "room-1", "http://bot-server.workadventure.localhost");
        const orbit = vi
            .spyOn(service as never as { fetch: () => Promise<Response> }, "fetch")
            .mockImplementation(putAnswer);
        vi.spyOn(service as never as { voiceAnswer: () => unknown }, "voiceAnswer").mockImplementation(() => ({
            enabled: true,
        }));
        const roomEnter = vi.spyOn(service, "notifyRoomEnter").mockResolvedValue({ botsSpawned: 0 });
        return { service, orbit, roomEnter };
    }

    it("tells the bot server to look at the room again once voice is saved as on", async () => {
        const { service, orbit, roomEnter } = voiceService();

        await service.setBotVoiceEnabled("bot-1", true);

        expect(orbit).toHaveBeenCalledWith(
            "/api/bots/bot-1/voice",
            expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: true }) })
        );
        expect(roomEnter).toHaveBeenCalledTimes(1);
        // The bot server is told after Orbit has the choice, never before
        expect(orbit.mock.invocationCallOrder[0]).toBeLessThan(roomEnter.mock.invocationCallOrder[0]);
    });

    it("tells the bot server to look at the room again once voice is saved as off", async () => {
        const { service, orbit, roomEnter } = voiceService();

        await service.setBotVoiceEnabled("bot-1", false);

        expect(orbit).toHaveBeenCalledWith(
            "/api/bots/bot-1/voice",
            expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: false }) })
        );
        expect(roomEnter).toHaveBeenCalledTimes(1);
    });

    it("leaves the bot server alone when Orbit refuses the switch", async () => {
        const { service, roomEnter } = voiceService(() => Promise.reject(new Error("409")));

        await expect(service.setBotVoiceEnabled("bot-1", true)).rejects.toThrow("409");

        expect(roomEnter).not.toHaveBeenCalled();
    });

    it("still answers when the room-enter call fails", async () => {
        const { service, roomEnter } = voiceService();
        roomEnter.mockRejectedValue(new Error("roomId is required"));

        await expect(service.setBotVoiceEnabled("bot-1", true)).resolves.toEqual({ enabled: true });
    });
});

describe("BotApiService when Orbit refuses a call after the session was renewed", () => {
    const ADMIN = "https://admin.example.com";
    const OLD_SESSION = `orb_sess_v2_${"c".repeat(64)}`;
    const NEW_SESSION = `orb_sess_v2_${"d".repeat(64)}`;
    // An OIDC access token that does not say when it runs out, wrapped like the game's token
    const b64u = (input: unknown) =>
        btoa(JSON.stringify(input)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const ACCESS = authToken(`${b64u({ alg: "none" })}.${b64u({ sub: "user" })}.sig`);

    function orbit(retryAnswer: Response) {
        return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            const authorization = (init?.headers as Record<string, string> | undefined)?.Authorization;
            if (url === `${ADMIN}/api/auth/session`) {
                return Promise.resolve(
                    new Response(
                        JSON.stringify({ version: 2, sessionId: NEW_SESSION, expiresAt: Date.now() + 3600_000 })
                    )
                );
            }
            if (url === `${ADMIN}/api/me/apps`) {
                return Promise.resolve(
                    authorization === `Bearer ${OLD_SESSION}`
                        ? new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 })
                        : retryAnswer
                );
            }
            return Promise.resolve(new Response("unexpected", { status: 500 }));
        });
    }

    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
        mocks.getAuthToken.mockReset();
        mocks.setAuthToken.mockReset();
        mocks.pusherGet.mockReset();
        mocks.getAuthToken.mockReturnValue(ACCESS);
    });

    const addApp = () => {
        const service = new BotApiService();
        service.initialize(ACCESS, ADMIN, "room-1");
        // a session that was good a moment ago and that Orbit now refuses
        sessionStorage.setItem("orbit_admin_session_v2", OLD_SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 3600_000));
        return service.addMyApp({
            name: "My app",
            serverUrl: "https://tools.example.com/mcp",
            authType: "none",
            requestKey: "a".repeat(32),
        });
    };

    it("gives Orbit's own refusal of the retried call (a 409), not 'your session has expired'", async () => {
        orbit(new Response(JSON.stringify({ error: "That key was used for another app" }), { status: 409 }));
        await expect(addApp()).rejects.toMatchObject({
            message: "That key was used for another app",
            status: 409,
        });
    });

    it("still says the session has expired when the renewed session is refused too", async () => {
        orbit(new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 }));
        await expect(addApp()).rejects.toMatchObject({ isAuthError: true, status: 401 });
    });

    it("does not send a refused request again to another Orbit the game moved to while it was on its way", async () => {
        const OTHER = "https://other-orbit.example.com";
        const service = new BotApiService();
        service.initialize(ACCESS, ADMIN, "room-1");
        sessionStorage.setItem("orbit_admin_session_v2", OLD_SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 3600_000));
        const seen: string[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            seen.push(url);
            if (url === `${ADMIN}/api/me/apps`) {
                // Orbit refuses the session; meanwhile the player moves to a room on another Orbit
                service.initialize(ACCESS, OTHER, "room-2");
                return Promise.resolve(new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 }));
            }
            return Promise.resolve(
                new Response(JSON.stringify({ version: 2, sessionId: NEW_SESSION, expiresAt: Date.now() + 3600_000 }))
            );
        });
        await expect(
            service.addMyApp({
                name: "My app",
                serverUrl: "https://tools.example.com/mcp",
                authType: "none",
                requestKey: "a".repeat(32),
            })
        ).rejects.toMatchObject({ isAuthError: true, status: 401 });
        expect(seen).toEqual([`${ADMIN}/api/me/apps`]);
    });

    it("does not send the request again either when the game went to another Orbit and back while the new session was being asked for", async () => {
        const OTHER = "https://other-orbit.example.com";
        const service = new BotApiService();
        service.initialize(ACCESS, ADMIN, "room-1");
        sessionStorage.setItem("orbit_admin_session_v2", OLD_SESSION);
        sessionStorage.setItem("orbit_admin_session_v2_expires", String(Date.now() + 3600_000));
        const seen: string[] = [];
        vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
            const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
            seen.push(url);
            if (url === `${ADMIN}/api/auth/session`) {
                // The player goes to a room on another Orbit and back while the renewed session is on its way: the answer is for the same
                // Orbit and account again, but it is not the same stay, so the request is not sent again
                service.initialize(ACCESS, OTHER, "room-2");
                service.initialize(ACCESS, ADMIN, "room-1");
                return Promise.resolve(
                    new Response(
                        JSON.stringify({ version: 2, sessionId: NEW_SESSION, expiresAt: Date.now() + 3600_000 })
                    )
                );
            }
            return Promise.resolve(new Response(JSON.stringify({ error: "Invalid session" }), { status: 401 }));
        });
        await expect(
            service.addMyApp({
                name: "My app",
                serverUrl: "https://tools.example.com/mcp",
                authType: "none",
                requestKey: "a".repeat(32),
            })
        ).rejects.toMatchObject({ isAuthError: true, status: 401 });
        expect(seen).toEqual([`${ADMIN}/api/me/apps`, `${ADMIN}/api/auth/session`]);
    });

    it("answers the retried call once the renewed session is taken", async () => {
        const fetchSpy = orbit(new Response(JSON.stringify({ id: "app-1", name: "My app" }), { status: 200 }));
        await expect(addApp()).resolves.toEqual({ id: "app-1", name: "My app" });
        // The first request goes with the old session, then the session is exchanged, then the same request goes with the new one
        const sent = fetchSpy.mock.calls.map(([input, init]) => ({
            url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
        }));
        expect(sent.map((one) => one.url)).toEqual([
            `${ADMIN}/api/me/apps`,
            `${ADMIN}/api/auth/session`,
            `${ADMIN}/api/me/apps`,
        ]);
        expect(sent[0].authorization).toBe(`Bearer ${OLD_SESSION}`);
        expect(sent[2].authorization).toBe(`Bearer ${NEW_SESSION}`);
    });
});
