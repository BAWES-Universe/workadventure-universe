import { describe, expect, it } from "vitest";
import { pageInView } from "../wordPages";

const tops = [0, 1000, 2000];

describe("the page a reader of a Word file is on", () => {
    it("is the page that covers the upper part of the view", () => {
        const view = { clientHeight: 600, scrollHeight: 3000, scale: 1, sheetTops: tops };
        expect(pageInView({ ...view, scrollTop: 0 })).toBe(1);
        expect(pageInView({ ...view, scrollTop: 900 })).toBe(2);
    });

    it("is the last page at the very end, even a short one", () => {
        expect(pageInView({ clientHeight: 600, scrollHeight: 2300, scale: 1, sheetTops: tops, scrollTop: 1700 })).toBe(
            3
        );
    });

    it("stays on page 1 when every page fits in the panel and there is nothing to scroll", () => {
        expect(
            pageInView({ clientHeight: 900, scrollHeight: 900, scale: 0.3, sheetTops: [0, 1000, 2000], scrollTop: 0 })
        ).toBe(1);
    });
});
