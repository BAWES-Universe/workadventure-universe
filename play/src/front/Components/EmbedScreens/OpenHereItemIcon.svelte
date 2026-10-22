<script lang="ts">
    import { IconWorld } from "@wa-icons";

    /** A file's badge (PDF in red, other kinds in grey), as the chat's file card draws it. */
    export let badge: { label: string; color: string } | undefined = undefined;
    /** A site's favicon. */
    export let src: string | undefined = undefined;
    /** What shows through a transparent icon. */
    export let background = "#fff";

    let failed = false;
    $: if (src) failed = false;
</script>

{#if badge}
    <span class="icon badge" style:background={badge.color} aria-hidden="true">{badge.label}</span>
{:else if src && !failed}
    <img class="icon" style:background {src} alt="" draggable="false" on:error={() => (failed = true)} />
{:else}
    <span class="icon globe" aria-hidden="true"><IconWorld font-size="20" /></span>
{/if}

<style>
    .icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        box-sizing: border-box;
        width: 32px;
        height: 32px;
        border-radius: 8px;
        flex: none;
    }

    .badge {
        color: #fff;
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.04em;
    }

    img.icon {
        object-fit: cover;
    }

    .globe {
        color: rgba(255, 255, 255, 0.85);
        background: rgba(255, 255, 255, 0.1);
    }
</style>
