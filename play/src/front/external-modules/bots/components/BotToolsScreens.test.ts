import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
    isInitialized: vi.fn(() => true),
    getBotMcpServers: vi.fn(),
    getMcpServerTools: vi.fn(),
    moveMcpTool: vi.fn(),
    confirmMcpTools: vi.fn(),
    saveMcpServerSettings: vi.fn(),
    getBotToolSettings: vi.fn(),
    saveBotToolSettings: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotData } from "../types";
import { botToolsStore } from "../stores/BotToolsStore";
import type { BotToolSettings, ServerTool, ServerTools } from "../toolsModel";
import BotToolsServerScreen from "./BotToolsServerScreen.svelte";
import BotToolsHeadingScreen from "./BotToolsHeadingScreen.svelte";
import BotToolsApprovalsScreen from "./BotToolsApprovalsScreen.svelte";

const bot = { id: "b1", name: "Linear SH" } as unknown as BotData;

const server = {
    id: "s1",
    name: "Linear",
    serverUrl: "https://mcp.linear.app/mcp",
    authType: "none",
    enabled: true,
    createdAt: "2026-11-01T00:00:00Z",
    lastTestResult: { success: true, toolCount: 6, toolNames: [], error: null },
};

const tool = (over: Partial<ServerTool> & { id: string; name: string }): ServerTool => ({
    title: null,
    description: null,
    suggestedHeading: null,
    suggestionSource: null,
    heading: null,
    state: "confirmed",
    confirmedBy: "Sara",
    movedBy: null,
    ...over,
});

function answer(over: Partial<ServerTools> = {}): ServerTools {
    return {
        serverId: "s1",
        state: "confirmed",
        policyRevision: 4,
        settings: {
            looksUp: "rightAway",
            makesNew: "rightAway",
            changesThings: "asksFirst",
            deletesOrSends: "asksFirst",
        },
        tools: [
            tool({
                id: "t1",
                name: "list_issues",
                title: "List issues",
                suggestedHeading: "looksUp",
                suggestionSource: "server",
            }),
            tool({
                id: "t2",
                name: "get_issue",
                title: "Get issue",
                suggestedHeading: "looksUp",
                suggestionSource: "server",
            }),
            tool({
                id: "t3",
                name: "list_comments",
                title: "List comments",
                suggestedHeading: "looksUp",
                suggestionSource: "server",
            }),
            tool({
                id: "t4",
                name: "list_teams",
                title: "List teams",
                suggestedHeading: "looksUp",
                suggestionSource: "server",
            }),
            tool({
                id: "t5",
                name: "save_comment",
                title: "Save comment",
                description: "Add a comment to an issue",
                suggestedHeading: "changesThings",
                suggestionSource: "server",
            }),
            tool({
                id: "t6",
                name: "delete_comment",
                title: "Delete comment",
                suggestedHeading: "deletesOrSends",
                suggestionSource: "server",
            }),
        ],
        truncated: false,
        totalSeen: null,
        ...over,
    };
}

