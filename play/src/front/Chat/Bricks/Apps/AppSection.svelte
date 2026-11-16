<script lang="ts">
    /** A small heading over a run of rows, the way the Bricks page names its sections */
    export let title: string;
    export let testId: string | undefined = undefined;
</script>

<div class="as" data-testid={testId}>{title}</div>

<style>
    .as {
        display: flex;
        align-items: center;
        min-height: 36px;
        margin-top: 6px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.5);
    }
</style>
