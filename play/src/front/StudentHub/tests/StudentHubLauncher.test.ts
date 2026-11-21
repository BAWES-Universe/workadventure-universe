import { describe, expect, it, vi } from "vitest";
import { StudentHubLauncher, playerOfToken, type CoWebsiteIframeHooks } from "../StudentHubLauncher";
import { IDENTITY_REQUEST_TYPE, type MessageTarget } from "../StudentHubIdentityListener";

const EMBED_ORIGIN = "https://studenthub.bawes.net";
const CHALLENGE = "c".repeat(43);

function gameToken(identifier: string, extra: Record<string, unknown> = {}): string {
    const payload = btoa(JSON.stringify({ identifier, ...extra }))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

class FakeTarget implements MessageTarget {
    listener: ((event: MessageEvent) => void) | undefined;
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
        this.listener = listener;
    }
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
        if (this.listener === listener) this.listener = undefined;
    }
}

function setup(
    options: { embedOrigin?: string; studentHubUrl?: string; token?: string | null; logged?: boolean } = {}
) {
    let token: string | null = options.token === undefined ? gameToken("player@example.com") : options.token;
    let open = false;
    let hooks: CoWebsiteIframeHooks | undefined;
    const contentWindow = { postMessage: vi.fn() };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;
    const target = new FakeTarget();
    const deps = {
        studentHubUrl: options.studentHubUrl,
        embedOrigin: "embedOrigin" in options ? options.embedOrigin : EMBED_ORIGIN,
        pusherUrl: "https://play.bawes.net/",
        getAuthToken: () => token,
        setAuthToken: vi.fn((value: string) => {
            token = value;
        }),
        isLogged: () => options.logged ?? true,
        openCoWebsite: vi.fn((url: URL, onIframe: CoWebsiteIframeHooks) => {
            void url;
            open = true;
            hooks = onIframe;
            // The window shows the item: its iframe is put on the page.
            onIframe.mounted(iframe);
            return {
                close: () => {
                    open = false;
                    hooks?.unmounted(iframe);
                },
                isOpen: () => open,
            };
        }),
        openTab: vi.fn(),
        fetch: vi.fn(),
        messageTarget: target,
    };
    const launcher = new StudentHubLauncher(deps);
    return {
        launcher,
        deps,
        target,
        contentWindow,
        isOpen: () => open,
        setToken: (value: string | null) => {
            token = value;
        },
        ask: () =>
            target.listener?.({
                source: contentWindow,
                origin: EMBED_ORIGIN,
                data: { type: IDENTITY_REQUEST_TYPE, v: 1, challenge: CHALLENGE },
            } as unknown as MessageEvent),
    };
}

const flush = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

