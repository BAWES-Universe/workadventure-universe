import { beforeAll, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../../i18n/i18n-util.sync";
import { i18nObject } from "../../i18n/i18n-util";
import { NO_PAY_LINE, type PayLine } from "./PagePayments";
import { describePayLine, shortDate } from "./payLineView";

vi.mock("./ArtifactApi", () => ({ ArtifactRequestError: class extends Error {}, payOnArtifact: vi.fn() }));

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
                sub: "If you paid, it still counts. You can check now.",
                closable: false,
            });
            expect(labels(over)).toEqual(["check:Check payment:primary"]);
        }
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
            sub: "If you just paid, it can take a few minutes to show.",
        });
        expect(labels({ problem: "not_paid", canCheck: true })).toEqual(["check:Check payment:primary"]);
    });

    it("g5: a purchase that is back, with the day it was made", () => {
        expect(view({ paid: { test: false }, restored: { paidAt: "2026-11-19T08:00:00.000Z" } })).toMatchObject({
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
            sub: "Save your receipt link. It brings this purchase back on any device.",
        });
        expect(labels(guest)).toEqual(["copy:Copy receipt link:primary"]);
        expect(view(guest, { copied: true })).toMatchObject({
            title: "Receipt link copied.",
            sub: "Keep it somewhere safe, like your notes or email.",
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
            { restored: { paidAt: "2026-11-19T08:00:00.000Z" } },
        ] as Partial<PayLine>[]) {
            expect(view({ paid: { test: true }, ...extra })).toMatchObject({
                title: "Test payment received. No money moved.",
                sub: "Only a live payment counts as a purchase.",
                actions: [],
            });
        }
    });

    it("u2, u3: a page that cannot ask says it needs an update; the buyer can check, the owner is told to ask the Brick", () => {
        expect(view({ needsUpdate: true, canCheck: true })).toMatchObject({
            title: "This page's pay button needs an update.",
            sub: "If you already paid, you can check it here.",
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
        expect(view({})).toBeNull();
    });

    it("names the day in the buyer's language, English first the day", () => {
        expect(shortDate("2026-11-19T08:00:00.000Z", "en-US")).toBe("19 Nov");
        expect(shortDate("2026-11-19T08:00:00.000Z")).toBe("19 Nov");
        expect(shortDate(null)).toBeNull();
        expect(shortDate("2026-11-19T08:00:00.000Z", "not a locale!!")).toBe("19 Nov");
    });
});
