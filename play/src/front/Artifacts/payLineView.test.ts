import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../../i18n/i18n-util.sync";
import { i18nObject } from "../../i18n/i18n-util";
import { NO_PAY_LINE, type PayLine } from "./PagePayments";
import { describePayLine, shortDate } from "./payLineView";

vi.mock("./ArtifactApi", () => ({ ArtifactRequestError: class extends Error {}, payOnArtifact: vi.fn() }));

// Noon of 19 Nov in the time zone the test runs in: a fixed UTC time would be 20 Nov east of UTC+12
const NOON_19_NOV = new Date(2026, 10, 19, 12).toISOString();

// Every line of the approved mock M1 (19 Nov), word for word. Orbit's public page says the same lines.
describe("the line under a paying page says what the approved mock says", () => {
    beforeAll(() => loadLocale("en-US"));
    const LL = () => i18nObject("en-US").chat.artifacts;
    const line = (over: Partial<PayLine>): PayLine => ({ ...NO_PAY_LINE, ...over });
    const view = (over: Partial<PayLine>, state: { copied?: boolean; owner?: { maker: string } } = {}) =>
        describePayLine(line(over), { copied: false, locale: "en-US", ...state }, LL());
    const labels = (over: Partial<PayLine>, state = {}) =>
        view(over, state)?.actions.map((a) => `${a.kind}:${a.label}:${a.style}`);

    it("g1: not heard back yet, with Check payment (twenty minutes, or a start whose answer was lost)", () => {
        for (const over of [
            { problem: "cant_confirm" },
            { problem: "unavailable", canCheck: true },
            { canCheck: true },
        ] as Partial<PayLine>[]) {
            expect(view(over)).toMatchObject({
                title: "We haven't heard back about your payment yet.",
                sub: "If you paid, it still counts. Check it here before paying again.",
                closable: false,
            });
            expect(labels(over)).toEqual(["check:Check payment:primary"]);
        }
    });

    it("still checking an earlier payment, with Check payment (and Restore purchase when it is owed)", () => {
        const over = { problem: "still_checking", canCheck: true } as Partial<PayLine>;
        expect(view(over)).toMatchObject({
            title: "We're still checking your earlier payment.",
            sub: "If you paid, it will show up here when your payment service confirms it. Buying again starts a new payment.",
            closable: false,
        });
        expect(labels(over)).toEqual(["check:Check payment:primary"]);
        expect(labels({ ...over, offerRestore: true })).toEqual([
            "check:Check payment:primary",
            "restore:Restore purchase:secondary",
        ]);
        // never the words of a payment not heard back about, or not paid
        expect(JSON.stringify(view(over))).not.toMatch(/haven't heard back|Not paid yet|No purchase found/);
    });

    it("g2: checking, and the longer wait", () => {
        expect(view({ checking: true })).toMatchObject({
            title: "Checking your payment…",
            sub: "Asking the payment service directly.",
            actions: [],
        });
        expect(view({ checking: true, slow: true })).toMatchObject({
            title: "This is taking longer than usual…",
            sub: "Your payment is still being checked.",
        });
        // A pop-up that was blocked or closed: the same checkout again
        expect(
            labels({ checking: true, resume: { url: "https://checkout.examplepay.com/c1", app: "Example" } })
        ).toEqual(["resume:Continue to Example:secondary"]);
        expect(labels({ checking: true, resume: { url: "https://checkout.examplepay.com/c1", app: "" } })).toEqual([
            "resume:Continue to the payment page:secondary",
        ]);
    });

    it("a guest who paid on a page with no receipt link is not told it is saved to an account", () => {
        const guest = view({ paid: { test: false }, buyer: "guest" });
        expect(guest?.title).toBe("Paid. Thank you.");
        expect(guest?.sub).not.toContain("account");
        expect(guest?.actions).toEqual([]);
    });

    it("g3: paid, saved to the account", () => {
        expect(view({ paid: { test: false }, buyer: "account" })).toMatchObject({
            title: "Paid. Thank you.",
            sub: "It's saved to your account, so it comes back whenever you open this page.",
            actions: [],
        });
    });

    it("g4: not paid yet, with Check payment", () => {
        expect(view({ problem: "not_paid", canCheck: true })).toMatchObject({
            title: "Not paid yet.",
            sub: "If you already paid, it can take a while to show. Check it here before paying again.",
        });
        expect(labels({ problem: "not_paid", canCheck: true })).toEqual(["check:Check payment:primary"]);
    });

    it("a payment that ended without paying while another page was turned away offers Restore purchase beside what it already offers", () => {
        for (const problem of ["not_paid", "cant_confirm"] as const) {
            expect(labels({ problem, canCheck: true, offerRestore: true })).toEqual([
                "check:Check payment:primary",
                "restore:Restore purchase:secondary",
            ]);
            // Nothing owed: only what it offered before
            expect(labels({ problem, canCheck: true })).toEqual(["check:Check payment:primary"]);
        }
        expect(labels({ problem: "unavailable", canCheck: true, offerRestore: true })).toEqual([
            "check:Check payment:primary",
            "restore:Restore purchase:secondary",
        ]);
        expect(labels({ problem: "unavailable", offerRestore: true })).toEqual(["restore:Restore purchase:secondary"]);
        expect(labels({ problem: "limit", offerRestore: true })).toEqual(["restore:Restore purchase:secondary"]);
    });

    it("keeps Check payment on a 'none' line and a 'limit' line when the payment can be checked, and shows no action when it cannot", () => {
        expect(labels({ problem: "none", buyer: "guest", canCheck: true })).toEqual(["check:Check payment:primary"]);
        expect(labels({ problem: "none", buyer: "account", canCheck: true })).toEqual(["check:Check payment:primary"]);
        expect(labels({ problem: "none", buyer: "guest", canCheck: false })).toEqual([]);
        expect(view({ problem: "none", buyer: "guest", canCheck: true })?.closable).toBe(true);
        expect(labels({ problem: "limit", canCheck: true })).toEqual(["check:Check payment:primary"]);
        expect(labels({ problem: "limit", canCheck: false })).toEqual([]);
    });

    it("g5: a purchase that is back, with the day it was made", () => {
        expect(view({ paid: { test: false }, restored: { paidAt: NOON_19_NOV } })).toMatchObject({
            title: "Your purchase from 19 Nov is back.",
            sub: null,
            actions: [],
        });
        expect(view({ paid: { test: false }, restored: { paidAt: null } })).toMatchObject({
            title: "Your purchase is back.",
        });
        expect(view({ paid: { test: false }, restored: { paidAt: "not a date" } })).toMatchObject({
            title: "Your purchase is back.",
        });
    });

    it("o1, o2: a guest gets a receipt link to keep, then is told it was copied", () => {
        const guest = {
            paid: { test: false },
            buyer: "guest",
            receipt: "https://orbit.test/a/a1#receipt=abc",
        } as Partial<PayLine>;
        expect(view(guest)).toMatchObject({
            title: "Paid. Thank you.",
            sub: "A guest purchase on this browser. Save your private receipt link: it brings this purchase back on any device, so share it with no one.",
        });
        expect(labels(guest)).toEqual(["copy:Copy private receipt link:primary"]);
        expect(view(guest, { copied: true })).toMatchObject({
            title: "Private receipt link copied.",
            sub: "Keep it somewhere safe, like your notes or email. Anyone who has it can bring this purchase back.",
        });
        expect(view(guest, { copied: true })?.actions).toEqual([
            { kind: "copy", label: "Copied", style: "secondary", disabled: true },
        ]);
    });

    it("o3, o4, o6: Bought this before? can be closed; none found says it for a guest and for an account", () => {
        expect(view({ offerRestore: true })).toMatchObject({ title: "Bought this before?", sub: null, closable: true });
        expect(labels({ offerRestore: true })).toEqual(["restore:Restore purchase:secondary"]);
        expect(view({ problem: "none", buyer: "guest" })).toMatchObject({
            title: "No purchase found in this browser.",
            sub: "Open the receipt link you saved when you paid. It brings your purchase back here.",
            closable: true,
        });
        expect(view({ problem: "none", buyer: "account" })).toMatchObject({
            title: "No purchase found on your account for this page.",
            sub: "If you paid as a guest, open the receipt link you saved.",
            closable: true,
        });
    });

    it("t1: a test payment says no money moved, and is never a purchase, whoever the buyer is", () => {
        for (const extra of [
            {},
            { receipt: "https://orbit.test/a/a1#receipt=abc", buyer: "guest" },
            { restored: { paidAt: NOON_19_NOV } },
        ] as Partial<PayLine>[]) {
            expect(view({ paid: { test: true }, ...extra })).toMatchObject({
                title: "Test payment received. No money moved.",
                sub: "Only a live payment counts as a purchase.",
                actions: [],
            });
        }
    });

    it("a restored test purchase still reads as a test payment, never as a purchase that is back", () => {
        expect(view({ paid: { test: true }, restored: { paidAt: "2026-11-19T08:00:00Z" } })).toMatchObject({
            title: "Test payment received. No money moved.",
            sub: "Only a live payment counts as a purchase.",
            actions: [],
        });
    });

    it("u2, u3: a page that cannot ask says it needs an update; the buyer can check, the owner is told to ask the Brick", () => {
        expect(view({ needsUpdate: true, canCheck: true })).toMatchObject({
            title: "This page's pay button needs an update.",
            sub: "If you already paid, check it here before paying again.",
        });
        expect(labels({ needsUpdate: true, canCheck: true })).toEqual(["check:Check payment:primary"]);
        expect(view({ needsUpdate: true, canCheck: true }, { owner: { maker: "Nova" } })).toMatchObject({
            title: "This page's pay button needs an update.",
            sub: "Ask Nova to make the page again.",
        });
        expect(labels({ needsUpdate: true, canCheck: true }, { owner: { maker: "Nova" } })).toEqual([
            "check:Check payment:secondary",
        ]);
        // While a check is running nothing more is offered
        expect(labels({ needsUpdate: true, canCheck: true, checking: true })).toEqual([]);
        // A payment on its way keeps its Continue link, for the buyer and the owner: a pop-up that was blocked or closed can be opened again
        const resume = { url: "https://checkout.examplepay.com/c1", app: "Example" };
        expect(labels({ needsUpdate: true, checking: true, resume })).toEqual(["resume:Continue to Example:secondary"]);
        expect(labels({ needsUpdate: true, checking: true, resume }, { owner: { maker: "Nova" } })).toEqual([
            "resume:Continue to Example:secondary",
        ]);
    });

    it("says too many tries and unavailable plainly, and nothing at all when there is nothing to say", () => {
        expect(view({ problem: "limit" })).toMatchObject({
            title: "Too many tries for now.",
            sub: "Try again in a little while.",
        });
        expect(view({ problem: "unavailable" })).toMatchObject({
            title: "Payments unavailable",
            sub: null,
            actions: [],
        });
        // The payment was set on a version this person is not shown yet: plain, nothing to press, no newer version named
        expect(view({ problem: "not_published" })).toMatchObject({
            title: "Payments unavailable",
            sub: "This page isn’t taking payments right now. Try again later.",
            actions: [],
            closable: false,
        });
        // The page was published again since it was opened: open it again, nothing to press here
        expect(view({ problem: "page_changed" })).toMatchObject({
            title: "This page was updated.",
            sub: "Close it and open it again to see the latest version before you pay.",
            actions: [],
            closable: false,
        });
        expect(view({})).toBeNull();
    });

    it("names the day in the buyer's language, English first the day", () => {
        expect(shortDate(NOON_19_NOV, "en-US")).toBe("19 Nov");
        expect(shortDate(NOON_19_NOV)).toBe("19 Nov");
        expect(shortDate(null)).toBeNull();
        expect(shortDate(NOON_19_NOV, "not a locale!!")).toBe("19 Nov");
    });
});
