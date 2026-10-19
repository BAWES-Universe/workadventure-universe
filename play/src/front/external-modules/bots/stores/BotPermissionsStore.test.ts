import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BotPermissions, BotRule } from "../accessModel";

const mocks = vi.hoisted(() => ({
    getBotPermissions: vi.fn(),
    saveBotPermissions: vi.fn(),
    saveBotRule: vi.fn(),
    deleteBotRule: vi.fn(),
}));

vi.mock("../services/BotApiService", () => ({ botApiService: mocks }));
vi.mock("../../../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return {
        default: readable({
            mapEditor: { edit: { bots: { page: { access: { saveFailed: () => "That didn't save. Try again." } } } } },
        }),
    };
});

import {
    addRule,
    botPermissionsStore,
    loadBotPermissions,
    removeRule,
    setPrivateBot,
    setRefusalReply,
    setRuleValue,
} from "./BotPermissionsStore";

function rule(partial: Partial<BotRule> = {}): BotRule {
    return {
        id: "r1",
        roleId: "role-member",
        userId: null,
        role: { key: "member", name: "Member", color: "" },
        person: null,
        chat: "default",
        dm: "default",
        summon: "default",
        manage: "default",
        ...partial,
    };
}

function permissions(partial: Partial<BotPermissions> = {}): BotPermissions {
    return { privateBot: false, refusalReply: null, dailyReplyCap: null, rules: [], roles: [], ...partial };
}

async function opened(data: BotPermissions) {
    mocks.getBotPermissions.mockResolvedValueOnce(data);
    await loadBotPermissions("b1");
}

