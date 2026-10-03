<script lang="ts">
    import { createEventDispatcher, getContext } from "svelte";
    import type { Action } from "svelte/action";
    import HelpTooltip from "../Tooltip/HelpTooltip.svelte";
    import { helpTextDisabledStore } from "../../Stores/MenuStore";
    import { IconChevronRight } from "@wa-icons";

    export let label: string | undefined = undefined;
    export let tooltipTitle = "";
    export let tooltipDesc = "";
    export let disabledHelp = false;
    // "active" is switched on (the brand gradient); "open" is a window or menu this button opened (the pressed grey).
    export let state: "normal" | "active" | "open" | "forbidden" | "disabled" = "normal";
    // On and reaching someone (the microphone and camera in a bubble or a meeting): drawn as a violet ring.
    export let live = false;
    export let dataTestId: string | undefined = undefined;
    export let classList = "group";
    // Hide the icon in the action bar (displays only the label), and only displays the icon if we are in the responsive menu.
    export let hideIconInActionBar = false;
    // An optional action that will be added to the button element.
    export let bgColor: string | undefined = undefined;
    export let textColor: string | undefined = undefined;
    export let isGradient = false;
    export let hasImage = true;
    export let action: Action = () => {};
    export let media = "";
    export let desc = "";
    export let tooltipShortcuts: string[] = [];
    export let boldLabel = false;
    // In a menu: a trailing arrow, for rows that open a screen. Opt-in, so other menus are unaffected.
    export let chevron = false;
    // In the action bar: a label shown beside the icon only where the bar is wide (2xl), an icon alone elsewhere.
    export let wideLabel: string | undefined = undefined;
    // In a menu: the icon is a picture (the woka, the companion) shown whole in a 32px tile rather than a 16px icon.
    export let imageTile = false;

    // By default, the button will have a rounded corner on the left if it is the first of a div.
    // This behaviour can be overridden by setting the "first" prop to true or false explicitly.
    // Used for the responsive menu items.
    export let first: boolean | undefined = undefined;
    // By default, the button will have a rounded corner on the right if it is the last of a div.
    // This behaviour can be overridden by setting the "last" prop to true or false explicitly.
    // Used for the responsive menu items.
    export let last: boolean | undefined = undefined;
    // Can be used to force the context. If not set, the context is deduced from the "inMenu" Svelte context.
    export let context: "actionBar" | "menu" | undefined = undefined;

    $: isInMenu = context !== undefined ? context === "menu" : getContext("inMenu");

    let helpActive = false;

    const dispatch = createEventDispatcher<{
        click: void;
        mouseenter: void;
        mouseleave: void;
    }>();

    function handleClick() {
        if (state === "disabled") {
            return;
        }
        helpActive = false;
        dispatch("click");
    }

    $: styleVars = [bgColor ? `--bg-color: ${bgColor};` : "", textColor ? `--text-color: ${textColor};` : ""]
        .filter(Boolean)
        .join(" ");
</script>

