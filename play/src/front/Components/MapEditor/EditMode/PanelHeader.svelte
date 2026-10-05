<script lang="ts">
    // The title line of a panel: an optional back circle, the title, one line under it, and room for a trailing control.
    import { IconChevronLeft } from "@wa-icons";

    export let title: string;
    export let subtitle: string | undefined = undefined;
    export let onBack: (() => void) | undefined = undefined;
    export let backLabel = "Back";
</script>

<div class="em-head">
    {#if onBack}
        <button type="button" class="em-back" aria-label={backLabel} data-testid="edit-panel-back" on:click={onBack}>
            <IconChevronLeft font-size="18" />
        </button>
    {/if}
    <div class="em-head-text">
        <div class="em-title"><slot name="title">{title}</slot></div>
        {#if subtitle || $$slots.subtitle}
            <div class="em-sub"><slot name="subtitle">{subtitle}</slot></div>
        {/if}
    </div>
    <slot name="trailing" />
</div>

<style>
    .em-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        min-height: 40px;
    }
    .em-head-text {
        flex: 1;
        min-width: 0;
    }
    .em-title {
        font-size: 18px;
        font-weight: 650;
        letter-spacing: -0.01em;
        line-height: 1.2;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .em-sub {
        margin-top: 1px;
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .em-back {
        display: grid;
        place-items: center;
        flex: none;
        width: 34px;
        height: 34px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        cursor: pointer;
    }
    @media (hover: hover) {
        .em-back:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
