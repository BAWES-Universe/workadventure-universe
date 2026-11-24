import { describe, expect, it } from "vitest";
import {
    exactDollars,
    availableLabel,
    availableText,
    fullAgainWhen,
    moneyLeft,
    moneyUsedUp,
    parseUsage,
    renewsWhen,
    spentLabel,
    storageSize,
} from "../Usage";

const answer = (over: Record<string, unknown> = {}) => ({
    chat: { left: 0.6, words: "plenty", fullAgainAt: "2026-11-12T17:40:00.000Z" },
    computer: null,
    storage: null,
    extra: null,
    ...over,
});

describe("a person's usage as Orbit sends it (#1999)", () => {
    it("reads the Universe AI bar, with nothing else for someone whose Brick uses no computer", () => {
        expect(parseUsage(answer())).toEqual({
            version: null,
            chat: {
                left: 0.6,
                words: "plenty",
                fullAgainAt: "2026-11-12T17:40:00.000Z",
                replies: null,
                extra: null,
                unavailable: false,
            },
            apps: null,
            computer: null,
            credit: [],
            bots: [],
            activity: [],
            storageBytes: null,
            storagePaidByUniverse: false,
            extraUntil: null,
        });
    });

    it("reads computer time, what the Bricks keep and the day extra usage ends", () => {
        const usage = parseUsage(
            answer({
                computer: {
                    left: 0,
                    words: "out",
                    startsAgainAt: "2026-12-01T00:00:00.000Z",
                    unlimited: false,
                    asked: false,
                    canAskForMore: true,
                },
                storage: { bytes: 1_400_000_000 },
                extra: { until: "2026-11-30T00:00:00.000Z" },
            })
        );
        expect(usage?.computer).toEqual({
            left: 0,
            words: "out",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            asked: false,
            canAskForMore: true,
            money: null,
        });
        expect(usage?.storageBytes).toBe(1_400_000_000);
        expect(usage?.extraUntil).toBe("2026-11-30T00:00:00.000Z");
    });

    it("keeps a bar between empty and full, and leaves out what it can't read", () => {
        expect(parseUsage(answer({ chat: { left: 3, words: "plenty", fullAgainAt: null } }))?.chat.left).toBe(1);
        expect(parseUsage(answer({ computer: { left: 0.5, words: "half" } }))?.computer).toBeNull();
        expect(parseUsage(answer({ storage: { bytes: -4 } }))?.storageBytes).toBeNull();
        expect(parseUsage(answer({ extra: { until: "soon" } }))?.extraUntil).toBeNull();
    });

    it("is nothing when the answer is not a usage", () => {
        expect(parseUsage(null)).toBeUndefined();
        expect(parseUsage({ error: "Unauthorized" })).toBeUndefined();
        expect(parseUsage(answer({ chat: { left: 0.5, words: "lots" } }))).toBeUndefined();
    });
});

const real = (over: Record<string, unknown> = {}) =>
    answer({
        version: 1731645600000,
        chat: {
            left: 0.6,
            words: "plenty",
            fullAgainAt: "2026-11-12T20:40:00.000Z",
            replies: { available: 18, total: 30, inProgress: 2, running: true, windowHours: 5 },
        },
        apps: {
            kind: "monthly",
            availableMicros: 3_200_000,
            totalMicros: 5_000_000,
            renewsAt: "2026-12-01T00:00:00.000Z",
            canAskForMore: false,
        },
        ...over,
    });

