/**
 * The tile closest to `start`, in steps a player can walk (never through a wall), that `isAllowed` accepts, or
 * undefined if there is none. Used to put a player who would arrive in a full room just outside it (#1621).
 *
 * @param size the map, in tiles
 * @param start the tile to start from
 * @param isWalkable whether a player can step on this tile
 * @param isAllowed whether a player may stay on this tile
 */
export function findNearestFreeTile(
    size: { width: number; height: number },
    start: { x: number; y: number },
    isWalkable: (x: number, y: number) => boolean,
    isAllowed: (x: number, y: number) => boolean
): { x: number; y: number } | undefined {
    const isOnMap = (x: number, y: number) => x >= 0 && y >= 0 && x < size.width && y < size.height;
    if (!isOnMap(start.x, start.y)) {
        return undefined;
    }
    const seen = new Set<number>([start.y * size.width + start.x]);
    const queue: { x: number; y: number }[] = [start];
    for (let index = 0; index < queue.length; index++) {
        const tile = queue[index];
        if (isWalkable(tile.x, tile.y) && isAllowed(tile.x, tile.y)) {
            return tile;
        }
        for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
        ]) {
            const x = tile.x + dx;
            const y = tile.y + dy;
            const key = y * size.width + x;
            if (!isOnMap(x, y) || seen.has(key) || !isWalkable(x, y)) {
                continue;
            }
            seen.add(key);
            queue.push({ x, y });
        }
    }
    return undefined;
}
