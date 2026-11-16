import { describe, expect, it } from "vitest";
import { cleanKey, parseGitHubWhere, shortLink } from "../GitHub";
import { parseMyAppPage } from "../Apps";

const where = (over: Record<string, unknown> = {}) => ({
    login: "BAWES",
    ownKey: false,
    places: [
        { account: "BAWES", type: "User", repos: "all", manageUrl: "https://github.com/settings/installations/1" },
        {
            account: "BAWES-Universe",
            type: "Organization",
            repos: 3,
            manageUrl: "https://github.com/organizations/x/settings/installations/2",
        },
    ],
    waiting: [{ account: "acme-corp", type: "Organization" }],
    addPlaceUrl: "https://github.com/apps/bawes-universe/installations/select_target",
    installUrl: "https://github.com/apps/bawes-universe/installations/new",
    ownKeyPage: "https://github.com/settings/tokens/new?scopes=repo",
    known: true,
    ...over,
});

describe("Connect GitHub on the app page (#2041)", () => {
    it("reads where it works and where it waits", () => {
        expect(parseGitHubWhere(where())).toEqual({
            login: "BAWES",
            ownKey: false,
            places: [
                {
                    account: "BAWES",
                    type: "User",
                    repos: "all",
                    manageUrl: "https://github.com/settings/installations/1",
                },
                {
                    account: "BAWES-Universe",
                    type: "Organization",
                    repos: 3,
                    manageUrl: "https://github.com/organizations/x/settings/installations/2",
                },
            ],
            waiting: [{ account: "acme-corp", type: "Organization" }],
            addPlaceUrl: "https://github.com/apps/bawes-universe/installations/select_target",
            installUrl: "https://github.com/apps/bawes-universe/installations/new",
            ownKeyPage: "https://github.com/settings/tokens/new?scopes=repo",
            known: true,
        });
    });

    it("opens only GitHub's own pages: anything else makes it not GitHub's block, and a bad place is left out", () => {
        expect(parseGitHubWhere(where({ installUrl: "https://evil.example.com/apps/x" }))).toBeUndefined();
        expect(parseGitHubWhere(where({ addPlaceUrl: "http://github.com/apps/x" }))).toBeUndefined();
        expect(parseGitHubWhere(where({ ownKeyPage: "javascript:alert(1)" }))).toBeUndefined();
        const read = parseGitHubWhere(
            where({
                places: [
                    { account: "a", type: "User", repos: "all", manageUrl: "https://github.evil.com/x" },
                    { account: "b", type: "User", repos: -1, manageUrl: "https://github.com/x" },
                    { account: "", type: "User", repos: 1, manageUrl: "https://github.com/x" },
                    "nonsense",
                ],
                waiting: [{ account: "" }, 7, { account: "solo", type: "User" }],
            })
        );
        expect(read?.places).toEqual([]);
        expect(read?.waiting).toEqual([{ account: "solo", type: "User" }]);
        expect(parseGitHubWhere(undefined)).toBeUndefined();
        expect(parseGitHubWhere(where({ places: "x" }))).toBeUndefined();
    });

    it("says it is not known unless Orbit says it asked GitHub, and has no login when none is given", () => {
        const read = parseGitHubWhere(where({ known: "yes", login: "" }));
        expect(read?.known).toBe(false);
        expect(read?.login).toBeNull();
    });

    it("is read only for the GitHub app", () => {
        const app = {
            id: "c1",
            name: "GitHub",
            authType: "oauth",
            source: "github",
            connected: true,
            reconnectRequired: false,
            lendable: false,
            bricks: [],
        };
        const page = { canLetUse: [], lentTo: [], canLendTo: [], github: where() };
        expect(parseMyAppPage({ ...page, app })?.github?.login).toBe("BAWES");
        expect(parseMyAppPage({ ...page, app: { ...app, source: "catalog" } })?.github).toBeUndefined();
    });

    it("cleans a pasted key and shows the link without https://", () => {
        expect(cleanKey("  ghp_abc\n def123456  ")).toBe("ghp_abcdef123456");
        expect(cleanKey("short")).toBe("");
        expect(cleanKey("x".repeat(501))).toBe("");
        expect(shortLink("https://github.com/apps/bawes-universe/installations/new")).toBe(
            "github.com/apps/bawes-universe/installations/new"
        );
    });
});
