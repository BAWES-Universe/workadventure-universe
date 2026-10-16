import type { Emitter } from "./NativeSoundscape";

/** Explicit opt-in map metadata; absence leaves the legacy audio path untouched. */
export function parseNativeSoundscape(value: unknown, mapUrl: string): Emitter | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") throw new Error("nativeSoundscape must be a JSON string");
    const data: unknown = JSON.parse(value);
    if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error("Invalid nativeSoundscape descriptor");
    const record = data as Record<string, unknown>;
    const keys = ["url", "volume", "x", "y", "innerRadius", "outerRadius"];
    if (Object.keys(record).some((key) => !keys.includes(key))) throw new Error("Unknown nativeSoundscape field");
    if (typeof record.url !== "string" || !record.url) throw new Error("Water URL required");
    for (const key of keys.slice(1))
        if (typeof record[key] !== "number" || !Number.isFinite(record[key])) throw new Error(`Invalid ${key}`);
    const { volume, x, y, innerRadius, outerRadius } = record as {
        volume: number;
        x: number;
        y: number;
        innerRadius: number;
        outerRadius: number;
    };
    const url = new URL(record.url, mapUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error("Invalid water URL");
    if (volume < 0 || volume > 1 || innerRadius < 0 || outerRadius <= innerRadius)
        throw new Error("Invalid soundscape bounds");
    return { url: url.toString(), volume, loop: true, x, y, innerRadius, outerRadius };
}
