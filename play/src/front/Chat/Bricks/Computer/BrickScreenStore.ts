import { writable } from "svelte/store";
import type { Readable } from "svelte/store";
import type { BrickCard } from "../Brick";

/** The Brick whose computer screen is open (Watch, game #2000), over the chat panel. Undefined: none. */
const screen = writable<BrickCard | undefined>(undefined);
export const brickScreenStore: Readable<BrickCard | undefined> = { subscribe: screen.subscribe };

export function openBrickScreen(brick: BrickCard): void {
    screen.set(brick);
}

export function closeBrickScreen(): void {
    screen.set(undefined);
}
