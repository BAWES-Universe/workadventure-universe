import { describe, expect, it } from "vitest";
import {
    SHOWN_ACTIONS,
    defaultFor,
    errorLine,
    isOpenToEveryone,
    readPermissions,
    readRule,
    rolesWithoutRule,
    ruleName,
    ruleSummary,
    saysNothing,
    subjectOf,
    type BotRole,
    type BotRule,
    type RuleSummaryText,
} from "./accessModel";

const text: RuleSummaryText = {
    blocked: "Blocked",
    follows: "Follows the roles",
    action: {
        chat: "Chat nearby",
        dm: "Direct messages",
        summon: "Summon",
        manage: "Manage",
        change: "Change things",
        deleteOrSend: "Delete or send",
    },
    allowsAndBlocks: (allows, blocks) => `${allows} · ${blocks} blocked`,
    blocksOnly: (blocks) => `${blocks} blocked`,
};

function rule(partial: Partial<BotRule> = {}): BotRule {
    return {
        id: "r1",
        roleId: "role-member",
        userId: null,
        role: { key: "member", name: "Member", color: "#fff" },
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

const roles: BotRole[] = [
    {
        id: "role-everyone",
        key: "everyone",
        name: "Everyone",
        color: "",
        builtIn: true,
        defaults: { chat: true, dm: false, summon: false, manage: false, change: false, deleteOrSend: false },
    },
    {
        id: "role-member",
        key: "member",
        name: "Member",
        color: "",
        builtIn: true,
        defaults: { chat: true, dm: true, summon: true, manage: false, change: true, deleteOrSend: false },
    },
    {
        id: "role-editor",
        key: "editor",
        name: "Editor",
        color: "",
        builtIn: true,
        defaults: { chat: true, dm: true, summon: true, manage: true, change: true, deleteOrSend: true },
    },
];

describe("reading what Orbit sends", () => {
    it("reads anything missing as Default, never as a guess", () => {
        const read = readRule({ id: "r1", roleId: "x", chat: "banana", summon: "no" });
        expect(read?.chat).toBe("default");
        expect(read?.summon).toBe("no");
        expect(read?.manage).toBe("default");
        expect(read?.change).toBe("default");
        expect(read?.deleteOrSend).toBe("default");
    });

    it("reads changing, deleting and sending from a rule and from what a role gives", () => {
        const read = readRule({ id: "r1", roleId: "x", change: "yes", deleteOrSend: "no" });
        expect(read).toMatchObject({ change: "yes", deleteOrSend: "no" });
        const permissions = readPermissions({
            roles: [{ id: "a", name: "Editor", defaults: { chat: true, change: true, deleteOrSend: false } }],
        });
        expect(permissions.roles[0].defaults).toMatchObject({
            chat: true,
            change: true,
            deleteOrSend: false,
            manage: false,
        });
    });

    it("reads the universe and its owner by name, and none from an older Orbit", () => {
        expect(readPermissions({ universe: { name: "Nova", ownerName: "Layla" } }).universe).toEqual({
            name: "Nova",
            ownerName: "Layla",
        });
        expect(readPermissions({ universe: { name: "Nova", ownerName: null } }).universe).toEqual({
            name: "Nova",
            ownerName: null,
        });
        expect(readPermissions({}).universe).toBeUndefined();
        expect(readPermissions({ universe: { ownerName: "Layla" } }).universe).toBeUndefined();
    });

    it("drops a rule without an id and keeps the others", () => {
        const permissions = readPermissions({ privateBot: true, rules: [{ roleId: "x" }, { id: "ok" }], roles: [] });
        expect(permissions.privateBot).toBe(true);
        expect(permissions.rules.map((r) => r.id)).toEqual(["ok"]);
    });

    it("reads an empty answer as an open bot with no rules", () => {
        const permissions = readPermissions(undefined);
        expect(permissions).toMatchObject({ privateBot: false, refusalReply: null, rules: [], roles: [] });
        expect(isOpenToEveryone(permissions)).toBe(true);
    });

    it("is no longer open once the bot is Private or has a rule", () => {
        expect(isOpenToEveryone(readPermissions({ privateBot: true }))).toBe(false);
        expect(isOpenToEveryone(readPermissions({ rules: [{ id: "a" }] }))).toBe(false);
    });
});

describe("rows", () => {
    it("names a role by its name and a person by theirs, with a plain word for no name", () => {
        expect(ruleName(rule(), "A person")).toBe("Member");
        expect(ruleName(rule({ role: null, roleId: null, userId: "u", person: { name: "Nora" } }), "A person")).toBe(
            "Nora"
        );
        expect(ruleName(rule({ role: null, roleId: null, userId: "u", person: { name: null } }), "A person")).toBe(
            "A person"
        );
    });

    it("names the subject the way Orbit's API wants it", () => {
        expect(subjectOf(rule())).toEqual({ roleId: "role-member" });
        expect(subjectOf(rule({ roleId: null, userId: "u1" }))).toEqual({ userId: "u1" });
    });

    it("lists only the roles that have no row yet", () => {
        const permissions = { ...readPermissions({}), roles, rules: [rule()] };
        expect(rolesWithoutRule(permissions).map((r) => r.key)).toEqual(["everyone", "editor"]);
    });

    it("sees a row that says Default everywhere as saying nothing", () => {
        expect(saysNothing(rule())).toBe(true);
        expect(saysNothing(rule({ dm: "no" }))).toBe(false);
        expect(saysNothing(rule({ deleteOrSend: "yes" }))).toBe(false);
        expect(saysNothing(rule({ change: "no" }))).toBe(false);
    });

    it("shows direct messages next to nearby chat", () => {
        expect(SHOWN_ACTIONS).toEqual(["chat", "dm", "summon", "change", "deleteOrSend", "manage"]);
    });
});

describe("what a row says", () => {
    it("says Blocked when chatting, direct messages and summoning are all No", () => {
        expect(ruleSummary(rule({ chat: "no", dm: "no", summon: "no" }), text)).toBe("Blocked");
        expect(ruleSummary(rule({ chat: "no", summon: "no" }), text)).toBe("Chat nearby, Summon blocked");
        expect(ruleSummary(rule({ chat: "no", dm: "yes", summon: "no" }), text)).toBe(
            "Direct messages · Chat nearby, Summon blocked"
        );
    });
    it("lists what is allowed, then what is blocked", () => {
        expect(ruleSummary(rule({ chat: "yes", summon: "no" }), text)).toBe("Chat nearby · Summon blocked");
        expect(ruleSummary(rule({ chat: "yes", summon: "yes" }), text)).toBe("Chat nearby, Summon");
        expect(ruleSummary(rule({ summon: "no" }), text)).toBe("Summon blocked");
    });
    it("says it follows the roles when it changes nothing", () => {
        expect(ruleSummary(rule(), text)).toBe("Follows the roles");
    });
    it("names changing, deleting and sending like the other things", () => {
        expect(ruleSummary(rule({ change: "yes", deleteOrSend: "yes" }), text)).toBe("Change things, Delete or send");
        expect(ruleSummary(rule({ chat: "yes", deleteOrSend: "no" }), text)).toBe(
            "Chat nearby · Delete or send blocked"
        );
    });
});

describe("what Default comes to", () => {
    it("is what the role gives, named", () => {
        expect(defaultFor("manage", rule({ roleId: "role-editor" }), roles)).toEqual({ allowed: true, from: "Editor" });
    });
    it("is what the role gives for changing, and for deleting and sending", () => {
        expect(defaultFor("change", rule({ roleId: "role-member" }), roles)).toEqual({ allowed: true, from: "Member" });
        expect(defaultFor("deleteOrSend", rule({ roleId: "role-member" }), roles)).toEqual({
            allowed: false,
            from: null,
        });
        expect(defaultFor("deleteOrSend", rule({ roleId: "role-editor" }), roles)).toEqual({
            allowed: true,
            from: "Editor",
        });
    });
    it("falls back to what Everyone gives, since everyone has Everyone's permissions", () => {
        expect(defaultFor("chat", rule({ roleId: "role-editor" }), [roles[0]])).toEqual({
            allowed: true,
            from: "Everyone",
        });
    });
    it("is No when no role gives it", () => {
        expect(defaultFor("manage", rule({ roleId: "role-member" }), roles)).toEqual({ allowed: false, from: null });
    });
    it("cannot be said for a person, whose roles this page cannot see", () => {
        expect(defaultFor("chat", rule({ roleId: null, userId: "u" }), roles)).toBeNull();
    });
});

describe("errors", () => {
    it("uses Orbit's line when it sent one, and ours when it sent only a status", () => {
        expect(errorLine(new Error("The owner needs no rule"), "That didn't save")).toBe("The owner needs no rule");
        expect(errorLine(new Error("API error: 500"), "That didn't save")).toBe("That didn't save");
        expect(errorLine("nope", "That didn't save")).toBe("That didn't save");
    });
});
