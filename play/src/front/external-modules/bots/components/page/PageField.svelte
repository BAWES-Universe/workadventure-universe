<script lang="ts">
    // One setting: its name and a line saying what it does, with its choices underneath.
    export let title: string;
    export let hint: string | undefined = undefined;
</script>

<div class="bp-fld">
    <div>
        <div class="bp-t">{title}</div>
        {#if hint}<div class="bp-m">{hint}</div>{/if}
    </div>
    <slot />
</div>

<style>
    .bp-fld {
        display: flex;
        flex-direction: column;
        gap: 7px;
    }
    .bp-t {
        font-size: 13px;
        font-weight: 600;
    }
    .bp-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
</style>
