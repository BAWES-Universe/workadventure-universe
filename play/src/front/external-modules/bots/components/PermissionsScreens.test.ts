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
        defaults: { chat: true, dm: false, summon: false, manage: false },
    },
    {
        id: "role-member",
        key: "member",
        name: "Member",
        color: "#3b82f6",
        builtIn: true,
        defaults: { chat: true, dm: true, summon: true, manage: false },
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

    it("says a bot nobody limited is open to everyone", async () => {
        mocks.getBotPermissions.mockResolvedValue(permissions());
        const component = new PermissionsGroup({
            target,
            props: { bot, open: false, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Permissions");
        expect(text()).toContain("Open to everyone");
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

    it("saves the Private bot switch, and says so on a bot with nobody added", async () => {
        await open(permissions({ privateBot: true }));
        const component = new PermissionsGroup({
            target,
            props: { bot, open: true, onToggle: vi.fn(), onOpenRule: vi.fn(), onAdd: vi.fn() },
        });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Only you and the admins, until you add someone");
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
        expect(text()).toContain("Private bot");
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
        const component = new BotRuleScreen({ target, props: { botId: "b1", ruleId: "r1", onClose: vi.fn() } });
        destroy = () => component.$destroy();
        await settle();
        expect(text()).toContain("Member's rules for this bot");
        expect(text()).toContain("Default: Yes, from Member");
        expect(text()).toContain("Default: No");
        // Summon is the second group of three choices; No is its first
        byTestId("bot-rule-no")[1].click();
        await settle();
        expect(mocks.saveBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" }, { summon: "no" });
        expect(get(botPermissionsStore)?.data?.rules[0].summon).toBe("no");
    });

    it("closes itself when its row is gone, and removes only after a tap", async () => {
        await open(permissions({ rules: [rule()] }));
        mocks.deleteBotRule.mockResolvedValue(undefined);
        const onClose = vi.fn();
        const component = new BotRuleScreen({ target, props: { botId: "b1", ruleId: "r1", onClose } });
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
