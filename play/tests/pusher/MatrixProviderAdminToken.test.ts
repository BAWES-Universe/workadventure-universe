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
        create: vi.fn((_config: unknown) => ({
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
    MATRIX_ADMIN_TOKEN: "device-less-token",
    MATRIX_API_URI: "http://matrix.test/",
    MATRIX_DOMAIN: "chat.test",
}));

const LOGIN_URL = "http://matrix.test/_matrix/client/r0/login";

function logins() {
    return post.mock.calls.filter(([url]) => url === LOGIN_URL);
}

function authorizationsUsed(): unknown[] {
    return create.mock.calls.map(
        ([config]) => (config as { headers: { Authorization: string } }).headers.Authorization
    );
}

describe("MatrixProvider admin sign-in with MATRIX_ADMIN_TOKEN", () => {
    beforeEach(() => {
        vi.resetModules();
        post.mockReset();
        post.mockImplementation(() => Promise.resolve({ status: 200, data: { access_token: "password-token" } }));
        create.mockClear();
        instancePost.mockReset().mockResolvedValue({ status: 200, data: {} });
        request.mockReset().mockResolvedValue({ status: 200, data: {} });
        interceptorUse.mockReset();
        vi.spyOn(console, "info").mockImplementation(() => undefined);
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("uses the token and never signs in, so no device is added", async () => {
        await import("../../src/pusher/services/MatrixProvider");

        await vi.waitFor(() => expect(create.mock.calls.length).toBeGreaterThanOrEqual(2));

        expect(logins()).toHaveLength(0);
        expect(new Set(authorizationsUsed())).toEqual(new Set(["Bearer device-less-token"]));
    });

    it("signs in with the password once when Synapse refuses the token, and keeps using that sign-in", async () => {
        await import("../../src/pusher/services/MatrixProvider");
        await vi.waitFor(() => expect(interceptorUse).toHaveBeenCalled());
        const onRejected = interceptorUse.mock.calls[0][1] as (error: unknown) => Promise<unknown>;
        const config = { headers: { Authorization: "Bearer device-less-token" } };

        await onRejected({ isAxiosError: true, response: { status: 401 }, config });

        expect(logins()).toHaveLength(1);
        expect(logins()[0][1]).toMatchObject({
            type: "m.login.password",
            user: "admin",
            device_id: expect.stringMatching(/^universe-pusher-.+/),
        });
        expect(request).toHaveBeenCalledWith(
            expect.objectContaining({ headers: { Authorization: "Bearer password-token" } })
        );

        // The refused token is not tried again: the next call is made with the signed-in token.
        create.mockClear();
        const { matrixProvider } = await import("../../src/pusher/services/MatrixProvider");
        await matrixProvider.createRoomForArea();
        expect(authorizationsUsed()).toEqual(["Bearer password-token"]);
        expect(logins()).toHaveLength(1);
    });

    it("never writes the token to the log", async () => {
        await import("../../src/pusher/services/MatrixProvider");
        await vi.waitFor(() => expect(interceptorUse).toHaveBeenCalled());
        const onRejected = interceptorUse.mock.calls[0][1] as (error: unknown) => Promise<unknown>;

        await onRejected({
            isAxiosError: true,
            response: { status: 401 },
            config: { headers: { Authorization: "Bearer device-less-token" } },
        });

        const logged = [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.info).mock.calls].flat().join(" ");
        expect(logged).not.toContain("device-less-token");
    });
});
