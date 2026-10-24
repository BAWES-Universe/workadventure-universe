import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { post, instancePost, create } = vi.hoisted(() => {
    const instancePost = vi.fn();
    return { post: vi.fn(), instancePost, create: vi.fn(() => ({ post: instancePost, get: vi.fn() })) };
});

vi.mock("axios", () => ({ default: { post, create } }));

const OVERRIDE_PATH = "override_ratelimit";

async function startProvider(matrixDomain: string | undefined) {
    vi.resetModules();
    vi.doMock("../../src/pusher/enums/EnvironmentVariable", () => ({
        MATRIX_ADMIN_USER: "admin",
        MATRIX_ADMIN_PASSWORD: "secret",
        MATRIX_API_URI: "http://matrix.test/",
        MATRIX_DOMAIN: matrixDomain,
    }));
    await import("../../src/pusher/services/MatrixProvider");
}

describe("MatrixProvider admin rate limit", () => {
    beforeEach(() => {
        post.mockReset().mockResolvedValue({ status: 200, data: { access_token: "token" } });
        instancePost.mockReset().mockResolvedValue({ status: 200, data: {} });
        vi.spyOn(console, "info").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("does not call Synapse with an id ending in :undefined when the domain is missing", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await startProvider(undefined);

        await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining("MATRIX_DOMAIN is not set")));
        const overrideCalls = instancePost.mock.calls.filter(([url]) => String(url).includes(OVERRIDE_PATH));
        expect(overrideCalls).toEqual([]);
    });

    it("lifts the rate limit of the admin account when the domain is set", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await startProvider("chat.test");

        await vi.waitFor(() =>
            expect(instancePost).toHaveBeenCalledWith("_synapse/admin/v1/users/@admin:chat.test/override_ratelimit", {
                message_per_second: 0,
                burst_count: 0,
            })
        );
        expect(warn).not.toHaveBeenCalled();
    });
});
