// Plain named counters, shared by everything in one worker process. Tests and the stats endpoint read them.
export class Counters {
    private readonly values = new Map<string, number>();

    inc(name: string, by = 1): void {
        this.values.set(name, (this.values.get(name) ?? 0) + by);
    }

    max(name: string, value: number): void {
        if (value > (this.values.get(name) ?? 0)) this.values.set(name, value);
    }

    get(name: string): number {
        return this.values.get(name) ?? 0;
    }

    snapshot(): Record<string, number> {
        return Object.fromEntries(this.values);
    }
}