function okResponse(body: unknown) {
    return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

describe("StudentHub launcher", () => {
    it("opens /universe/embed inside Universe when the embed is on, with no credential in the URL", () => {
        const { launcher, deps } = setup();
        launcher.launch();
        expect(deps.openCoWebsite).toHaveBeenCalledTimes(1);
        const url = deps.openCoWebsite.mock.calls[0][0];
        expect(url.toString()).toBe("https://studenthub.bawes.net/universe/embed");
        expect(deps.openTab).not.toHaveBeenCalled();
    });

    it("opens StudentHub top-level in a new tab when the embed configuration is absent", () => {
        const { launcher, deps } = setup({ embedOrigin: undefined, studentHubUrl: "https://staging.studenthub.co/" });
        expect(launcher.isAvailable()).toBe(true);
        expect(launcher.isEmbedded()).toBe(false);
        launcher.launch();
        expect(deps.openTab).toHaveBeenCalledWith("https://staging.studenthub.co/");
        expect(deps.openCoWebsite).not.toHaveBeenCalled();
    });

    it("is not offered with no StudentHub configuration at all", () => {
        const { launcher, deps } = setup({ embedOrigin: undefined });
        expect(launcher.isAvailable()).toBe(false);
        launcher.launch();
        expect(deps.openTab).not.toHaveBeenCalled();
        expect(deps.openCoWebsite).not.toHaveBeenCalled();
    });

    it("does not open a second StudentHub while one is open", () => {
        const { launcher, deps } = setup();
        launcher.launch();
        launcher.launch();
        expect(deps.openCoWebsite).toHaveBeenCalledTimes(1);
    });

    it("passes the attestation for StudentHub's challenge from the pusher to the StudentHub iframe", async () => {
        const { launcher, deps, contentWindow, ask } = setup();
        deps.fetch.mockResolvedValue(okResponse({ attestation: "bawes-aa.v1.p.s" }));
        launcher.launch();

        ask();
        await flush();
        await flush();

        const [url, init] = deps.fetch.mock.calls[0] as [URL, RequestInit];
        expect(url.toString()).toBe("https://play.bawes.net/studenthub/embed/attestation");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ challenge: CHALLENGE });
        expect(contentWindow.postMessage).toHaveBeenCalledWith(
            { type: "studenthub.embed.identity", v: 1, attestation: "bawes-aa.v1.p.s" },
            { targetOrigin: EMBED_ORIGIN }
        );
    });

    it("keeps the renewed game token the pusher returns, only for the same player", async () => {
        const { launcher, deps, ask } = setup();
        deps.fetch.mockResolvedValue(
            okResponse({ attestation: "a.b.c.d", authToken: gameToken("player@example.com", { accessToken: "x" }) })
        );
        launcher.launch();
        ask();
        await flush();
        await flush();
        expect(deps.setAuthToken).toHaveBeenCalledTimes(1);

        deps.setAuthToken.mockClear();
        deps.fetch.mockResolvedValue(
            okResponse({ attestation: "a.b.c.d", authToken: gameToken("someone@example.com") })
        );
        ask();
        await flush();
        await flush();
        expect(deps.setAuthToken).not.toHaveBeenCalled();
    });

    it("asks the pusher nothing for a guest", async () => {
        const { launcher, deps, contentWindow, ask } = setup({ logged: false, token: gameToken("4f0c-guest") });
        launcher.launch();
        ask();
        await flush();
        expect(deps.fetch).not.toHaveBeenCalled();
        expect(contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("sends nothing when the pusher refuses (stale token, revoked provider, mismatch)", async () => {
        const { launcher, deps, contentWindow, ask } = setup();
        deps.fetch.mockResolvedValue({ ok: false, json: () => Promise.resolve({ error: "provider_refused" }) });
        launcher.launch();
        ask();
        await flush();
        await flush();
        expect(contentWindow.postMessage).not.toHaveBeenCalled();
    });

    it("closes StudentHub on logout and stops answering", () => {
        const { launcher, deps, target, isOpen } = setup();
        launcher.launch();
        launcher.authTokenChanged(null);
        expect(isOpen()).toBe(false);
        expect(target.listener).toBeUndefined();
        expect(deps.fetch).not.toHaveBeenCalled();
    });

    it("closes StudentHub on an account switch (another player's token), here or in another tab", () => {
        const { launcher, isOpen } = setup();
        launcher.launch();
        launcher.authTokenChanged(gameToken("someone@example.com"));
        expect(isOpen()).toBe(false);
    });

    it("stays open when the same player's token is renewed", () => {
        const { launcher, isOpen } = setup();
        launcher.launch();
        launcher.authTokenChanged(gameToken("player@example.com", { accessToken: "renewed" }));
        expect(isOpen()).toBe(true);
    });

    it("closes StudentHub on a reconnect", () => {
        const { launcher, target, isOpen } = setup();
        launcher.launch();
        launcher.close("reconnect");
        expect(isOpen()).toBe(false);
        expect(target.listener).toBeUndefined();
    });

    it("does not attest for a player other than the one who opened StudentHub", async () => {
        const { launcher, deps, ask, setToken } = setup();
        launcher.launch();
        // The token changed without the change being reported (as if a listener were missed).
        setToken(gameToken("someone@example.com"));
        ask();
        await flush();
        expect(deps.fetch).not.toHaveBeenCalled();
    });
});

describe("playerOfToken", () => {
    it("reads the identifier claim", () => {
        expect(playerOfToken(gameToken("player@example.com"))).toBe("player@example.com");
    });
    it.each([null, "", "not-a-jwt", "a.%%%.c", `a.${btoa("[]")}.c`])("gives nothing for %s", (token) => {
        expect(playerOfToken(token)).toBeUndefined();
    });
});
