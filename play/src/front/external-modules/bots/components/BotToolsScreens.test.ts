import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
    isInitialized: vi.fn(() => true),
    getBotMcpServers: vi.fn(),
    testBotMcpServer: vi.fn(),
    refreshMcpServerTools: vi.fn(),
    getMcpServerTools: vi.fn(),
    moveMcpTool: vi.fn(),
    confirmMcpTools: vi.fn(),
    saveMcpServerSettings: vi.fn(),
    getBotToolSettings: vi.fn(),
    saveBotToolSettings: vi.fn(),
    getAllowedMore: vi.fn(),
    endAllowedMore: vi.fn(),
    setMcpToolSetting: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotData } from "../types";
import { beginBot, botToolsStore, setServers } from "../stores/BotToolsStore";
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
    setting: null,
    ...over,
});

function answer(over: Partial<ServerTools> = {}): ServerTools {
    return {
        serverId: "s1",
        kind: "tools",
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

    describe("Test server", () => {
        const press = async () => {
            byTestId("bot-test-server")?.click();
            await settle();
        };

        it("has the bot server read the tools, then shows them on the page", async () => {
            // Orbit has no tools until the bot server has read and saved them
            let saved = false;
            mocks.getMcpServerTools.mockImplementation(() => Promise.resolve(saved ? answer() : answer({ tools: [] })));
            mocks.testBotMcpServer.mockResolvedValue({ success: true, toolCount: 6, toolNames: [] });
            mocks.refreshMcpServerTools.mockImplementation(() => {
                saved = true;
                return Promise.resolve({ tools: 6, saved: "saved" });
            });
            await mountServer();
            expect(target.textContent).toContain("has no tools sorted yet");

            await press();

            expect(mocks.testBotMcpServer).toHaveBeenCalledWith("b1", "s1");
            expect(mocks.refreshMcpServerTools).toHaveBeenCalledWith("b1", "s1");
            expect(target.textContent).not.toContain("has no tools sorted yet");
            expect(byTestId("bot-tools-heading-looksUp")).not.toBeNull();
            expect(byTestId("bot-test-problem")).toBeNull();
        });

        it("says so when the bot server could not read the tools, instead of showing the same page", async () => {
            mocks.getMcpServerTools.mockResolvedValue(answer({ tools: [] }));
            mocks.testBotMcpServer.mockResolvedValue({ success: true, toolCount: 6, toolNames: [] });
            mocks.refreshMcpServerTools.mockRejectedValue(new Error("Bot-server API error: 502"));
            await mountServer();

            await press();

            expect(byTestId("bot-test-problem")?.textContent).toContain("Couldn't read the tools right now");
        });

        it("says so when the bot server read the tools but Orbit did not get them", async () => {
            mocks.getMcpServerTools.mockResolvedValue(answer({ tools: [] }));
            mocks.testBotMcpServer.mockResolvedValue({ success: true, toolCount: 6, toolNames: [] });
            mocks.refreshMcpServerTools.mockResolvedValue({ tools: 6, saved: "skipped" });
            await mountServer();

            await press();

            expect(byTestId("bot-test-problem")?.textContent).toContain("Couldn't read the tools right now");
        });

        it("does not ask the bot server to read when the server did not answer the test", async () => {
            mocks.getMcpServerTools.mockResolvedValue(answer({ tools: [] }));
            mocks.testBotMcpServer.mockResolvedValue({
                success: false,
                toolCount: 0,
                toolNames: [],
                error: "HTTP 401",
            });
            await mountServer();

            await press();

            expect(mocks.refreshMcpServerTools).not.toHaveBeenCalled();
        });

        it("clears the last problem when the next test works", async () => {
            mocks.getMcpServerTools.mockResolvedValue(answer({ tools: [] }));
            mocks.testBotMcpServer.mockResolvedValue({ success: true, toolCount: 6, toolNames: [] });
            mocks.refreshMcpServerTools
                .mockRejectedValueOnce(new Error("Bot-server API error: 502"))
                .mockResolvedValue({ tools: 6, saved: "saved" });
            await mountServer();
            await press();
            expect(byTestId("bot-test-problem")).not.toBeNull();

            await press();

            expect(byTestId("bot-test-problem")).toBeNull();
        });
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
        const settings: BotToolSettings = {
            askBeforeMaking: 5,
            askWhichWay: "rarely",
            cardWaitMinutes: 10,
            allowMoreIdleMinutes: 60,
            allowMoreMaxMinutes: 480,
        };
        beforeEach(() => {
            mocks.getAllowedMore.mockReset().mockResolvedValue([]);
            mocks.endAllowedMore.mockReset();
        });

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

        it("shows how long “allow more” waits for the person and lasts at most, with the recommended ones picked", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            await mountApprovals();
            expect(target.textContent).toContain("Allow more");
            expect(picked("When the person is quiet for")).toBe("1 hour");
            expect(picked("After at most")).toBe("8 hours");
            const labels = (name: string) =>
                [
                    ...(target.querySelector(`[role=radiogroup][aria-label="${name}"]`)?.querySelectorAll("button") ??
                        []),
                ].map((b) => b.textContent?.trim());
            expect(labels("When the person is quiet for")).toEqual(["30 min", "1 hour", "2 hours"]);
            expect(labels("After at most")).toEqual(["4 hours", "8 hours", "24 hours"]);
        });

        it("saves only the allow-more time that was picked", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.saveBotToolSettings.mockResolvedValue({ ...settings, allowMoreMaxMinutes: 1440 });
            await mountApprovals();
            await click(
                [...target.querySelectorAll<HTMLButtonElement>("button")].find(
                    (b) => b.textContent?.trim() === "24 hours"
                ) ?? null
            );
            expect(mocks.saveBotToolSettings).toHaveBeenCalledWith("b1", { allowMoreMaxMinutes: 1440 });
            expect(picked("After at most")).toBe("24 hours");
        });

        it("says nobody is allowed more right now, with no End all", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            await mountApprovals();
            expect(byTestId("bot-tools-allowed-more")?.textContent).toContain("Allowed more right now");
            expect(byTestId("bot-tools-allowed-more")?.textContent).toContain("Nobody right now");
            expect(byTestId("bot-tools-end-all")).toBeNull();
        });

        it("lists who is allowed more right now and ends them all with End all", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.getAllowedMore.mockResolvedValue([
                { id: "g1", name: "Khalid", isGuest: false, tool: "Create issue", fixed: "WEB" },
                { id: "g2", name: null, isGuest: true, tool: "Create issue", fixed: "" },
                { id: "g3", name: null, isGuest: false, tool: "Create issue", fixed: "MAP" },
            ]);
            mocks.endAllowedMore.mockResolvedValue(3);
            await mountApprovals();
            const rows = [...target.querySelectorAll("[data-testid=bot-tools-allowed-row]")].map((r) => r.textContent);
            expect(rows).toEqual([
                "Khalid: Create issue, more with WEB",
                "A guest: more Create issue",
                "Someone: Create issue, more with MAP",
            ]);
            await click(byTestId("bot-tools-end-all"));
            expect(mocks.endAllowedMore).toHaveBeenCalledWith("b1");
            expect(target.querySelectorAll("[data-testid=bot-tools-allowed-row]")).toHaveLength(0);
            expect(byTestId("bot-tools-allowed-more")?.textContent).toContain("Nobody right now");
            expect(byTestId("bot-tools-end-all")).toBeNull();
        });

        it("keeps the list and says so when End all fails", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.getAllowedMore.mockResolvedValue([
                { id: "g1", name: "Khalid", isGuest: false, tool: "Create issue", fixed: "WEB" },
            ]);
            mocks.endAllowedMore.mockRejectedValue(new Error("Forbidden"));
            await mountApprovals();
            await click(byTestId("bot-tools-end-all"));
            expect(target.querySelector("[role=alert]")?.textContent).toContain("Forbidden");
            expect(target.querySelectorAll("[data-testid=bot-tools-allowed-row]")).toHaveLength(1);
        });

        it("leaves the list out when Orbit can't say, and the settings still show", async () => {
            mocks.getBotToolSettings.mockResolvedValue(settings);
            mocks.getAllowedMore.mockRejectedValue(new Error("down"));
            vi.spyOn(console, "error").mockImplementation(() => undefined);
            await mountApprovals();
            expect(byTestId("bot-tools-allowed-more")).toBeNull();
            expect(picked("After at most")).toBe("8 hours");
        });
    });
    describe("a ready-made App's actions on a Brick, from Apps (Ask, Do, Ignore)", () => {
        const gmailServer = {
            ...server,
            name: "Gmail",
            serverUrl: "https://orbit.example/link",
            authType: "none" as const,
        };
        const action = (
            id: string,
            name: string,
            title: string,
            heading: ServerTool["heading"],
            over: Partial<ServerTool> = {}
        ) =>
            tool({
                id,
                name,
                title,
                heading,
                suggestedHeading: heading,
                suggestionSource: "builtIn",
                confirmedBy: null,
                ...over,
            });
        function gmail(over: Partial<ServerTools> = {}): ServerTools {
            return answer({
                kind: "appActions",
                settings: {
                    looksUp: "rightAway",
                    makesNew: "rightAway",
                    changesThings: "asksFirst",
                    deletesOrSends: "asksFirst",
                },
                tools: [
                    action("a1", "GMAIL_FETCH_EMAILS", "Fetch emails", "looksUp"),
                    action("a2", "GMAIL_GET_THREAD", "Read a thread", "looksUp"),
                    action("a3", "GMAIL_LIST_LABELS", "List labels", "looksUp"),
                    action("a4", "GMAIL_SEND_EMAIL", "Send email", "deletesOrSends", {
                        description: "Sends an email from your address",
                    }),
                    action("a5", "GMAIL_REPLY_TO_THREAD", "Reply to an email", "deletesOrSends"),
                    action("a6", "GMAIL_DELETE_MESSAGE", "Delete for good", "deletesOrSends", { setting: "off" }),
                    // Not confirmed by a person: an App's actions never ask for a check
                    action("a7", "GMAIL_CREATE_DRAFT", "Create a draft", "makesNew", { state: "notConfirmedYet" }),
                ],
                ...over,
            });
        }
        const brick = { id: "b1", name: "Nudge" } as unknown as BotData;

        beforeEach(() => {
            mocks.getBotMcpServers.mockResolvedValue([gmailServer]);
            mocks.getMcpServerTools.mockResolvedValue(gmail());
        });

        // Apps opens these screens with the Brick's servers already read (AppBrickScreen), not through the server buttons
        function fromApps() {
            beginBot("b1");
            setServers("b1", [gmailServer]);
        }

        async function mountApp(appMode = true) {
            fromApps();
            const component = new BotToolsServerScreen({
                target,
                props: { bot: brick, serverId: "s1", onOpenHeading: vi.fn(), onGone: vi.fn(), appMode },
            });
            destroy = () => component.$destroy();
            await settle();
        }

        async function mountAppHeading(heading: "deletesOrSends" | "looksUp" = "deletesOrSends") {
            fromApps();
            const gone = new BotToolsServerScreen({
                target: document.createElement("div"),
                props: { bot: brick, serverId: "s1", onOpenHeading: vi.fn(), onGone: vi.fn(), appMode: true },
            });
            await settle();
            gone.$destroy();
            const component = new BotToolsHeadingScreen({
                target,
                props: { bot: brick, serverId: "s1", heading, appMode: true },
            });
            destroy = () => component.$destroy();
            await settle();
        }

        it("hides the server buttons and the check banner, and uses the App's words", async () => {
            await mountApp();
            expect(mocks.getMcpServerTools).toHaveBeenCalledWith("b1", "s1");
            expect(byTestId("bot-tools-server-head")).toBeNull();
            expect(byTestId("bot-tools-confirm")).toBeNull();
            expect(byTestId("bot-tools-top")?.textContent).toContain(
                "Pick what Nudge may do in Gmail. Same in chat, on maps and when brought along."
            );
            const sends = byTestId("bot-tools-heading-deletesOrSends")?.textContent ?? "";
            expect(sends).toContain("3 things");
            expect(sends).toContain("Deletes things, sends email or messages, or spends money");
            // Two names, never cut, then +N more
            expect(sends).toContain("Send email, Reply to an email");
            expect(sends).toContain("+1 more");
        });

        it("says an action's own choice in search results, not its heading's", async () => {
            await mountApp();
            const search = byTestId("bot-tools-search") as HTMLInputElement;
            search.value = "delete";
            search.dispatchEvent(new Event("input"));
            await settle();
            const results = target.querySelector(".ts-found")?.textContent ?? "";
            expect(results).toContain("Delete for good");
            expect(results).not.toContain("Asks first");
            expect(results).toContain("Off");
        });

        it("shows a bot's own server as before when it is not an App's actions", async () => {
            mocks.getMcpServerTools.mockResolvedValue(answer());
            await mountApp();
            expect(byTestId("bot-tools-server-head")).not.toBeNull();
            expect(byTestId("bot-tools-heading-looksUp")?.textContent).toContain(
                "List issues, Get issue, List comments"
            );
        });

        it("keeps the bot page exactly as it was for the same answer", async () => {
            await mountApp(false);
            expect(byTestId("bot-tools-server-head")).not.toBeNull();
            expect(byTestId("bot-tools-confirm")).not.toBeNull();
            expect(byTestId("bot-tools-top")?.textContent).not.toContain("Pick what");
        });

        it("says tap one, with no source line and no move buttons, and tags an action with its own choice", async () => {
            await mountAppHeading();
            const text = target.textContent ?? "";
            expect(text).toContain("When Nudge does these 3 things");
            expect(text).toContain("3 things");
            expect(text).toContain("from Gmail");
            expect(text).toContain("Shows you a card and waits for your OK.");
            expect(text).toContain("Tap one to set it on its own.");
            expect(text).not.toContain("Suggested");
            expect(text).not.toContain("Tap a tool to move it");
            expect(byTestId("bot-tools-own-GMAIL_DELETE_MESSAGE")?.textContent).toBe("Off");
            expect(byTestId("bot-tools-own-GMAIL_SEND_EMAIL")).toBeNull();
            await click(byTestId("bot-tools-tool-GMAIL_SEND_EMAIL"));
            expect(target.querySelectorAll("[data-testid^=bot-tools-move-]")).toHaveLength(0);
        });

        it("picks nothing while an action follows its heading, and saves its own choice", async () => {
            mocks.setMcpToolSetting.mockResolvedValue(
                gmail({ tools: gmail().tools.map((t) => (t.id === "a4" ? { ...t, setting: "rightAway" } : t)) })
            );
            await mountAppHeading();
            await click(byTestId("bot-tools-tool-GMAIL_SEND_EMAIL"));
            const choice = byTestId("bot-tools-action-choice");
            expect(choice?.querySelectorAll("[aria-checked=true]")).toHaveLength(0);
            expect(choice?.textContent).toContain("Same as heading (Asks first)");
            await click(byTestId("bot-tools-action-choice-rightAway"));
            expect(mocks.setMcpToolSetting).toHaveBeenCalledWith("b1", "s1", "a4", "rightAway");
            expect(byTestId("bot-tools-action-choice-rightAway")?.getAttribute("aria-checked")).toBe("true");
            expect(byTestId("bot-tools-action-choice")?.textContent).toContain("Set just for this one");
            expect(byTestId("bot-tools-own-GMAIL_SEND_EMAIL")?.textContent).toBe("Right away");
        });

        it("follows the heading again with Use heading again", async () => {
            mocks.setMcpToolSetting.mockResolvedValue(
                gmail({ tools: gmail().tools.map((t) => (t.id === "a6" ? { ...t, setting: null } : t)) })
            );
            await mountAppHeading();
            await click(byTestId("bot-tools-tool-GMAIL_DELETE_MESSAGE"));
            expect(byTestId("bot-tools-action-choice-off")?.getAttribute("aria-checked")).toBe("true");
            await click(byTestId("bot-tools-use-heading"));
            expect(mocks.setMcpToolSetting).toHaveBeenCalledWith("b1", "s1", "a6", null);
            expect(byTestId("bot-tools-own-GMAIL_DELETE_MESSAGE")).toBeNull();
            expect(byTestId("bot-tools-action-choice")?.textContent).toContain("Same as heading (Asks first)");
        });

        it("puts the action's choice back and says so when Orbit refuses it", async () => {
            mocks.setMcpToolSetting.mockRejectedValue(new Error("Could not save"));
            await mountAppHeading();
            await click(byTestId("bot-tools-tool-GMAIL_SEND_EMAIL"));
            await click(byTestId("bot-tools-action-choice-off"));
            expect(target.querySelector("[role=alert]")?.textContent).toContain("Could not save");
            expect(byTestId("bot-tools-own-GMAIL_SEND_EMAIL")).toBeNull();
        });
    });
});
