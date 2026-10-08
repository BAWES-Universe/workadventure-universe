import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextFunction, Request, Response } from "express";
import { AxiosError, AxiosHeaders } from "axios";
import * as Sentry from "@sentry/node";
import { adminToken } from "../../src/pusher/middlewares/AdminToken";
import { mapStorageToken } from "../../src/pusher/middlewares/MapStorageToken";
import { authenticated } from "../../src/pusher/middlewares/Authenticated";
import { describeError } from "../../src/pusher/services/SafeErrorLog";

const ADMIN_TOKEN = "admin-token-value-XYZ";
const MAP_STORAGE_TOKEN = "map-storage-token-value-XYZ";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    ADMIN_API_TOKEN: "admin-token-value-XYZ",
    MAP_STORAGE_API_TOKEN: "map-storage-token-value-XYZ",
}));

vi.mock("../../src/pusher/services/JWTTokenManager", () => ({
    jwtTokenManager: {
        verifyJWTToken: () => {
            throw new Error("jwt malformed");
        },
    },
}));

vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));

function request(headers: Record<string, string>): Request {
    return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

function response() {
    const res = { status: vi.fn(), end: vi.fn(), send: vi.fn() };
    res.status.mockReturnValue(res);
    return res as unknown as Response & typeof res;
}

/** Everything the code wrote to the console and to Sentry, as one string. */
function everythingLogged(spies: ReturnType<typeof vi.spyOn>[]): string {
    const calls = [...spies.flatMap((spy) => spy.mock.calls), ...vi.mocked(Sentry.captureException).mock.calls];
    return calls
        .map((args) =>
            args.map((arg) => (arg instanceof Error ? `${arg.message} ${arg.stack}` : JSON.stringify(arg))).join(" ")
        )
        .join("\n");
}

describe("error logs never carry the credentials", () => {
    let spies: ReturnType<typeof vi.spyOn>[];
    beforeEach(() => {
        spies = [
            vi.spyOn(console, "error").mockImplementation(() => {}),
            vi.spyOn(console, "warn").mockImplementation(() => {}),
        ];
        vi.mocked(Sentry.captureException).mockClear();
    });
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("a wrong admin token is refused without being written down", () => {
        const next = vi.fn() as unknown as NextFunction;
        adminToken(request({ authorization: "someone-elses-admin-token-ABC" }), response(), next);
        expect(next).not.toHaveBeenCalled();
        expect(everythingLogged(spies)).not.toContain("someone-elses-admin-token-ABC");
        expect(everythingLogged(spies)).not.toContain(ADMIN_TOKEN);
    });

    it("a wrong map storage token is refused without being written down", () => {
        const next = vi.fn() as unknown as NextFunction;
        mapStorageToken(request({ authorization: "old-map-storage-token-ABC" }), response(), next);
        expect(next).not.toHaveBeenCalled();
        expect(everythingLogged(spies)).not.toContain("old-map-storage-token-ABC");
        expect(everythingLogged(spies)).not.toContain(MAP_STORAGE_TOKEN);
    });

    it("an invalid player token is refused without being written down", () => {
        const next = vi.fn() as unknown as NextFunction;
        const res = response();
        authenticated(
            request({ authorization: "eyJhbGciOiJIUzI1NiJ9.player-identity-payload.signature" }),
            res as never,
            next
        );
        expect(res.status).toHaveBeenCalledWith(401);
        expect(next).not.toHaveBeenCalled();
        expect(everythingLogged(spies)).not.toContain("player-identity-payload");
    });

    it("describeError keeps what failed, not the request an axios error carries", () => {
        const error = new AxiosError("Request failed with status code 500", "ERR_BAD_RESPONSE", {
            headers: new AxiosHeaders({ Authorization: ADMIN_TOKEN }),
        } as never);
        const described = describeError(error);
        expect(described).toContain("Request failed with status code 500");
        expect(described).toContain("ERR_BAD_RESPONSE");
        expect(described).not.toContain(ADMIN_TOKEN);
    });
});
