import { tick } from "svelte";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const game = vi.hoisted(() => ({
    getBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
    brickComputerAction:
        vi.fn<(brickId: string, action: string, shown?: { what: string; where: string }) => Promise<unknown>>(),
    watchBrickComputer: vi.fn<(brickId: string) => Promise<unknown>>(),
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
        expect(byId("brickScreenReady")?.textContent).toContain("your name and phone");
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
