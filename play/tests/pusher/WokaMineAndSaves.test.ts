import type * as AxiosModule from "axios";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "express";

const mocks = vi.hoisted(() => ({
    saveTextures: vi.fn(),
    saveCompanionTexture: vi.fn(),
    getWokaMine: vi.fn(),
    get: vi.fn(),
}));

vi.mock("axios", async (importOriginal) => {
    const actual = await importOriginal<typeof AxiosModule>();
    return { ...actual, default: { ...actual.default, get: mocks.get } };
});
vi.mock("../../src/pusher/services/AdminService", () => ({
    adminService: {
        saveTextures: mocks.saveTextures,
        saveCompanionTexture: mocks.saveCompanionTexture,
        getWokaMine: mocks.getWokaMine,
    },
}));
vi.mock("../../src/pusher/middlewares/Authenticated", () => ({ authenticated: vi.fn() }));
vi.mock("@sentry/node", () => ({ captureException: vi.fn() }));
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    ADMIN_API_RETRY_DELAY: 0,
    ADMIN_API_TOKEN: "token",
    ADMIN_API_URL: "http://admin.test",
    OPID_PROFILE_SCREEN_PROVIDER: undefined,
}));
vi.mock("../../src/pusher/services/JWTTokenManager", () => ({ jwtTokenManager: {} }));
vi.mock("../../src/pusher/services/IceServersService", () => ({ iceServersService: {} }));

import { UserController } from "../../src/pusher/controllers/UserController";
import { WokaMineController } from "../../src/pusher/controllers/WokaMineController";
import { adminApi } from "../../src/pusher/services/AdminApi";

type Handler = (req: unknown, res: unknown) => Promise<void>;

/** An express app that only remembers the handlers that were registered. */
class FakeApp {
    handlers = new Map<string, Handler>();
    options() {
        return;
    }
    get(path: string, _middlewares: unknown, handler: Handler) {
        this.handlers.set(`GET ${path}`, handler);
    }
    post(path: string, _middlewares: unknown, handler: Handler) {
        this.handlers.set(`POST ${path}`, handler);
    }
}

class FakeResponse {
    statusCode: number | undefined;
    body: unknown;
    constructor(public userIdentifier: string | undefined = "uuid-1", public isLogged: boolean | undefined = true) {}
    status(code: number) {
        this.statusCode = code;
        return this;
    }
    json(body: unknown) {
        this.body = body;
        return this;
    }
    send(body?: unknown) {
        this.body = body;
        return this;
    }
}

/** What axios throws for a response with a status. */
function httpError(status: number, data?: unknown) {
    return Object.assign(new Error(`Request failed with status code ${status}`), {
        isAxiosError: true,
        response: { status, data },
    });
}

const roomUrl = "http://play.workadventure.localhost/@/uni/world/room";

describe("saves tell the game what the admin said", () => {
    let app: FakeApp;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        app = new FakeApp();
        new UserController(app as unknown as Application);
    });

    async function post(path: string, body: unknown, res = new FakeResponse()) {
        await app.handlers.get(`POST ${path}`)?.({ method: "POST", originalUrl: path, ip: "", body }, res);
        return res;
    }

    it.each([
        ["/save-textures", "saveTextures", { textures: ["a"], roomUrl }],
        ["/save-companion-texture", "saveCompanionTexture", { texture: "dog", roomUrl }],
    ] as const)("%s: 204 when the admin saved it", async (path, method, body) => {
        mocks[method].mockResolvedValue(undefined);
        const res = await post(path, body);
        expect(res.statusCode).toBe(204);
    });

    it.each([
        ["/save-textures", "saveTextures", { textures: ["a"], roomUrl }],
        ["/save-companion-texture", "saveCompanionTexture", { texture: "dog", roomUrl }],
    ] as const)("%s: the admin's 422 WOKA_NOT_ALLOWED goes back as 422 with the code", async (path, method, body) => {
        mocks[method].mockRejectedValue(httpError(422, { code: "WOKA_NOT_ALLOWED" }));
        const res = await post(path, body);
        expect(res.statusCode).toBe(422);
        expect(res.body).toEqual({ code: "WOKA_NOT_ALLOWED" });
    });

    it.each([
        ["/save-textures", "saveTextures", { textures: ["a"], roomUrl }],
        ["/save-companion-texture", "saveCompanionTexture", { texture: "dog", roomUrl }],
    ] as const)("%s: any other admin failure is a 502, not an unhandled error", async (path, method, body) => {
        mocks[method].mockRejectedValueOnce(httpError(500));
        expect((await post(path, body)).statusCode).toBe(502);
        // A 422 that is not about the WOKA is not passed on as that either
        mocks[method].mockRejectedValueOnce(httpError(422, { code: "SOMETHING_ELSE" }));
        expect((await post(path, body)).statusCode).toBe(502);
        mocks[method].mockRejectedValueOnce(new Error("socket hang up"));
        expect((await post(path, body)).statusCode).toBe(502);
    });

    it("a guest has nothing to save on an account: 204 without asking the admin", async () => {
        const res = await post("/save-textures", { textures: ["a"], roomUrl }, new FakeResponse("uuid-1", false));
        expect(res.statusCode).toBe(204);
        expect(mocks.saveTextures).not.toHaveBeenCalled();
    });
});

