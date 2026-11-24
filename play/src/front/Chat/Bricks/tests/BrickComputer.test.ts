import { describe, expect, it } from "vitest";
import {
    barState,
    canWatch,
    fileSize,
    holdsComputer,
    monthWord,
    noticeToTell,
    parseBrickComputer,
    parseComputerJob,
    parseJobAnswer,
    sentenceStart,
    type BrickComputerView,
} from "../Computer/BrickComputer";

const job = (over: Record<string, unknown> = {}) => ({
    id: "j1",
    title: "Book the table",
    status: "running",
    queuedFor: null,
    stepDone: 2,
    stepTotal: 5,
    stepLabel: "Opening the site",
    waitingFor: null,
    control: "brick",
    ready: null,
    ...over,
});
const view = (over: Partial<BrickComputerView> = {}): BrickComputerView => ({
    available: true,
    on: true,
    machine: "working",
    job: parseComputerJob(job()) ?? null,
    queued: [],
    month: { leftFraction: 0.8, unlimited: false, endsAt: "2026-12-01T00:00:00.000Z" },
    files: { bytes: 0, savedAt: null },
    restoredFrom: null,
    notice: null,
    ...over,
});

describe("a Brick's computer as the game reads it (#2000)", () => {
    it("reads a job and drops anything it does not know", () => {
        expect(parseComputerJob(job())).toMatchObject({ id: "j1", status: "running", stepDone: 2, stepTotal: 5 });
        expect(parseComputerJob(job({ status: "exploding" }))).toBeUndefined();
        expect(parseComputerJob(null)).toBeUndefined();
        expect(parseComputerJob(job({ waitingFor: "money", queuedFor: "never" }))).toMatchObject({
            waitingFor: null,
            queuedFor: null,
        });
    });

    it("names what it is ready to put in only when it says both what and where", () => {
        expect(parseComputerJob(job({ ready: { what: "your name", where: "the form" } }))?.ready).toEqual({
            what: "your name",
            where: "the form",
        });
        expect(parseComputerJob(job({ ready: { what: "your name" } }))?.ready).toBeNull();
    });

    it("reads the computer, keeping the share of the month between nothing and all of it", () => {
        const read = parseBrickComputer({
            computer: {
                available: true,
                on: true,
                machine: "resting",
                job: null,
                queued: [job({ id: "j2", status: "queued", queuedFor: "allowance" }), { nope: 1 }],
                month: { leftFraction: 7, unlimited: false, endsAt: "2026-12-01T00:00:00.000Z" },
                files: { bytes: 2000, savedAt: "2026-11-10T10:00:00.000Z" },
            },
        });
        expect(read?.machine).toBe("resting");
        expect(read?.queued.map((one) => one.id)).toEqual(["j2"]);
        expect(read?.month?.leftFraction).toBe(1);
        expect(parseBrickComputer({})).toBeUndefined();
        expect(parseBrickComputer(null)).toBeUndefined();
        expect(parseBrickComputer({ computer: { machine: "weird" } })?.machine).toBe("none");
    });

    it("reads the job out of a job answer", () => {
        expect(parseJobAnswer({ job: job() })?.id).toBe("j1");
        expect(parseJobAnswer({})).toBeUndefined();
    });

    it("says the month in words: never a number", () => {
        const month = (leftFraction: number, unlimited = false) => ({ leftFraction, unlimited, endsAt: "x" });
        expect(monthWord(month(0.9))).toBe("plenty");
        expect(monthWord(month(0.4))).toBe("half");
        expect(monthWord(month(0.1))).toBe("little");
        expect(monthWord(month(0))).toBe("none");
        expect(monthWord(month(0, true))).toBe("unlimited");
    });

    it("writes sizes the way a person knows them", () => {
        expect(fileSize(10)).toBe("1 KB");
        expect(fileSize(340_000_000)).toBe("340 MB");
        expect(fileSize(1_200_000_000)).toBe("1.2 GB");
    });

    it("lets the person watch only a computer that is working on something", () => {
        expect(canWatch(view())).toBe(true);
        expect(canWatch(view({ machine: "resting" }))).toBe(false);
        expect(canWatch(view({ job: null }))).toBe(false);
        expect(canWatch(view({ on: false }))).toBe(false);
        expect(canWatch(undefined)).toBe(false);
        expect(holdsComputer(parseComputerJob(job({ status: "queued" })))).toBe(false);
    });

    it("tells the bar what is true: waking, working, waiting for the person, in line, or nothing", () => {
        expect(barState(view())).toBe("working");
        expect(barState(view({ machine: "waking" }))).toBe("waking");
        expect(
            barState(view({ job: parseComputerJob(job({ status: "waiting", waitingFor: "details" })) ?? null }))
        ).toBe("waiting");
        expect(barState(view({ job: null, queued: [parseComputerJob(job({ status: "queued" }))!] }))).toBe("queued");
        expect(barState(view({ job: null }))).toBeNull();
        expect(barState(view({ on: false }))).toBeNull();
        expect(barState(undefined)).toBeNull();
    });

    it("starts a named line with a capital, whatever case Brick named it in", () => {
        expect(sentenceStart("your name and passport number")).toBe("Your name and passport number");
        expect(sentenceStart("Your name")).toBe("Your name");
        expect(sentenceStart("")).toBe("");
    });

    it("reads how the last job ended, and nothing for an ending it does not know", () => {
        const read = (notice: unknown) =>
            parseBrickComputer({ computer: { available: true, on: true, notice } })?.notice;
        expect(read({ jobId: "j9", how: "unanswered", endedAt: "2026-11-15T12:00:00.000Z" })).toEqual({
            jobId: "j9",
            how: "unanswered",
        });
        expect(read({ jobId: "j9", how: "month" })).toEqual({ jobId: "j9", how: "month" });
        expect(read({ jobId: "j9", how: "failed" })).toBeNull();
        expect(read({ how: "month" })).toBeNull();
        expect(read(null)).toBeNull();
        expect(read(undefined)).toBeNull();
    });

    it("tells the notice only when nothing else is happening on a computer that is on", () => {
        const notice = { jobId: "j9", how: "month" as const };
        expect(noticeToTell(view({ job: null, machine: "resting", notice }))).toEqual(notice);
        expect(noticeToTell(view({ notice }))).toBeNull();
        expect(noticeToTell(view({ job: null, machine: "resting", notice, on: false }))).toBeNull();
        expect(
            noticeToTell(view({ job: null, machine: "resting", notice, queued: [parseComputerJob(job())!] }))
        ).toBeNull();
        expect(noticeToTell(view({ job: null, machine: "resting" }))).toBeNull();
        expect(noticeToTell(undefined)).toBeNull();
    });
});
