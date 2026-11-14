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
    you: { owner: true, change: true, manage: true, copy: true, inChat: true },
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

    it("asks for a page's checkout and an order's state as the viewer, and keeps only what the window may know (game #2044)", async () => {
        const answer = {
            orderId: "o1",
            checkoutUrl: "https://checkout.tap.company/c1",
            app: "Tap",
            amount: "1.000",
            currency: "KWD",
            apiKey: "sk_live_never",
        };
        const http = { put: vi.fn(), post: vi.fn(() => Promise.resolve({ data: answer })) };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const started = await service.pay(ID, { start: true }, viewer);
        expect(http.post).toHaveBeenCalledWith(
            `https://orbit.test/api/artifacts/${ID}/pay`,
            { viewer, start: true },
            { headers: { Authorization: "secret" } }
        );
        expect(started).toEqual({ orderId: "o1", checkoutUrl: "https://checkout.tap.company/c1", app: "Tap" });
        http.post.mockResolvedValueOnce({ data: { status: "paid", checkoutUrl: null, testPayment: true } } as never);
        expect(await service.pay(ID, { order: "o1" }, viewer)).toEqual({ status: "paid", checkoutUrl: null, testPayment: true });
        http.post.mockRejectedValueOnce(orbitError(429, { error: "limit" }));
        await expect(service.pay(ID, { start: true }, viewer)).rejects.toEqual(new ArtifactsError("limit", 429));
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
        expect(answer.you).toEqual({ owner: true, change: true, manage: true, copy: true, inChat: true });
        expect(answer.artifact).not.toHaveProperty("makerBotId");
        // An address of the bucket's never stops: nothing to tell about its life
        expect(answer.version).not.toHaveProperty("urlLifeMs");
        expect(answer.version).not.toHaveProperty("urlHasMedia");
    });

    describe('a "Just you" artifact (game #1994)', () => {
        const NOW = Date.parse("2026-11-11T09:00:00.000Z");
        const privateUrl = "https://orbit.test/af/PASS/2/index.html";
        const song = { name: "song.mp3", contentType: "audio/mpeg", sizeBytes: 900 };
        const openedPrivately = (extra: Record<string, unknown>) => ({
            ...opened,
            artifact: { ...opened.artifact, openScope: "me" },
            version: { ...version, url: privateUrl, urlExpiresAt: "2026-11-11T21:00:00.000Z", ...extra },
        });
        const serviceAnswering = (data: unknown) =>
            new ArtifactsService(
                "https://orbit.test",
                "secret",
                { put: vi.fn(), post: vi.fn(() => Promise.resolve({ data })) },
                () => NOW
            );

        it("tells its owner how long the address of this one opening goes on working, as a length of time", async () => {
            const answer = await serviceAnswering(openedPrivately({ media: [] })).open(ID, viewer);
            expect(answer.artifact.openScope).toBe("me");
            expect(answer.version.url).toBe(privateUrl);
            expect(answer.version.urlLifeMs).toBe(12 * 60 * 60 * 1000);
            // The moment it stops is Orbit's clock; the browser's may be wrong, so it is not passed on
            expect(answer.version).not.toHaveProperty("urlExpiresAt");
            expect(answer.version).not.toHaveProperty("media");
            expect(answer.version).not.toHaveProperty("urlHasMedia");
        });

        it("says when songs, pictures or videos sit beside the page, which it may fetch at any moment", async () => {
            const answer = await serviceAnswering(openedPrivately({ media: [song] })).open(ID, viewer);
            expect(answer.version.urlLifeMs).toBe(12 * 60 * 60 * 1000);
            expect(answer.version.urlHasMedia).toBe(true);
            expect(answer.version).not.toHaveProperty("media");
        });

        it.each(["soon", "2026-11-11T09:00:00.000Z", "2026-11-10T09:00:00.000Z"])(
            "tells no life it cannot read, or one that is over already (%s)",
            async (urlExpiresAt) => {
                const answer = await serviceAnswering(openedPrivately({ urlExpiresAt, media: [song] })).open(
                    ID,
                    viewer
                );
                expect(answer.version.url).toBe(privateUrl);
                expect(answer.version).not.toHaveProperty("urlLifeMs");
                expect(answer.version).not.toHaveProperty("urlHasMedia");
            }
        );

        it("has no address anywhere but in that opening: a document, the list of versions, the code, a restore", async () => {
            const hidden = { ...version, url: null };
            const document = await serviceAnswering({ ...opened, version: hidden }).open(ID, viewer);
            expect(document.version.url).toBeNull();
            expect(document.version).not.toHaveProperty("urlLifeMs");

            expect(await serviceAnswering({ versions: [hidden] }).listVersions(ID, viewer)).toEqual([hidden]);
            expect(await serviceAnswering({ version: hidden, content: "<h1>x</h1>" }).readCode(ID, 2, viewer)).toEqual({
                version: hidden,
                content: "<h1>x</h1>",
            });
            const restored = await serviceAnswering({ ...opened, version: hidden }).restore(ID, 1, viewer);
            expect(restored.version.url).toBeNull();
        });

        it("asks Orbit for it as one more choice of who can open it", async () => {
            const http = {
                post: vi.fn(),
                put: vi.fn(() => Promise.resolve({ data: { artifact: { ...opened.artifact, openScope: "me" } } })),
            };
            const service = new ArtifactsService("https://orbit.test", "secret", http);
            const answer = await service.share(ID, { openScope: "me" }, viewer);
            expect(http.put).toHaveBeenCalledWith(
                `https://orbit.test/api/artifacts/${ID}/share`,
                { viewer, openScope: "me" },
                { headers: { Authorization: "secret" } }
            );
            expect(answer.artifact.openScope).toBe("me");
        });

        it("passes on that its owner keeps it private, for someone in the chat it was made in", async () => {
            const kept = orbitError(404, { error: "kept_private", message: "Its owner keeps this one private." });
            const service = new ArtifactsService("https://orbit.test", "secret", {
                put: vi.fn(),
                post: vi.fn(() => Promise.reject(kept)),
            });
            await expect(service.open(ID, viewer)).rejects.toEqual(new ArtifactsError("kept_private", 404));
        });

        it("passes on that Orbit cannot keep files private as it is set up, and no other breakdown", async () => {
            const off = new ArtifactsService("https://orbit.test", "secret", {
                post: vi.fn(),
                put: vi.fn(() => Promise.reject(orbitError(503, { error: "private_files_not_configured" }))),
            });
            await expect(off.share(ID, { openScope: "me" }, viewer)).rejects.toEqual(
                new ArtifactsError("private_files_not_configured", 503)
            );
            const down = new ArtifactsService("https://orbit.test", "secret", {
                post: vi.fn(),
                put: vi.fn(() => Promise.reject(orbitError(503, { error: "database_down" }))),
            });
            await expect(down.share(ID, { openScope: "me" }, viewer)).rejects.not.toBeInstanceOf(ArtifactsError);
        });
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

    it("lists a chat's artifacts a page at a time, as the viewer, and keeps whether each is theirs", async () => {
        const row = { ...opened.artifact, yours: false, updatedAt: "2026-10-28T09:00:00.000Z" };
        const http = {
            put: vi.fn(),
            post: vi.fn(() => Promise.resolve({ data: { artifacts: [row], total: 51, next: 50 } })),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const chat = { kind: "dm" as const, ref: "!room:chat.example" };
        const answer = await service.listInChat({ ...viewer, inChat: false, chat }, 50);
        expect(http.post).toHaveBeenCalledWith(
            "https://orbit.test/api/artifacts/chat",
            { viewer: { ...viewer, inChat: false, chat }, offset: 50 },
            { headers: { Authorization: "secret" } }
        );
        expect(answer.total).toBe(51);
        expect(answer.next).toBe(50);
        expect(answer.artifacts[0]).toMatchObject({ id: ID, yours: false, updatedAt: row.updatedAt });
        expect(answer.artifacts[0]).not.toHaveProperty("makerBotId");
    });

    it("lists every artifact the person owns a page at a time, naming only the person", async () => {
        const row = { ...opened.artifact, updatedAt: "2026-10-28T09:00:00.000Z" };
        const http = {
            put: vi.fn(),
            post: vi.fn(() => Promise.resolve({ data: { artifacts: [row], total: 51, next: 50 } })),
        };
        const service = new ArtifactsService("https://orbit.test", "secret", http);
        const answer = await service.listOwned(viewer.person, 50);
        expect(http.post).toHaveBeenCalledWith(
            "https://orbit.test/api/artifacts/owned",
            { person: viewer.person, offset: 50 },
            { headers: { Authorization: "secret" } }
        );
        expect(answer).toMatchObject({ total: 51, next: 50 });
        expect(answer.artifacts[0]).toMatchObject({ id: ID, makerName: "Scout", updatedAt: row.updatedAt });
        expect(answer.artifacts[0]).not.toHaveProperty("makerBotId");
    });
});