{#if !isInMenu}
    <div
        class="relative u-surface-flat u-segment py-2 ps-1 pe-1 pointer-events-auto {classList} group-[.invisible]/visibilitychecker:px-2"
        class:first-of-type:rounded-s-xl={first === undefined}
        class:first-of-type:ps-2={first === undefined}
        class:u-seg-auto-start={first === undefined}
        class:last-of-type:rounded-e-xl={last === undefined}
        class:last-of-type:pe-2={last === undefined}
        class:u-seg-auto-end={last === undefined}
        class:rounded-s-xl={first === true}
        class:ps-2={first === true}
        class:u-seg-start={first === true}
        class:rounded-e-xl={last === true}
        class:pe-2={last === true}
        class:u-seg-end={last === true}
        use:action
        style={styleVars}
    >
        <!-- The button is a square (or a pill-wide rectangle) and takes the whole tap; what is drawn is the state
             layer inside it, a circle (a pill with a label). States and hover are colours on that layer, never a
             shape, and the tests read them from data-state. -->
        <button
            type="button"
            class="u-ab-btn h-12 @sm/actions:h-10 @xl/actions:h-12 p-1 m-0
                    {!label
                ? 'u-ab-icon w-12 @sm/actions:w-10 @xl/actions:w-12'
                : 'px-4 text-base @sm/actions:text-sm @xl/actions:text-base whitespace-nowrap'}
                {wideLabel && !label
                ? '@2xl/actions:w-auto @2xl/actions:px-4 text-base @sm/actions:text-sm @xl/actions:text-base whitespace-nowrap'
                : ''}
                {isGradient ? 'gradient overflow-hidden font-bold rounded-full' : 'rounded-none'}
                {bgColor && !isGradient ? 'u-ab-custom' : ''}
                {textColor ? 'text-[var(--text-color)]' : 'text-neutral-100'}
                    flex items-center justify-center outline-none focus:outline-none gap-2 select-none"
            data-state={state}
            data-live={live ? "true" : undefined}
            disabled={state === "disabled"}
            on:click|preventDefault={() => handleClick()}
            on:mouseenter={() => {
                helpActive = true;
                dispatch("mouseenter");
            }}
            on:mouseleave={() => {
                helpActive = false;
                dispatch("mouseleave");
            }}
            data-testid={dataTestId}
        >
            {#if !isGradient}
                <span class="u-ab-state" aria-hidden="true" />
            {/if}
            {#if !hideIconInActionBar}
                <slot />
            {/if}
            {#if label}<span class={boldLabel ? "font-bold" : ""}>{label}</span>{/if}
            {#if wideLabel && !label}<span class="hidden @2xl/actions:inline font-bold">{wideLabel}</span>{/if}
        </button>
        {#if helpActive && !$helpTextDisabledStore && !disabledHelp && (tooltipTitle != "" || tooltipDesc != "")}
            <HelpTooltip title={tooltipTitle} helpMedia={media} {desc} shortcuts={tooltipShortcuts} />
        {/if}
    </div>
{:else}
    <button
        type="button"
        class="u-menu-row group pointer-events-auto select-none
                    {state === 'disabled' ? 'opacity-50 cursor-not-allowed' : ''}
                    {state === 'active' && !isGradient ? 'u-selected' : ''}
                    {state === 'forbidden' ? 'u-danger' : ''}
                    {isGradient ? 'gradient overflow-hidden' : ''}
                    {bgColor && !isGradient ? 'bg-[var(--bg-color)]' : ''}
                    {textColor ? 'text-[var(--text-color)]' : ''}
                    {isGradient ? 'relative' : ''}"
        data-state={state}
        disabled={state === "disabled"}
        use:action
        on:click={() => handleClick()}
        style={styleVars}
    >
        {#if hasImage}
            <span class="u-menu-tile" class:u-menu-tile-image={imageTile}>
                <slot />
            </span>
        {/if}
        <span class="u-menu-label">
            {label ?? tooltipTitle ?? ""}
            <slot name="end" />
        </span>
        {#if chevron}
            <IconChevronRight font-size="16" class="u-menu-go rtl:-scale-x-100" aria-hidden="true" />
        {/if}
    </button>
{/if}

<style>
    .gradient:before {
        content: "";
        z-index: -1;
        position: absolute;
        top: 0;
        inset-inline-start: 0;
        width: 100%;
        height: 200%;
        border-radius: 100%;
        filter: blur(20px);
        /*background-color: #cdb012;*/
        background-color: var(--bg-color);
        opacity: 0.7;
        transition: all 0.5s ease-in-out;
    }

    .gradient:hover:before {
        opacity: 1;
        border-radius: 10%;
    }

    .gradient {
        border: 1px solid rgb(from var(--bg-color) r g b / 0.3);
        transition: all 0.2s ease-in-out;
        box-shadow: 0px 0px 0px 0px var(--bg-color) / 0;
    }

    .gradient:hover {
        box-shadow: 0px 0px 4px 2px rgb(from var(--bg-color) r g b / 0.1);
    }
</style>
