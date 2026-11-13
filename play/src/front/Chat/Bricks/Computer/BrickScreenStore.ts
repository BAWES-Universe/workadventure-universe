import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
/** What a computer needs to know of its Brick: which one, and what it is called. A Brick card is one. */
export interface BrickRef {
    id: string;
    name: string;
}

/** The Brick whose computer screen is open (Watch, game #2000), over the chat panel. Undefined: none. */
const screen = writable<BrickRef | undefined>(undefined);
export const brickScreenStore: Readable<BrickRef | undefined> = { subscribe: screen.subscribe };

export function openBrickScreen(brick: BrickRef): void {
    screen.set(brick);
}

export function closeBrickScreen(): void {
    screen.set(undefined);
}
