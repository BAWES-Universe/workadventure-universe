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
    reconnect: vi.fn<(app: string | Promise<string>) => Promise<string>>(),
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
import { forgetMyApps } from "../AppsStore";

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
        target = document.createElement("div");
        document.body.appendChild(target);
        game.getMyApps.mockResolvedValue({ apps: [], bricks: [] });
        game.discoverMcpOAuthEndpoints.mockResolvedValue(found);
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
        expect(words(byId("addAppSheet"))).toContain("Paste the app's MCP link. Universe checks how it signs in.");
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

    it("says so when the window can't open", async () => {
        game.reconnect.mockResolvedValueOnce("blocked");
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppBlocked"))).toContain("Couldn't open the sign-in page");
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
        game.addMyApp.mockRejectedValue(new Error("400"));
        await open();
        await paste(ZAPIER);
        await click("addAppSignIn");
        expect(words(byId("addAppFailed"))).toBe("That didn't go through. Nothing was added.");
        expect(game.addMyApp).toHaveBeenCalledTimes(1);
        expect(byId("addAppConnected")).toBeNull();
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
        expect(words(byId("addAppExtra"))).toBe("Extra headers 1 header");
        await click("addAppSignIn");
        expect((game.addMyApp.mock.calls[0][0] as { headers: unknown }).headers).toEqual({
            "X-Team": "Bearer x",
        });
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
