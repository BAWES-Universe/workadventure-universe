<script lang="ts">
    /**
     * A row of thin bars, one per level (0 to 1), green when quiet, yellow when loud, red when peaking: the same
     * meter as the mic buttons. Used live (the recorder, the "You" chip) and still (a voice note's shape).
     */
    export let levels: number[] = [];
    export let height = 36;
    export let gap = 3;
    export let barWidth = 3;
    export let classList = "";

    function colour(level: number): string {
        if (level < 0.45) return "#34d399";
        if (level < 0.75) return "#fbbf24";
        return "#f87171";
    }
</script>

<div class="flex items-center justify-center {classList}" style="height: {height}px; gap: {gap}px" aria-hidden="true">
    {#each levels as level, index (index)}
        <span
            class="rounded-full flex-none"
            style="width: {barWidth}px; height: {Math.max(3, Math.round(level * height))}px; background: {colour(
                level
            )}"
        />
    {/each}
</div>
