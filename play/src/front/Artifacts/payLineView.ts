import type { TranslationFunctions } from "../../i18n/i18n-types";
import type { PayLine } from "./PagePayments";

/** What can be pressed on the window's line under a paying page. */
export type PayAction =
    | { kind: "check"; label: string; style: "primary" | "secondary" }
    | { kind: "restore"; label: string; style: "primary" | "secondary" }
    | { kind: "copy"; label: string; style: "primary" | "secondary"; disabled?: boolean }
    | { kind: "resume"; label: string; url: string; style: "primary" | "secondary" };

export interface PayView {
    title: string;
    sub: string | null;
    actions: PayAction[];
    /** The line can be closed (a quiet offer, or "no purchase found"); a payment on its way never can. */
    closable: boolean;
}

type Words = TranslationFunctions["chat"]["artifacts"];

/** "19 Nov": the day a purchase was made, never a time-zone dump. English reads day first, as the approved mock does. */
export function shortDate(iso: string | null, locale = "en-GB"): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return date.toLocaleDateString(locale.startsWith("en") ? "en-GB" : locale, { day: "numeric", month: "short" });
    } catch {
        return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }
}

/**
 * What the line says, and what can be pressed, for the state the window is in (the approved mock M1; Orbit's public page says the same).
 * A pure function, so every screen of the mock is tested on its own. Order: a payment that ended well, then a problem, then a page that
 * cannot ask, then a payment on its way, then the quiet offers.
 * `owner` is set for the page's owner, who is told to ask the Brick for a new page; a buyer is told they can check their payment.
 */
export function describePayLine(
    line: PayLine,
    state: { copied: boolean; locale?: string; owner?: { maker: string } },
    LL: Words
): PayView | null {
    const check: PayAction = { kind: "check", label: LL.payCheckPayment(), style: "primary" };
    const resume: PayAction[] = line.resume
        ? [
              {
                  kind: "resume",
                  label: line.resume.app ? LL.payContinue({ app: line.resume.app }) : LL.payContinueDefault(),
                  url: line.resume.url,
                  style: "secondary",
              },
          ]
        : [];

    // A payment that ended without paying, while a page of a newer opening was turned away: Restore purchase is owed, and offered along with what the end already offers
    const restoreToo: PayAction[] = line.offerRestore
        ? [{ kind: "restore", label: LL.payRestorePurchase(), style: "secondary" }]
        : [];

    if (line.paid) {
        if (line.paid.test) return { title: LL.payPaidTest(), sub: LL.payPaidTestSub(), actions: [], closable: false };
        if (line.restored) {
            const date = shortDate(line.restored.paidAt, state.locale);
            return {
                title: date ? LL.payRestored({ date }) : LL.payRestoredNoDate(),
                sub: null,
                actions: [],
                closable: false,
            };
        }
        if (line.receipt) {
            return state.copied
                ? {
                      title: LL.payReceiptCopied(),
                      sub: LL.payReceiptCopiedSub(),
                      actions: [{ kind: "copy", label: LL.payCopied(), style: "secondary", disabled: true }],
                      closable: false,
                  }
                : {
                      title: LL.payPaidGuest(),
                      sub: LL.payPaidGuestSub(),
                      actions: [{ kind: "copy", label: LL.payCopyReceipt(), style: "primary" }],
                      closable: false,
                  };
        }
        // A guest on a page that cannot be opened by link has no receipt link: it is not told the purchase is saved to an account
        if (line.buyer === "guest") {
            return { title: LL.payPaidGuest(), sub: LL.payPaidGuestNoReceiptSub(), actions: [], closable: false };
        }
        return { title: LL.payPaidAccount(), sub: LL.payPaidAccountSub(), actions: [], closable: false };
    }
    if (line.problem === "none") {
        // Check payment found no order for the wish: it can be asked again (a Restore purchase that found nothing cannot)
        const again = line.canCheck ? [check] : [];
        return line.buyer === "account"
            ? { title: LL.payNoneAccount(), sub: LL.payNoneAccountSub(), actions: again, closable: true }
            : { title: LL.payNoneGuest(), sub: LL.payNoneGuestSub(), actions: again, closable: true };
    }
    if (line.problem === "not_paid") {
        return { title: LL.payNotPaid(), sub: LL.payNotPaidSub(), actions: [check, ...restoreToo], closable: false };
    }
    if (line.problem === "cant_confirm") {
        return { title: LL.payNotHeard(), sub: LL.payNotHeardSub(), actions: [check, ...restoreToo], closable: false };
    }
    // A start whose answer was lost: an order may or may not exist, so it is said like any other payment not heard back about
    if (line.problem === "unavailable") {
        return line.canCheck
            ? { title: LL.payNotHeard(), sub: LL.payNotHeardSub(), actions: [check, ...restoreToo], closable: false }
            : { title: LL.payUnavailable(), sub: null, actions: restoreToo, closable: false };
    }
    if (line.problem === "limit") {
        // An answer that may have made an order (an uncertain refusal) can be checked
        return {
            title: LL.payLimit(),
            sub: LL.payLimitSub(),
            actions: [...(line.canCheck ? [check] : []), ...restoreToo],
            closable: false,
        };
    }
    if (line.needsUpdate) {
        if (state.owner) {
            // The owner can make the page again; checking a payment is still there, quietly
            return {
                title: LL.payNeedsUpdate(),
                sub: LL.payNeedsUpdateOwnerSub({ maker: state.owner.maker }),
                // A payment on its way keeps its Continue link: a blocked or closed pop-up can still be opened again
                actions: line.checking ? resume : [{ ...check, style: "secondary" }],
                closable: false,
            };
        }
        return {
            title: LL.payNeedsUpdate(),
            sub: LL.payNeedsUpdateSub(),
            actions: line.checking ? resume : [check],
            closable: false,
        };
    }
    if (line.checking) {
        return line.slow
            ? { title: LL.payTakingLonger(), sub: LL.payTakingLongerSub(), actions: resume, closable: false }
            : { title: LL.payChecking(), sub: LL.payCheckingSub(), actions: resume, closable: false };
    }
    if (line.offerRestore) {
        return {
            title: LL.payBoughtBefore(),
            sub: null,
            actions: [{ kind: "restore", label: LL.payRestorePurchase(), style: "secondary" }],
            closable: true,
        };
    }
    if (line.canCheck) return { title: LL.payNotHeard(), sub: LL.payNotHeardSub(), actions: [check], closable: false };
    return null;
}