describe("GET /woka/mine", () => {
    let app: FakeApp;

    beforeEach(() => {
        vi.resetAllMocks();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        app = new FakeApp();
        new WokaMineController(app as unknown as Application);
    });

    async function ask(res = new FakeResponse(), query: Record<string, string> = { roomUrl }) {
        await app.handlers.get("GET /woka/mine")?.({ method: "GET", originalUrl: "/woka/mine", ip: "", query }, res);
        return res;
    }

    it("passes on what the admin says about the player in that room", async () => {
        const mine = { recent: [], current: null };
        mocks.getWokaMine.mockResolvedValue(mine);
        const res = await ask();
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual(mine);
        expect(mocks.getWokaMine).toHaveBeenCalledWith("uuid-1", roomUrl);
    });

    it("is a 404 when the admin does not tell (no capability, or the local admin)", async () => {
        mocks.getWokaMine.mockResolvedValue(undefined);
        expect((await ask()).statusCode).toBe(404);
    });

    it("is a 404 for a guest, without asking the admin", async () => {
        const res = await ask(new FakeResponse("uuid-1", false));
        expect(res.statusCode).toBe(404);
        expect(mocks.getWokaMine).not.toHaveBeenCalled();
    });

    it("is a 502 when the admin fails", async () => {
        mocks.getWokaMine.mockRejectedValue(new Error("boom"));
        expect((await ask()).statusCode).toBe(502);
    });

    it("asks for the room URL", async () => {
        expect((await ask(new FakeResponse(), {})).statusCode).toBe(400);
    });
});

describe("AdminApi.getWokaMine", () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    const setCapabilities = (capabilities: Record<string, string>) => {
        (adminApi as unknown as { capabilities: Record<string, string> }).capabilities = capabilities;
    };

    it("answers nothing, and does not call the admin, without the api/woka/mine capability", async () => {
        setCapabilities({});
        expect(await adminApi.getWokaMine("uuid-1", roomUrl)).toBeUndefined();
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it("asks the admin for the player in that room and checks the answer", async () => {
        setCapabilities({ "api/woka/mine": "v1" });
        mocks.get.mockResolvedValue({
            data: {
                current: {
                    textures: [{ id: "crown", url: "/c.png" }],
                    name: "Gold crown",
                    wearableHere: false,
                    reason: "other_place",
                    placeName: "Default world",
                },
                suggestion: { textures: [{ id: "teal", url: "/t.png" }], name: "Teal", lastWorn: true },
                recent: [{ textures: [{ id: "teal", url: "/t.png" }], name: "Teal", current: true }],
                companion: { id: "dog1", url: "/d.png", wearableHere: true },
            },
        });
        const mine = await adminApi.getWokaMine("uuid-1", roomUrl);
        expect(mine?.current?.reason).toBe("other_place");
        expect(mine?.recent).toHaveLength(1);
        expect(mocks.get).toHaveBeenCalledWith("http://admin.test/api/woka/mine", {
            headers: { Authorization: "token" },
            params: { roomUrl, uuid: "uuid-1" },
            timeout: 10_000,
        });
    });

    it("answers nothing when the admin says 404 (a guest or an unknown player)", async () => {
        setCapabilities({ "api/woka/mine": "v1" });
        mocks.get.mockRejectedValue(httpError(404));
        expect(await adminApi.getWokaMine("uuid-1", roomUrl)).toBeUndefined();
    });

    it("lets any other failure through, so the pusher can answer 502", async () => {
        setCapabilities({ "api/woka/mine": "v1" });
        mocks.get.mockRejectedValue(httpError(500));
        await expect(adminApi.getWokaMine("uuid-1", roomUrl)).rejects.toBeTruthy();
    });
});
