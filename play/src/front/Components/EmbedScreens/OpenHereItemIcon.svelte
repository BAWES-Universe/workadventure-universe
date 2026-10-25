<script lang="ts">
    import { IconWorld } from "@wa-icons";

    /** A file's badge (PDF in red, other kinds in grey), as the chat's file card draws it. */
    export let badge: { label: string; color: string } | undefined = undefined;
    /** A site's favicon. */
    export let src: string | undefined = undefined;
    /** What shows through a transparent icon. */
    export let background = "#fff";
    /** 32 in a row, smaller in a tab. */
    export let size = 32;

    let failed = false;
    $: if (src) failed = false;
</script>

{#if badge}
    <span
        class="icon badge"
        style:background={badge.color}
        style:width="{size}px"
        style:height="{size}px"
        style:border-radius="{size / 4}px"
        style:font-size="{size < 32 ? 8 : 9}px"
        aria-hidden="true">{badge.label}</span
    >
{:else if src && !failed}
    <img
        class="icon"
        style:background
        style:width="{size}px"
        style:height="{size}px"
        style:border-radius="{size / 4}px"
        {src}
        alt=""
        draggable="false"
        on:error={() => (failed = true)}
    />
{:else}
    <span
        class="icon globe"
        style:width="{size}px"
        style:height="{size}px"
        style:border-radius="{size / 4}px"
        aria-hidden="true"><IconWorld font-size={Math.round(size * 0.62)} /></span
    >
{/if}

<style>
    .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        flex: none;
    }

    .badge {
        color: #fff;
        font-weight: 700;
        letter-spacing: 0.04em;
    }

    /* A site icon that is not square shows whole, not cut off. */
    img.icon {
        object-fit: contain;
    }

    .globe {
        color: rgba(255, 255, 255, 0.85);
        background: rgba(255, 255, 255, 0.1);
    }
</style>
