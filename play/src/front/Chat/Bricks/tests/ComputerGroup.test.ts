import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction:
        vi.fn<(brickId: string, action: string, shown?: { what: string; where: string }) => Promise<unknown>>(),
    watchBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    dismissBrickComputerNotice: vi.fn<(brickId: string, jobId: string) => Promise<unknown>>(),
    warn: vi.fn<(message: string) => void>(),
}));
// The tests run Svelte's server build, where onMount does nothing; the pieces read the computer on mount.
// eslint-disable-next-line svelte/no-svelte-internal
vi.mock("svelte", async () => await import("svelte/internal"));
vi.mock("../../../external-modules/bots/services/BotApiService", () => ({ botApiService: game }));
vi.mock("../../../Stores/ErrorStore", () => ({ warningMessageStore: { addWarningMessage: game.warn } }));

import { loadLocale } from "../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../i18n/i18n-svelte";
import ComputerGroup from "../Computer/ComputerGroup.svelte";
import BrickComputerBar from "../Computer/BrickComputerBar.svelte";
import BrickScreen from "../Computer/BrickScreen.svelte";
import { closeBrickScreen } from "../Computer/BrickScreenStore";
import { loadBrickComputer } from "../Computer/BrickComputerStore";

const BRICK = "0b7c1d2e-1111-4222-8333-944455556666";
const brick = {
    id: BRICK,
    name: "Recipe Brick",
    description: "Keeps the family recipes",
    characterTextureId: "brick-orange",
    enabled: true,
    isDefault: false,
    createdAt: "2026-11-11T10:00:00.000Z",
    hello: null,
};
const computer = (over: Record<string, unknown> = {}) => ({
    computer: {
        available: true,
        on: true,
        machine: "resting",
        job: null,
        queued: [],
        month: { leftFraction: 0.8, unlimited: false, endsAt: "2026-12-01T00:00:00.000Z" },
        files: { bytes: 0, savedAt: null },
        ...over,
    },
});
const job = (over: Record<string, unknown> = {}) => ({
    id: "j1",
    title: "Book the table",
    status: "running",
    stepDone: 2,
    stepTotal: 5,
    stepLabel: "Opening the site",
    control: "brick",
    ...over,
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

describe("a Brick's computer on screen (#2000)", () => {
    let target: HTMLElement;
    let piece: { $destroy: () => void } | undefined;

    beforeAll(() => {
        loadLocale("en-US");
        setLocale("en-US");
    });
    beforeEach(() => {
        vi.clearAllMocks();
        closeBrickScreen();
        target = document.createElement("div");
        document.body.appendChild(target);
    });
    afterEach(() => {
        piece?.$destroy();
        piece = undefined;
        target.remove();
    });

    const text = () => target.textContent?.replace(/\s+/g, " ").trim() ?? "";
    const byId = (id: string) => target.querySelector<HTMLElement>(`[data-testid="${id}"]`);

    async function showGroup(read: unknown) {
        game.getBrickComputer.mockResolvedValue(read);
        await loadBrickComputer(BRICK);
        const made = new ComputerGroup({ target, props: { brick, open: true, onToggle: () => undefined } });
        piece = made;
        await settle();
    }

    it("offers a computer that is off with what it is for and one button, and no switch", async () => {
        await showGroup(computer({ on: false, machine: "none" }));
        expect(text()).toContain("Computer");
        expect(text()).toContain("Give Recipe Brick a computer");
        expect(target.querySelector('input[type="checkbox"]')).toBeNull();
        game.brickComputerAction.mockResolvedValue(computer());
        byId("brickComputerGive")?.click();
        await settle();
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "give");
    });

    it("says a server with no computers has none yet", async () => {
        await showGroup(computer({ available: false, on: false }));
        expect(byId("brickComputerNotOpen")).not.toBeNull();
        expect(byId("brickComputerGive")).toBeNull();
    });

    it("shows what a working computer is doing, with Stop and Watch, and the month in words", async () => {
        await showGroup(computer({ machine: "working", job: job() }));
        expect(text()).toContain("Book the table");
        expect(text()).toContain("step 2 of 5");
        expect(byId("brickComputerStop")).not.toBeNull();
        expect(byId("brickComputerWatch")?.textContent).toContain("Watch");
        expect(byId("brickComputerMonth")?.textContent).toMatch(/plenty|left/i);
        expect(text()).not.toMatch(/\$|credits|\d+ ?%/);
        game.brickComputerAction.mockResolvedValue(computer());
        byId("brickComputerStop")?.click();
        await settle();
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "stop");
    });

    it("warns when Orbit refuses", async () => {
        await showGroup(computer({ machine: "working", job: job() }));
        game.brickComputerAction.mockRejectedValue(new Error("nope"));
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job() }));
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        byId("brickComputerStop")?.click();
        await settle();
        expect(game.warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it("has a bar only while the computer has something to do, and Take over when it waits for the person", async () => {
        game.getBrickComputer.mockResolvedValue(computer());
        await loadBrickComputer(BRICK);
        const first = new BrickComputerBar({ target, props: { brick } });
        await settle();
        expect(byId("brickComputerBar")).toBeNull();
        first.$destroy();
        game.getBrickComputer.mockResolvedValue(
            computer({ machine: "working", job: job({ status: "waiting", waitingFor: "details" }) })
        );
        await loadBrickComputer(BRICK);
        const second = new BrickComputerBar({ target, props: { brick } });
        await settle();
        expect(byId("brickComputerBar")).not.toBeNull();
        expect(byId("brickComputerBarStop")).not.toBeNull();
        expect(text()).toContain("Take over");
        second.$destroy();
    });

    it("tells the person, on the page and in the chat, that a handover ended because nobody answered, and Dismiss clears both", async () => {
        const ended = computer({ notice: { jobId: "j9", how: "unanswered" } });
        await showGroup(ended);
        const bar = new BrickComputerBar({ target: document.body, props: { brick } });
        await settle();
        const inChat = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        expect(byId("brickComputerNotice")?.textContent).toContain("Recipe Brick's computer stopped waiting for you.");
        expect(byId("brickComputerNotice")?.textContent).toContain("Its files are kept.");
        expect(inChat("brickComputerBarNotice")?.textContent).toContain("stopped waiting for you");
        game.dismissBrickComputerNotice.mockResolvedValue(computer({ notice: null }));
        byId("brickComputerNoticeDismiss")?.click();
        await settle();
        expect(game.dismissBrickComputerNotice).toHaveBeenCalledWith(BRICK, "j9");
        // One dismiss: Orbit forgot that ending, so both lines go
        expect(byId("brickComputerNotice")).toBeNull();
        expect(inChat("brickComputerBarNotice")).toBeNull();
        bar.$destroy();
    });

    it("says in words that this month's computer time ran out, with no number, and never while a job runs", async () => {
        await showGroup(computer({ notice: { jobId: "j9", how: "month" } }));
        expect(byId("brickComputerNotice")?.textContent).toContain("This month's computer time ran out");
        expect(text()).not.toMatch(/\d+ ?(min|hour|%)|\$/);
        piece?.$destroy();
        // A job that runs has the card's own words, not the ending of an older one
        await showGroup(computer({ machine: "working", job: job(), notice: { jobId: "j9", how: "month" } }));
        expect(byId("brickComputerNotice")).toBeNull();
    });

    it("has the notice in the chat only when nothing is happening, and a dismiss that fails says so", async () => {
        game.getBrickComputer.mockResolvedValue(computer({ notice: { jobId: "j9", how: "unanswered" } }));
        await loadBrickComputer(BRICK);
        piece = new BrickComputerBar({ target, props: { brick } });
        await settle();
        expect(byId("brickComputerBarNotice")?.textContent).toContain("stopped waiting for you");
        expect(byId("brickComputerBar")).toBeNull();
        game.dismissBrickComputerNotice.mockResolvedValue({ nothing: true });
        byId("brickComputerBarNoticeDismiss")?.click();
        await settle();
        // Orbit did not accept it: the notice stays, and is read again rather than guessed
        expect(byId("brickComputerBarNotice")).not.toBeNull();
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job() }));
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickComputerBarNotice")).toBeNull();
        expect(byId("brickComputerBar")).not.toBeNull();
    });

    it("shows the screen only for a working computer, and the one tap names exactly what goes in", async () => {
        game.watchBrickComputer.mockResolvedValue({ url: "https://screen.test/abc" });
        game.getBrickComputer.mockResolvedValue(
            computer({
                machine: "working",
                job: job({
                    status: "waiting",
                    waitingFor: "details",
                    control: "person",
                    ready: { what: "your name and phone", where: "the booking form" },
                }),
            })
        );
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/abc");
        expect(byId("brickScreenReady")?.textContent).toContain(
            "Your name and phone. One tap sends them to the booking form."
        );
        game.brickComputerAction.mockResolvedValue({ job: job({ control: "person" }) });
        byId("brickScreenFill")?.click();
        await settle();
        // What the screen showed goes with the tap, so Orbit refuses it if Brick named something else since
        expect(game.brickComputerAction).toHaveBeenCalledWith(BRICK, "fill-details", {
            what: "your name and phone",
            where: "the booking form",
        });
    });

    it("lets go of the screen link when the computer rests, and asks for a fresh one when it works again", async () => {
        game.watchBrickComputer.mockResolvedValueOnce({ url: "https://screen.test/old" });
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job() }));
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/old");
        game.getBrickComputer.mockResolvedValue(computer());
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickScreenFrame")).toBeNull();
        game.watchBrickComputer.mockResolvedValueOnce({ url: "https://screen.test/new" });
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job({ id: "j2" }) }));
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/new");
    });

    it("drops a screen link that arrives after the job ended, and asks again when the next job works", async () => {
        let late: (answer: unknown) => void = () => undefined;
        game.watchBrickComputer.mockReturnValueOnce(
            new Promise((resolve) => {
                late = resolve;
            })
        );
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job() }));
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        // The job ends while the link is still on its way
        game.getBrickComputer.mockResolvedValue(computer());
        await loadBrickComputer(BRICK);
        await settle();
        late({ url: "https://screen.test/late" });
        await settle();
        expect(byId("brickScreenFrame")).toBeNull();
        // The next job gets its own link, never the late one
        game.watchBrickComputer.mockResolvedValueOnce({ url: "https://screen.test/next" });
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job({ id: "j2" }) }));
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/next");
    });

    it("asks for a new tap when the next page needs details, one tap a page", async () => {
        game.watchBrickComputer.mockResolvedValue({ url: "https://screen.test/abc" });
        const waiting = (ready: { what: string; where: string } | null) =>
            computer({
                machine: "working",
                job: job({ status: "waiting", waitingFor: "details", control: "person", ...(ready ? { ready } : {}) }),
            });
        game.getBrickComputer.mockResolvedValue(waiting({ what: "your name", where: "the first page" }));
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        game.brickComputerAction.mockResolvedValue({ job: job({ control: "person" }) });
        byId("brickScreenFill")?.click();
        await settle();
        expect(byId("brickScreenReady")).toBeNull();
        // Brick names what the next page needs while the person is still in control
        game.getBrickComputer.mockResolvedValue(waiting({ what: "your passport number", where: "the second page" }));
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickScreenReady")?.textContent).toContain("Your passport number");
        expect(byId("brickScreenFill")).not.toBeNull();
    });

    it("asks for a tap again when another job names the same details, even if no read saw the gap", async () => {
        game.watchBrickComputer.mockResolvedValue({ url: "https://screen.test/abc" });
        const waiting = (id: string) =>
            computer({
                machine: "working",
                job: job({
                    id,
                    status: "waiting",
                    waitingFor: "details",
                    control: "person",
                    ready: { what: "your name", where: "the first page" },
                }),
            });
        game.getBrickComputer.mockResolvedValue(waiting("j1"));
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        game.brickComputerAction.mockResolvedValue({ job: job({ control: "person" }) });
        byId("brickScreenFill")?.click();
        await settle();
        expect(byId("brickScreenReady")).toBeNull();
        // The next job asks for the very same thing, and the read goes straight from one job to the other
        game.getBrickComputer.mockResolvedValue(waiting("j2"));
        await loadBrickComputer(BRICK);
        await settle();
        expect(byId("brickScreenReady")).not.toBeNull();
        expect(byId("brickScreenFill")).not.toBeNull();
    });

    it("keeps the tap for the job it was made for when the answer comes after a read moved on to another job", async () => {
        game.watchBrickComputer.mockResolvedValue({ url: "https://screen.test/abc" });
        const waiting = (id: string) =>
            computer({
                machine: "working",
                job: job({
                    id,
                    status: "waiting",
                    waitingFor: "details",
                    control: "person",
                    ready: { what: "your name", where: "the first page" },
                }),
            });
        game.getBrickComputer.mockResolvedValue(waiting("j1"));
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        let answer: (value: unknown) => void = () => undefined;
        game.brickComputerAction.mockReturnValue(
            new Promise((resolve) => {
                answer = resolve;
            })
        );
        byId("brickScreenFill")?.click();
        await settle();
        // Before the answer, a read goes straight to the next job, which names the same details
        game.getBrickComputer.mockResolvedValue(waiting("j2"));
        await loadBrickComputer(BRICK);
        await settle();
        answer({ job: job({ id: "j1", control: "person" }) });
        await settle();
        // The tap was for j1: j2 still has its details and its button
        expect(byId("brickScreenReady")).not.toBeNull();
        expect(byId("brickScreenFill")).not.toBeNull();
    });

    it("reads the computer again only when the Brick changes, not when the page hands over a new object for the same one", async () => {
        const OTHER = "9f8e7d6c-1111-4222-8333-000011112222";
        game.getBrickComputer.mockResolvedValue(computer());
        await showGroup(computer());
        const set = (props: object) => (piece as unknown as { $set: (props: object) => void }).$set(props);
        game.getBrickComputer.mockClear();
        // Typing in the name or the line replaces the Brick object, with the same id, over and over
        for (let i = 0; i < 10; i++) {
            set({ brick: { ...brick, name: `Recipe Brick ${i}` } });
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect(game.getBrickComputer).not.toHaveBeenCalled();
        // Another Brick is read, and the first one is let go
        set({ brick: { ...brick, id: OTHER, name: "Other" } });
        await settle();
        expect(game.getBrickComputer).toHaveBeenCalledTimes(1);
        expect(game.getBrickComputer).toHaveBeenCalledWith(OTHER);
    });

    it("reads the Brick of a chat bar again only when the Brick changes", async () => {
        const OTHER = "9f8e7d6c-1111-4222-8333-000011112222";
        game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job() }));
        await loadBrickComputer(BRICK);
        piece = new BrickComputerBar({ target, props: { brick } });
        await settle();
        game.getBrickComputer.mockClear();
        const set = (props: object) => (piece as unknown as { $set: (props: object) => void }).$set(props);
        for (let i = 0; i < 10; i++) {
            set({ brick: { ...brick, name: `Recipe Brick ${i}` } });
            // eslint-disable-next-line no-await-in-loop
            await settle();
        }
        expect(game.getBrickComputer).not.toHaveBeenCalled();
        set({ brick: { ...brick, id: OTHER, name: "Other" } });
        await settle();
        expect(game.getBrickComputer).toHaveBeenCalledWith(OTHER);
    });

    it("follows the Brick that is shown when the page switches to another one, and stops reading the first", async () => {
        const OTHER = "9f8e7d6c-1111-4222-8333-000011112222";
        game.getBrickComputer.mockResolvedValue(computer());
        await showGroup(computer());
        expect(game.getBrickComputer).toHaveBeenCalledWith(BRICK);
        game.getBrickComputer.mockClear();
        (piece as unknown as { $set: (props: object) => void }).$set({ brick: { ...brick, id: OTHER, name: "Other" } });
        await settle();
        expect(game.getBrickComputer).toHaveBeenCalledWith(OTHER);
    });

    describe("when asking for the screen does not go through", () => {
        afterEach(() => {
            vi.useRealTimers();
        });

        const working = () => computer({ machine: "working", job: job() });
        const advance = async (ms: number) => {
            await vi.advanceTimersByTimeAsync(ms);
            await tick();
        };

        it("asks again soon, and shows the screen once it goes through", async () => {
            vi.useFakeTimers();
            game.watchBrickComputer
                .mockResolvedValueOnce("failed")
                .mockResolvedValueOnce("failed")
                .mockResolvedValueOnce({ url: "https://screen.test/third" });
            game.getBrickComputer.mockResolvedValue(working());
            await loadBrickComputer(BRICK);
            piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
            await advance(0);
            expect(byId("brickScreenFrame")).toBeNull();
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(1);
            await advance(2000);
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(2);
            expect(byId("brickScreenFrame")).toBeNull();
            await advance(4000);
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(3);
            expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/third");
        });

        it("has one request on its way at a time, however often the computer is read meanwhile", async () => {
            vi.useFakeTimers();
            game.watchBrickComputer.mockReturnValue(
                new Promise(() => {
                    // never answers
                })
            );
            game.getBrickComputer.mockResolvedValue(working());
            await loadBrickComputer(BRICK);
            piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
            await advance(0);
            for (let i = 0; i < 6; i++) {
                // eslint-disable-next-line no-await-in-loop
                await loadBrickComputer(BRICK);
            }
            await advance(1000);
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(1);
        });

        it("stops asking a computer that keeps having no screen, after a minute or so of reads", async () => {
            vi.useFakeTimers();
            game.watchBrickComputer.mockResolvedValue(undefined);
            game.getBrickComputer.mockResolvedValue(working());
            await loadBrickComputer(BRICK);
            piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
            await advance(0);
            for (let i = 0; i < 40; i++) {
                // eslint-disable-next-line no-await-in-loop
                await loadBrickComputer(BRICK);
                // eslint-disable-next-line no-await-in-loop
                await advance(0);
            }
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(15);
            // A new job asks afresh
            game.getBrickComputer.mockResolvedValue(computer());
            await loadBrickComputer(BRICK);
            await advance(0);
            game.watchBrickComputer.mockResolvedValue({ url: "https://screen.test/next" });
            game.getBrickComputer.mockResolvedValue(computer({ machine: "working", job: job({ id: "j2" }) }));
            await loadBrickComputer(BRICK);
            await advance(0);
            expect(byId("brickScreenFrame")?.getAttribute("src")).toBe("https://screen.test/next");
        });

        it("has one request on its way after one that found no screen, however often the computer is read", async () => {
            vi.useFakeTimers();
            game.watchBrickComputer
                .mockResolvedValueOnce(undefined)
                .mockReturnValue(
                    new Promise(() => {
                        // the next one never answers
                    })
                );
            game.getBrickComputer.mockResolvedValue(working());
            await loadBrickComputer(BRICK);
            piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
            await advance(0);
            for (let i = 0; i < 6; i++) {
                // eslint-disable-next-line no-await-in-loop
                await loadBrickComputer(BRICK);
                // eslint-disable-next-line no-await-in-loop
                await advance(0);
            }
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(2);
        });

        it("stops asking after a few tries, however often the computer is read", async () => {
            vi.useFakeTimers();
            game.watchBrickComputer.mockResolvedValue("failed");
            game.getBrickComputer.mockResolvedValue(working());
            await loadBrickComputer(BRICK);
            piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
            await advance(60_000);
            // The first ask and four more, not one per read of the computer
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(5);
            await loadBrickComputer(BRICK);
            await loadBrickComputer(BRICK);
            await advance(1000);
            expect(game.watchBrickComputer).toHaveBeenCalledTimes(5);
            expect(byId("brickScreenNone")).not.toBeNull();
        });
    });

    it("shows no screen for a computer that is resting, and does not ask for one to be woken", async () => {
        game.watchBrickComputer.mockResolvedValue(undefined);
        game.getBrickComputer.mockResolvedValue(computer());
        await loadBrickComputer(BRICK);
        piece = new BrickScreen({ target, props: { brick, onClose: () => undefined } });
        await settle();
        expect(byId("brickScreenFrame")).toBeNull();
        expect(byId("brickScreenNone")).not.toBeNull();
        expect(game.brickComputerAction).not.toHaveBeenCalled();
    });
});
