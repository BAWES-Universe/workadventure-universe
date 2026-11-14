import { get } from "svelte/store";
import { describe, expect, it } from "vitest";
import {
    closeKeyFormSheet,
    isActiveHost,
    keyFormHosts,
    keyFormLinkId,
    keyFormOpen,
    mountHost,
    openKeyFormSheet,
} from "../KeyFormLink";
import { looksLikeAKeyPastedWords } from "../KeyShapes";

describe("the link to the safe key form", () => {
    it("reads the form out of a link, and only a well-formed one", () => {
        expect(keyFormLinkId("#key-form=abc-123_X")).toBe("abc-123_X");
        expect(keyFormLinkId("#key-form=")).toBeUndefined();
        expect(keyFormLinkId("#key-form=a b")).toBeUndefined();
        expect(keyFormLinkId("#key-form=https://evil.example")).toBeUndefined();
        expect(keyFormLinkId("#brick-chat=1")).toBeUndefined();
        expect(keyFormLinkId(null)).toBeUndefined();
    });

    it("opens and closes the sheet", () => {
        openKeyFormSheet("f1");
        expect(get(keyFormOpen)).toBe("f1");
        closeKeyFormSheet();
        expect(get(keyFormOpen)).toBeUndefined();
    });

    it("lets only the latest mounted host draw the sheet", () => {
        const first = Symbol("first");
        const second = Symbol("second");
        const leaveFirst = mountHost(first);
        expect(isActiveHost(first, get(keyFormHosts))).toBe(true);
        const leaveSecond = mountHost(second);
        expect(isActiveHost(first, get(keyFormHosts))).toBe(false);
        expect(isActiveHost(second, get(keyFormHosts))).toBe(true);
        leaveSecond();
        expect(isActiveHost(first, get(keyFormHosts))).toBe(true);
        leaveFirst();
        expect(get(keyFormHosts)).toEqual([]);
    });
});

describe("words that look like a key", () => {
    it.each([
        ["sk_", "live_51Habcdefghijklmnop12345"].join(""),
        ["here: sk_", "test_abcdefghijklmnopqrstuvwx"].join(""),
        ["gh", "p_abcdefghijklmnopqrstuvwxyz0123456789"].join(""),
        "Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
    ])("holds back %s", (words) => {
        expect(looksLikeAKeyPastedWords(words)).toBe(true);
    });

    it.each(["hello", "sk_live_ is how they start", "what is a key?", ""])("lets %j through", (words) => {
        expect(looksLikeAKeyPastedWords(words)).toBe(false);
    });
});