describe("who may use the bot, as the page holds it", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        botPermissionsStore.set(undefined);
    });

    it("loads, and says it could not when there is nothing to show", async () => {
        mocks.getBotPermissions.mockRejectedValueOnce(new Error("API error: 500"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await loadBotPermissions("b1");
        expect(get(botPermissionsStore)).toEqual({ botId: "b1", status: "failed" });
    });

    it("keeps showing what it holds when a refresh fails, and says why", async () => {
        await opened(permissions({ privateBot: true }));
        mocks.getBotPermissions.mockRejectedValueOnce(new Error("API error: 500"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        await loadBotPermissions("b1");
        const state = get(botPermissionsStore);
        expect(state?.data?.privateBot).toBe(true);
        expect(state?.saveError).toBeTruthy();
    });

    it("shows a switch change at once and keeps what Orbit answers", async () => {
        await opened(permissions());
        mocks.saveBotPermissions.mockResolvedValueOnce(permissions({ privateBot: true, refusalReply: "x" }));
        const saving = setPrivateBot("b1", true);
        expect(get(botPermissionsStore)?.data?.privateBot).toBe(true);
        await saving;
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { privateBot: true });
        expect(get(botPermissionsStore)?.data?.refusalReply).toBe("x");
        expect(get(botPermissionsStore)?.saveError).toBeUndefined();
    });

    it("goes back to what Orbit holds and says so when a change is refused", async () => {
        await opened(permissions({ privateBot: false }));
        mocks.saveBotPermissions.mockRejectedValueOnce(new Error("Only the owner can do that"));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions({ privateBot: false }));
        await setPrivateBot("b1", true);
        const state = get(botPermissionsStore);
        expect(state?.data?.privateBot).toBe(false);
        expect(state?.saveError).toBe("Only the owner can do that");
    });

    it("says whether the refusal line was saved, so the page keeps the words when it was not", async () => {
        await opened(permissions());
        mocks.saveBotPermissions.mockResolvedValueOnce(permissions({ refusalReply: "Sorry" }));
        await expect(setRefusalReply("b1", " Sorry ")).resolves.toBe(true);
        expect(mocks.saveBotPermissions).toHaveBeenCalledWith("b1", { refusalReply: "Sorry" });

        mocks.saveBotPermissions.mockRejectedValueOnce(new Error("API error: 500"));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions({ refusalReply: "Sorry" }));
        await expect(setRefusalReply("b1", "Other")).resolves.toBe(false);
        expect(get(botPermissionsStore)?.saveError).toBeTruthy();
    });

    it("changes one choice of one row and nothing else", async () => {
        await opened(permissions({ rules: [rule({ id: "r1" }), rule({ id: "r2", roleId: "role-editor" })] }));
        mocks.saveBotRule.mockResolvedValueOnce(rule({ id: "r1", chat: "no" }));
        await setRuleValue("b1", rule({ id: "r1" }), "chat", "no");
        expect(mocks.saveBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" }, { chat: "no" });
        const rules = get(botPermissionsStore)?.data?.rules ?? [];
        expect(rules.map((r) => r.chat)).toEqual(["no", "default"]);
    });

    it("reverts a row's choice when Orbit refuses it", async () => {
        const held = rule({ id: "r1" });
        await opened(permissions({ rules: [held] }));
        mocks.saveBotRule.mockRejectedValueOnce(new Error("API error: 500"));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions({ rules: [held] }));
        await setRuleValue("b1", held, "summon", "no");
        const state = get(botPermissionsStore);
        expect(state?.data?.rules[0].summon).toBe("default");
        expect(state?.saveError).toBe("That didn't save. Try again.");
    });

    it("adds a role with Yes for chatting and calling it over, so a Private bot lets them in", async () => {
        await opened(permissions({ privateBot: true }));
        mocks.saveBotRule
            .mockResolvedValueOnce(rule({ id: "r9" }))
            .mockResolvedValueOnce(rule({ id: "r9", chat: "yes", dm: "yes", summon: "yes" }));
        const added = await addRule("b1", { roleId: "role-member" });
        expect(mocks.saveBotRule).toHaveBeenNthCalledWith(1, "b1", { roleId: "role-member" }, {});
        expect(mocks.saveBotRule).toHaveBeenNthCalledWith(
            2,
            "b1",
            { roleId: "role-member" },
            { chat: "yes", dm: "yes", summon: "yes" }
        );
        expect(added.chat).toBe("yes");
        expect(get(botPermissionsStore)?.data?.rules.map((r) => r.id)).toEqual(["r9"]);
    });

    it("keeps what a role or person that already had a row said", async () => {
        await opened(permissions());
        mocks.saveBotRule.mockResolvedValueOnce(rule({ id: "r9", chat: "no" }));
        const added = await addRule("b1", { roleId: "role-member" });
        expect(mocks.saveBotRule).toHaveBeenCalledTimes(1);
        expect(added.chat).toBe("no");
    });

    it("says why when a person cannot be added", async () => {
        await opened(permissions());
        mocks.saveBotRule.mockRejectedValueOnce(new Error("The bot's owner always has access"));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions());
        await expect(addRule("b1", { identifier: "owner" })).rejects.toThrow("The bot's owner always has access");
        expect(get(botPermissionsStore)?.data?.rules).toEqual([]);
    });

    it("takes a row off at once and puts it back when Orbit refuses", async () => {
        const held = rule({ id: "r1" });
        await opened(permissions({ rules: [held] }));
        mocks.deleteBotRule.mockResolvedValueOnce(undefined);
        await removeRule("b1", held);
        expect(mocks.deleteBotRule).toHaveBeenCalledWith("b1", { roleId: "role-member" });
        expect(get(botPermissionsStore)?.data?.rules).toEqual([]);

        mocks.deleteBotRule.mockRejectedValueOnce(new Error("API error: 500"));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions({ rules: [held] }));
        await removeRule("b1", held);
        expect(get(botPermissionsStore)?.data?.rules).toHaveLength(1);
        expect(get(botPermissionsStore)?.saveError).toBeTruthy();
    });

    it("ignores an answer that arrives after the page moved to another bot", async () => {
        await opened(permissions());
        let release: (value: BotPermissions) => void = () => undefined;
        mocks.saveBotPermissions.mockReturnValueOnce(
            new Promise<BotPermissions>((resolve) => {
                release = resolve;
            })
        );
        const saving = setPrivateBot("b1", true);
        botPermissionsStore.set({ botId: "b2", status: "ready", data: permissions() });
        release(permissions({ privateBot: true }));
        await saving;
        expect(get(botPermissionsStore)?.botId).toBe("b2");
        expect(get(botPermissionsStore)?.data?.privateBot).toBe(false);
    });

    it("keeps both changes when two choices of one row are saved one after the other", async () => {
        await opened(permissions({ rules: [rule()] }));
        const releases: Array<() => void> = [];
        mocks.saveBotRule
            .mockImplementationOnce(
                () =>
                    new Promise<BotRule>((resolve) => {
                        releases.push(() => resolve(rule({ chat: "no" })));
                    })
            )
            .mockImplementationOnce(
                () =>
                    new Promise<BotRule>((resolve) => {
                        releases.push(() => resolve(rule({ chat: "no", dm: "no" })));
                    })
            );
        const first = setRuleValue("b1", rule(), "chat", "no");
        const second = setRuleValue("b1", rule({ chat: "no" }), "dm", "no");
        // The first answer does not say the second change yet: the page must not go back to it
        await vi.waitFor(() => expect(releases).toHaveLength(1));
        releases[0]();
        await first;
        expect(get(botPermissionsStore)?.data?.rules[0]).toMatchObject({ chat: "no", dm: "no" });
        // The second save only starts once the first is done
        await vi.waitFor(() => expect(releases).toHaveLength(2));
        releases[1]();
        await second;
        expect(get(botPermissionsStore)?.data?.rules[0]).toMatchObject({ chat: "no", dm: "no" });
        expect(mocks.saveBotRule).toHaveBeenCalledTimes(2);
    });

    it("goes back to what Orbit holds when an earlier change was refused and a later one went through", async () => {
        await opened(permissions({ rules: [rule()] }));
        mocks.saveBotRule.mockRejectedValueOnce(new Error("API error: 500")).mockResolvedValueOnce(rule({ dm: "no" }));
        mocks.getBotPermissions.mockResolvedValueOnce(permissions({ rules: [rule({ dm: "no" })] }));
        const first = setRuleValue("b1", rule(), "chat", "no");
        const second = setRuleValue("b1", rule({ chat: "no" }), "dm", "no");
        await Promise.all([first, second]);
        const state = get(botPermissionsStore);
        expect(state?.data?.rules[0]).toMatchObject({ chat: "default", dm: "no" });
        expect(state?.saveError).toBeTruthy();
    });
});