describe("real numbers (credits and grants)", () => {
    it("reads replies as Orbit counted them, and Instant Apps in dollars", () => {
        const usage = parseUsage(real());
        expect(usage?.version).toBe(1731645600000);
        expect(usage?.chat.replies).toEqual({ available: 18, total: 30, inProgress: 2, running: true, windowHours: 5 });
        expect(usage?.chat.left).toBeCloseTo(0.6);
        expect(usage?.apps).toEqual({
            kind: "monthly",
            availableMicros: 3_200_000,
            totalMicros: 5_000_000,
            inProgressMicros: 0,
            renewsAt: "2026-12-01T00:00:00.000Z",
            asked: false,
            canAskForMore: false,
            unavailable: false,
        });
    });

    it("never reads more replies available than there are", () => {
        const usage = parseUsage(
            real({ chat: { replies: { available: 50, total: 30, inProgress: 0, running: true } } })
        );
        expect(usage?.chat.replies?.available).toBe(30);
        expect(usage?.chat.left).toBe(1);
    });

    it("reads a bar from the counts alone, and a balance that could not be read", () => {
        expect(parseUsage(real({ chat: { replies: { available: 0, total: 30, running: true } } }))?.chat.words).toBe(
            "out"
        );
        const unread = parseUsage(real({ chat: { unavailable: true }, apps: { unavailable: true } }));
        expect(unread?.chat.unavailable).toBe(true);
        expect(unread?.apps?.unavailable).toBe(true);
    });

    it("reads an extra that lifts the limit, as a multiple or as no personal limit", () => {
        const twice = { multiplier: 2, until: "2026-12-31T00:00:00.000Z" };
        expect(
            parseUsage(real({ chat: { replies: { available: 48, total: 60, running: true }, extra: twice } }))?.chat
                .extra
        ).toEqual({
            multiplier: 2,
            noLimit: false,
            until: "2026-12-31T00:00:00.000Z",
        });
        const none = parseUsage(
            real({ chat: { replies: { available: 0, total: 0, running: false }, extra: { noLimit: true } } })
        );
        expect(none?.chat.extra).toEqual({ multiplier: null, noLimit: true, until: null });
        // 1x or less is no extra
        expect(
            parseUsage(real({ chat: { replies: { available: 1, total: 2, running: true }, extra: { multiplier: 1 } } }))
                ?.chat.extra
        ).toBeNull();
    });

    it("reads computer time in dollars beside the old bar, and leaves out what it can't read", () => {
        const money = {
            left: 0.4,
            words: "half",
            startsAgainAt: "2026-12-01T00:00:00.000Z",
            kind: "oneoff",
            availableMicros: 800_000,
            totalMicros: 2_000_000,
        };
        const computer = parseUsage(real({ computer: money }))?.computer;
        expect(computer?.money).toMatchObject({ kind: "oneoff", availableMicros: 800_000, totalMicros: 2_000_000 });
        expect(computer?.left).toBeCloseTo(0.4);
        expect(parseUsage(real({ apps: { kind: "oneoff", availableMicros: "lots" } }))?.apps).toBeNull();
        expect(parseUsage(real({ apps: { availableMicros: -1, totalMicros: 5 } }))?.apps).toBeNull();
    });

    it("keeps the Computers section when only its balance could not be read", () => {
        const computer = parseUsage(real({ computer: { unavailable: true } }))?.computer;
        expect(computer?.money?.unavailable).toBe(true);
        // Nothing else is sent and nothing is made up
        expect(parseUsage(real({ computer: { left: 0.5, words: "half" } }))?.computer).toBeNull();
    });

    it("reads extra credit, what each Brick spent and the tasks, leaving out only the lines it can't read", () => {
        const usage = parseUsage(
            real({
                credit: [
                    {
                        covers: ["apps", "computer"],
                        availableMicros: 3_100_000,
                        totalMicros: 5_000_000,
                        until: "2026-12-31T00:00:00.000Z",
                    },
                    { covers: ["nothing"], availableMicros: 1, totalMicros: 1 },
                ],
                bots: [
                    { id: "11", name: "Brick", spentMicros: 1_390_000, uses: ["apps", "computer", "apps", "x"] },
                    { name: "no id", spentMicros: 5 },
                ],
                activity: [
                    {
                        id: "act_1",
                        title: "Welcome video",
                        at: "2026-11-15T11:16:00.000Z",
                        state: "refunded",
                        spentMicros: null,
                        category: "apps",
                        payer: "sponsor",
                        payerName: "BAWES Universe",
                        lines: [
                            { label: "Instant video", amountMicros: 0 },
                            { label: "", note: "x" },
                        ],
                    },
                    { id: "bad id!", title: "x", at: "2026-11-15T11:16:00.000Z" },
                    { id: "act_2", title: "No time", at: "soon" },
                ],
                storage: { bytes: 1_200_000_000, payer: "universe" },
            })
        );
        expect(usage?.credit).toEqual([
            {
                covers: ["apps", "computer"],
                availableMicros: 3_100_000,
                totalMicros: 5_000_000,
                until: "2026-12-31T00:00:00.000Z",
                fromName: null,
            },
        ]);
        expect(usage?.bots).toEqual([{ id: "11", name: "Brick", spentMicros: 1_390_000, uses: ["apps", "computer"] }]);
        expect(usage?.activity).toHaveLength(1);
        expect(usage?.activity[0]).toMatchObject({
            id: "act_1",
            state: "refunded",
            payer: "sponsor",
            payerName: "BAWES Universe",
            category: "apps",
            lines: [{ label: "Instant video", amountMicros: 0, note: null }],
        });
        expect(usage?.storagePaidByUniverse).toBe(true);
    });

    it("has one row for a receipt: the same id twice is one task, the first", () => {
        const at = "2026-11-15T11:16:00.000Z";
        const read = parseUsage(
            real({
                activity: [
                    { id: "same", title: "First", at },
                    { id: "same", title: "Second", at },
                    { id: "other", title: "Other", at },
                ],
            })
        );
        expect(read?.activity.map((one) => `${one.id}:${one.title}`)).toEqual(["same:First", "other:Other"]);
    });

    it("does not let a row that is still being looked up take the place of the same task's settled row", () => {
        const at = "2026-11-15T11:16:00.000Z";
        const read = parseUsage(
            real({
                activity: [
                    { id: "same", title: "Looking", at, state: "checking" },
                    { id: "same", title: "Settled", at, state: "done" },
                ],
            })
        );
        expect(read?.activity.map((one) => `${one.id}:${one.title}`)).toEqual(["same:Settled"]);
    });

    describe("a task that did not finish, or could not be confirmed", () => {
        const read = (over: Record<string, unknown>) =>
            parseUsage(
                real({
                    activity: [
                        {
                            id: "act_x",
                            title: "Email the invoices",
                            at: "2026-11-15T11:16:00.000Z",
                            state: "done",
                            spentMicros: 30_000,
                            ...over,
                        },
                    ],
                })
            )?.activity[0];
        const step = (outcome: string, over: Record<string, unknown> = {}) => ({
            label: "gmail",
            outcome,
            text: `Gmail · ${outcome}`,
            takenText: "Nothing taken",
            amountMicros: 5_000,
            ...over,
        });

        it("keeps an action whose outcome could not be confirmed, with Orbit's words and no amount", () => {
            const item = read({ actions: [step("worked"), step("unknown", { takenText: "Hold being released" })] });
            expect(item?.actions.map((one) => one.outcome)).toEqual(["worked", "unknown"]);
            expect(item?.actions[1]).toMatchObject({ takenText: "Hold being released", amountMicros: null });
            expect(item?.actions[0]).toMatchObject({ takenText: null, amountMicros: 5_000 });
        });

        it("reads Orbit's failed and unconfirmed outcomes, never as done, with Orbit's headline and note", () => {
            expect(
                read({ outcome: "failed", outcomeText: "Didn't finish", outcomeNote: "The message wasn't sent." })
            ).toMatchObject({
                outcome: "failed",
                outcomeText: "Didn't finish",
                outcomeNote: "The message wasn't sent.",
            });
            expect(read({ outcome: "unconfirmed", outcomeText: "Couldn't confirm" })).toMatchObject({
                outcome: "unconfirmed",
                outcomeText: "Couldn't confirm",
                outcomeNote: null,
            });
        });

        it("is partly done for a step that worked and one that did not work or could not be confirmed", () => {
            expect(read({ outcome: "partial", actions: [step("worked"), step("unknown")] })?.outcome).toBe("partial");
            expect(read({ outcome: "partial", actions: [step("worked"), step("failed")] })?.outcome).toBe("partial");
            expect(read({ outcome: "partial", actions: [step("unknown")] })?.outcome).toBe("done");
            expect(read({ outcome: "partial", actions: [] })?.outcome).toBe("done");
            expect(read({ actions: [step("worked"), step("failed")] })?.outcome).toBe("done");
        });

        it("is partly done for one step that worked even when the other step is the computer, which is not an action", () => {
            // A refunded computer and a charged Gmail send: Orbit says "partial" and sends only the Gmail action
            const item = read({
                outcome: "partial",
                outcomeText: "Partly done",
                outcomeNote: "The Gmail step worked. The computer's time was returned.",
                spentMicros: 5_000,
                returnedMicros: 30_000,
                actions: [step("worked")],
            });
            expect(item).toMatchObject({ outcome: "partial", returnedMicros: 30_000, outcomeText: "Partly done" });
            expect(item?.refundPendingMicros).toBeUndefined();
        });

        it("is partly done, with Orbit's words kept as they are, for an App that was let go and then confirmed delivered (nothing owed for it) beside a computer part given back", () => {
            const NOTE =
                "Partly done. Exa was delivered. Its hold was released. The computer part didn't finish and its cost was returned.";
            const item = read({
                category: "computer",
                outcome: "partial",
                outcomeText: "Partly done",
                outcomeNote: NOTE,
                spentMicros: 0,
                returnedMicros: 30_000,
                actions: [{ label: "exa", outcome: "worked", text: "Exa · worked", takenText: null, amountMicros: 0 }],
            });
            expect(item).toMatchObject({
                outcome: "partial",
                outcomeText: "Partly done",
                outcomeNote: NOTE,
                returnedMicros: 30_000,
            });
            expect(item?.actions).toEqual([
                expect.objectContaining({ label: "exa", outcome: "worked", text: "Exa · worked", amountMicros: 0 }),
            ]);
            expect(item?.refundPendingMicros).toBeUndefined();
        });

        it("reads a rule stop, a task still being decided and a refund pending as themselves, never as done, with Orbit's headline and note", () => {
            expect(
                read({
                    outcome: "stopped",
                    outcomeText: "Stopped at your spending rule",
                    outcomeNote: "A rule you set stopped it.",
                    spentMicros: null,
                })
            ).toMatchObject({
                state: "done",
                outcome: "stopped",
                outcomeText: "Stopped at your spending rule",
                outcomeNote: "A rule you set stopped it.",
                unknownOutcome: false,
            });
            expect(read({ outcome: "deciding", outcomeText: "Still deciding" })).toMatchObject({
                outcome: "deciding",
                outcomeText: "Still deciding",
                unknownOutcome: false,
            });
            expect(
                read({
                    outcome: "refund_pending",
                    outcomeText: "$0.05 refund pending",
                    outcomeNote: "We're giving this back.",
                    spentMicros: null,
                    refundPendingMicros: 50_000,
                })
            ).toMatchObject({
                outcome: "refund_pending",
                outcomeText: "$0.05 refund pending",
                refundPendingMicros: 50_000,
                spentMicros: null,
            });
            // a refunded task is the refund, whatever else it says
            expect(read({ state: "refunded", outcome: "stopped", outcomeText: "x" })).toMatchObject({
                outcome: "refunded",
                outcomeText: null,
            });
        });

        it("keeps the amounts Orbit returned or still owes as whole micros, and none when it sends none or nonsense", () => {
            expect(read({ returnedMicros: 12_000.4, refundPendingMicros: 50_000 })).toMatchObject({
                returnedMicros: 12_000,
                refundPendingMicros: 50_000,
            });
            const none = read({ returnedMicros: 0, refundPendingMicros: -5 });
            expect(none).not.toHaveProperty("returnedMicros");
            expect(none).not.toHaveProperty("refundPendingMicros");
            expect(read({ returnedMicros: "5", refundPendingMicros: null })).not.toHaveProperty("returnedMicros");
        });

        it("reads what a line that says Given back got back", () => {
            const item = read({
                outcome: "partial",
                actions: [step("worked")],
                lines: [
                    { label: "Computer, 5 minutes", note: "Given back", returnedMicros: 30_000 },
                    { label: "Computer, 2 minutes", note: "Refund pending" },
                ],
            });
            expect(item?.lines).toEqual([
                { label: "Computer, 5 minutes", amountMicros: null, note: "Given back", returnedMicros: 30_000 },
                { label: "Computer, 2 minutes", amountMicros: null, note: "Refund pending", returnedMicros: null },
            ]);
        });

        it("says an amount as Orbit says it: thousandths under a cent, cents above, nothing for less than a tenth of a cent", () => {
            expect(exactDollars(9_000)).toBe("$0.009");
            expect(exactDollars(1_200)).toBe("$0.001");
            expect(exactDollars(50_000)).toBe("$0.05");
            expect(exactDollars(10_000)).toBe("$0.01");
            expect(exactDollars(1_250_000)).toBe("$1.25");
            expect(exactDollars(300)).toBeNull();
            expect(exactDollars(0)).toBeNull();
            expect(exactDollars(Number.NaN)).toBeNull();
        });

        it("keeps the note of an outcome it does not know, and reads it as done; a refunded task carries neither", () => {
            expect(read({ outcome: "later", outcomeNote: "Held up." })).toMatchObject({
                outcome: "done",
                outcomeNote: "Held up.",
            });
            expect(read({ state: "refunded", outcome: "failed", outcomeNote: "x", outcomeText: "y" })).toMatchObject({
                outcome: "refunded",
                outcomeNote: null,
                outcomeText: null,
            });
        });

        it("tells an outcome it does not know from a genuine done task, so its headline can still be shown", () => {
            expect(read({ outcome: "later", outcomeText: "Held up" })).toMatchObject({
                outcome: "done",
                unknownOutcome: true,
                outcomeText: "Held up",
            });
            for (const outcome of [
                "done",
                "partial",
                "failed",
                "unconfirmed",
                "stopped",
                "deciding",
                "refund_pending",
                undefined,
                "",
                7,
            ]) {
                expect(read({ outcome, outcomeText: "x" })?.unknownOutcome).toBe(false);
            }
            // A refunded task is the refund, whatever else it says
            expect(read({ state: "refunded", outcome: "later" })?.unknownOutcome).toBe(false);
        });

        it("keeps an unconfirmed task as unconfirmed once its hold is released and Orbit sends it as refunded: the money line stays the refund's", () => {
            const item = read({
                state: "refunded",
                spentMicros: null,
                outcome: "unconfirmed",
                outcomeText: "Couldn't confirm",
                outcomeNote: "We couldn't confirm whether Exa finished. We released your hold.",
                actions: [step("unknown", { takenText: "Hold released" })],
            });
            expect(item).toMatchObject({
                state: "refunded",
                outcome: "unconfirmed",
                outcomeText: "Couldn't confirm",
                outcomeNote: "We couldn't confirm whether Exa finished. We released your hold.",
            });
            expect(item?.actions).toHaveLength(1);
            expect(item?.actions[0]).toMatchObject({ outcome: "unknown", takenText: "Hold released" });
        });
    });

    it("reads at most fifty tasks", () => {
        const many = Array.from({ length: 80 }, (_, i) => ({
            id: `a${i}`,
            title: `Task ${i}`,
            at: "2026-11-15T11:16:00.000Z",
        }));
        expect(parseUsage(real({ activity: many }))?.activity).toHaveLength(50);
    });
});

