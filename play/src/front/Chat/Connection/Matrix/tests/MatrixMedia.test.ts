import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { get } from "svelte/store";
import { MAX_KEPT_MEDIA, holdMatrixMedia, matrixAvatarStore, resolveMatrixMediaUrl } from "../MatrixMedia";

function fakeClient(accessToken: string | null = "token"): MatrixClient {
    return {
        getAccessToken: () => accessToken,
        mxcUrlToHttp: (
            mxc: string,
            width?: number,
            _h?: number,
            _m?: string,
            _direct?: boolean,
            _redirects?: boolean,
            useAuthentication?: boolean
        ) => {
            const kind = width ? `thumbnail` : `download`;
            const size = width ? `?width=${width}` : "";
            return useAuthentication
                ? `https://matrix.test/_matrix/client/v1/media/${kind}/${mxc.slice(6)}${size}`
                : `https://matrix.test/_matrix/media/v3/${kind}/${mxc.slice(6)}${size}`;
        },
    } as unknown as MatrixClient;
}

describe("resolveMatrixMediaUrl", () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/1234");
    });

    afterEach(() => {
        fetchMock.mockReset();
        vi.unstubAllGlobals();
    });

    it("downloads with the access token and returns a blob URL", async () => {
        fetchMock.mockResolvedValue(new Response(new Blob(["png"]), { status: 200 }));

        const url = await resolveMatrixMediaUrl(fakeClient(), "mxc://matrix.test/withToken");

        expect(url).toBe("blob:https://play.test/1234");
        expect(fetchMock).toHaveBeenCalledWith(
            "https://matrix.test/_matrix/client/v1/media/download/matrix.test/withToken",
            { headers: { Authorization: "Bearer token" } }
        );
    });

    it("downloads each file once", async () => {
        fetchMock.mockResolvedValue(new Response(new Blob(["png"]), { status: 200 }));
        const client = fakeClient();

        await resolveMatrixMediaUrl(client, "mxc://matrix.test/once");
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/once");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the legacy URL on servers without authenticated media", async () => {
        fetchMock.mockResolvedValue(new Response("", { status: 404 }));

        expect(await resolveMatrixMediaUrl(fakeClient(), "mxc://matrix.test/oldServer")).toBe(
            "https://matrix.test/_matrix/media/v3/download/matrix.test/oldServer"
        );
    });

    it("retries after a network error", async () => {
        fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
        fetchMock.mockResolvedValueOnce(new Response(new Blob(["png"]), { status: 200 }));
        const client = fakeClient();

        expect(await resolveMatrixMediaUrl(client, "mxc://matrix.test/blip")).toBe(
            "https://matrix.test/_matrix/media/v3/download/matrix.test/blip"
        );
        expect(await resolveMatrixMediaUrl(client, "mxc://matrix.test/blip")).toBe("blob:https://play.test/1234");
    });

    it("retries after a server error", async () => {
        fetchMock.mockResolvedValueOnce(new Response("", { status: 502 }));
        fetchMock.mockResolvedValueOnce(new Response(new Blob(["png"]), { status: 200 }));
        const client = fakeClient();

        expect(await resolveMatrixMediaUrl(client, "mxc://matrix.test/serverError")).toBe(
            "https://matrix.test/_matrix/media/v3/download/matrix.test/serverError"
        );
        expect(await resolveMatrixMediaUrl(client, "mxc://matrix.test/serverError")).toBe(
            "blob:https://play.test/1234"
        );
    });

    it("asks a server without authenticated media only once", async () => {
        fetchMock.mockResolvedValue(new Response("", { status: 404 }));
        const client = fakeClient();

        await resolveMatrixMediaUrl(client, "mxc://matrix.test/oldServerOnce");
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/oldServerOnce");

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("ignores anything that isn't an mxc URL", async () => {
        expect(await resolveMatrixMediaUrl(fakeClient(), undefined)).toBeUndefined();
        expect(await resolveMatrixMediaUrl(fakeClient(), "https://example.com/a.png")).toBeUndefined();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses the legacy URL when there is no access token", async () => {
        expect(await resolveMatrixMediaUrl(fakeClient(null), "mxc://matrix.test/guest")).toBe(
            "https://matrix.test/_matrix/media/v3/download/matrix.test/guest"
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("asks for a thumbnail when a size is given, cached apart from the full file", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        const client = fakeClient();

        await resolveMatrixMediaUrl(client, "mxc://matrix.test/avatar", 48);
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/avatar");

        expect(fetchMock).toHaveBeenNthCalledWith(
            1,
            "https://matrix.test/_matrix/client/v1/media/thumbnail/matrix.test/avatar?width=48",
            { headers: { Authorization: "Bearer token" } }
        );
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("releases the oldest files and fetches them again when shown later", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        let created = 0;
        URL.createObjectURL = vi.fn(() => `blob:https://play.test/lru-${created++}`);
        const revoke = vi.fn();
        URL.revokeObjectURL = revoke;
        const client = fakeClient();

        const first = await resolveMatrixMediaUrl(client, "mxc://matrix.test/lru-first");
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/lru-${i}`)
            )
        );
        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith(first));

        fetchMock.mockClear();
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/lru-first");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("keeps a file that was shown again recently", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        URL.revokeObjectURL = vi.fn();
        const client = fakeClient();

        // The cache is updated as each call is made, so the order of the calls is what counts.
        const shown = [resolveMatrixMediaUrl(client, "mxc://matrix.test/recent-kept")];
        for (let i = 0; i < MAX_KEPT_MEDIA; i++) {
            shown.push(resolveMatrixMediaUrl(client, `mxc://matrix.test/recent-${i}`));
            shown.push(resolveMatrixMediaUrl(client, "mxc://matrix.test/recent-kept"));
        }
        await Promise.all(shown);

        fetchMock.mockClear();
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/recent-kept");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps profile pictures however many files are shown", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        URL.revokeObjectURL = vi.fn();
        const client = fakeClient();

        await resolveMatrixMediaUrl(client, "mxc://matrix.test/picture-kept", 48);
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA + 1 }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/many-${i}`)
            )
        );

        fetchMock.mockClear();
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/picture-kept", 48);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("never releases a file that is still shown", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/held");
        const revoke = vi.fn();
        URL.revokeObjectURL = revoke;
        const client = fakeClient();

        const hold = holdMatrixMedia(client, "mxc://matrix.test/held");
        await hold.url;
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/other");
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA + 5 }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/held-other-${i}`)
            )
        );
        await Promise.resolve();
        expect(revoke).not.toHaveBeenCalledWith("blob:https://play.test/held");

        fetchMock.mockClear();
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/held");
        expect(fetchMock).not.toHaveBeenCalled();
        hold.release();
    });

    it("releases a file once it is no longer shown and the limit is reached", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/let-go");
        const revoke = vi.fn();
        URL.revokeObjectURL = revoke;
        const client = fakeClient();

        const hold = holdMatrixMedia(client, "mxc://matrix.test/let-go");
        await hold.url;
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/other");
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/let-go-other-${i}`)
            )
        );
        hold.release();
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/let-go-later-${i}`)
            )
        );

        await vi.waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:https://play.test/let-go"));
    });
});

describe("matrixAvatarStore", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("shows a profile picture once it's fetched with the access token", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Blob(["png"]), { status: 200 })));
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/avatar");
        const store = matrixAvatarStore(fakeClient(), "mxc://matrix.test/profile", 96);

        const values: (string | undefined)[] = [];
        const unsubscribe = store.subscribe((value) => values.push(value));
        await vi.waitFor(() => expect(values).toContain("blob:https://play.test/avatar"));
        unsubscribe();

        expect(values[0]).toBeUndefined();
    });

    it("stays empty without a picture", () => {
        expect(get(matrixAvatarStore(fakeClient(), undefined, 24))).toBeUndefined();
    });
});
