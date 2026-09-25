<script lang="ts">
    // One thumb-sized (40px) icon button for the People tab, with an accessible name and a hover/focus tooltip.
    export let label: string;
    export let ariaLabel: string = label;
    export let testId: string | undefined = undefined;
    export let disabled = false;
    export let primary = false;
    export let expanded: boolean | undefined = undefined;
    export let hasPopup = false;
    export let buttonElement: HTMLButtonElement | undefined = undefined;
    let className = "";
    export { className as class };
</script>

<div class="relative group/action shrink-0">
    <span
        aria-hidden="true"
        class="pointer-events-none absolute bottom-full end-0 mb-1 z-20 w-max max-w-[12rem] text-start rounded bg-contrast/90 backdrop-blur-xl px-2 py-1 text-xs text-white opacity-0 translate-y-1 transition-all duration-150 motion-reduce:transition-none motion-reduce:translate-y-0 [@media(hover:hover)]:group-hover/action:opacity-100 [@media(hover:hover)]:group-hover/action:translate-y-0 group-has-[:focus-visible]/action:opacity-100 group-has-[:focus-visible]/action:translate-y-0"
    >
        {label}
    </span>
    <button
        bind:this={buttonElement}
        type="button"
        class="m-0 p-0 h-10 w-10 flex items-center justify-center rounded-lg border-0 text-white transition-all duration-150 motion-reduce:transition-none active:scale-90 motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-secondary disabled:cursor-not-allowed disabled:bg-transparent disabled:text-gray-400 disabled:active:scale-100 {primary
            ? 'bg-secondary/30 hover:bg-secondary/50'
            : 'bg-white/5 hover:bg-white/15'} {className}"
        aria-label={ariaLabel}
        aria-expanded={expanded}
        aria-haspopup={hasPopup ? "menu" : undefined}
        data-testid={testId}
        {disabled}
        on:click|stopPropagation
    >
        <slot />
    </button>
</div>
