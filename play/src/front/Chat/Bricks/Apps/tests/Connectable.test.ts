import { describe, expect, it } from "vitest";
import type { MyApp } from "../Apps";
import { isConnectedApp, matchesSearch, parseCatalog, parseReadyMade, toConnectAnother } from "../Connectable";

const mine = (over: Partial<MyApp> = {}): MyApp => ({
    id: "c1",
    name: "Gmail",
    authType: "oauth",
    source: "listed",
    connected: true,
    reconnectRequired: false,
    signInLostAt: null,
    connectedAt: "2026-11-10T09:00:00.000Z",
    lendable: false,
    bricks: [],
    ...over,
});

const catalog = {
    apps: [
        { key: "notion", name: "Notion", blurb: "Notes and docs", icon: "brand-notion", connectionId: null },
        { key: "gmail", name: "Gmail", blurb: "Email", icon: "brand-gmail", connectionId: "c1" },
    ],
};

describe("what Connect another reads (#2001)", () => {
    it("reads the listed apps, with their one line and their connection", () => {
        expect(parseCatalog(catalog)).toEqual([
            { kind: "listed", key: "notion", name: "Notion", blurb: "Notes and docs", connectionId: null },
            { kind: "listed", key: "gmail", name: "Gmail", blurb: "Email", connectionId: "c1" },
        ]);
    });

    it("reads the ready-made apps, which have no line", () => {
        expect(parseReadyMade({ apps: [{ key: "linear", name: "Linear", connectionId: null }] })).toEqual([
            { kind: "readyMade", key: "linear", name: "Linear", blurb: "", connectionId: null },
        ]);
    });

    it("refuses an answer that is not a list, and a list with one row it cannot read", () => {
        expect(parseCatalog(undefined)).toBeUndefined();
        expect(parseCatalog({ apps: "x" })).toBeUndefined();
        expect(parseCatalog({ apps: [{ key: "notion" }] })).toBeUndefined();
        expect(parseCatalog({ apps: [{ key: "notion", name: "Notion" }, 3] })).toBeUndefined();
    });
});

describe("which apps are connected", () => {
    it("counts an app whose sign-in is done, one that needs Reconnect, and one added by link", () => {
        expect(isConnectedApp(mine())).toBe(true);
        expect(isConnectedApp(mine({ connected: false, reconnectRequired: true }))).toBe(true);
        expect(isConnectedApp(mine({ connected: false, source: "link" }))).toBe(true);
    });

    it("does not count a listed app that was started and never signed in", () => {
        expect(isConnectedApp(mine({ connected: false }))).toBe(false);
    });
});

describe("Connect another", () => {
    const all = parseCatalog(catalog)!;

    it("leaves out an app that is already connected", () => {
        expect(toConnectAnother(all, [mine()]).map((app) => app.key)).toEqual(["notion"]);
    });

    it("keeps an app whose sign-in was never finished, so Connect starts it again", () => {
        expect(toConnectAnother(all, [mine({ connected: false })]).map((app) => app.key)).toEqual(["notion", "gmail"]);
    });

    it("shows an app of the same name once, as the first list has it", () => {
        const both = [
            ...all,
            { kind: "readyMade" as const, key: "gmail", name: "gmail", blurb: "", connectionId: null },
            { kind: "readyMade" as const, key: "linear", name: "Linear", blurb: "", connectionId: null },
        ];
        expect(toConnectAnother(both, []).map((app) => `${app.kind}:${app.key}`)).toEqual([
            "listed:notion",
            "listed:gmail",
            "readyMade:linear",
        ]);
    });

    it("keeps an official app whose name an app added by link also has", () => {
        const own = mine({ id: "c2", name: "Notion", source: "link" });
        expect(toConnectAnother(all, [own]).map((app) => app.key)).toEqual(["notion", "gmail"]);
    });

    it("leaves out a ready-made app that has the name of one already connected", () => {
        const ready = [
            { kind: "readyMade" as const, key: "google-mail", name: "Gmail", blurb: "", connectionId: null },
        ];
        expect(toConnectAnother(ready, [mine()])).toEqual([]);
    });
});

describe("Search apps", () => {
    it("matches a name or its line, in any case, and nothing typed matches everything", () => {
        expect(matchesSearch("DR", "Dropbox", "Your files")).toBe(true);
        expect(matchesSearch("files", "Dropbox", "Your files")).toBe(true);
        expect(matchesSearch("  ", "Dropbox")).toBe(true);
        expect(matchesSearch("slack", "Dropbox", "Your files")).toBe(false);
    });
});
