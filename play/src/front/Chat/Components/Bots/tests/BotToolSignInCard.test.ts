import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";

// The wording is the approved mock's.
vi.mock("../../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    const toolSignIn = {
        titleOne: ({ name }: { name: string }) => `${name} needs signing in again`,
        titleMany: ({ count }: { count: number }) => `${count} connections need signing in again`,
        titleBackOne: ({ name }: { name: string }) => `${name} is connected again`,
        titleBackMany: () => "Connected again",
        lineOne: ({ time, bot, name }: { time: string; bot: string; name: string }) =>
            `Since ${time}. ${bot} answers without ${name} until it's reconnected.`,
        lineMany: ({ bot }: { bot: string }) => `${bot} answers without them until they're reconnected.`,
        lineBack: ({ bot }: { bot: string }) => `${bot} can use it from its next reply.`,
        reconnect: ({ name }: { name: string }) => `Reconnect ${name}`,
        pasteKey: ({ name }: { name: string }) => `Paste a new ${name} key`,
        waiting: ({ name }: { name: string }) => `Waiting for ${name}…`,
        reconnected: () => "Reconnected",
        rowBack: ({ name }: { name: string }) => `${name} reconnected`,
        rowBackLine: () => "Working again",
        rowSince: ({ time }: { time: string }) => `Since ${time}`,
        blocked: () => "Couldn't open the sign-in window. Allow pop-ups and try again.",
        onlyYou: ({ bot }: { bot: string }) => `Only you see this card. You can manage ${bot}.`,
        close: () => "Close",
    };
    return { default: readable({ chat: { toolSignIn } }), locale: readable("en-US") };
});

const getBotMcpServers = vi.fn();
vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { getBotMcpServers: (...args: unknown[]) => getBotMcpServers(...args) },
}));
const reconnectBotServer = vi.fn();
vi.mock("../../../../external-modules/bots/services/reconnectServer", () => ({
    reconnectBotServer: (...args: unknown[]) => reconnectBotServer(...args),
}));
const openBotPage = vi.fn();
vi.mock("../../../../external-modules/bots/index", () => ({
    openBotPage: (...args: unknown[]) => openBotPage(...args),
}));

import type { BotToolSignIn } from "../../../Bots/BotToolSignIn";
import BotToolSignInCard from "../BotToolSignInCard.svelte";

const TAVILY = { serverId: "srv-1", name: "Tavily", since: "2026-11-05T09:54:00.000Z", kind: "oauth" as const };
const ATTIO = { serverId: "srv-2", name: "Attio", since: "2026-11-05T09:55:00.000Z", kind: "key" as const };
const card = (...lost: BotToolSignIn["lost"]): BotToolSignIn => ({ botId: "b-1", botName: "Tavily Researcher", lost });
const lostOnOrbit = (...ids: string[]) =>
    ["srv-1", "srv-2"].map((id) => ({ id, signInLostAt: ids.includes(id) ? "2026-11-05T09:54:00.000Z" : null }));

