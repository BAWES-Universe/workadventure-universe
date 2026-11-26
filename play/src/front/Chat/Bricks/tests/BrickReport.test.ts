import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A note a Brick sent to the Universe team (mock "Brick reports inbox", screens 6 and 7): read from the answer's message, the line under
 * the answer, what was sent, and Take it back for 24 hours.
 */
const game = vi.hoisted(() => ({
    takeBack: vi.fn<(id: string, key: string) => Promise<"taken" | "too_late" | "failed">>(),
    openModal: vi.fn<(component: unknown, props: unknown) => void>(),
    closeModal: vi.fn<() => void>(),
}));
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("svelte-modals", () => ({ closeModal: game.closeModal, openModal: game.openModal }));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({
    botApiService: { takeBackBrickReport: game.takeBack },
}));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import { BRICK_REPORTS_KEY, TAKE_BACK_MS, canTakeBack, readBrickReports, type BrickReport } from "../BrickReport";
import { takenBackReports } from "../BrickReportStore";
import BrickReportLine from "../BrickReportLine.svelte";
import BrickReportSheet from "../BrickReportSheet.svelte";

const BRICK_SENDER = "@bot_0b7c1d2e-1111-4222-8333-944455556666:matrix.test";
const NOW = Date.parse("2026-11-26T10:00:00.000Z");

const field = (over: Record<string, unknown> = {}) => ({
    id: "note-1",
    key: "key-1234567890abcdef",
    kind: "problem",
    area: "pages",
    title: "Links inside pages don't open",
    tried: "A link on each listing in a shortlist page, then a button.",
    stopped: "Tapping a link does nothing in the chat preview.",
    idea: "Let page links open in a new tab.",
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

    it("shows the note as kept and what is never sent", async () => {
        part = new BrickReportSheet({ target, props: { isOpen: true, report, messageAt: NOW }, intro: false });
        await settle();
        expect(byId("brickReportKind")?.textContent?.trim()).toBe("Problem · Pages");
        expect(byId("brickReportTitle")?.textContent).toBe("Links inside pages don't open");
        expect(text()).toContain("What I tried A link on each listing in a shortlist page, then a button.");
        expect(text()).toContain("What stopped me Tapping a link does nothing in the chat preview.");
        expect(text()).toContain("Idea Let page links open in a new tab.");
        expect(text()).toContain(
            "Never sent: your name, this chat’s words, links or files. The Universe team sees how many Bricks hit this, never whose."
        );
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
