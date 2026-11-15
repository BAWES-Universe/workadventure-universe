import { describe, expect, it } from "vitest";
import {
    NO_DISCOVERY,
    headersBody,
    looksLikeLink,
    newAppBody,
    oauthConfig,
    oauthFieldsDone,
    parseDiscovery,
    parseNewAppId,
    parseThings,
    reservedHeader,
    signsInByItself,
    type OAuthFields,
} from "../AddApp";

const EMPTY: OAuthFields = { authorizeUrl: "", tokenUrl: "", clientId: "", clientSecret: "", scopes: "" };

describe("Add your own app: the rules (#2001)", () => {
    it("checks only a link that looks like a web address", () => {
        expect(looksLikeLink("https://mcp.zapier.com/api/mcp/mcp")).toBe(true);
        expect(looksLikeLink("  http://tools.example.com/mcp ")).toBe(true);
        expect(looksLikeLink("")).toBe(false);
        expect(looksLikeLink("mcp.zapier.com")).toBe(false);
        expect(looksLikeLink("https://")).toBe(false);
        expect(looksLikeLink("https://nodot")).toBe(false);
        expect(looksLikeLink("ftp://tools.example.com/mcp")).toBe(false);
        expect(looksLikeLink("https://tools.example.com/a b")).toBe(false);
    });

    it("reads what Orbit's check found, and treats anything odd as 'the app didn't say'", () => {
        const found = parseDiscovery({
            discovered: true,
            name: "Zapier",
            signsInWith: "Zapier",
            authorizeUrl: "https://zapier.com/authorize",
            tokenUrl: "https://zapier.com/token",
            clientId: "abc",
            clientSecret: null,
            scopesSupported: ["a", "b", 3],
            registrationStatus: "auto",
            revocationUrl: "https://zapier.com/revoke",
        });
        expect(found).toMatchObject({
            discovered: true,
            name: "Zapier",
            signsInWith: "Zapier",
            clientId: "abc",
            clientSecret: "",
            scopes: "a b",
            registration: "auto",
            revocationUrl: "https://zapier.com/revoke",
        });
        expect(signsInByItself(found)).toBe(true);
        expect(parseDiscovery({ discovered: false })).toBe(NO_DISCOVERY);
        expect(parseDiscovery(null)).toBe(NO_DISCOVERY);
        expect(parseDiscovery("nope")).toBe(NO_DISCOVERY);
        // a sign-in page with no token address cannot be used
        expect(parseDiscovery({ discovered: true, authorizeUrl: "https://x.example.com/a" })).toBe(NO_DISCOVERY);
    });

    it("signs in on its own only when Universe registered itself at the app", () => {
        const manual = parseDiscovery({
            discovered: true,
            authorizeUrl: "https://x.example.com/a",
            tokenUrl: "https://x.example.com/t",
            registrationStatus: "manual",
        });
        expect(manual.registration).toBe("manual");
        expect(signsInByItself(manual)).toBe(false);
        const noClient = parseDiscovery({
            discovered: true,
            authorizeUrl: "https://x.example.com/a",
            tokenUrl: "https://x.example.com/t",
            registrationStatus: "auto",
        });
        expect(signsInByItself(noClient)).toBe(false);
    });

    it("needs the client from the person only when Universe did not register itself", () => {
        const fields = { ...EMPTY, authorizeUrl: "https://x.example.com/a", tokenUrl: "https://x.example.com/t" };
        expect(oauthFieldsDone(fields, "auto")).toBe(true);
        expect(oauthFieldsDone(fields, "manual")).toBe(false);
        expect(oauthFieldsDone(fields, undefined)).toBe(false);
        expect(oauthFieldsDone({ ...fields, clientId: "id", clientSecret: "s" }, undefined)).toBe(true);
        expect(oauthFieldsDone({ ...EMPTY, clientId: "id", clientSecret: "s" }, "manual")).toBe(false);
    });

    it("keeps the sign-in settings in the shape a bot's own app uses", () => {
        expect(
            JSON.parse(
                oauthConfig({
                    authorizeUrl: " https://x.example.com/a ",
                    tokenUrl: "https://x.example.com/t",
                    clientId: " id ",
                    clientSecret: "",
                    scopes: " read write ",
                    revocationUrl: "https://x.example.com/r",
                })
            )
        ).toEqual({
            authorizeUrl: "https://x.example.com/a",
            tokenUrl: "https://x.example.com/t",
            clientId: "id",
            clientSecret: null,
            scopes: "read write",
            revocationUrl: "https://x.example.com/r",
        });
    });

    it("refuses the headers Orbit keeps for the way in, in any letter case", () => {
        expect(reservedHeader([{ key: "X-Team", value: "a" }])).toBeUndefined();
        expect(
            reservedHeader([
                { key: "x-team", value: "a" },
                { key: " Authorization ", value: "b" },
            ])
        ).toBe("Authorization");
        expect(reservedHeader([{ key: "X-API-KEY", value: "b" }])).toBe("X-API-KEY");
        expect(headersBody([{ key: "", value: "x" }])).toBeUndefined();
        expect(
            headersBody([
                { key: " X-Team ", value: "a" },
                { key: "", value: "x" },
            ])
        ).toEqual({ "X-Team": "a" });
    });

    it("builds what Orbit takes for each way in", () => {
        const base = {
            name: " My app ",
            link: " https://tools.example.com/mcp ",
            sentAs: "bearer" as const,
            key: "",
            oauth: EMPTY,
            headers: [],
        };
        expect(newAppBody({ ...base, signIn: "none" })).toEqual({
            name: "My app",
            serverUrl: "https://tools.example.com/mcp",
            authType: "none",
        });
        expect(newAppBody({ ...base, signIn: "key", key: " sk-1 " })).toEqual({
            name: "My app",
            serverUrl: "https://tools.example.com/mcp",
            authType: "bearer",
            authConfig: "sk-1",
        });
        expect(newAppBody({ ...base, signIn: "key", sentAs: "api-key", key: "sk-1" }).authType).toBe("api-key");
        const oauth = newAppBody({
            ...base,
            signIn: "oauth",
            oauth: { ...EMPTY, authorizeUrl: "https://x.example.com/a", tokenUrl: "https://x.example.com/t" },
            headers: [{ key: "X-Team", value: "a" }],
        });
        expect(oauth.authType).toBe("oauth");
        expect(oauth.headers).toEqual({ "X-Team": "a" });
        expect(JSON.parse(oauth.authConfig ?? "{}")).toMatchObject({ authorizeUrl: "https://x.example.com/a" });
    });

    it("never sends a key for an app with no sign-in, and keeps no key for an app that signs in on a page", () => {
        const base = {
            name: "A",
            link: "https://tools.example.com/mcp",
            sentAs: "bearer" as const,
            oauth: EMPTY,
            headers: [],
        };
        expect(newAppBody({ ...base, signIn: "none", key: "left-over" }).authConfig).toBeUndefined();
        expect(JSON.stringify(newAppBody({ ...base, signIn: "oauth", key: "left-over" }))).not.toContain("left-over");
    });

    it("reads what the app can do, and says nothing when Orbit did not say", () => {
        expect(parseThings({ things: ["Find Events", " Send Email ", ""] })).toEqual(["Find Events", "Send Email"]);
        expect(parseThings({ things: [{ name: "Find Events" }, { name: 3 }, null] })).toEqual(["Find Events"]);
        expect(parseThings({ things: [] })).toBeUndefined();
        expect(parseThings({})).toBeUndefined();
        expect(parseThings(undefined)).toBeUndefined();
        expect(parseNewAppId({ id: "a1", name: "Zapier" })).toBe("a1");
        expect(parseNewAppId({ id: "" })).toBeUndefined();
        expect(parseNewAppId(undefined)).toBeUndefined();
    });
});
