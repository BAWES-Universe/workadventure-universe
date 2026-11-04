import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { tick } from "svelte";
import { get } from "svelte/store";

const mocks = vi.hoisted(() => ({
    getBotPermissions: vi.fn(),
    saveBotPermissions: vi.fn(),
    saveBotRule: vi.fn(),
    deleteBotRule: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));
vi.mock("../../../Components/Input/MemberAutocomplete.svelte", async () => ({
    default: (await import("./testStub.svelte")).default,
}));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import type { BotPermissions, BotRole, BotRule } from "../accessModel";
import { botPermissionsStore, loadBotPermissions } from "../stores/BotPermissionsStore";
import type { BotData } from "../types";
import PermissionsGroup from "./page/PermissionsGroup.svelte";
import LimitSuggestion from "./page/LimitSuggestion.svelte";
import BotRuleScreen from "./BotRuleScreen.svelte";
import BotRuleAdd from "./BotRuleAdd.svelte";

const roles: BotRole[] = [
    {
        id: "role-everyone",
        key: "everyone",
        name: "Everyone",
        color: "#999999",
        builtIn: true,
        defaults: { chat: true, dm: false, summon: false, manage: false, change: false, deleteOrSend: false },
    },
    {
        id: "role-member",
        key: "member",
        name: "Member",
        color: "#3b82f6",
        builtIn: true,
        defaults: { chat: true, dm: true, summon: true, manage: false, change: true, deleteOrSend: false },
    },
];

function rule(partial: Partial<BotRule> = {}): BotRule {
    return {
        id: "r1",
        roleId: "role-member",
        userId: null,
        role: { key: "member", name: "Member", color: "#3b82f6" },
        person: null,
        chat: "default",
        dm: "default",
        summon: "default",
        manage: "default",
        change: "default",
        deleteOrSend: "default",
        ...partial,
    };
}

function permissions(partial: Partial<BotPermissions> = {}): BotPermissions {
    return { privateBot: false, refusalReply: null, dailyReplyCap: null, rules: [], roles, ...partial };
}

const bot = {
    id: "b1",
    name: "Nora",
    behaviorConfig: { assignedSpace: { center: { x: 0, y: 0 }, radius: 0 } },
} as BotData;

async function settle(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 5);
    });
    await tick();
}

