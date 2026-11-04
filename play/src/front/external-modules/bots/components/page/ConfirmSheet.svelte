<script lang="ts">
    // A confirmation that rises from the bottom on a phone and sits in the middle on a desktop, in the bot module's
    // dialog style (a dimmed page and the raised surface), moved to the page's body so the panel does not clip it.
    // It says what the change does, with the words that matter in bold, and asks once.
    import { onMount } from "svelte";

    export let title: string;
    /** One bullet each. `bold` are pieces of `text` to set in bold. */
    export let lines: { text: string; bold?: string[] }[];
    export let note = "";
    export let cancelLabel: string;
    export let confirmLabel: string;
    export let onCancel: () => void;
    export let onConfirm: () => void;
    export let testId = "bot-confirm-sheet";

    let cancelButton: HTMLButtonElement | undefined;
    let confirmButton: HTMLButtonElement | undefined;

    // Keyboard focus moves into the sheet (on Cancel, the safe answer) and comes back to its opener on close
    onMount(() => {
        const opener = document.activeElement as HTMLElement | null;
        cancelButton?.focus();
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

    /** `text` cut into pieces, the ones named in `bold` marked */
    function pieces(text: string, bold: string[] = []): { t: string; b: boolean }[] {
        const found = bold.filter((piece) => piece && text.includes(piece));
        if (!found.length) return [{ t: text, b: false }];
        const escaped = found.map((piece) => piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        return text
            .split(new RegExp(`(${escaped.join("|")})`))
            .filter((t) => t !== "")
            .map((t) => ({ t, b: found.includes(t) }));
    }

    // Caught before the bot page's own Escape handler, so Escape closes this sheet and not the screen behind it.
    // Tab stays between the two buttons.
    function onKeydown(e: KeyboardEvent) {
        if (e.key === "Escape") {
            e.stopPropagation();
            onCancel();
        } else if (e.key === "Tab") {
            e.preventDefault();
            (document.activeElement === cancelButton ? confirmButton : cancelButton)?.focus();
        }
    }
</script>

<svelte:window on:keydown|capture={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div role="presentation" class="cs-scrim pointer-events-auto" use:portal on:click={onCancel}>
    <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
    <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bot-confirm-sheet-title"
        class="cs-sheet u-surface text-white"
        data-testid={testId}
        on:click|stopPropagation
    >
        <h2 id="bot-confirm-sheet-title" class="cs-title">{title}</h2>
        <ul class="cs-lines">
            {#each lines as line (line.text)}
                <li>
                    {#each pieces(line.text, line.bold) as piece, i (i)}{#if piece.b}<b>{piece.t}</b
                            >{:else}{piece.t}{/if}{/each}
                </li>
            {/each}
        </ul>
        {#if note}<p class="cs-note">{note}</p>{/if}
        <div class="cs-btns">
            <button
                bind:this={cancelButton}
                type="button"
                class="cs-btn"
                data-testid="{testId}-cancel"
                on:click={onCancel}>{cancelLabel}</button
            >
            <button
                bind:this={confirmButton}
                type="button"
                class="cs-btn cs-go"
                data-testid="{testId}-confirm"
                on:click={onConfirm}>{confirmLabel}</button
            >
        </div>
    </div>
</div>

<style>
    .cs-scrim {
        position: fixed;
        inset: 0;
        z-index: 3000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 0, 0, 0.5);
    }
    .cs-sheet {
        display: flex;
        flex-direction: column;
        gap: 12px;
        width: 100%;
        max-width: 428px;
        max-height: 100%;
        overflow-y: auto;
        padding: 20px;
        border-radius: 20px;
    }
    /* On a phone it rises from the bottom, like the other choices there */
    @media (max-width: 640px) {
        .cs-scrim {
            align-items: flex-end;
            padding: 0;
        }
        .cs-sheet {
            max-width: none;
            padding-bottom: calc(20px + env(safe-area-inset-bottom));
            border-radius: 20px 20px 0 0;
        }
    }
    .cs-title {
        margin: 0;
        font-size: 1.25rem;
        line-height: 1.15;
        font-weight: 800;
        text-transform: none;
        letter-spacing: normal;
        color: #fff;
    }
    .cs-lines {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 0;
        padding-inline-start: 18px;
        list-style: disc;
        font-size: 14px;
        line-height: 1.45;
        color: rgba(244, 242, 250, 0.82);
    }
    .cs-lines b {
        font-weight: 700;
        color: #fff;
    }
    .cs-note {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .cs-btns {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 4px;
    }
    .cs-btn {
        height: 44px;
        margin: 0;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    /* The gradient is for going ahead */
    .cs-go {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    @media (hover: hover) {
        .cs-btn:not(.cs-go):hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
    .cs-btn:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
