import { describe, expect, it } from "vitest";
import {
    appsRowNames,
    dayOf,
    namesLine,
    parseAvailableApps,
    parseMyApp,
    parseMyAppPage,
    parseMyApps,
    parseMyUniverses,
    parseTeamApp,
    parseTeamAppPage,
    parseTeamApps,
    settingsGroups,
    usesChoices,
} from "../Apps";

const brick = { botId: "b1", botName: "Brick", serverId: "s1", enabled: true, headings: { lookUp: "rightAway" } };
const app = (over: Record<string, unknown> = {}) => ({
    id: "a1",
    name: "Tavily",
    authType: "api-key",
    source: "link",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-04T09:00:00.000Z",
    lendable: true,
    bricks: [brick],
    ...over,
});
const team = (over: Record<string, unknown> = {}) => ({
    id: "t1",
    name: "Notion",
    universeId: "u1",
    universeName: "BAWES Universe",
    authType: "oauth",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-12T09:00:00.000Z",
    connectedBy: { id: "p1", name: "Khalid", stillManages: true },
    managers: [{ id: "p1", name: "Khalid", owner: true, you: true }],
    bots: [{ botId: "g", botName: "Guide", serverId: "s", enabled: true }],
    usesThisMonth: 212,
    youManage: true,
    ...over,
});

describe("reading Orbit's answers about apps (#2001)", () => {
    it("reads an app with its Bricks, and fills the four settings a Brick was not sent", () => {
        const read = parseMyApp(app());
        expect(read?.name).toBe("Tavily");
        expect(read?.lendable).toBe(true);
        expect(read?.bricks[0].settings).toEqual({
            lookUp: "rightAway",
            make: "asksFirst",
            change: "asksFirst",
            deleteSend: "asksFirst",
        });
    });

    it("does not read an app that is not one, or a list with one row it cannot read", () => {
        expect(parseMyApp(null)).toBeUndefined();
        expect(parseMyApp({ ...app(), id: "" })).toBeUndefined();
        expect(parseMyApps({ apps: [app(), { nonsense: true }], bricks: [] })).toBeUndefined();
        expect(parseMyApps({ apps: [app()], bricks: [{ id: "b1", name: "Brick" }] })?.apps).toHaveLength(1);
    });

    it("never calls an app lendable unless Orbit said so", () => {
        expect(parseMyApp(app({ lendable: undefined }))?.lendable).toBe(false);
    });

    it("reads where an app is lent: all four things as null, a limit or none, and the bots with their uses", () => {
        const page = parseMyAppPage({
            app: app(),
            canLetUse: [{ id: "b2", name: "Studio Brick" }],
            lentTo: [
                {
                    universeId: "u1",
                    universeName: "BAWES Universe",
                    things: ["lookUp", "make", "change", "deleteSend"],
                    usesPerDay: 200,
                    usedToday: 12,
                    bots: [{ botId: "g", botName: "Guide", serverId: "s", enabled: true, usesThisMonth: 34 }],
                },
                {
                    universeId: "u2",
                    universeName: "Kuwait Makers",
                    things: ["lookUp"],
                    usesPerDay: null,
                    usedToday: 0,
                    bots: [],
                },
            ],
            canLendTo: [{ id: "u3", name: "Third", access: "owner" }],
        });
        expect(page?.lentTo[0].things).toBeNull();
        expect(page?.lentTo[0].bots[0].usesThisMonth).toBe(34);
        expect(page?.lentTo[1].things).toEqual(["lookUp"]);
        expect(page?.lentTo[1].usesPerDay).toBeNull();
        expect(page?.canLendTo[0].access).toBe("owner");
    });

    it("does not read a lend with a limit it cannot read", () => {
        const lent = { universeId: "u1", universeName: "U", things: null, usesPerDay: "many", usedToday: 0, bots: [] };
        expect(parseMyAppPage({ app: app(), canLetUse: [], lentTo: [lent], canLendTo: [] })).toBeUndefined();
    });

    it("reads a universe's app with who connected it, and keeps the owner and you marks only when Orbit sends them", () => {
        const read = parseTeamApp(team());
        expect(read?.connectedBy).toEqual({ id: "p1", name: "Khalid", stillManages: true });
        expect(read?.managers[0]).toEqual({ id: "p1", name: "Khalid", owner: true, you: true });
        const old = parseTeamApp(team({ managers: [{ id: "p2", name: "Sara" }] }));
        expect(old?.managers[0]).toEqual({ id: "p2", name: "Sara" });
        expect(old?.managers[0].owner).toBeUndefined();
    });

    it("reads an app whose connector is gone as having none", () => {
        expect(parseTeamApp(team({ connectedBy: null }))?.connectedBy).toBeNull();
    });

    it("reads the lists of a universe's apps and the page of one", () => {
        expect(parseTeamApps({ apps: [team()] })).toHaveLength(1);
        expect(parseTeamApps({ apps: "no" })).toBeUndefined();
        expect(
            parseTeamAppPage({ app: team(), canAddAsManager: [{ id: "p2", name: "Sara" }] })?.canAddAsManager
        ).toEqual([{ id: "p2", name: "Sara" }]);
        expect(parseTeamAppPage({ app: team() })).toBeUndefined();
    });

    it("reads Your universes and the apps a bot could use here", () => {
        expect(parseMyUniverses({ universes: [{ id: "u1", name: "BAWES Universe", apps: 2 }] })).toEqual([
            { id: "u1", name: "BAWES Universe", apps: 2 },
        ]);
        expect(parseMyUniverses({ universes: [] })).toEqual([]);
        expect(
            parseAvailableApps({
                apps: [
                    { connectionId: "c1", name: "Tavily", kind: "lent" },
                    { connectionId: "c2", name: "Notion", kind: "team" },
                ],
            })
        ).toEqual([
            { connectionId: "c1", name: "Tavily", kind: "lent" },
            { connectionId: "c2", name: "Notion", kind: "team" },
        ]);
        expect(parseAvailableApps({ apps: [{ name: "No id" }] })).toBeUndefined();
    });
});

