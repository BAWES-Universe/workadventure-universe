import { describe, expect, it } from "vitest";
import { resolveChatLayout } from "../ChatLayout";

const LIMIT = 670;

describe("resolveChatLayout", () => {
    it("shows the thread alone under 670px, hiding the list and its Chat / People tabs", () => {
        expect(resolveChatLayout(669, LIMIT, true)).toEqual({ twoColumns: false, showList: false });
    });

    it("splits list and thread at exactly 670px, with the columns and the list agreeing", () => {
        expect(resolveChatLayout(670, LIMIT, true)).toEqual({ twoColumns: true, showList: true });
    });

    it("splits list and thread above 670px", () => {
        expect(resolveChatLayout(671, LIMIT, true)).toEqual({ twoColumns: true, showList: true });
    });

    it("always shows the list when no thread is open", () => {
        expect(resolveChatLayout(250, LIMIT, false)).toEqual({ twoColumns: false, showList: true });
        expect(resolveChatLayout(669, LIMIT, false).showList).toBe(true);
    });
});
