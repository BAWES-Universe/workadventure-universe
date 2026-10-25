/**
 * How the strip makes room (#1019). Words drop only when they do not fit, in this order:
 *  1. "· 21 bots" goes from "6 people · 21 bots", before the room name is cut (#1389);
 *  2. the room name shortens, down to a short stub (CSS does it: ellipsis, minimum width);
 *  3. "Invite someone to join" and "Full screen" become icons only;
 *  4. the faces beside "6 people" go.
 * Level 0 shows everything with the room name whole; each level keeps what the one before it dropped.
 */
export type FitLevel = 0 | 1 | 2 | 3;

export const LAST_FIT_LEVEL: FitLevel = 3;

/** The smallest level that fits. `fitsAt` lays the strip out at a level and says whether nothing overflows. */
export async function pickFitLevel(fitsAt: (level: FitLevel) => Promise<boolean>): Promise<FitLevel> {
    if (await fitsAt(0)) return 0;
    if (await fitsAt(1)) return 1;
    if (await fitsAt(2)) return 2;
    await fitsAt(LAST_FIT_LEVEL);
    return LAST_FIT_LEVEL;
}

/** "02:14": the time in a conversation, as minutes and seconds (minutes keep counting past 59). */
export function formatConversationTime(totalSeconds: number): string {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
