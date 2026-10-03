import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { resolveMatrixMediaUrl } from "../MatrixMedia";

function fakeClient(accessToken: string | null = "token"): MatrixClient {
    return {
        getAccessToken: () => accessToken,
        mxcUrlToHttp: (
            mxc: string,
            _w?: number,
            _h?: number,
            _m?: string,
            _direct?: boolean,
            _redirects?: boolean,
            useAuthentication?: boolean
        ) =>
            useAuthentication
                ? `https://matrix.test/_matrix/client/v1/media/download/${mxc.slice(6)}`
                : `https://matrix.test/_matrix/media/v3/download/${mxc.slice(6)}`,
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
});
