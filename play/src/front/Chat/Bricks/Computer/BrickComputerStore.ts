import { get, writable } from "svelte/store";
import type { Readable } from "svelte/store";
import { botApiService } from "../../../external-modules/bots/services/BotApiService";
import { parseBrickComputer, parseJobAnswer, holdsComputer, type BrickComputerView } from "./BrickComputer";

/**
 * Each Brick's computer as its owner sees it (game #2000), read from Orbit. Reading never makes or wakes anything. A Brick
 * with nothing read yet has no entry: what shows it then says nothing rather than guess.
 */
const computers = writable<Map<string, BrickComputerView>>(new Map());
export const brickComputers: Readable<Map<string, BrickComputerView>> = { subscribe: computers.subscribe };

/**
 * Answers can come back in a different order than they were asked for: a read that was on its way when the owner tapped Stop
 * can arrive after Stop's answer. Each ask takes a number when it is sent, and an answer older than the one on screen is dropped.
 */
const asked = new Map<string, number>();
const onScreen = new Map<string, number>();
const ticket = (brickId: string): number => {
    const next = (asked.get(brickId) ?? 0) + 1;
    asked.set(brickId, next);
    return next;
};

const put = (brickId: string, view: BrickComputerView, sentAs: number) => {
    if (sentAs < (onScreen.get(brickId) ?? 0)) return;
    onScreen.set(brickId, sentAs);
    computers.update((all) => {
        const next = new Map(all);
        next.set(brickId, view);
        return next;
    });
};

/** Reads one Brick's computer again. Resolves to what Orbit said, or undefined when it could not be read. */
export async function loadBrickComputer(brickId: string): Promise<BrickComputerView | undefined> {
    const sentAs = ticket(brickId);
    try {
        const view = parseBrickComputer(await botApiService.getBrickComputer(brickId));
        if (view) put(brickId, view, sentAs);
        return view;
    } catch (error) {
        console.warn("Could not read a Brick's computer", error);
        return undefined;
    }
}

export type ComputerAction = "give" | "turn-off" | "stop" | "take-over" | "hand-back" | "fill-details";

/**
 * One of the owner's calls. Orbit answers with the computer (give, turn off, stop) or with the job (take over, hand back, the
 * one tap): either way the computer is read again so the page and the bar agree. True when Orbit accepted it.
 */
export async function brickComputerAction(
    brickId: string,
    action: ComputerAction,
    shown?: { what: string; where: string }
): Promise<boolean> {
    const sentAs = ticket(brickId);
    try {
        const answer = shown
            ? await botApiService.brickComputerAction(brickId, action, shown)
            : await botApiService.brickComputerAction(brickId, action);
        const view = parseBrickComputer(answer);
        if (view) put(brickId, view, sentAs);
        else if (parseJobAnswer(answer)) await loadBrickComputer(brickId);
        else return false;
        return true;
    } catch (error) {
        console.warn(`Could not ${action} a Brick's computer`, error);
        // A refusal (nothing waits for the person any more) means the page was old: read it again
        await loadBrickComputer(brickId);
        return false;
    }
}

/** "Dismiss" on the notice of how a job ended: Orbit forgets that ending, so neither the page nor the chat says it again. True when it did. */
export async function dismissComputerNotice(brickId: string, jobId: string): Promise<boolean> {
    const sentAs = ticket(brickId);
    try {
        const view = parseBrickComputer(await botApiService.dismissBrickComputerNotice(brickId, jobId));
        if (!view) return false;
        put(brickId, view, sentAs);
        return true;
    } catch (error) {
        console.warn("Could not dismiss a Brick's computer notice", error);
        await loadBrickComputer(brickId);
        return false;
    }
}

const POLL_MS = 4000;

/** One loop per Brick, however many pieces on screen show it: the bar, the page card and the screen share it. */
const loops = new Map<string, { holders: number; stop: () => void }>();

function startLoop(brickId: string): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A read that failed says nothing about the computer: the pace stays what the last read that went through set it to
    let busy = false;
    const tick = async () => {
        const view = await loadBrickComputer(brickId);
        if (stopped) return;
        if (view) busy = holdsComputer(view.job) || view.queued.length > 0;
        timer = setTimeout(() => void tick(), busy ? POLL_MS : POLL_MS * 5);
    };
    void tick();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

/**
 * Keeps one Brick's computer up to date while something shows it: read at once, then every few seconds while a job runs, waits or
 * is in line, and slowly otherwise. Reading is all it does. Pieces that show the same Brick share one loop, so the same read never
 * goes out twice: the first to follow starts it, one that joins later reads once now so it starts fresh, and the last to let go
 * stops it. Returns the function that lets go (letting go twice is harmless).
 */
export function followBrickComputer(brickId: string): () => void {
    const existing = loops.get(brickId);
    const loop = existing ?? { holders: 0, stop: startLoop(brickId) };
    if (!existing) loops.set(brickId, loop);
    else void loadBrickComputer(brickId);
    loop.holders += 1;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        loop.holders -= 1;
        if (loop.holders > 0) return;
        loop.stop();
        if (loops.get(brickId) === loop) loops.delete(brickId);
    };
}

export const brickComputerOf = (brickId: string): BrickComputerView | undefined => get(computers).get(brickId);