describe("the Reconnect card for a tool whose sign-in expired (#1819)", () => {
    let target: HTMLElement;
    let shown: { $destroy: () => void } | undefined;
    const onClose = vi.fn();

    beforeEach(() => {
        target = document.createElement("div");
        document.body.appendChild(target);
        vi.clearAllMocks();
        getBotMcpServers.mockResolvedValue(lostOnOrbit("srv-1", "srv-2"));
    });

    afterEach(() => {
        shown?.$destroy();
        shown = undefined;
        target.remove();
    });

    async function show(value: BotToolSignIn) {
        shown = new BotToolSignInCard({ target, props: { signIn: value, onClose } });
        await tick();
        await Promise.resolve();
        await tick();
    }
    const text = () => (target.textContent ?? "").replace(/\s+/g, " ").trim();
    const byId = (id: string) => target.querySelector<HTMLButtonElement>(`[data-testid=${id}]`);

    it("says which connection needs signing in again, since when, and that only this person sees the card", async () => {
        await show(card(TAVILY));
        expect(text()).toContain("Tavily needs signing in again");
        expect(text()).toContain("Tavily Researcher answers without Tavily until it's reconnected.");
        expect(text()).toContain("Only you see this card. You can manage Tavily Researcher.");
        expect(byId("botToolSignInReconnect")?.textContent).toContain("Reconnect Tavily");
    });

    it("has an X that closes it", async () => {
        await show(card(TAVILY));
        byId("botToolSignInClose")?.click();
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("opens the provider's sign-in window from Reconnect, and says reconnected once Orbit has cleared the mark", async () => {
        reconnectBotServer.mockResolvedValue("done");
        await show(card(TAVILY));
        getBotMcpServers.mockResolvedValue(lostOnOrbit());
        byId("botToolSignInReconnect")?.click();
        await tick();
        await vi.waitFor(() => expect(byId("botToolSignInDone")).not.toBeNull());
        expect(reconnectBotServer).toHaveBeenCalledWith("b-1", "srv-1");
        expect(text()).toContain("Tavily is connected again");
        expect(text()).toContain("Tavily Researcher can use it from its next reply.");
        expect(byId("botToolSignInDone")?.textContent).toContain("Reconnected");
    });

    it("waits while the provider's window is open", async () => {
        let finish: (value: string) => void = () => undefined;
        reconnectBotServer.mockReturnValue(
            new Promise((resolve) => {
                finish = resolve;
            })
        );
        await show(card(TAVILY));
        byId("botToolSignInReconnect")?.click();
        await tick();
        expect(byId("botToolSignInReconnect")?.textContent).toContain("Waiting for Tavily…");
        expect(byId("botToolSignInReconnect")?.disabled).toBe(true);
        finish("cancelled");
        await vi.waitFor(() => expect(byId("botToolSignInReconnect")?.textContent).toContain("Reconnect Tavily"));
    });

    it("stays on Reconnect when the window is closed, and says so when the browser blocked it", async () => {
        reconnectBotServer.mockResolvedValue("blocked");
        await show(card(TAVILY));
        byId("botToolSignInReconnect")?.click();
        await vi.waitFor(() => expect(text()).toContain("Allow pop-ups"));
        expect(byId("botToolSignInReconnect")?.textContent).toContain("Reconnect Tavily");
    });

    it("keeps Reconnect when the provider said yes but Orbit still marks the sign-in lost", async () => {
        reconnectBotServer.mockResolvedValue("done");
        await show(card(TAVILY));
        byId("botToolSignInReconnect")?.click();
        await vi.waitFor(() => expect(reconnectBotServer).toHaveBeenCalled());
        await vi.waitFor(() => expect(byId("botToolSignInReconnect")?.textContent).toContain("Reconnect Tavily"));
        expect(byId("botToolSignInDone")).toBeNull();
    });

    it("sends a key or token to the bot's page, where it is pasted", async () => {
        await show(card(ATTIO));
        expect(byId("botToolSignInReconnect")?.textContent).toContain("Paste a new Attio key");
        byId("botToolSignInReconnect")?.click();
        expect(openBotPage).toHaveBeenCalledWith("b-1");
        expect(reconnectBotServer).not.toHaveBeenCalled();
    });

    it("lists two connections as one quiet row each, with no second main button", async () => {
        await show(card(TAVILY, ATTIO));
        expect(text()).toContain("2 connections need signing in again");
        expect(text()).toContain("Tavily Researcher answers without them until they're reconnected.");
        const rows = [...target.querySelectorAll("[data-testid=botToolSignInRow]")];
        expect(rows.map((row) => row.textContent?.replace(/\s+/g, " ").trim().split(" Since")[0])).toEqual([
            "Reconnect Tavily",
            "Paste a new Attio key",
        ]);
        expect(byId("botToolSignInReconnect")).toBeNull();
    });

    it("leaves a connection off the card when Orbit says it is fine now, and closes when none is left", async () => {
        getBotMcpServers.mockResolvedValue(lostOnOrbit("srv-2"));
        await show(card(TAVILY, ATTIO));
        await vi.waitFor(() => expect(text()).toContain("Attio needs signing in again"));
        expect(text()).not.toContain("Tavily needs");
        shown?.$destroy();
        getBotMcpServers.mockResolvedValue(lostOnOrbit());
        await show(card(TAVILY));
        await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    });

    it("shows the card as the bot sent it when Orbit can't be asked from here", async () => {
        getBotMcpServers.mockRejectedValue(new Error("not initialized"));
        await show(card(TAVILY));
        expect(text()).toContain("Tavily needs signing in again");
        expect(onClose).not.toHaveBeenCalled();
    });
});
