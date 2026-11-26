import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A note a Brick sent to the Universe team (mock "Brick reports inbox", screens 6 and 7): read from the answer's message, the line under
 * the answer, what was sent, the person's own words sent only when they press Send, what became of it read from Orbit, and Take it back
 * for 24 hours.
 */
const game = vi.hoisted(() => ({
    takeBack: vi.fn<(id: string, key: string) => Promise<"taken" | "too_late" | "failed">>(),
    addWords: vi.fn<(id: string, key: string, words: string) => Promise<{ outcome: string; words?: string }>>(),
    status: vi.fn<(id: string, key: string) => Promise<{ state: string; words: string } | null>>(),
    openModal: vi.fn<(component: unknown, props: unknown) => void>(),
    closeModal: vi.fn<() => void>(),
}));
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("svelte-modals", () => ({ closeModal: game.closeModal, openModal: game.openModal }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: {
        takeBackBrickReport: game.takeBack,
        addBrickReportWords: game.addWords,
        brickReportStatus: game.status,
    },
}));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { BRICK_REPORTS_KEY, TAKE_BACK_MS, canTakeBack, readBrickReports, type BrickReport } from "../BrickReport";
import { sentReportWords, takenBackReports } from "../BrickReportStore";
import BrickReportLine from "../BrickReportLine.svelte";
import BrickReportSheet from "../BrickReportSheet.svelte";

const BRICK_SENDER = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";
const NOW = Date.parse("2026-11-26T10:00:00.000Z");

const field = (over: Record<string, unknown> = {}) => ({
    id: "note-1",
    key: "key-1234567890abcdef",
    kind: "problem",
    area: "pages",
    title: "Failed: read_page",
    retried: true,
    wordsDraft: "Links on my listings page do nothing when tapped.",
    sentAt: NOW,
    ...over,
});

describe("reading the notes on a Brick's answer", () => {
    it("reads each whole note, once, from a Brick's own text message", () => {
        const content = {
            msgtype: "m.text",
            body: "Sent.",
            [BRICK_REPORTS_KEY]: [field(), field(), field({ id: "note-2", kind: "odd", area: "odd", sentAt: "x" })],
        };
        expect(readBrickReports(BRICK_SENDER, content)).toEqual([
            field(),
            { ...field({ id: "note-2" }), kind: "problem", area: "other", sentAt: 0 },
        ]);
        // A note with nothing more: not tried again, no words
        expect(
            readBrickReports(BRICK_SENDER, {
                msgtype: "m.text",
                body: "x",
                [BRICK_REPORTS_KEY]: [field({ retried: "yes", wordsDraft: 4 })],
            })
        ).toEqual([{ ...field(), retried: false, wordsDraft: "" }]);
    });

    it("reads nothing from a person's message, another type, or a note with no id, key or title", () => {
        const content = { msgtype: "m.text", body: "x", [BRICK_REPORTS_KEY]: [field()] };
        expect(readBrickReports("@alice:matrix.test", content)).toEqual([]);
        expect(readBrickReports(BRICK_SENDER, { ...content, msgtype: "m.notice" })).toEqual([]);
        expect(
            readBrickReports(BRICK_SENDER, {
                msgtype: "m.text",
                body: "x",
                [BRICK_REPORTS_KEY]: [field({ id: "" }), field({ key: 3 }), field({ title: " " })],
            })
        ).toEqual([]);
        expect(readBrickReports(BRICK_SENDER, { msgtype: "m.text", body: "x", [BRICK_REPORTS_KEY]: "no" })).toEqual([]);
    });

    it("can be taken back for 24 hours, by the message's time when the note does not say", () => {
        const report = readBrickReports(BRICK_SENDER, {
            msgtype: "m.text",
            body: "x",
            [BRICK_REPORTS_KEY]: [field()],
        })[0];
        expect(canTakeBack(report, null, NOW + TAKE_BACK_MS - 1)).toBe(true);
        expect(canTakeBack(report, null, NOW + TAKE_BACK_MS)).toBe(false);
        expect(canTakeBack({ ...report, sentAt: 0 }, NOW, NOW + 1000)).toBe(true);
        expect(canTakeBack({ ...report, sentAt: 0 }, null, NOW)).toBe(false);
    });
});