describe("the bot page's Tools screens (game #1655)", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        botToolsStore.set(undefined);
        mocks.isInitialized.mockReturnValue(true);
        mocks.getBotMcpServers.mockResolvedValue([server]);
        mocks.getMcpServerTools.mockResolvedValue(answer());
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const settle = async () => {
        for (let i = 0; i < 6; i++) {
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
            // eslint-disable-next-line no-await-in-loop
            await tick();
        }
    };
    const byTestId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const click = async (el: Element | null) => {
        (el as HTMLElement).click();
        await settle();
    };

    async function mountServer(onOpenHeading = vi.fn(), onGone = vi.fn()) {
        const component = new BotToolsServerScreen({ target, props: { bot, serverId: "s1", onOpenHeading, onGone } });
        destroy = () => component.$destroy();
        await settle();
        return { onOpenHeading, onGone };
    }

    it("shows each heading with its tool count, the first three names and +N more, as one row", async () => {
        const { onOpenHeading } = await mountServer();
        const looksUp = byTestId("bot-tools-heading-looksUp");
        expect(looksUp?.textContent).toContain("Looks things up");
        expect(looksUp?.textContent).toContain("4 tools");
        expect(looksUp?.textContent).toContain("List issues, Get issue, List comments");
        expect(looksUp?.textContent).toContain("+1 more");
        // A heading with no tools is not shown
        expect(byTestId("bot-tools-heading-makesNew")).toBeNull();
        expect(byTestId("bot-tools-heading-changesThings")?.textContent).toContain("1 tool");
        expect(byTestId("bot-tools-heading-changesThings")?.textContent).not.toContain("more");

        await click(byTestId("bot-tools-open-looksUp"));
        expect(onOpenHeading).toHaveBeenCalledWith("looksUp");
    });

    it("says what each choice does, and saves a new choice for that heading only", async () => {
        mocks.saveMcpServerSettings.mockResolvedValue(
            answer({
                policyRevision: 5,
                settings: {
                    looksUp: "rightAway",
                    makesNew: "rightAway",
                    changesThings: "off",
                    deletesOrSends: "asksFirst",
                },
            })
        );
        await mountServer();
        expect(byTestId("bot-tools-heading-changesThings")?.textContent).toContain(
            "This bot shows the person chatting a card and waits for their OK, every time."
        );
        await click(byTestId("bot-tools-choice-changesThings-off"));
        expect(mocks.saveMcpServerSettings).toHaveBeenCalledWith("b1", "s1", { changesThings: "off" });
        expect(byTestId("bot-tools-heading-changesThings")?.textContent).toContain("This bot never uses these tools.");
    });

    it("puts a choice back and says so when Orbit refuses it", async () => {
        mocks.saveMcpServerSettings.mockRejectedValue(new Error("Forbidden"));
        await mountServer();
        await click(byTestId("bot-tools-choice-changesThings-off"));
        expect(target.querySelector("[role=alert]")?.textContent).toContain("Forbidden");
        expect(get(botToolsStore)?.tools.s1.settings.changesThings).toBe("asksFirst");
    });

    it("has one search for all of the server's tools, which says what it searches and where each result sits", async () => {
        await mountServer();
        const search = byTestId("bot-tools-search") as HTMLInputElement;
        expect(search.placeholder).toBe("Search all 6 Linear tools");
        expect(target.querySelectorAll("input[type=search]")).toHaveLength(1);
        search.value = "comment";
        search.dispatchEvent(new Event("input"));
        await settle();
        expect(byTestId("bot-tools-search-count")?.textContent).toContain("3 of 6 tools match");
        const results = target.querySelector(".ts-found")?.textContent ?? "";
        expect(results).toContain("List comments");
        expect(results).toContain("Looks things up · Right away");
        expect(results).toContain("Delete comment");
        expect(results).toContain("Deletes or sends out · Asks first");
    });

    it("asks for a check while tools wait, and confirms the list as it was shown", async () => {
        mocks.getMcpServerTools.mockResolvedValue(
            answer({
                state: "notConfirmedYet",
                tools: answer().tools.map((t) => ({ ...t, state: "notConfirmedYet", confirmedBy: null })),
            })
        );
        mocks.confirmMcpTools.mockResolvedValue(answer({ policyRevision: 5 }));
        await mountServer();
        expect(byTestId("bot-tools-confirm")?.textContent).toContain("Check what Linear's 6 tools do");
        expect(target.textContent).toContain("4 to check");
        await click(byTestId("bot-tools-confirm-all"));
        expect(mocks.confirmMcpTools).toHaveBeenCalledWith("b1", "s1", 4);
        expect(byTestId("bot-tools-confirm")).toBeNull();
    });

    it("names the tool in the check banner and the button when only one waits", async () => {
        mocks.getMcpServerTools.mockResolvedValue(
            answer({
                state: "notConfirmedYet",
                tools: [
                    tool({
                        id: "t1",
                        name: "update_page",
                        title: "Update page",
                        suggestedHeading: "changesThings",
                        suggestionSource: "server",
                        state: "notConfirmedYet",
                        confirmedBy: null,
                    }),
                    tool({ id: "t2", name: "list_pages", title: "List pages", suggestedHeading: "looksUp" }),
                ],
            })
        );
        await mountServer();
        const banner = byTestId("bot-tools-confirm")?.textContent ?? "";
        expect(banner).toContain("Check what Update page does");
        expect(byTestId("bot-tools-confirm-all")?.textContent).toContain("Confirm Update page");
    });

    it("shows Orbit's reason when the tools moved while a person was looking", async () => {
        mocks.getMcpServerTools.mockResolvedValue(
            answer({ state: "notConfirmedYet", tools: answer().tools.map((t) => ({ ...t, state: "notConfirmedYet" })) })
        );
        mocks.confirmMcpTools.mockRejectedValue(new Error("This tool changed, review it again"));
        await mountServer();
        await click(byTestId("bot-tools-confirm-all"));
        expect(target.querySelector("[role=alert]")?.textContent).toContain("This tool changed, review it again");
        expect(byTestId("bot-tools-confirm")).not.toBeNull();
    });

    it("says an old server was added before tools were checked", async () => {
        mocks.getMcpServerTools.mockResolvedValue(answer({ state: "notCheckedYet" }));
        await mountServer();
        expect(byTestId("bot-tools-confirm")?.textContent).toContain("was added before tools were checked");
    });

    describe("a server with more tools than Orbit keeps (Orbit #801)", () => {
        const cut = (count: number, over: Partial<ServerTools> = {}) =>
            answer({
                truncated: true,
                tools: Array.from({ length: count }, (_, i) =>
                    tool({ id: `c${i}`, name: `tool_${i}`, suggestedHeading: "looksUp", suggestionSource: "server" })
                ),
                ...over,
            });

        it("says the list is cut, how many the server has and why, with the number Orbit sent", async () => {
            mocks.getMcpServerTools.mockResolvedValue(cut(500, { totalSeen: 731 }));
            await mountServer();
            const line = byTestId("bot-tools-cut")?.textContent ?? "";
            expect(line).toContain("Showing the first 500 of 731 tools");
            expect(line).toContain(
                "500 is the most Orbit keeps for one server, so Linear SH uses these and none of the rest."
            );
        });

        it("takes the number shown from the tools it got, not from a fixed 500", async () => {
            mocks.getMcpServerTools.mockResolvedValue(cut(300, { totalSeen: 450 }));
            await mountServer();
            expect(byTestId("bot-tools-cut")?.textContent).toContain("Showing the first 300 of 450 tools");
        });

        it("still says it is cut when the server's count is not known", async () => {
            mocks.getMcpServerTools.mockResolvedValue(cut(500));
            await mountServer();
            const line = byTestId("bot-tools-cut")?.textContent ?? "";
            expect(line).toContain("Showing the first 500 tools");
            expect(line).not.toMatch(/first 500 of/);
        });

        it("shows no line when the list is whole", async () => {
            await mountServer();
            expect(byTestId("bot-tools-cut")).toBeNull();
            expect(target.textContent).not.toContain("Showing the first");
        });
    });

    it("says to test the server when no tools have been read yet", async () => {
        mocks.getMcpServerTools.mockResolvedValue(answer({ tools: [] }));
        await mountServer();
        expect(target.textContent).toContain("Linear has no tools sorted yet. Tap Test server to read them.");
        expect(byTestId("bot-tools-search")).toBeNull();
    });

    describe("a heading's page", () => {
        async function mountHeading(heading: "changesThings" | "unsorted" | "looksUp" = "looksUp") {
            // Its server's page has loaded first: the store holds the servers and their tools
            const gone = new BotToolsServerScreen({
                target: document.createElement("div"),
                props: { bot, serverId: "s1", onOpenHeading: vi.fn(), onGone: vi.fn() },
            });
            await settle();
            gone.$destroy();
            const component = new BotToolsHeadingScreen({ target, props: { bot, serverId: "s1", heading } });
            destroy = () => component.$destroy();
            await settle();
        }

        it("titles the choice with the bot and the tool count, and lists the heading's tools with where each came from", async () => {
            await mountHeading();
            const text = target.textContent ?? "";
            expect(text).toContain("When Linear SH uses these 4 tools");
            expect(text).toContain("4 tools");
            expect(text).toContain("from Linear");
            expect(text).toContain("Tap a tool to move it under another heading, like Deletes or sends out.");
            expect(text).toContain("Suggested by Linear · Confirmed by Sara");
            expect(target.querySelectorAll("input[type=search]")).toHaveLength(0);
        });

        it("opens where a tool can move and moves it", async () => {
            mocks.moveMcpTool.mockResolvedValue(
                answer({
                    policyRevision: 5,
                    tools: answer().tools.map((t) =>
                        t.id === "t5" ? { ...t, heading: "deletesOrSends", movedBy: "Khalid" } : t
                    ),
                })
            );
            await mountHeading("changesThings");
            await click(byTestId("bot-tools-tool-save_comment"));
            expect(target.querySelectorAll("[data-testid^=bot-tools-move-]")).toHaveLength(3);
            expect(byTestId("bot-tools-move-changesThings")).toBeNull();
            await click(byTestId("bot-tools-move-deletesOrSends"));
            expect(mocks.moveMcpTool).toHaveBeenCalledWith("b1", "s1", "t5", "deletesOrSends");
            expect(byTestId("bot-tools-moved")?.textContent).toContain("Moved Save comment under Deletes or sends out");
            expect(byTestId("bot-tools-tool-save_comment")).toBeNull();
        });

        it("keeps tools nobody has sorted on a page of their own, where every heading can be picked", async () => {
            mocks.getMcpServerTools.mockResolvedValue(
                answer({ tools: [tool({ id: "t9", name: "mystery", state: "notConfirmedYet", confirmedBy: null })] })
            );
            await mountHeading("unsorted");
            expect(target.textContent).toContain("Not sorted yet");
            expect(target.textContent).not.toContain("When Linear SH uses");
            await click(byTestId("bot-tools-tool-mystery"));
            expect(target.querySelectorAll("[data-testid^=bot-tools-move-]")).toHaveLength(4);
        });
    });

    describe("Asking for approvals", () => {
        const settings: BotToolSettings = { askBeforeMaking: 5, askWhichWay: "rarely", cardWaitMinutes: 10 };

        async function mountApprovals() {
            const component = new BotToolsApprovalsScreen({ target, props: { bot } });
            destroy = () => component.$destroy();
            await settle();
        }
        const picked = (label: string) =>
            [...(target.querySelector(`[role=radiogroup][aria-label="${label}"]`)?.querySelectorAll("button") ?? [])]
                .find((b) => b.getAttribute("aria-checked") === "true")
                ?.textContent?.trim();

        it("shows how long a card waits, the most things it makes before asking, and when it asks which way to go", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            await mountApprovals();
            expect(target.textContent).toContain("Before this bot changes, deletes or sends something");
            expect(picked("Waits for a tap")).toBe("10 min");
            expect(picked("Asks before making more than")).toBe("5");
            expect(picked("Asks which way to go")).toBe("Rarely");
        });

        it("saves only the one that was picked, and shows No limit as a choice", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.saveBotToolSettings.mockResolvedValue({ ...settings, askBeforeMaking: null });
            await mountApprovals();
            const chip = [...target.querySelectorAll<HTMLButtonElement>("button")].find(
                (b) => b.textContent?.trim() === "No limit"
            );
            await click(chip ?? null);
            expect(mocks.saveBotToolSettings).toHaveBeenCalledWith("b1", { askBeforeMaking: null });
            expect(picked("Asks before making more than")).toBe("No limit");
        });

        it("puts the choice back and says so when Orbit refuses it", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.saveBotToolSettings.mockRejectedValue(new Error("Forbidden"));
            await mountApprovals();
            await click(
                [...target.querySelectorAll<HTMLButtonElement>("button")].find(
                    (b) => b.textContent?.trim() === "30 min"
                ) ?? null
            );
            expect(target.querySelector("[role=alert]")?.textContent).toContain("Forbidden");
            expect(picked("Waits for a tap")).toBe("10 min");
        });
    });
});