describe("the words around apps (#2001)", () => {
    const more = (count: number) => `${count} more`;

    it("names Bricks in a row of words", () => {
        expect(namesLine([], "and", more)).toBe("");
        expect(namesLine(["Brick"], "and", more)).toBe("Brick");
        expect(namesLine(["Brick", "Studio Brick"], "and", more)).toBe("Brick and Studio Brick");
        expect(namesLine(["A", "B", "C", "D"], "and", more)).toBe("A, B and 2 more");
    });

    it("names the apps on the Bricks page up to three", () => {
        const apps = (names: string[]) =>
            names.map((name) => parseMyApp(app({ name, id: name })) as NonNullable<ReturnType<typeof parseMyApp>>);
        expect(appsRowNames(apps(["Gmail", "GitHub", "Notion"]), "and", more)).toBe("Gmail, GitHub and Notion");
        expect(appsRowNames(apps(["Gmail", "Google Calendar", "GitHub", "Notion", "Slack"]), "and", more)).toBe(
            "Gmail, Google Calendar, GitHub and 2 more"
        );
    });

    it("offers 50, 200, 500 and no limit, and the lend's own number when it is none of them", () => {
        expect(usesChoices(undefined)).toEqual([50, 200, 500, null]);
        expect(usesChoices(200)).toEqual([50, 200, 500, null]);
        expect(usesChoices(null)).toEqual([50, 200, 500, null]);
        expect(usesChoices(120)).toEqual([50, 120, 200, 500, null]);
        expect(usesChoices(9000)).toEqual([50, 200, 500, 9000, null]);
    });

    it("sorts what a Brick may do into right away, asks first and off", () => {
        expect(
            settingsGroups({ lookUp: "rightAway", make: "rightAway", change: "asksFirst", deleteSend: "off" })
        ).toEqual({
            rightAway: ["lookUp", "make"],
            asksFirst: ["change"],
            off: ["deleteSend"],
        });
    });

    it("says a day in the short form, and nothing for a day it cannot read", () => {
        expect(dayOf("2026-11-12T09:00:00.000Z", "en-US")).toBe("12 Nov");
        expect(dayOf(null, "en-US")).toBe("");
        expect(dayOf("not a day", "en-US")).toBe("");
    });
});
