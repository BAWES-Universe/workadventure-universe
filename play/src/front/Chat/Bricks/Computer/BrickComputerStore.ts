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

const put = (brickId: string, view: BrickComputerView) =>
    computers.update((all) => {
        const next = new Map(all);
        next.set(brickId, view);
        return next;
    });

/** Reads one Brick's computer again. Resolves to what Orbit said, or undefined when it could not be read. */
export async function loadBrickComputer(brickId: string): Promise<BrickComputerView | undefined> {
    try {
        const view = parseBrickComputer(await botApiService.getBrickComputer(brickId));
        if (view) put(brickId, view);
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
    try {
        const answer = shown
            ? await botApiService.brickComputerAction(brickId, action, shown)
            : await botApiService.brickComputerAction(brickId, action);
        const view = parseBrickComputer(answer);
        if (view) put(brickId, view);
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
    try {
        const view = parseBrickComputer(await botApiService.dismissBrickComputerNotice(brickId, jobId));
        if (!view) return false;
        put(brickId, view);
        return true;
    } catch (error) {
        console.warn("Could not dismiss a Brick's computer notice", error);
        await loadBrickComputer(brickId);
        return false;
    }
}

const POLL_MS = 4000;

/**
 * Keeps one Brick's computer up to date while something shows it: read at once, then every few seconds while a job runs, waits or
 * is in line, and slowly otherwise. Reading is all it does. Returns the function that stops it.
 */
export function followBrickComputer(brickId: string): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
        const view = await loadBrickComputer(brickId);
        if (stopped) return;
        const busy = !!view && (holdsComputer(view.job) || view.queued.length > 0);
        timer = setTimeout(() => void tick(), busy ? POLL_MS : POLL_MS * 5);
    };
    void tick();
    return () => {
        stopped = true;
        if (timer) clearTimeout(timer);
    };
}

export const brickComputerOf = (brickId: string): BrickComputerView | undefined => get(computers).get(brickId);