async function settle(): Promise<void> {
    for (let i = 0; i < 3; i++) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
        // eslint-disable-next-line no-await-in-loop
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0);
        });
    }
}

describe("the line under the answer and what was sent", () => {
    let target: HTMLElement;
    let part: { $destroy: () => void } | undefined;
    const report = field() as BrickReport;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        game.status.mockResolvedValue({ state: "live", words: "" });
        sentReportWords.set(new Map());
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(NOW + 60_000);
        takenBackReports.set(new Set());
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        part?.$destroy();
        part = undefined;
        target.remove();
        vi.useRealTimers();
    });

    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";

    it("says it was sent, and See what was sent opens the note", async () => {
        part = new BrickReportLine({ target, props: { reports: [report], messageAt: NOW } });
        await settle();
        expect(byId("brickReportLine")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
            "Sent to the Universe team · See what was sent"
        );
        byId("brickReportSee")?.click();
        expect(game.openModal).toHaveBeenCalledWith(BrickReportSheet, { report, messageAt: NOW });
    });

    it("shows Taken back from another device without opening the note, asking Orbit once", async () => {
        const fresh = { ...report, id: "note-other-device" };
        game.status.mockResolvedValue({ state: "taken_back", words: "" });
        part = new BrickReportLine({ target, props: { reports: [fresh], messageAt: NOW } });
        await settle();
        expect(game.status).toHaveBeenCalledWith("note-other-device", "key-1234567890abcdef");
        expect(byId("brickReportTakenBack")?.textContent).toBe("Taken back");
        part.$destroy();
        part = new BrickReportLine({ target, props: { reports: [fresh], messageAt: NOW } });
        await settle();
        expect(game.status).toHaveBeenCalledTimes(1);
    });

    it("asks Orbit again the next time the line is drawn when it could not answer", async () => {
        const lost = { ...report, id: "note-lost-read" };
        game.status.mockResolvedValueOnce(null);
        part = new BrickReportLine({ target, props: { reports: [lost], messageAt: NOW } });
        await settle();
        part.$destroy();
        game.status.mockResolvedValueOnce({ state: "taken_back", words: "" });
        part = new BrickReportLine({ target, props: { reports: [lost], messageAt: NOW } });
        await settle();
        expect(game.status).toHaveBeenCalledTimes(2);
        expect(byId("brickReportTakenBack")?.textContent).toBe("Taken back");
    });

    it("asks Orbit nothing for a line older than 24 hours", async () => {
        vi.setSystemTime(NOW + TAKE_BACK_MS + 1);
        part = new BrickReportLine({ target, props: { reports: [{ ...report, id: "note-old" }], messageAt: NOW } });
        await settle();
        expect(game.status).not.toHaveBeenCalled();
    });

    it("shows the note as kept, what is never sent, and the person's words as they would go, not sent yet", async () => {
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        expect(byId("brickReportKind")?.textContent?.trim()).toBe("Problem · Pages");
        expect(byId("brickReportTitle")?.textContent).toBe("Failed: read_page");
        expect(byId("brickReportRetried")?.textContent).toBe("Yes, before sending");
        expect(text()).toContain("Your words, not sent yet Links on my listings page do nothing when tapped.");
        expect(text()).toContain("This is exactly what would go with the note. Nothing else you wrote is sent.");
        expect(text()).toContain(
            "Never sent on its own: your name, this chat’s words, links or files; your words go only if you press Send. The Universe team sees how many Bricks hit this, never whose."
        );
        expect(game.addWords).not.toHaveBeenCalled();
        // What became of it is read from Orbit when it opens
        expect(game.status).toHaveBeenCalledWith("note-1", "key-1234567890abcdef");
    });

    it("sends the person's words only when they press Send, exactly as shown", async () => {
        game.addWords.mockResolvedValue({
            outcome: "sent",
            words: "Links on my listings page do nothing when tapped.",
        });
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        byId("brickReportSendWords")?.click();
        await settle();
        expect(game.addWords).toHaveBeenCalledWith(
            "note-1",
            "key-1234567890abcdef",
            "Links on my listings page do nothing when tapped."
        );
        expect(byId("brickReportWordsSent")?.textContent).toBe("Links on my listings page do nothing when tapped.");
        expect(byId("brickReportSendWords")).toBeNull();
        expect(byId("brickReportWordsDraft")).toBeNull();
    });

    it("says when the words did not go", async () => {
        game.addWords.mockResolvedValueOnce({ outcome: "failed" }).mockResolvedValueOnce({ outcome: "too_late" });
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        byId("brickReportSendWords")?.click();
        await settle();
        expect(byId("brickReportWordsProblem")?.textContent?.trim()).toBe("Your words didn’t go. Try again.");
        byId("brickReportSendWords")?.click();
        await settle();
        expect(byId("brickReportWordsProblem")?.textContent?.trim()).toBe("Words can only be added within 24 hours.");
        expect(byId("brickReportSendWords")).toBeNull();
    });

    it("shows what another device did: taken back there, or words already sent", async () => {
        game.status.mockResolvedValueOnce({ state: "taken_back", words: "" });
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        expect(byId("brickReportSheetTakenBack")?.textContent).toBe("Taken back");
        expect(byId("brickReportTakeBack")).toBeNull();
        expect(byId("brickReportSendWords")).toBeNull();
        part.$destroy();
        takenBackReports.set(new Set());
        game.status.mockResolvedValueOnce({ state: "live", words: "Sent from my phone." });
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        expect(byId("brickReportWordsSent")?.textContent).toBe("Sent from my phone.");
        expect(byId("brickReportSendWords")).toBeNull();
    });

    it("a note with no words and not tried again shows neither", async () => {
        part = new BrickReportSheet({
            target,
            props: { isOpen: true, report: { ...report, retried: false, wordsDraft: "" }, messageAt: NOW },
            intro: false,
        });
        await settle();
        expect(byId("brickReportRetried")).toBeNull();
        expect(byId("brickReportWordsDraft")).toBeNull();
        expect(byId("brickReportSendWords")).toBeNull();
    });

    it("takes it back, and the line under the answer says so", async () => {
        game.takeBack.mockResolvedValue("taken");
        const line = document.createElement("div");
        document.body.appendChild(line);
        const under = new BrickReportLine({ target: line, props: { reports: [report], messageAt: NOW } });
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        byId("brickReportTakeBack")?.click();
        await settle();
        expect(game.takeBack).toHaveBeenCalledWith("note-1", "key-1234567890abcdef");
        expect(game.closeModal).toHaveBeenCalled();
        expect(line.querySelector('[data-testid="brickReportTakenBack"]')?.textContent).toBe("Taken back");
        under.$destroy();
        line.remove();
    });

    it("says when taking it back did not work, and when it is too late", async () => {
        game.takeBack.mockResolvedValueOnce("failed").mockResolvedValueOnce("too_late");
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        byId("brickReportTakeBack")?.click();
        await settle();
        expect(byId("brickReportProblem")?.textContent?.trim()).toBe("That didn’t work. Try again.");
        byId("brickReportTakeBack")?.click();
        await settle();
        expect(byId("brickReportProblem")?.textContent?.trim()).toBe("It can only be taken back within 24 hours.");
        expect(byId("brickReportTakeBack")).toBeNull();
        expect(game.closeModal).not.toHaveBeenCalled();
    });

    it("offers no Take it back after 24 hours", async () => {
        vi.setSystemTime(NOW + TAKE_BACK_MS + 1);
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        expect(byId("brickReportTakeBack")).toBeNull();
        expect(byId("brickReportDone")).not.toBeNull();
    });
});
