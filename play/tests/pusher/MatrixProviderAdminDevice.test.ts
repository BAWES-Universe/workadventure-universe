import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { post, instancePost, request, interceptorUse, create } = vi.hoisted(() => {
    const instancePost = vi.fn();
    const request = vi.fn();
    const interceptorUse = vi.fn();
    return {
        post: vi.fn(),
        instancePost,
        request,
        interceptorUse,
        create: vi.fn(() => ({
            post: instancePost,
            get: vi.fn(),
            request,
            interceptors: { response: { use: interceptorUse } },
        })),
    };
});

vi.mock("axios", () => ({
    default: { post, create, isAxiosError: (error: { isAxiosError?: boolean }) => error?.isAxiosError === true },
}));
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => ({
    MATRIX_ADMIN_USER: "admin",
    MATRIX_ADMIN_PASSWORD: "secret",
    MATRIX_API_URI: "http://matrix.test/",
    MATRIX_DOMAIN: "chat.test",
}));

const LOGIN_URL = "http://matrix.test/_matrix/client/r0/login";

function logins() {
    return post.mock.calls.filter(([url]) => url === LOGIN_URL);
}

describe("MatrixProvider admin sign-in", () => {
    beforeEach(() => {
        vi.resetModules();
        post.mockReset();
        let count = 0;
        post.mockImplementation(() => Promise.resolve({ status: 200, data: { access_token: `token-${++count}` } }));
        instancePost.mockReset().mockResolvedValue({ status: 200, data: {} });
        request.mockReset().mockResolvedValue({ status: 200, data: {} });
        interceptorUse.mockReset();
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("signs in once, with a device id of its own, even though two calls start together", async () => {
        await import("../../src/pusher/services/MatrixProvider");

        await vi.waitFor(() => expect(create.mock.calls.length).toBeGreaterThanOrEqual(2));

        expect(logins()).toHaveLength(1);
        expect(logins()[0][1]).toMatchObject({
            type: "m.login.password",
            user: "admin",
            device_id: expect.stringMatching(/^universe-pusher-.+/),
            initial_device_display_name: "Universe game server",
        });
    });

    it("signs in again once when Synapse refuses the token, and repeats the call with the new token", async () => {
        await import("../../src/pusher/services/MatrixProvider");
        await vi.waitFor(() => expect(interceptorUse).toHaveBeenCalled());
        const onRejected = interceptorUse.mock.calls[0][1] as (error: unknown) => Promise<unknown>;
        const config = { headers: { Authorization: "Bearer token-1" } };

        await onRejected({ isAxiosError: true, response: { status: 401 }, config });

        expect(logins()).toHaveLength(2);
        expect(request).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: "Bearer token-2" } }));

        // A second refusal of the same call is passed on, not retried again.
        const error = { isAxiosError: true, response: { status: 401 }, config };
        await expect(onRejected(error)).rejects.toBe(error);
        expect(logins()).toHaveLength(2);
    });

    it("passes other errors on without signing in again", async () => {
        await import("../../src/pusher/services/MatrixProvider");
        await vi.waitFor(() => expect(interceptorUse).toHaveBeenCalled());
        const onRejected = interceptorUse.mock.calls[0][1] as (error: unknown) => Promise<unknown>;
        const error = { isAxiosError: true, response: { status: 500 }, config: { headers: {} } };

        await expect(onRejected(error)).rejects.toBe(error);

        expect(logins()).toHaveLength(1);
    });
});
