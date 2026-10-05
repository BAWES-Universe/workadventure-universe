import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "matrix-js-sdk";
import { MAX_KEPT_MEDIA, holdMatrixMedia, resolveMatrixMediaUrl } from "../MatrixMedia";

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

    it("a late failure of a released file's old fetch keeps the new one", async () => {
        let failFirst: (error: Error) => void = () => undefined;
        fetchMock.mockImplementationOnce(
            () =>
                new Promise((_, reject) => {
                    failFirst = reject;
                })
        );
        fetchMock.mockImplementation(() => Promise.resolve(new Response(new Blob(["png"]), { status: 200 })));
        URL.createObjectURL = vi.fn(() => "blob:https://play.test/late");
        URL.revokeObjectURL = vi.fn();
        const client = fakeClient();

        const first = resolveMatrixMediaUrl(client, "mxc://matrix.test/late");
        await Promise.all(
            Array.from({ length: MAX_KEPT_MEDIA }, (_, i) =>
                resolveMatrixMediaUrl(client, `mxc://matrix.test/late-${i}`)
            )
        );
        // Released and shown again: a second fetch replaces the first.
        const hold = holdMatrixMedia(client, "mxc://matrix.test/late");
        await hold.url;
        failFirst(new TypeError("Failed to fetch"));
        await first;

        fetchMock.mockClear();
        await resolveMatrixMediaUrl(client, "mxc://matrix.test/late");
        expect(fetchMock).not.toHaveBeenCalled();
        hold.release();
    });
});

describe("holdMatrixMedia with an encrypted file", () => {
    const fetchMock = vi.fn();

    beforeEach(() => vi.stubGlobal("fetch", fetchMock));
    afterEach(() => {
        fetchMock.mockReset();
        vi.unstubAllGlobals();
    });

    function toBase64(bytes: ArrayBuffer | Uint8Array): string {
        return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=+$/, "");
    }

    /** Encrypts like Element does for an attachment in an encrypted chat. */
    async function encryptLikeElement(text: string, mxcUrl: string) {
        const key = await crypto.subtle.generateKey({ name: "AES-CTR", length: 256 }, true, ["encrypt", "decrypt"]);
        const iv = new Uint8Array(16);
        crypto.getRandomValues(iv.subarray(0, 8));
        const ciphertext = await crypto.subtle.encrypt(
            { name: "AES-CTR", counter: iv, length: 64 },
            key,
            new TextEncoder().encode(text)
        );
        const jwk = await crypto.subtle.exportKey("jwk", key);
        const sha256 = toBase64(await crypto.subtle.digest("SHA-256", ciphertext));
        return {
            ciphertext,
            file: { url: mxcUrl, key: { ...jwk, k: jwk.k ?? "" }, iv: toBase64(iv), hashes: { sha256 }, v: "v2" },
        };
    }

    it("downloads and decrypts it", async () => {
        const { ciphertext, file } = await encryptLikeElement("hello photo", "mxc://matrix.test/encrypted");
        fetchMock.mockResolvedValue(new Response(ciphertext, { status: 200 }));
        let shown: Blob | undefined;
        URL.createObjectURL = vi.fn((blob: Blob) => {
            shown = blob;
            return "blob:https://play.test/decrypted";
        });

        const hold = holdMatrixMedia(fakeClient(), file, "image/png");

        expect(await hold.url).toBe("blob:https://play.test/decrypted");
        expect(fetchMock).toHaveBeenCalledWith(
            "https://matrix.test/_matrix/client/v1/media/download/matrix.test/encrypted",
            { headers: { Authorization: "Bearer token" } }
        );
        expect(shown?.type).toBe("image/png");
        // jsdom's Blob has no text(): read it with a FileReader.
        const text = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
            reader.readAsText(shown as Blob);
        });
        expect(text).toBe("hello photo");
        hold.release();
    });

    it("doesn't show a file that doesn't match its hash", async () => {
        const { file } = await encryptLikeElement("hello", "mxc://matrix.test/tampered");
        fetchMock.mockResolvedValue(new Response(new TextEncoder().encode("not the same"), { status: 200 }));
        const createObjectURL = vi.fn(() => "blob:https://play.test/tampered");
        URL.createObjectURL = createObjectURL;

        expect(await resolveMatrixMediaUrl(fakeClient(), file)).toBeUndefined();
        expect(createObjectURL).not.toHaveBeenCalled();
    });
});
