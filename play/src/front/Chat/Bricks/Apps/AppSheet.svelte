<script lang="ts">
    import { onMount } from "svelte";

    /**
     * A sheet for a choice about an app (Lend, Add a manager): it rises from the bottom on a phone and sits in the middle on
     * a desktop, in the bot module's dialog style, the same as the confirmations. Escape, Cancel and a tap on the dimmed page
     * close it. The buttons go in the `buttons` slot, the choices in the default slot.
     */
    export let title: string;
    export let sub = "";
    export let onClose: () => void;
    export let testId = "app-sheet";

    let sheet: HTMLDivElement | undefined;

    // Keyboard focus moves into the sheet and comes back to its opener on close
    onMount(() => {
        const opener = document.activeElement as HTMLElement | null;
        sheet?.focus();
        return () => opener?.focus?.();
    });

    function portal(node: HTMLElement) {
        document.body.appendChild(node);
        return {
            destroy() {
                if (node.parentNode) node.parentNode.removeChild(node);
            },
        };
    }

    // Caught before the page's own Escape handler, so Escape closes this sheet and not the page behind it. Tab and Shift+Tab
    // go round inside the sheet, never to the page behind the dimmed layer.
    function onKeydown(event: KeyboardEvent) {
        if (event.key === "Tab" && sheet) {
            const stops = Array.from(
                sheet.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), [tabindex='0']")
            );
            const first = stops[0];
            const last = stops[stops.length - 1];
            if (!first || !last) {
                event.preventDefault();
                return;
            }
            const active = document.activeElement;
            if (!sheet.contains(active) || (active === sheet && event.shiftKey)) {
                event.preventDefault();
                (event.shiftKey ? last : first).focus();
            } else if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
            return;
        }
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onClose();
    }
</script>

<svelte:window on:keydown|capture={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div role="presentation" class="sh-scrim pointer-events-auto" use:portal on:click={onClose}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        bind:this={sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabindex="-1"
        class="sh-sheet u-surface text-white"
        data-testid={testId}
        on:click|stopPropagation
    >
        <h2 class="sh-title">{title}</h2>
        {#if sub}<p class="sh-sub">{sub}</p>{/if}
        <slot />
        <div class="sh-btns"><slot name="buttons" /></div>
    </div>
</div>

<style>
    .sh-scrim {
        position: fixed;
        inset: 0;
        z-index: 3000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.5);
    }
    .sh-sheet {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 428px;
        max-height: 100%;
        overflow-y: auto;
        padding: 20px;
        border-radius: 20px;
        box-sizing: border-box;
        outline: none;
    }
    @media (max-width: 640px) {
        .sh-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .sh-sheet {
            max-width: none;
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
            border-radius: 20px 20px 0 0;
        }
    }
    .sh-title {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        color: #fff;
    }
    .sh-sub {
        margin: -6px 0 0;
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .sh-btns {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 4px;
    }
</style>
