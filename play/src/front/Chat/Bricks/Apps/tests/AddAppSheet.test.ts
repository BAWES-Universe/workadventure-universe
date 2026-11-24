import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
    (window as unknown as { env: Record<string, unknown> }).env = {};
    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const game = vi.hoisted(() => ({
    getMyApps: vi.fn<() => Promise<unknown>>(),
    discoverMcpOAuthEndpoints: vi.fn<(url: string, callback: string, signal?: AbortSignal) => Promise<unknown>>(),
    addMyApp: vi.fn<(app: unknown) => Promise<unknown>>(),
    getMyAppThings: vi.fn<(id: string) => Promise<unknown>>(),
    disconnectMyApp: vi.fn<(id: string) => Promise<unknown>>(),
    reconnect: vi.fn<(app: string | Promise<string>, options?: { signal?: AbortSignal }) => Promise<string>>(),
}));
// The tests run Svelte's server build, where onMount does nothing
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        isInitialized: () => true,
        getMyApps: game.getMyApps,
        discoverMcpOAuthEndpoints: game.discoverMcpOAuthEndpoints,
        addMyApp: game.addMyApp,
        getMyAppThings: game.getMyAppThings,
        disconnectMyApp: game.disconnectMyApp,
    },
}));
vi.mock("../../../../Stores/MenuStore", async () => {
    const store = await import("svelte/store");
    return { userIsConnected: store.writable(true) };
});
vi.mock("../../../../Stores/MobileLayoutStore", async () => {
    const store = await import("svelte/store");
    return { mobileLayoutStore: store.writable(true) };
});
vi.mock("../Reconnect", () => ({ signInInPopup: game.reconnect }));

import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import AddAppSheet from "../AddAppSheet.svelte";
import { DISCOVERY_DEADLINE_MS } from "../AddApp";
import { forgetMyApps } from "../AppsStore";
import { cleanupsInProgress, resetCleanupsForTests, setCleanupDelaysForTests } from "../AppCleanup";

const ZAPIER = "https://mcp.zapier.com/api/mcp/mcp";
const found = {
    discovered: true,
    name: "Zapier",
    signsInWith: "Zapier",
    authorizeUrl: "https://zapier.com/authorize",
    tokenUrl: "https://zapier.com/token",
    clientId: "client-1",
    clientSecret: null,
    scopesSupported: ["mcp"],
    registrationStatus: "auto",
    revocationUrl: null,
};

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
    await tick();
}

const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const words = (element: HTMLElement | null | undefined) => element?.textContent?.replace(/\s+/g, " ").trim() ?? "";
async function click(id: string): Promise<void> {
    byId(id)?.click();
    await settle();
}
async function type(id: string, value: string, inputType = "insertText"): Promise<void> {
    const input = byId(id) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new InputEvent("input", { inputType, bubbles: true }));
    await settle();
}
/** A sign-in window that stays open until it is told to close */
function stoppedBy(signal: AbortSignal | undefined): Promise<string> {
    return new Promise<string>((resolve) => {
        const onAbort = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve("stopped");
        };
        signal?.addEventListener("abort", onAbort);
    });
}
const paste = (value: string) => type("addAppLink", value, "insertFromPaste");

