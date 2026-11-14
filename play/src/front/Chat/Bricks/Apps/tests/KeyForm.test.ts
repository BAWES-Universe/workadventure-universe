import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { openKeyForm: vi.fn(async () => "form-1") },
}));
vi.mock("../AppsStore", () => ({ loadMyApps: vi.fn(async () => undefined) }));

import { isModeChange, keyProblemOf, parseKeyForm } from "../KeyForm";

const form = {
    id: "f1",
    mode: "prefilled",
    name: "Tap Payments",
    short: "Tap",
    keyLabel: "Tap key",
    keyHint: "sk_test_…",
    helpUrl: "https://developers.tap.company/keys",
    host: "api.tap.company",
    hostReadable: null,
    source: null,
    differentSite: false,
    check: "Look up a charge",
    replacing: { keyLast4: "ab12", mode: "test" },
    triesLeft: 5,
};

describe("reading the safe form", () => {
    it("reads what Orbit shows, with or without its wrapper", () => {
        expect(parseKeyForm({ form })?.short).toBe("Tap");
        const read = parseKeyForm(form);
        expect(read?.host).toBe("api.tap.company");
        expect(read?.replacing).toEqual({ keyLast4: "ab12", mode: "test" });
        expect(read?.triesLeft).toBe(5);
    });

    it("drops a help link that is not a plain https address", () => {
        expect(parseKeyForm({ ...form, helpUrl: "javascript:alert(1)" })?.helpUrl).toBeNull();
        expect(parseKeyForm({ ...form, helpUrl: "http://x.example" })?.helpUrl).toBeNull();
        expect(parseKeyForm({ ...form, helpUrl: "https://x.example/help" })?.helpUrl).toBe("https://x.example/help");
    });

    it("reads nothing out of something that is not a form", () => {
        expect(parseKeyForm(undefined)).toBeUndefined();
        expect(parseKeyForm({ id: "f1" })).toBeUndefined();
        expect(parseKeyForm("form")).toBeUndefined();
    });

    it("never carries more than the words and the key's end", () => {
        const read = parseKeyForm({ ...form, key: "sk_live_secret", secret: "x" }) as unknown as Record<string, unknown>;
        expect(JSON.stringify(read)).not.toContain("sk_live_secret");
    });
});

describe("what went wrong with a key", () => {
    it("maps Orbit's codes to the sheet's words", () => {
        const code = (value: string) => Object.assign(new Error("x"), { code: value });
        expect(keyProblemOf(code("rejected"))).toBe("rejected");
        expect(keyProblemOf(code("invalid_key"))).toBe("invalid");
        expect(keyProblemOf(code("unreachable"))).toBe("unreachable");
        expect(keyProblemOf(code("expired"))).toBe("expired");
        expect(keyProblemOf(code("not_found"))).toBe("expired");
        expect(keyProblemOf(code("used"))).toBe("used");
        expect(keyProblemOf(code("too_many"))).toBe("tooMany");
        expect(keyProblemOf(new Error("boom"))).toBe("other");
        expect(keyProblemOf(undefined)).toBe("other");
    });

    it("asks to be sure only for a change between a test and a real key", () => {
        expect(isModeChange(Object.assign(new Error("x"), { code: "mode_change" }))).toBe(true);
        expect(isModeChange(Object.assign(new Error("x"), { code: "rejected" }))).toBe(false);
        expect(isModeChange(null)).toBe(false);
    });
});
