<script lang="ts">
    import { onDestroy, tick } from "svelte";
    import type { ComponentType } from "svelte";
    import { IconCheck, IconChevronDown } from "@wa-icons";

    /**
     * The game's dropdown, in place of the browser's own list (which ignores the design and is narrower than the
     * field). The field shows the chosen option; tapped, the options open over what is below (or above, when there is
     * no room), picked the way you pick your status: the chosen one is tinted and bold, with a check.
     */
    type Option = { value: string; label: string };

    export let label: string;
    /** An icon at the start of the field */
    export let icon: ComponentType | undefined = undefined;
    export let value: string | undefined;
    export let options: Option[];
    /** Shown when there is nothing to pick */
    export let placeholder = "";
    export let disabled = false;
    export let dim = false;
    export let onSelect: (value: string) => void;

    const id = `u-select-${Math.random().toString(36).slice(2, 9)}`;
    let root: HTMLDivElement;
    let head: HTMLButtonElement;
    let panel: HTMLDivElement | undefined;
    let open = false;
    let upward = false;

    $: current = options.find((option) => option.value === value);
    $: shown = current?.label ?? (options.length > 0 ? options[0].label : placeholder);
    $: if (disabled && open) close(false);

    async function show() {
        if (disabled || options.length === 0) return;
        // Opens upward when the list would not fit under the field
        const rect = head.getBoundingClientRect();
        const listHeight = Math.min(options.length * 46 + 12, 252);
        upward = rect.bottom + listHeight + 8 > window.innerHeight && rect.top - listHeight - 8 > 0;
        open = true;
        await tick();
        focusOption(
            Math.max(
                0,
                options.findIndex((option) => option.value === value)
            )
        );
    }

    function close(refocus = true) {
        open = false;
        if (refocus) head?.focus();
    }

    function pick(option: Option) {
        close();
        if (option.value !== value) onSelect(option.value);
    }

    function optionButtons(): HTMLButtonElement[] {
        return panel ? Array.from(panel.querySelectorAll<HTMLButtonElement>("[role=option]")) : [];
    }

    function focusOption(index: number) {
        const buttons = optionButtons();
        buttons[Math.min(Math.max(index, 0), buttons.length - 1)]?.focus();
    }

    function onHeadKeyDown(event: KeyboardEvent) {
        if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            if (open) close();
            else show().catch((e) => console.error(e));
        }
    }

    function onPanelKeyDown(event: KeyboardEvent) {
        const buttons = optionButtons();
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let handled = true;
        if (event.key === "ArrowDown") focusOption(index + 1);
        else if (event.key === "ArrowUp") focusOption(index - 1);
        else if (event.key === "Home") focusOption(0);
        else if (event.key === "End") focusOption(buttons.length - 1);
        else if (event.key === "Escape") close();
        else if (event.key === "Enter" || event.key === " ") {
            if (index >= 0) pick(options[index]);
        } else if (event.key === "Tab") {
            close(false);
            handled = false;
        } else handled = false;
        if (handled) {
            event.preventDefault();
            event.stopPropagation();
        }
    }

    // The Enter that picks must not reach the screen's own Enter (which saves and joins)
    function stopEnter(event: KeyboardEvent) {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    }

    function onWindowPointerDown(event: PointerEvent) {
        if (open && !root.contains(event.target as Node)) close(false);
    }

    onDestroy(() => {
        open = false;
    });
</script>

<svelte:window on:pointerdown={onWindowPointerDown} />

<div class="u-select" class:opacity-50={dim} bind:this={root}>
    <button
        type="button"
        class="u-join-field u-select-head"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        {disabled}
        bind:this={head}
        on:click={() => (open ? close() : show().catch((e) => console.error(e)))}
        on:keydown={onHeadKeyDown}
        on:keyup={stopEnter}
    >
        {#if icon}
            <svelte:component this={icon} font-size="18" class="flex-none text-white/80" />
        {/if}
        <span class="u-select-value">{shown}</span>
        <IconChevronDown font-size="16" class="u-select-chevron {open ? 'is-open' : ''}" />
    </button>
    {#if open}
        <div
            class="u-select-panel"
            class:upward
            {id}
            role="listbox"
            tabindex="-1"
            aria-label={label}
            bind:this={panel}
            on:keydown={onPanelKeyDown}
            on:keyup={stopEnter}
        >
            {#each options as option (option.value)}
                <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    class="u-menu-row u-select-option"
                    class:u-selected={option.value === value}
                    on:click={() => pick(option)}
                >
                    <span class="u-select-option-label">{option.label}</span>
                    {#if option.value === value}
                        <IconCheck class="flex-none ms-auto" font-size="18" />
                    {/if}
                </button>
            {/each}
        </div>
    {/if}
</div>

<style lang="scss">
    .u-select {
        position: relative;
        min-width: 0;
    }
    .u-select-head {
        width: 100%;
        cursor: pointer;
        text-align: start;
        font: inherit;
    }
    .u-select-head:disabled {
        cursor: default;
    }
    .u-select-head:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 2px rgba(196, 181, 253, 0.85);
    }
    .u-select-value {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        font-size: 0.9375rem;
    }
    .u-select-head :global(.u-select-chevron) {
        flex: none;
        color: rgba(255, 255, 255, 0.7);
        transition: transform 150ms ease;
    }
    .u-select-head :global(.u-select-chevron.is-open) {
        transform: rotate(180deg);
    }
    /* Over what is below, never pushing it down */
    .u-select-panel {
        position: absolute;
        top: calc(100% + 6px);
        left: 0;
        right: 0;
        z-index: 60;
        display: flex;
        flex-direction: column;
        max-height: 252px;
        overflow-y: auto;
        padding: 6px;
        border-radius: 14px;
        /* Opaque, so the fields under it don't show through */
        background: linear-gradient(160deg, rgb(31 28 47), rgb(var(--u-ink)));
        box-shadow: var(--u-surface-shadow), 0 12px 32px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(18px) saturate(140%);
        -webkit-backdrop-filter: blur(18px) saturate(140%);
    }
    .u-select-panel.upward {
        top: auto;
        bottom: calc(100% + 6px);
    }
    .u-select-option {
        min-height: 44px;
        padding: 0 12px;
        font-size: 0.9375rem;
        font-weight: 400;
        text-align: start;
        cursor: pointer;
    }
    .u-select-option.u-selected {
        font-weight: 700;
    }
    .u-select-option-label {
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
    }
</style>