describe("dollars", () => {
    it("cuts what is available down to the cent, so it never claims more than the server will admit", () => {
        expect(availableText(3_209_999, "en-US")).toBe("$3.20");
        expect(availableText(2_000_000, "en-US")).toBe("$2");
        expect(availableText(9_999, "en-US")).toBe("$0");
        expect(availableText(-5, "en-US")).toBe("$0");
    });
    it("says what is available under a cent as 'less than', and what was taken exactly as Orbit does", () => {
        const tiny = "Less than $0.01";
        expect(availableLabel(5_000, "en-US", tiny)).toBe(tiny);
        expect(availableLabel(9_999, "en-US", tiny)).toBe(tiny);
        expect(availableLabel(0, "en-US", tiny)).toBe("$0");
        expect(availableLabel(10_000, "en-US", tiny)).toBe("$0.01");
        expect(availableLabel(3_209_999, "en-US", tiny)).toBe("$3.20");
        // What was taken is said EXACTLY as Orbit's dollars() says it (same table in Orbit's and the bots' tests), above a cent too
        const line = "less than $0.001";
        const table: Array<[number, string]> = [
            [0, "$0"],
            [1, "less than $0.001"],
            [499, "less than $0.001"],
            [500, "$0.001"],
            [1200, "$0.001"],
            [1500, "$0.002"],
            [2500, "$0.003"],
            [9000, "$0.009"],
            [9999, "$0.010"],
            [10000, "$0.01"],
            [10001, "$0.01"],
            [15000, "$0.01"],
            [25000, "$0.03"],
            [35000, "$0.04"],
            [45000, "$0.04"],
            [50000, "$0.05"],
            [1250000, "$1.25"],
            [5000000, "$5.00"],
            [3209999, "$3.21"],
        ];
        for (const [micros, said] of table) expect(spentLabel(micros, "en-US", line)).toBe(said);
        expect(spentLabel(Number.NaN, "en-US", line)).toBe("$0");
    });
    it("is used up below a cent, and the bar counts whole cents", () => {
        expect(moneyUsedUp({ availableMicros: 9_999 })).toBe(true);
        expect(moneyUsedUp({ availableMicros: 10_000 })).toBe(false);
        expect(moneyLeft({ availableMicros: 3_200_000, totalMicros: 5_000_000 })).toBeCloseTo(0.64);
        expect(moneyLeft({ availableMicros: 9_000_000, totalMicros: 5_000_000 })).toBe(1);
        expect(moneyLeft({ availableMicros: 5, totalMicros: 0 })).toBe(0);
    });
    it("counts both sides of a small credit in the same whole cents, so the bar agrees with the words", () => {
        const line = (available: number, total: number) =>
            `${availableText(available, "en-US")} of ${availableText(total, "en-US")}`;
        // 1.5 cents of 1.5 cents is a full bar beside "$0.01 of $0.01", not a half-full one
        expect(line(15_000, 15_000)).toBe("$0.01 of $0.01");
        expect(moneyLeft({ availableMicros: 15_000, totalMicros: 15_000 })).toBe(1);
        expect(line(14_999, 15_000)).toBe("$0.01 of $0.01");
        expect(moneyLeft({ availableMicros: 14_999, totalMicros: 15_000 })).toBe(1);
        expect(line(0, 15_000)).toBe("$0 of $0.01");
        expect(moneyLeft({ availableMicros: 0, totalMicros: 15_000 })).toBe(0);
    });
    it("says when a monthly credit renews, in the viewer's own clock", () => {
        const renews = renewsWhen("2026-12-01T03:00:00", "en-US");
        expect(renews).toEqual({ day: "1 Dec", time: "3:00 AM" });
        expect(renewsWhen(null, "en-US")).toBeUndefined();
        expect(renewsWhen("nope", "en-US")).toBeUndefined();
    });
});

describe("when a bar is full again", () => {
    const now = new Date("2026-11-12T12:00:00");
    it("is the time today, and the day with it on any other day", () => {
        expect(fullAgainWhen("2026-11-12T20:40:00", "en-US", now)).toBe("8:40 PM");
        expect(fullAgainWhen("2026-11-13T01:10:00", "en-US", now)).toBe("13 Nov, 1:10 AM");
    });
    it("is empty with no time", () => {
        expect(fullAgainWhen(null, "en-US", now)).toBe("");
        expect(fullAgainWhen("nope", "en-US", now)).toBe("");
    });
});

describe("a size", () => {
    it("is in plain units", () => {
        expect(storageSize(0)).toBe("0 B");
        expect(storageSize(512)).toBe("512 B");
        expect(storageSize(230_000_000)).toBe("230 MB");
        expect(storageSize(1_400_000_000)).toBe("1.4 GB");
        expect(storageSize(2_000_000_000)).toBe("2 GB");
    });
});
