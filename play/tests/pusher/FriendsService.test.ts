import { describe, expect, it, vi } from "vitest";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AxiosError, AxiosHeaders } from "axios";
import { FriendsError, FriendsService, PerSocketRateLimiter } from "../../src/pusher/services/FriendsService";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));

function orbitError(status: number, data: unknown): AxiosError {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    const response: AxiosResponse = { status, statusText: "", data, headers: {}, config };
    return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", config, {}, response);
}

function serviceRejecting(error: Error) {
    const http = {
        get: vi.fn(() => Promise.reject(error)),
        post: vi.fn(() => Promise.reject(error)),
        put: vi.fn(() => Promise.reject(error)),
    };
    return { service: new FriendsService("https://orbit.test", "token", http), http };
}

describe("FriendsService", () => {
    it("is unavailable without an admin", async () => {
        const http = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
        const service = new FriendsService(undefined, undefined, http);
        expect(service.isEnabled()).toBe(false);
        await expect(service.getFriends("alice")).rejects.toEqual(new FriendsError("friends_unavailable"));
        expect(http.get).not.toHaveBeenCalled();
    });

    it("turns Orbit's refusals into their code", async () => {
        const { service } = serviceRejecting(orbitError(403, { error: "no_shared_world" }));
        const refusal = await service.act("alice", "bob", "request").catch((e: unknown) => e);
        expect(refusal).toBeInstanceOf(FriendsError);
        expect(refusal).toMatchObject({ code: "no_shared_world", status: 403 });
    });

    it("keeps the code of a rate-limited request", async () => {
        const { service } = serviceRejecting(orbitError(429, { error: "too_many_open_requests" }));
        await expect(service.act("alice", "bob", "request")).rejects.toMatchObject({
            code: "too_many_open_requests",
            status: 429,
        });
    });

    it("lets server errors and unexpected bodies through as they are", async () => {
        const serverError = orbitError(500, { error: "boom" });
        await expect(serviceRejecting(serverError).service.getSettings("alice")).rejects.toBe(serverError);

        const htmlError = orbitError(404, "<html>Not found</html>");
        await expect(serviceRejecting(htmlError).service.search("alice", "bo")).rejects.toBe(htmlError);
    });

    it("calls Orbit with the admin token and parses the answer", async () => {
        const http = {
            get: vi.fn(() =>
                Promise.resolve({
                    data: {
                        friends: [
                            {
                                uuid: "bob",
                                name: null,
                                chatId: null,
                                shareLocation: true,
                                since: null,
                                lastSeenAt: null,
                            },
                        ],
                        incoming: [],
                        outgoing: [],
                        blocked: [],
                    },
                })
            ),
            post: vi.fn(),
            put: vi.fn(),
        };
        const service = new FriendsService("https://orbit.test", "token", http);
        const list = await service.getFriends("alice");
        expect(list.friends[0]?.uuid).toBe("bob");
        expect(http.get).toHaveBeenCalledWith("https://orbit.test/api/friends", {
            headers: { Authorization: "token" },
            params: { userUuid: "alice" },
        });
    });

    it("asks Orbit how two players stand", async () => {
        const http = {
            get: vi.fn(() =>
                Promise.resolve({
                    data: { relationship: "friends", target: { ringFrom: "nobody", friendsSeeLocation: false } },
                })
            ),
            post: vi.fn(),
            put: vi.fn(),
        };
        const service = new FriendsService("https://orbit.test", "token", http);
        await expect(service.getRelationship("alice", "bob")).resolves.toEqual({
            relationship: "friends",
            target: { ringFrom: "nobody", friendsSeeLocation: false },
        });
        expect(http.get).toHaveBeenCalledWith("https://orbit.test/api/friends/relationship", {
            headers: { Authorization: "token" },
            params: { userUuid: "alice", targetUuid: "bob" },
        });

        const { service: missing } = serviceRejecting(orbitError(404, { error: "player_not_found" }));
        await expect(missing.getRelationship("alice", "nobody")).rejects.toMatchObject({
            code: "player_not_found",
            status: 404,
        });
    });
});

describe("PerSocketRateLimiter", () => {
    it("allows a number of calls per window and socket", () => {
        let now = 0;
        const limiter = new PerSocketRateLimiter<object>(2, 1000, () => now);
        const a = {};
        const b = {};
        expect(limiter.take(a)).toBe(true);
        expect(limiter.take(a)).toBe(true);
        expect(limiter.take(a)).toBe(false);
        expect(limiter.take(b)).toBe(true);
        now = 1001;
        expect(limiter.take(a)).toBe(true);
    });
});
