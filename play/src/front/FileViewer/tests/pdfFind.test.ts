import { describe, expect, it } from "vitest";
import { findCountOf } from "../pdfFind";

describe("the match counter of a PDF search", () => {
    it("shows the count once the reader has an answer", () => {
        expect(findCountOf({ state: 0, matchesCount: { current: 2, total: 5 } })).toEqual({ current: 2, total: 5 });
        expect(findCountOf({ state: 1, matchesCount: { current: 0, total: 0 } })).toEqual({ current: 0, total: 0 });
        expect(findCountOf({ matchesCount: { current: 1, total: 3 } })).toEqual({ current: 1, total: 3 });
    });

    it("keeps what it shows while the pages are still being searched", () => {
        expect(findCountOf({ state: 3, matchesCount: { current: 0, total: 0 } })).toBeUndefined();
    });
});