describe("Add your own app (#2001, mock Part 13)", () => {
    let target: HTMLElement;
    let sheet: { $destroy: () => void } | undefined;
    const onClose = vi.fn();
    const onDone = vi.fn();

    const open = async () => {
        sheet = new AddAppSheet({ target, props: { onClose, onDone } });
        await settle();
    };

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        forgetMyApps();
        // a clean-up that outlives its sheet waits long before trying again, unless a test says otherwise
        resetCleanupsForTests();
        setCleanupDelaysForTests([600_000]);
        target = document.createElement("div");
        document.body.appendChild(target);
        game.getMyApps.mockResolvedValue({ apps: [], bricks: [] });
        game.discoverMcpOAuthEndpoints.mockResolvedValue(found);
        // tries queued by one test must not reach the next
        game.addMyApp.mockReset();
        game.disconnectMyApp.mockReset();
        game.addMyApp.mockResolvedValue({ id: "app-1", name: "Zapier" });
        game.getMyAppThings.mockResolvedValue({
            things: ["Google Calendar: Find Events", "Gmail: Find Email", "Gmail: Send Email"],
        });
        game.disconnectMyApp.mockResolvedValue(undefined);
        // like the real one: a window that opens, an id that may not come, a sign-in that ends
        game.reconnect.mockImplementation(async (app) => {
            try {
                await app;
            } catch {
                return "blocked";
            }
            return "done";
        });
    });

    afterEach(() => {
        sheet?.$destroy();
        sheet = undefined;
        target.remove();
        document.body.innerHTML = "";
    });

    it("starts with only the link, and Next waits for a link", async () => {
        await open();
        expect(words(byId("addAppSheet"))).toContain("Add your own app");
        expect(words(byId("addAppSheet"))).toContain("Paste the app's link. Universe checks how it signs in.");
        expect(byId("addAppName")).toBeNull();
        expect((byId("addAppNext") as HTMLButtonElement).disabled).toBe(true);
        await type("addAppLink", "not a link");
        expect((byId("addAppNext") as HTMLButtonElement).disabled).toBe(true);
        expect(game.discoverMcpOAuthEndpoints).not.toHaveBeenCalled();
    });

    it("checks a pasted link at once and, when the app says how it signs in, offers one button", async () => {
        await open();
        await paste(ZAPIER);
        expect(game.discoverMcpOAuthEndpoints).toHaveBeenCalledTimes(1);
        expect(game.discoverMcpOAuthEndpoints.mock.calls[0][0]).toBe(ZAPIER);
        expect((byId("addAppName") as HTMLInputElement).value).toBe("Zapier");
        expect(words(byId("addAppNameHint"))).toBe("From the app. Change it any time.");
        expect(words(byId("addAppFound"))).toBe(
            "Signs in with Zapier Found at that link. You sign in on Zapier's own page, so Universe never sees your password."
        );
        expect(words(byId("addAppSignIn"))).toBe("Sign in with Zapier");
        expect(byId("addAppHowOauth")).toBeNull();
        expect(words(byId("addAppExtra"))).toBe("Extra headers None");
    });

    it("makes the app, opens its own sign-in page, then says what it can do and opens its page on Done", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        const sent = game.addMyApp.mock.calls[0][0] as {
            name: string;
            serverUrl: string;
            authType: string;
            authConfig: string;
        };
        expect(sent).toMatchObject({ name: "Zapier", serverUrl: ZAPIER, authType: "oauth" });
        expect(JSON.parse(sent.authConfig)).toMatchObject({
            authorizeUrl: "https://zapier.com/authorize",
            tokenUrl: "https://zapier.com/token",
            clientId: "client-1",
        });
        expect(game.reconnect).toHaveBeenCalledTimes(1);
        expect(words(byId("addAppConnected"))).toBe(
            "Connected · it can do 3 things Google Calendar: Find Events, Gmail: Find Email, Gmail: Send Email. Next you choose which of your Bricks use it."
        );
        expect((byId("addAppLink") as HTMLInputElement).disabled).toBe(true);
        expect(byId("addAppExtra")).toBeNull();
        await click("addAppDone");
        expect(onDone).toHaveBeenCalledWith("app-1");
        // the Apps page reads again behind the sheet, so the new app is in its list
        expect(game.getMyApps).toHaveBeenCalled();
    });

    it("says only 'Connected' when Orbit cannot list what the app does", async () => {
        game.getMyAppThings.mockRejectedValue(new Error("no route"));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppConnected"))).toBe("Connected Next you choose which of your Bricks use it.");
        await click("addAppDone");
        expect(onDone).toHaveBeenCalledWith("app-1");
    });

    it("asks 'How does it sign in?' when the app does not say, with the sign-in page first", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        await open();
        await paste("https://tools.example.com/mcp");
        expect((byId("addAppName") as HTMLInputElement).value).toBe("My app");
        expect(byId("addAppNameHint")).toBeNull();
        expect(words(byId("addAppSheet"))).toContain("How does it sign in? The app didn't say, so pick one.");
        expect(byId("addAppHowOauth")?.getAttribute("aria-checked")).toBe("true");
        expect(words(byId("addAppHowOauth"))).toBe(
            "Sign-in page (OAuth)You enter the details from the service's developer settings"
        );
        expect(words(byId("addAppHowKey"))).toBe("Key or tokenYou paste a key the service gave you");
        expect(words(byId("addAppHowNone"))).toBe("No sign-inAnyone with the link can use it");
        expect(words(byId("addAppSheet"))).not.toContain("Recommended");
        // the sign-in page needs its four details
        expect((byId("addAppSaveSignIn") as HTMLButtonElement).disabled).toBe(true);
        await type("addAppAuthorize", "https://tools.example.com/oauth/authorize");
        await type("addAppToken", "https://tools.example.com/oauth/token");
        await type("addAppClientId", "id-1");
        expect((byId("addAppSaveSignIn") as HTMLButtonElement).disabled).toBe(true);
        await type("addAppClientSecret", "secret-1");
        expect((byId("addAppSaveSignIn") as HTMLButtonElement).disabled).toBe(false);
        await click("addAppSaveSignIn");
        const sent = game.addMyApp.mock.calls[0][0] as { authType: string; authConfig: string };
        expect(sent.authType).toBe("oauth");
        expect(JSON.parse(sent.authConfig)).toMatchObject({ clientId: "id-1", clientSecret: "secret-1" });
        expect(game.reconnect).toHaveBeenCalledTimes(1);
    });

    it("fills the sign-in details from what the check found when Universe could not register itself", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ ...found, clientId: null, registrationStatus: "manual" });
        await open();
        await paste(ZAPIER);
        expect(byId("addAppSignIn")).toBeNull();
        expect(words(byId("addAppSheet"))).toContain("How does it sign in?");
        expect((byId("addAppAuthorize") as HTMLInputElement).value).toBe("https://zapier.com/authorize");
        expect((byId("addAppToken") as HTMLInputElement).value).toBe("https://zapier.com/token");
        expect((byId("addAppClientId") as HTMLInputElement).value).toBe("");
        expect((byId("addAppSaveSignIn") as HTMLButtonElement).disabled).toBe(true);
    });

    it("takes a key, sent as a bearer token, straight to Orbit and connects at once", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        game.getMyAppThings.mockResolvedValue({ things: ["Find music", "Make music"] });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        expect((byId("addAppAdd") as HTMLButtonElement).disabled).toBe(true);
        expect(byId("addAppSentBearer")?.getAttribute("aria-checked")).toBe("true");
        expect(words(byId("addAppSheet"))).toContain("Bearer token is what most apps expect.");
        expect((byId("addAppKey") as HTMLInputElement).type).toBe("password");
        await type("addAppKey", "sk-ace-5f2c");
        await click("addAppAdd");
        expect(game.addMyApp).toHaveBeenCalledWith({
            name: "My app",
            serverUrl: "https://tools.example.com/mcp",
            authType: "bearer",
            authConfig: "sk-ace-5f2c",
            requestKey: expect.stringMatching(/^[0-9a-f]{32}$/),
        });
        // no sign-in window for a key
        expect(game.reconnect).not.toHaveBeenCalled();
        expect(words(byId("addAppConnected"))).toContain("Connected · it can do 2 things");
    });

    it("sends the key as X-API-Key when asked, and an app with no sign-in with no key at all", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppSentApiKey");
        await click("addAppAdd");
        expect((game.addMyApp.mock.calls[0][0] as { authType: string }).authType).toBe("api-key");

        sheet?.$destroy();
        document.body.innerHTML = "";
        game.addMyApp.mockClear();
        target = document.createElement("div");
        document.body.appendChild(target);
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowNone");
        await click("addAppAdd");
        expect(game.addMyApp).toHaveBeenCalledWith({
            name: "My app",
            serverUrl: "https://tools.example.com/mcp",
            authType: "none",
            requestKey: expect.stringMatching(/^[0-9a-f]{32}$/),
        });
    });

    it("keeps a name the person typed when the check finds another", async () => {
        await open();
        await type("addAppLink", "https://tools.example.com/x", "insertFromPaste");
        await type("addAppName", "Our Zapier");
        await paste(ZAPIER);
        expect((byId("addAppName") as HTMLInputElement).value).toBe("Our Zapier");
        expect(byId("addAppNameHint")).toBeNull();
    });

    it("starts again from the check when the link is changed", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValueOnce({ discovered: false }).mockResolvedValueOnce(found);
        await open();
        await paste("https://tools.example.com/mcp");
        expect(byId("addAppHowOauth")).not.toBeNull();
        await paste(ZAPIER);
        expect(game.discoverMcpOAuthEndpoints).toHaveBeenCalledTimes(2);
        expect(byId("addAppHowOauth")).toBeNull();
        expect(byId("addAppSignIn")).not.toBeNull();
    });

    it("treats an app that can't be reached as 'the app didn't say'", async () => {
        game.discoverMcpOAuthEndpoints.mockRejectedValue(new Error("network"));
        await open();
        await paste("https://tools.example.com/mcp");
        expect(words(byId("addAppSheet"))).toContain("How does it sign in?");
    });

    it("says so and keeps the app when the sign-in window is closed; the next tap does not make a second app", async () => {
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppStopped"))).toBe("The sign-in didn't finish. Try again.");
        expect(byId("addAppConnected")).toBeNull();
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(game.reconnect).toHaveBeenCalledTimes(2);
        expect(byId("addAppConnected")).not.toBeNull();
        expect(byId("addAppStopped")).toBeNull();
    });

    it("makes the app again, and drops the old one, when the person changes how it signs in after a try that did not finish", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        game.addMyApp.mockResolvedValueOnce({ id: "app-1" }).mockResolvedValueOnce({ id: "app-2" });
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        await open();
        await paste("https://tools.example.com/mcp");
        await type("addAppAuthorize", "https://tools.example.com/oauth/authorize");
        await type("addAppToken", "https://tools.example.com/oauth/token");
        await type("addAppClientId", "id-1");
        await type("addAppClientSecret", "secret-1");
        await click("addAppSaveSignIn");
        expect(words(byId("addAppStopped"))).not.toBe("");
        // a different way in: a key
        await click("addAppHowKey");
        await type("addAppKey", "sk-new");
        await click("addAppAdd");
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect((game.addMyApp.mock.calls[1][0] as { authType: string }).authType).toBe("bearer");
        await click("addAppDone");
        expect(onDone).toHaveBeenCalledWith("app-2");
    });

    it("takes the app away when the sheet is closed while Orbit is still making it", async () => {
        let answer: (value: unknown) => void = () => {};
        game.addMyApp.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        await click("addAppCancel");
        answer({ id: "late-1" });
        await settle();
        expect(game.disconnectMyApp).toHaveBeenCalledWith("late-1");
        expect(byId("addAppConnected")).toBeNull();
    });

    it("takes the app away when the sheet goes away without its own close, while Orbit is still making it", async () => {
        let answer: (value: unknown) => void = () => {};
        game.addMyApp.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        sheet?.$destroy();
        sheet = undefined;
        answer({ id: "late-2" });
        await settle();
        expect(game.disconnectMyApp).toHaveBeenCalledWith("late-2");
        expect(onClose).not.toHaveBeenCalled();
    });

    it("takes an unfinished app away when the sheet goes away without its own close", async () => {
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        sheet?.$destroy();
        sheet = undefined;
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("keeps a connected app when the sheet goes away", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(byId("addAppConnected")).not.toBeNull();
        sheet?.$destroy();
        sheet = undefined;
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
    });

    it("keeps a connected app when the sheet is closed while the list of what it can do is still loading", async () => {
        game.getMyAppThings.mockImplementationOnce(() => new Promise(() => {}));
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        expect(game.getMyAppThings).toHaveBeenCalledTimes(1);
        await click("addAppCancel");
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
    });

    it("asks how the app signs in when the app never answers the check", async () => {
        game.discoverMcpOAuthEndpoints.mockImplementationOnce(() => new Promise(() => {}));
        await open();
        vi.useFakeTimers();
        try {
            const input = byId("addAppLink") as HTMLInputElement;
            input.value = ZAPIER;
            input.dispatchEvent(new InputEvent("input", { inputType: "insertFromPaste", bubbles: true }));
            await vi.advanceTimersByTimeAsync(1);
            expect(words(byId("addAppSheet"))).toContain("Checking how it signs in");
            await vi.advanceTimersByTimeAsync(DISCOVERY_DEADLINE_MS);
        } finally {
            vi.useRealTimers();
        }
        await settle();
        expect(words(byId("addAppSheet"))).toContain("How does it sign in?");
        expect(words(byId("addAppSheet"))).not.toContain("Checking how it signs in");
    });

    it("says so when the window can't open", async () => {
        game.reconnect.mockResolvedValueOnce("blocked");
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppBlocked"))).toContain("Couldn't open the sign-in page");
    });

    it("stays busy until Orbit has made the app when the window can't open, so a second tap does not make a second app", async () => {
        let answer: (value: unknown) => void = () => {};
        game.addMyApp.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        // a blocked window answers at once, before the app exists
        game.reconnect.mockResolvedValueOnce("blocked");
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        void click("addAppSignIn");
        await settle();
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        answer({ id: "app-1" });
        await settle();
        expect(words(byId("addAppBlocked"))).toContain("Couldn't open the sign-in page");
        // the next tap reuses the app that was made
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(byId("addAppConnected")).not.toBeNull();
    });

    it("takes an app that never got signed in away again when the sheet closes", async () => {
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppCancel");
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("keeps a connected app when the sheet is closed", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppCancel");
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("says that nothing was added when Orbit refuses, and makes no second try on its own", async () => {
        game.addMyApp.mockRejectedValue(Object.assign(new Error("API error: 400"), { status: 400 }));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppFailed"))).toBe("That didn't go through. Nothing was added.");
        expect(byId("addAppUnsure")).toBeNull();
        expect(byId("addAppConnected")).toBeNull();
        // closing the sheet must not replay a refused try
        await click("addAppCancel");
        await settle();
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
    });

    it("refuses an extra header that Orbit keeps for the key, before anything is made", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppExtra");
        await click("addAppAddHeader");
        await type("addAppHeaderName", "Authorization");
        await type("addAppHeaderValue", "Bearer x");
        await click("addAppSignIn");
        expect(words(byId("addAppReserved"))).toContain("Authorization is set by the key");
        expect(game.addMyApp).not.toHaveBeenCalled();
        expect(game.reconnect).not.toHaveBeenCalled();
        await type("addAppHeaderName", "X-Team");
        // the line about the refused header goes as soon as the header is renamed
        expect(byId("addAppReserved")).toBeNull();
        expect(words(byId("addAppExtra"))).toBe("Extra headers 1 header");
        await click("addAppSignIn");
        expect((game.addMyApp.mock.calls[0][0] as { headers: unknown }).headers).toEqual({
            "X-Team": "Bearer x",
        });
    });

    it("drops the line about a refused header when that header is removed", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppExtra");
        await click("addAppAddHeader");
        await type("addAppHeaderName", "Cookie");
        await click("addAppSignIn");
        expect(byId("addAppReserved")).not.toBeNull();
        document.querySelector<HTMLElement>(".hdr-x")?.click();
        await settle();
        expect(byId("addAppReserved")).toBeNull();
        expect(game.addMyApp).not.toHaveBeenCalled();
    });

    const keyOfCall = (call: number) => (game.addMyApp.mock.calls[call][0] as { requestKey?: string }).requestKey;

    it("sends the same request key on a repeat try at the same app, so a try that timed out is not made twice", async () => {
        game.addMyApp.mockRejectedValueOnce(new Error("Orbit did not answer in time"));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppUnsure"))).toContain("couldn't tell whether that went through");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        // the next tap: Orbit answers the repeated key with the app the first try made
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(keyOfCall(0)).toMatch(/^[0-9a-f]{32}$/);
        expect(keyOfCall(1)).toBe(keyOfCall(0));
        expect(words(byId("addAppConnected"))).toContain("Connected");
    });

    it("sends a new request key when the person changes anything the app is made from", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        game.addMyApp.mockRejectedValue(new Error("Orbit did not answer in time"));
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        await type("addAppKey", "sk-2");
        await click("addAppAdd");
        // the first try never answered, so it is looked for with its own key before the changed form is sent with a new one
        expect(game.addMyApp).toHaveBeenCalledTimes(3);
        expect(keyOfCall(1)).toBe(keyOfCall(0));
        expect(keyOfCall(2)).not.toBe(keyOfCall(0));
    });

    it("sends a new request key for a new sheet", async () => {
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        sheet?.$destroy();
        document.body.innerHTML = "";
        target = document.createElement("div");
        document.body.appendChild(target);
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(keyOfCall(1)).not.toBe(keyOfCall(0));
    });

    it("sends a new request key after the first app was taken away, since the old key would answer with it", async () => {
        game.addMyApp.mockResolvedValueOnce({ id: "app-1" }).mockResolvedValueOnce({ id: "app-2" });
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppStopped"))).not.toBe("");
        // the link is typed again: the unfinished app goes, and the next one is new for Orbit too
        await paste(ZAPIER + "?again");
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(keyOfCall(1)).not.toBe(keyOfCall(0));
    });

    it("starts with a fresh request key after Orbit says the key was used for another app (409)", async () => {
        game.addMyApp.mockRejectedValueOnce(Object.assign(new Error("API error: 409"), { status: 409 }));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppFailed"))).toBe("That didn't go through. Nothing was added.");
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(keyOfCall(1)).not.toBe(keyOfCall(0));
        expect(words(byId("addAppConnected"))).toContain("Connected");
    });

    it("finds and takes away the app a try that never answered may have made, before the changed form makes another", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        const order: string[] = [];
        game.addMyApp.mockImplementation((app) => {
            const sent = app as { authConfig?: string; requestKey: string };
            order.push(`add:${sent.authConfig}`);
            if (order.length === 1) return Promise.reject(new Error("Orbit did not answer in time"));
            // the earlier app was made after all: the same key finds it
            return Promise.resolve({ id: sent.authConfig === "sk-1" ? "app-1" : "app-2" });
        });
        game.disconnectMyApp.mockImplementation((id) => {
            order.push(`drop:${id}`);
            return Promise.resolve(undefined);
        });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        expect(words(byId("addAppUnsure"))).toBe(
            "We couldn't tell whether that went through. Try again in a moment; it won't be added twice."
        );
        // the person changes the key and tries again
        await type("addAppKey", "sk-2");
        await click("addAppAdd");
        expect(order).toEqual(["add:sk-1", "add:sk-1", "drop:app-1", "add:sk-2"]);
        expect(keyOfCall(1)).toBe(keyOfCall(0));
        expect(keyOfCall(2)).not.toBe(keyOfCall(0));
        await click("addAppDone");
        expect(onDone).toHaveBeenCalledWith("app-2");
    });

    it("still makes the changed app when the look for the earlier one gets no answer either", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockResolvedValueOnce({ id: "app-2" });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        await type("addAppKey", "sk-2");
        await click("addAppAdd");
        expect(game.addMyApp).toHaveBeenCalledTimes(3);
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
        await click("addAppDone");
        expect(onDone).toHaveBeenCalledWith("app-2");
    });

    it("keeps looking, on its own, for an earlier try whose look got no answer, even after a later try also never answered", async () => {
        setCleanupDelaysForTests([1]);
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        const tries: Record<string, number> = {};
        game.addMyApp.mockImplementation((app) => {
            const key = (app as { authConfig: string }).authConfig;
            tries[key] = (tries[key] ?? 0) + 1;
            // sk-1: the try, the first look: no answer; the look after that finds the app. sk-2: the try: no answer, then found.
            if (key === "sk-1") {
                return tries[key] < 3
                    ? Promise.reject(new Error("Orbit did not answer in time"))
                    : Promise.resolve({ id: "app-1" });
            }
            return tries[key] < 2
                ? Promise.reject(new Error("Orbit did not answer in time"))
                : Promise.resolve({ id: "app-2" });
        });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        await type("addAppKey", "sk-2");
        await click("addAppAdd");
        await click("addAppCancel");
        await vi.waitFor(() => {
            expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
            expect(game.disconnectMyApp).toHaveBeenCalledWith("app-2");
        });
        // every look used the key of the try it was for
        const keys = game.addMyApp.mock.calls.map((call) => (call[0] as { requestKey: string }).requestKey);
        expect(new Set(keys).size).toBe(2);
        await vi.waitFor(() => expect(cleanupsInProgress()).toBe(0));
    });

    it("does not look for an app when Orbit refused the try, since nothing was made", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        game.addMyApp
            .mockRejectedValueOnce(Object.assign(new Error("API error: 400"), { status: 400 }))
            .mockResolvedValueOnce({ id: "app-2" });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        await type("addAppKey", "sk-2");
        await click("addAppAdd");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(game.disconnectMyApp).not.toHaveBeenCalled();
    });

    it("still finds the earlier app when a repeat try with the same key is then refused", async () => {
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockRejectedValueOnce(Object.assign(new Error("API error: 429"), { status: 429 }))
            .mockResolvedValueOnce({ id: "app-1" });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        await click("addAppCancel");
        // the first try may have made the app after all: the same key finds it, and it is taken away
        expect(game.addMyApp).toHaveBeenCalledTimes(3);
        expect(keyOfCall(2)).toBe(keyOfCall(0));
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("finds and takes away the app a try that never answered may have made when the sheet is closed", async () => {
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockResolvedValueOnce({ id: "app-1" });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppUnsure"))).toContain("couldn't tell whether that went through");
        await click("addAppCancel");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(keyOfCall(1)).toBe(keyOfCall(0));
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("finds and takes away the app a try that never answered may have made when the link is changed", async () => {
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockResolvedValueOnce({ id: "app-1" });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await paste("https://tools.example.com/other");
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("uses a new key when the link goes back to what an unanswered try was made from", async () => {
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockResolvedValueOnce({ id: "app-1" })
            .mockResolvedValueOnce({ id: "app-2" });
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await paste("https://tools.example.com/other");
        // the earlier try's app was found and taken away; its key is gone with it
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(game.addMyApp).toHaveBeenCalledTimes(3);
        expect(keyOfCall(2)).not.toBe(keyOfCall(0));
    });

    it("looks for the app a try that never answered may have made when the sheet closed before Orbit answered", async () => {
        let fail: (error: Error) => void = () => {};
        game.addMyApp
            .mockImplementationOnce(
                async () =>
                    await new Promise((_resolve, reject) => {
                        fail = reject;
                    })
            )
            .mockResolvedValueOnce({ id: "app-1" });
        await open();
        await paste(ZAPIER);
        byId("addAppSignIn")?.click();
        await settle();
        await click("addAppCancel");
        fail(new Error("Orbit did not answer in time"));
        await settle();
        expect(game.addMyApp).toHaveBeenCalledTimes(2);
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
    });

    it("does not send a key, how it is sent, or a header typed for one app to another app", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await click("addAppSentApiKey");
        await type("addAppKey", "sk-for-a");
        await click("addAppExtra");
        await click("addAppAddHeader");
        await type("addAppHeaderName", "X-Team");
        await type("addAppHeaderValue", "team-a");
        // the same place again (another path) keeps what was typed
        await paste("https://tools.example.com/other");
        await click("addAppHowKey");
        expect((byId("addAppKey") as HTMLInputElement).value).toBe("sk-for-a");
        // another app: none of it goes along
        await paste("https://other.example.org/mcp");
        await click("addAppHowNone");
        await click("addAppAdd");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(game.addMyApp.mock.calls[0][0]).toEqual({
            name: "My app",
            serverUrl: "https://other.example.org/mcp",
            authType: "none",
            requestKey: expect.stringMatching(/^[0-9a-f]{32}$/),
        });
        expect(JSON.stringify(game.addMyApp.mock.calls)).not.toMatch(/sk-for-a|X-Team|team-a/);
    });

    it("starts the next app with a key sent as a bearer token, not as the first app's way", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await click("addAppSentApiKey");
        await paste("https://other.example.org/mcp");
        await click("addAppHowKey");
        expect(byId("addAppSentBearer")?.getAttribute("aria-checked")).toBe("true");
        expect((byId("addAppKey") as HTMLInputElement).value).toBe("");
    });

    it("keeps trying to take an unfinished app away after the sheet is gone, until Orbit confirms it", async () => {
        setCleanupDelaysForTests([1]);
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        game.disconnectMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockRejectedValueOnce(Object.assign(new Error("API error: 503"), { status: 503 }))
            .mockResolvedValueOnce(undefined);
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppCancel");
        sheet?.$destroy();
        sheet = undefined;
        await vi.waitFor(() => expect(game.disconnectMyApp).toHaveBeenCalledTimes(3));
        expect(game.disconnectMyApp).toHaveBeenCalledWith("app-1");
        await vi.waitFor(() => expect(cleanupsInProgress()).toBe(0));
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(3);
    });

    it("counts an app Orbit says is not there as taken away, and does not ask again", async () => {
        setCleanupDelaysForTests([1]);
        game.reconnect.mockImplementationOnce(async (app) => {
            await app;
            return "stopped";
        });
        game.disconnectMyApp.mockRejectedValue(Object.assign(new Error("API error: 404"), { status: 404 }));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppCancel");
        await vi.waitFor(() => expect(cleanupsInProgress()).toBe(0));
        expect(game.disconnectMyApp).toHaveBeenCalledTimes(1);
    });

    it("makes a replacement app only after the look for the earlier try has ended, even when the link was changed meanwhile", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        const order: string[] = [];
        let release: (answer: unknown) => void = () => undefined;
        game.addMyApp.mockImplementation((app) => {
            const sent = app as { serverUrl: string };
            order.push(`add:${sent.serverUrl}`);
            if (order.length === 1) return Promise.reject(new Error("Orbit did not answer in time"));
            if (order.length === 2) {
                // the look for the first try: Orbit is slow to answer it
                return new Promise((resolve) => {
                    release = resolve;
                });
            }
            return Promise.resolve({ id: "app-2" });
        });
        game.disconnectMyApp.mockImplementation((id) => {
            order.push(`drop:${id}`);
            return Promise.resolve(undefined);
        });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-1");
        await click("addAppAdd");
        // the link moves to another app: the look starts, and is slow
        await paste("https://other.example.org/mcp");
        await click("addAppHowNone");
        void click("addAppAdd");
        await settle();
        // nothing is made while the earlier try is still being looked for
        expect(order).toEqual(["add:https://tools.example.com/mcp", "add:https://tools.example.com/mcp"]);
        release({ id: "app-1" });
        await settle();
        expect(order).toEqual([
            "add:https://tools.example.com/mcp",
            "add:https://tools.example.com/mcp",
            "drop:app-1",
            "add:https://other.example.org/mcp",
        ]);
    });

    it("shows Done and reads the Apps again as soon as it is connected, without waiting for what the app can do", async () => {
        game.getMyAppThings.mockImplementationOnce(() => new Promise(() => {}));
        await open();
        await paste(ZAPIER);
        const reads = game.getMyApps.mock.calls.length;
        await click("addAppSignIn");
        expect(byId("addAppConnected")).not.toBeNull();
        expect(byId("addAppDone")).not.toBeNull();
        expect(game.getMyApps.mock.calls.length).toBeGreaterThan(reads);
        expect(words(byId("addAppConnected"))).toContain("Connected");
        expect(words(byId("addAppConnected"))).not.toContain("it can do");
    });

    it("says what the app can do when that comes back after Done is already there", async () => {
        let answer: (value: unknown) => void = () => undefined;
        game.getMyAppThings.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    answer = resolve;
                })
        );
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        answer({ things: ["Find music"] });
        await settle();
        expect(words(byId("addAppConnected"))).toContain("Connected · it can do 1 thing");
    });

    it("closes the sign-in window when the sheet is cancelled or goes away", async () => {
        const signals: Array<AbortSignal | undefined> = [];
        game.reconnect.mockImplementation(async (app, options) => {
            await app;
            signals.push(options?.signal);
            return await stoppedBy(options?.signal);
        });
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        expect(signals).toHaveLength(1);
        expect(signals[0]?.aborted).toBe(false);
        await click("addAppCancel");
        expect(signals[0]?.aborted).toBe(true);
    });

    it("closes the sign-in window when the sheet goes away without its own close", async () => {
        const signals: Array<AbortSignal | undefined> = [];
        game.reconnect.mockImplementation(async (app, options) => {
            await app;
            signals.push(options?.signal);
            return await stoppedBy(options?.signal);
        });
        await open();
        await paste(ZAPIER);
        void click("addAppSignIn");
        await settle();
        sheet?.$destroy();
        sheet = undefined;
        expect(signals[0]?.aborted).toBe(true);
    });

    it("says it could not tell, not that nothing was added, when Orbit fails with a server error", async () => {
        game.addMyApp.mockRejectedValueOnce(Object.assign(new Error("API error: 502"), { status: 502 }));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(byId("addAppFailed")).toBeNull();
        expect(words(byId("addAppUnsure"))).toContain("couldn't tell whether that went through");
    });

    it("says it could not tell when a refusal follows an earlier try of the same key that never answered", async () => {
        game.addMyApp
            .mockRejectedValueOnce(new Error("Orbit did not answer in time"))
            .mockRejectedValueOnce(Object.assign(new Error("API error: 400"), { status: 400 }));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        await click("addAppSignIn");
        expect(byId("addAppFailed")).toBeNull();
        expect(byId("addAppUnsure")).not.toBeNull();
    });

    it("never writes the key into the page's words", async () => {
        game.discoverMcpOAuthEndpoints.mockResolvedValue({ discovered: false });
        await open();
        await paste("https://tools.example.com/mcp");
        await click("addAppHowKey");
        await type("addAppKey", "sk-secret-123");
        expect(words(byId("addAppSheet"))).not.toContain("sk-secret-123");
        expect(words(byId("addAppKeyNote"))).toContain("kept locked");
    });
});
