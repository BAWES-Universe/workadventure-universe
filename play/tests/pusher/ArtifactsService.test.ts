import { describe, expect, it, vi } from "vitest";
import type { AxiosResponse, InternalAxiosRequestConfig } from "axios";
import { AxiosError, AxiosHeaders } from "axios";
import { ArtifactsError, ArtifactsService } from "../../src/pusher/services/ArtifactsService";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({ ADMIN_API_URL: undefined, ADMIN_API_TOKEN: undefined }));

const ID = "11111111-1111-4111-8111-111111111111";
const viewer = { person: { signedIn: true, identifier: "uuid-alice" }, inChat: true };

const version = {
    number: 2,
    summary: "Bigger buttons",
    askedByName: "Alice",
    sizeBytes: 120,
    createdAt: "2026-10-26T10:00:00.000Z",
    url: "https://artifacts-dev.brick.vip/artifacts/x/v2-aa.html",
};
const opened = {
    artifact: {
        id: ID,
        title: "Quests board",
        kind: "app",
        makerName: "Scout",
        owner: { name: "Alice" },
        version: 2,
        openScope: "chat",
        changeScope: "owner",
        chatKind: "nearby",
        expiresAt: null,
        makerBotId: "bot1",
    },
    version,
    you: { owner: true, change: true, manage: true, copy: true },
};

function orbitError(status: number, data: unknown): AxiosError {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig;
    const response: AxiosResponse = { status, statusText: "", data, headers: {}, config };
    return new AxiosError(`Request failed with status code ${status}`, "ERR_BAD_REQUEST", config, {}, response);
}

describe("ArtifactsService", () => {
    it("is unavailable without an admin", async () => {
        const http = { put: vi.fn(), post: vi.fn() };
        const service = new ArtifactsService(undefined, undefined, http);
        expect(service.isEnabled()).toBe(false);
        await expect(service.open(ID, viewer)).rejects.toEqual(new ArtifactsError("artifacts_unavailable", 503));
        expect(http.post).not.toHaveBeenCalled();
    });

    it("opens an artifact as the viewer, with the admin token, and keeps only what the game uses", async () => {
        const http = { put: vi.fn(), post: vi.fn(() => Promise.resolve({ data: opened })) };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const answer = await service.open(ID, viewer, 2);
        expect(http.post).toHaveBeenCalledWith(
            `https://orbit.test/api/artifacts/${ID}/open`,
            { viewer, version: 2 },
            { headers: { Authorization: "secret" } }
        );
        expect(answer.version.url).toBe(version.url);
        expect(answer.you).toEqual({ owner: true, change: true, manage: true, copy: true });
        expect(answer.artifact).not.toHaveProperty("makerBotId");
    });

    it("lists the versions and reads the code of one", async () => {
        const http = {
            put: vi.fn(),
            post: vi.fn((url: string) =>
                Promise.resolve({
                    data: url.endsWith("/versions") ? { versions: [version] } : { version, content: "<h1>x</h1>" },
                })
            ),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        expect(await service.listVersions(ID, viewer)).toEqual([version]);
        expect(await service.readCode(ID, 2, viewer)).toEqual({ version, content: "<h1>x</h1>" });
        expect(http.post).toHaveBeenLastCalledWith(
            `https://orbit.test/api/artifacts/${ID}/versions/2`,
            { viewer },
            expect.anything()
        );
    });

    it("restores a version as the viewer and passes on a refusal for anyone but the owner", async () => {
        const http = {
            put: vi.fn(),
            post: vi.fn(() => Promise.resolve({ data: { ...opened, version: { ...version, number: 3 } } })),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const answer = await service.restore(ID, 1, viewer);
        expect(http.post).toHaveBeenCalledWith(
            `https://orbit.test/api/artifacts/${ID}/restore`,
            { viewer, number: 1 },
            { headers: { Authorization: "secret" } }
        );
        expect(answer.version.number).toBe(3);

        const refused = new ArtifactsService("https://orbit.test", "secret", {
            put: vi.fn(),
            post: vi.fn(() => Promise.reject(orbitError(403, { error: "not_owner", message: "Only its owner." }))),
        });
        await expect(refused.restore(ID, 1, viewer)).rejects.toEqual(new ArtifactsError("not_owner", 403));
    });

    it("shares as the viewer with a PUT, sending only what changes", async () => {
        const http = {
            post: vi.fn(),
            put: vi.fn(() => Promise.resolve({ data: { artifact: { ...opened.artifact, openScope: "link" } } })),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const answer = await service.share(ID, { openScope: "link" }, viewer);
        expect(http.put).toHaveBeenCalledWith(
            `https://orbit.test/api/artifacts/${ID}/share`,
            { viewer, openScope: "link" },
            { headers: { Authorization: "secret" } }
        );
        expect(http.post).not.toHaveBeenCalled();
        expect(answer.artifact.openScope).toBe("link");
    });

    it("passes Orbit's refusal on with its status and code", async () => {
        const http = {
            put: vi.fn(),
            post: vi.fn(() => Promise.reject(orbitError(404, { error: "not_found", message: "No such artifact." }))),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        await expect(service.open(ID, viewer)).rejects.toEqual(new ArtifactsError("not_found", 404));
    });

    it("does not pass on a server failure or an answer it cannot read as a refusal", async () => {
        const down = new ArtifactsService("https://orbit.test", "secret", {
            put: vi.fn(),
            post: vi.fn(() => Promise.reject(orbitError(500, "boom"))),
        });
        await expect(down.open(ID, viewer)).rejects.not.toBeInstanceOf(ArtifactsError);
        const odd = new ArtifactsService("https://orbit.test", "secret", {
            put: vi.fn(),
            post: vi.fn(() => Promise.resolve({ data: { nope: true } })),
        });
        await expect(odd.open(ID, viewer)).rejects.toThrow();
    });
});