describe("the Permissions screens", () => {
    let target: HTMLElement;
    let destroy: () => void = () => undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });

    beforeEach(() => {
        vi.clearAllMocks();
        botPermissionsStore.set(undefined);
        target = document.createElement("div");
        document.body.append(target);
    });

    afterEach(() => {
        destroy();
        destroy = () => undefined;
        document.body.innerHTML = "";
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byTestId = (id: string) => [...target.querySelectorAll<HTMLElement>(`[data-testid=${id}]`)];

    async function open(data: BotPermissions) {
        mocks.getBotPermissions.mockResolvedValue(data);
        await loadBotPermissions("b1");
    }

    it("says a bot nobody limited is public", async () => {
        mocks.getBotPermissions.mockResolvedValue(permissions());
        const component = new PermissionsGroup({
            target,
            props: { bot, open: false, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Permissions");
        expect(text()).toContain("Public");
        component.$set({ open: true });
        await settle();
        expect(byTestId("bot-visibility")[0].textContent).toContain("Public bot");
        expect(byTestId("bot-visibility")[0].textContent).toContain(
            "Anyone who can enter this bot's room can use this bot, guests too"
        );
        expect(byTestId("bot-visibility-change")[0].textContent?.trim()).toBe("Make private");
    });

    it("lists each row with what it says, and a tap opens that row", async () => {
        await open(permissions({ rules: [rule({ chat: "yes", summon: "no" })] }));
        const onOpenRule = vi.fn();
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule, onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        const [row] = byTestId("bot-access-rule");
        expect(row.textContent).toContain("Member");
        expect(row.textContent).toContain("Chat nearby · Summon blocked");
        row.click();
        expect(onOpenRule).toHaveBeenCalledWith(expect.objectContaining({ id: "r1" }));
    });

    function mount(extra: Record<string, unknown> = {}) {
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn(), ...extra },
        });
        destroy = () => component.$destroy();
        return component;
    }

    const sheet = () => document.querySelector<HTMLElement>("[data-testid=bot-visibility-sheet]");
    const sheetText = () => sheet()?.textContent?.replace(/\s+/g, " ").trim() ?? "";

    it("says on a Private bot with nobody added who can always use it, by name", async () => {
        await open(permissions({ privateBot: true, universe: { name: "Nova", ownerName: "Layla" } }));
        mount({ bot: { ...bot, createdBy: { id: "u1", name: "Sara" } } });
        await settle();
        expect(byTestId("bot-visibility")[0].textContent).toContain("Private bot");
        expect(text()).toContain("Only Sara, Layla and Nova's Admins can use this bot until you add someone");
        expect(byTestId("bot-visibility-change")[0].textContent?.trim()).toBe("Make public");
    });

    it("names the roles and people who can use a Private bot, and the ones with own rules in the brief", async () => {
        await open(
            permissions({
                privateBot: true,
                rules: [
                    rule({ chat: "yes", dm: "yes", summon: "yes" }),
                    rule({
                        id: "r2",
                        roleId: null,
                        userId: "u2",
                        role: null,
                        person: { name: "Omar" },
                        chat: "yes",
                        summon: "no",
                    }),
                    rule({ id: "r3", roleId: "role-everyone", role: { key: "everyone", name: "Everyone", color: "" } }),
                ],
            })
        );
        mount();
        await settle();
        expect(text()).toContain("Private · own rules for Member, Omar and Everyone");
        // Everyone's row says Default everywhere: on a Private bot that lets nobody in
        expect(byTestId("bot-visibility")[0].textContent).toContain("Only Member and Omar can use this bot");
    });

    it("says which roles allow changing, and deleting or sending, with Admin always one of them", async () => {
        await open(permissions());
        mount();
        await settle();
        const line = byTestId("bot-access-tools-line")[0].textContent?.replace(/\s+/g, " ") ?? "";
        expect(line).toContain("Changing, deleting and sending");
        expect(line).toContain("Admin and Member can have this bot change things.");
        expect(line).toContain("Admin can also have this bot delete or send.");
        expect(line).toContain("Tap a role or person to set them differently.");
    });

    it("still draws the tools line when Orbit sends no roles", async () => {
        mocks.getBotPermissions.mockResolvedValue({ rules: [] } as unknown as BotPermissions);
        await loadBotPermissions("b1");
        mount();
        await settle();
        expect(byTestId("bot-access-tools-line")[0].textContent).toContain("Admin can have this bot change things.");
    });

    it("shows a row's changing and deleting or sending in its line", async () => {
        await open(permissions({ rules: [rule({ change: "yes", deleteOrSend: "yes" })] }));
        mount();
        await settle();
        expect(byTestId("bot-access-rule")[0].textContent).toContain("Change things, Delete or send");
    });

    it("asks before making the bot private, naming who is left, and saves only on the button", async () => {
        await open(
            permissions({
                rules: [rule({ chat: "yes" })],
                refusalReply: "Not today.",
                universe: { name: "Nova", ownerName: "Layla" },
            })
        );
        mocks.saveBotPermissions.mockResolvedValue(permissions({ privateBot: true }));
        mount({ bot: { ...bot, name: "Linear SH", createdBy: { id: "u1", name: "Sara" } } });
        await settle();
        byTestId("bot-visibility-change")[0].click();
        await settle();
        expect(sheetText()).toContain("Make Linear SH private?");
        expect(sheetText()).toContain("Only Member will be able to use this bot, each with the rules set for them.");
        expect(sheetText()).toContain(
            "Everyone else, guests too, won't be able to chat with, DM or summon this bot. This bot answers them with: “Not today.”"
        );
        expect(sheetText()).toContain(
            "Sara made this bot and Layla owns Nova, so they can always use this bot, and so can Nova's Admins."
        );
        expect(sheetText()).toContain("You can make this bot public again any time.");
        expect(mocks.saveBotPermissions).not.toHaveBeenCalled();

        document.querySelector<HTMLElement>("[data-testid=bot-visibility-sheet-cancel]")?.click();
        await settle();
        expect(sheet()).toBeNull();
        expect(mocks.saveBotPermissions).not.toHaveBeenCalled();

        byTestId("bot-visibility-change")[0].click();
        await settle();
        document.querySelector<HTMLElement>("[data-testid=bot-visibility-sheet-confirm]")?.click();
        await settle();
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { privateBot: true });
        expect(sheet()).toBeNull();
    });

    it("says what the bot answers with by default, and who is left when nobody was added", async () => {
        await open(permissions({ universe: { name: "Nova", ownerName: "Layla" } }));
        mount({ bot: { ...bot, name: "Linear SH", createdBy: { id: "u1", name: "Sara" } } });
        await settle();
        byTestId("bot-visibility-change")[0].click();
        await settle();
        expect(sheetText()).toContain(
            "No roles or people are added yet, so only Sara, Layla and Nova's Admins will be able to use this bot."
        );
        expect(sheetText()).toContain("This bot answers them with: “Sorry, I can't chat with you.”");
    });

    it("asks before making the bot public, and says guests can use it too", async () => {
        await open(permissions({ privateBot: true, rules: [rule({ chat: "yes" })] }));
        mocks.saveBotPermissions.mockResolvedValue(permissions());
        mount({ bot: { ...bot, name: "Linear SH" } });
        await settle();
        byTestId("bot-visibility-change")[0].click();
        await settle();
        expect(sheetText()).toContain("Make Linear SH public?");
        expect(sheetText()).toContain(
            "Anyone who can enter this bot's room, guests too, will be able to chat with and summon this bot. Anyone signed in can also DM this bot."
        );
        expect(sheetText()).toContain("Member keep the rules set for them.");
        expect(sheetText()).toContain("You can make this bot private again any time.");
        document.querySelector<HTMLElement>("[data-testid=bot-visibility-sheet-confirm]")?.click();
        await settle();
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { privateBot: false });
    });

    it("leaves the sheet with Escape and changes nothing", async () => {
        await open(permissions());
        mount();
        await settle();
        byTestId("bot-visibility-change")[0].click();
        await settle();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
        await settle();
        expect(sheet()).toBeNull();
        expect(mocks.saveBotPermissions).not.toHaveBeenCalled();
    });

    it("shows why a change was refused, in Orbit's words", async () => {
        await open(permissions());
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        botPermissionsStore.update((state) => (state ? { ...state, saveError: "Only the owner can do that" } : state));
        await settle();
        expect(byTestId("bot-access-error")[0].textContent).toBe("Only the owner can do that");
    });

    it("offers a retry when the list can't be loaded", async () => {
        mocks.getBotPermissions.mockRejectedValue(new Error("API error: 500"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Couldn't load who can use this bot.");
        mocks.getBotPermissions.mockResolvedValue(permissions());
        byTestId("bot-access-retry")[0].click();
        await settle();
        expect(text()).toContain("Public bot");
    });

    it("keeps a typed refusal line with the bot it was typed for when the page moves to another bot", async () => {
        await open(permissions());
        mocks.saveBotPermissions.mockResolvedValue(permissions({ refusalReply: "Only the team" }));
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        const box = byTestId("bot-access-reply")[0] as HTMLTextAreaElement;
        box.value = "Only the team";
        box.dispatchEvent(new Event("input"));

        mocks.getBotPermissions.mockResolvedValue(permissions());
        component.$set({ bot: { ...bot, id: "b2" } });
        await settle();
        expect((byTestId("bot-access-reply")[0] as HTMLTextAreaElement).value).toBe("");

        byTestId("bot-access-reply")[0].dispatchEvent(new Event("blur"));
        await settle();
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { refusalReply: "Only the team" });
        expect(mocks.saveBotPermissions).not.toHaveBeenCalledWith("b2", expect.anything());
    });

    it("keeps a trailing space in the refusal line while it is being typed, and settles when the box is left", async () => {
        await open(permissions());
        mocks.saveBotPermissions.mockResolvedValue(permissions({ refusalReply: "Only the team" }));
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        const box = byTestId("bot-access-reply")[0] as HTMLTextAreaElement;
        box.dispatchEvent(new Event("focus"));
        box.value = "Only the team ";
        box.dispatchEvent(new Event("input"));
        box.dispatchEvent(new Event("input"));
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 900);
        });
        await settle();
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { refusalReply: "Only the team" });
        expect((byTestId("bot-access-reply")[0] as HTMLTextAreaElement).value).toBe("Only the team ");

        byTestId("bot-access-reply")[0].dispatchEvent(new Event("blur"));
        await settle();
        expect((byTestId("bot-access-reply")[0] as HTMLTextAreaElement).value).toBe("Only the team");
    });

    it("shows No / Default / Yes with what Default comes to, and saves a tap", async () => {
        await open(permissions({ rules: [rule()] }));
        mocks.saveBotRule.mockResolvedValue(rule({ summon: "no" }));
        const component = new BotRuleScreen({
            target,
            props: { botId: "b1", botName: "Linear SH", ruleId: "r1", onClose: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Member's rules for Linear SH");
        expect(text()).toContain("Direct messages");
        expect(text()).toContain("One to one with this bot, from anywhere. Needs sign-in");
        expect(text()).toContain("Default here means Yes, from Member");
        expect(text()).toContain("Default here means No");
        // Summon is the third group of three choices, after nearby chat and direct messages; No is its first
        byTestId("bot-rule-no")[2].click();
        await settle();
        expect(mocks.saveBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" }, { summon: "no" });
        expect(get(botPermissionsStore)?.data?.rules[0].summon).toBe("no");
    });

    it("shows the two rows for changing, and deleting or sending, between Summon and Manage, and saves them", async () => {
        await open(permissions({ rules: [rule()] }));
        mocks.saveBotRule.mockResolvedValue(rule({ deleteOrSend: "yes" }));
        const component = new BotRuleScreen({
            target,
            props: { botId: "b1", botName: "Linear SH", ruleId: "r1", onClose: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        const titles = [...target.querySelectorAll(".br-t")].map((node) => node.textContent);
        expect(titles).toEqual([
            "Chat nearby",
            "Direct messages",
            "Summon",
            "Have this bot change things",
            "Have this bot delete or send",
            "Manage this bot",
        ]);
        expect(text()).toContain(
            "With this bot's tools under Makes new things and Changes things, like adding a Linear issue"
        );
        expect(text()).toContain(
            "With this bot's tools under Deletes or sends out, like sending an email or deleting a page"
        );
        expect(text()).toContain("Member then goes back to the Member role's settings in Orbit");
        // Member's role gives changing but not deleting or sending, so Default means Yes for one and No for the other
        const defaults = byTestId("bot-rule-default-line").map((line) => line.textContent);
        expect(defaults[3]).toBe("Default here means Yes, from Member");
        expect(defaults[4]).toBe("Default here means No");
        byTestId("bot-rule-yes")[4].click();
        await settle();
        expect(mocks.saveBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" }, { deleteOrSend: "yes" });
    });

    it("says a person goes back to what their roles allow", async () => {
        await open(
            permissions({ rules: [rule({ roleId: null, userId: "u2", role: null, person: { name: "Omar" } })] })
        );
        const component = new BotRuleScreen({
            target,
            props: { botId: "b1", botName: "Linear SH", ruleId: "r1", onClose: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Omar's rules for Linear SH");
        expect(text()).toContain("Omar then goes back to what Omar's roles allow");
    });

    it("closes itself when its row is gone, and removes only after a tap", async () => {
        await open(permissions({ rules: [rule()] }));
        mocks.deleteBotRule.mockResolvedValue(undefined);
        const onClose = vi.fn();
        const component = new BotRuleScreen({ target, props: { botId: "b1", botName: "Nora", ruleId: "r1", onClose } });
        destroy = () => component.$destroy();
        await settle();
        expect(onClose).not.toHaveBeenCalled();
        byTestId("bot-rule-remove")[0].click();
        await settle();
        expect(mocks.deleteBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" });
        expect(onClose).toHaveBeenCalled();
    });

    it("adds a role with one tap and opens it", async () => {
        await open(permissions({ rules: [] }));
        mocks.saveBotRule
            .mockResolvedValueOnce(rule({ id: "r7" }))
            .mockResolvedValueOnce(rule({ id: "r7", chat: "yes", dm: "yes", summon: "yes" }));
        const onAdded = vi.fn();
        const component = new BotRuleAdd({ target, props: { botId: "b1", onAdded } });
        destroy = () => component.$destroy();
        await settle();
        expect(byTestId("bot-rule-add-role").map((b) => b.textContent?.trim())).toEqual(["Everyone", "Member"]);
        byTestId("bot-rule-add-role")[1].click();
        await settle();
        expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "r7", chat: "yes" }));
    });

    it("opens nothing when the screen was left before the row was added", async () => {
        await open(permissions({ rules: [] }));
        let release: (value: ReturnType<typeof rule>) => void = () => undefined;
        mocks.saveBotRule
            .mockReturnValueOnce(
                new Promise((resolve) => {
                    release = resolve;
                })
            )
            .mockResolvedValueOnce(rule({ id: "r7", chat: "yes", dm: "yes", summon: "yes" }));
        const onAdded = vi.fn();
        const component = new BotRuleAdd({ target, props: { botId: "b1", onAdded } });
        destroy = () => undefined;
        await settle();
        byTestId("bot-rule-add-role")[1].click();
        component.$destroy();
        release(rule({ id: "r7" }));
        await settle();
        expect(onAdded).not.toHaveBeenCalled();
    });

    it("says why when adding is refused, and stays on the screen", async () => {
        await open(permissions({ rules: [] }));
        mocks.saveBotRule.mockRejectedValue(new Error("The bot's owner always has access"));
        const onAdded = vi.fn();
        const component = new BotRuleAdd({ target, props: { botId: "b1", onAdded } });
        destroy = () => component.$destroy();
        await settle();
        byTestId("bot-rule-add-role")[0].click();
        await settle();
        expect(onAdded).not.toHaveBeenCalled();
        expect(byTestId("bot-access-error")[0].textContent).toBe("The bot's owner always has access");
    });

    it("asks to limit who can use the bot, with two clear answers", async () => {
        const onChoose = vi.fn();
        const onKeep = vi.fn();
        const component = new LimitSuggestion({ target, props: { name: "Nora", onChoose, onKeep } });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Limit who can use Nora?");
        byTestId("bot-limit-choose")[0].click();
        byTestId("bot-limit-keep")[0].click();
        expect(onChoose).toHaveBeenCalledTimes(1);
        expect(onKeep).toHaveBeenCalledTimes(1);
    });
});
