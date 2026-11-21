import { describe, expect, it, vi } from "vitest";
import {
    IDENTITY_REPLY_TYPE,
    IDENTITY_REQUEST_TYPE,
    StudentHubIdentityListener,
    parseIdentityRequest,
    type MessageTarget,
} from "../StudentHubIdentityListener";

const EMBED_ORIGIN = "https://studenthub.bawes.net";
const CHALLENGE = "c".repeat(43);

class FakeTarget implements MessageTarget {
    listener: ((event: MessageEvent) => void) | undefined;
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
        this.listener = listener;
    }
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
        if (this.listener === listener) this.listener = undefined;
    }
    send(event: { source: unknown; origin: string; data: unknown }) {
        this.listener?.(event as unknown as MessageEvent);
    }
}

function fakeIframe() {
    const contentWindow = { postMessage: vi.fn() };
    return { iframe: { contentWindow } as unknown as HTMLIFrameElement, contentWindow };
}

const request = (challenge = CHALLENGE) => ({ type: IDENTITY_REQUEST_TYPE, v: 1, challenge });
const flush = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

function setup(attestation: string | undefined = "bawes-aa.v1.payload.signature") {
    // Called as setup(undefined) the default applies; "none" stands for "the pusher gave nothing".
    const target = new FakeTarget();
    const attest = vi.fn((challenge: string) => {
        void challenge;
        return Promise.resolve(attestation === "none" ? undefined : attestation);
    });
    const listener = new StudentHubIdentityListener(EMBED_ORIGIN, attest, target);
    return { target, attest, listener };
}

describe("StudentHub identity listener", () => {
    it("answers the registered StudentHub window, from the embed origin, with targetOrigin = the embed origin", async () => {
        const { target, attest, listener } = setup();
        const { iframe, contentWindow } = fakeIframe();
        listener.register(iframe);

        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request() });
        await flush();

        expect(attest).toHaveBeenCalledWith(CHALLENGE);
        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            { type: IDENTITY_REPLY_TYPE, v: 1, attestation: "bawes-aa.v1.payload.signature" },
            { targetOrigin: EMBED_ORIGIN }
        );
    });

    it("ignores a message from a window it did not register (another iframe, a popup, the game itself)", async () => {
        const { target, attest, listener } = setup();
        const registered = fakeIframe();
        const other = fakeIframe();
        listener.register(registered.iframe);

        target.send({ source: other.contentWindow, origin: EMBED_ORIGIN, data: request() });
        target.send({ source: null, origin: EMBED_ORIGIN, data: request() });
        await flush();

        expect(attest).not.toHaveBeenCalled();
        expect(other.contentWindow.postMessage).not.toHaveBeenCalled();
        expect(registered.contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("ignores the registered window when its origin is not the embed origin (it navigated elsewhere)", async () => {
        const { target, attest, listener } = setup();
        const { iframe, contentWindow } = fakeIframe();
        listener.register(iframe);

        for (const origin of [
            "https://evil.bawes.net",
            "https://staging.studenthub.co",
            "http://studenthub.bawes.net",
            "null",
        ]) {
            target.send({ source: contentWindow, origin, data: request() });
        }
        await flush();

        expect(attest).not.toHaveBeenCalled();
    });

    it("listens to nothing before an iframe is registered, and after it is closed", async () => {
        const { target, attest, listener } = setup();
        const { iframe, contentWindow } = fakeIframe();
        expect(target.listener).toBeUndefined();

        listener.register(iframe);
        listener.unregister(iframe);
        expect(target.listener).toBeUndefined();
        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request() });
        await flush();

        expect(attest).not.toHaveBeenCalled();
    });

    it("drops an answer still on its way when StudentHub is closed (logout, account switch, reconnect)", async () => {
        const target = new FakeTarget();
        let resolve!: (value: string) => void;
        const attest = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolve = r;
                })
        );
        const listener = new StudentHubIdentityListener(EMBED_ORIGIN, attest, target);
        const { iframe, contentWindow } = fakeIframe();
        listener.register(iframe);

        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request() });
        listener.reset();
        resolve("bawes-aa.v1.late.attestation");
        await flush();

        expect(contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("answers only the newest request (StudentHub keeps only its newest challenge)", async () => {
        const target = new FakeTarget();
        const resolvers: Array<(value: string) => void> = [];
        const attest = vi.fn(
            () =>
                new Promise<string>((r) => {
                    resolvers.push(r);
                })
        );
        const listener = new StudentHubIdentityListener(EMBED_ORIGIN, attest, target);
        const { iframe, contentWindow } = fakeIframe();
        listener.register(iframe);

        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request("a".repeat(43)) });
        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request("b".repeat(43)) });
        resolvers[1]("second");
        resolvers[0]("first");
        await flush();

        expect(contentWindow.postMessage).toHaveBeenCalledTimes(1);
        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            { type: IDENTITY_REPLY_TYPE, v: 1, attestation: "second" },
            { targetOrigin: EMBED_ORIGIN }
        );
    });

    it("sends nothing when the pusher gives no attestation (guest, refused provider, mismatch)", async () => {
        const { target, listener } = setup("none");
        const { iframe, contentWindow } = fakeIframe();
        listener.register(iframe);

        target.send({ source: contentWindow, origin: EMBED_ORIGIN, data: request() });
        await flush();

        expect(contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("an older iframe's removal does not forget a newer one", () => {
        const { listener } = setup();
        const first = fakeIframe();
        const second = fakeIframe();
        listener.register(first.iframe);
        listener.register(second.iframe);
        listener.unregister(first.iframe);
        expect(listener.isRegistered()).toBe(true);
    });
});

describe("the closed request schema", () => {
    it("accepts exactly { type, v: 1, challenge }", () => {
        expect(parseIdentityRequest(request())).toBe(CHALLENGE);
    });

    it.each([
        ["a string", JSON.stringify(request())],
        ["null", null],
        ["an array", [request()]],
        ["an extra key", { ...request(), subject: "someone@example.com" }],
        ["a missing challenge", { type: IDENTITY_REQUEST_TYPE, v: 1 }],
        ["another type", { ...request(), type: "studenthub.embed.identity" }],
        ["another version", { ...request(), v: 2 }],
        ["a version as text", { ...request(), v: "1" }],
        ["a short challenge", request("abc")],
        ["a challenge with a dot", request(`${"c".repeat(42)}.`)],
        ["a generic iframe-bus query", { id: 1, query: { type: "getState", data: undefined } }],
    ])("refuses %s", (_name, data) => {
        expect(parseIdentityRequest(data)).toBeUndefined();
    });

    it("refuses an object with another prototype", () => {
        const data = Object.assign(Object.create({ inherited: true }) as object, request());
        expect(parseIdentityRequest(data)).toBeUndefined();
    });
});
