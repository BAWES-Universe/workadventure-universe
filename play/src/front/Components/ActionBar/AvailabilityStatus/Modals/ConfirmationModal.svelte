<script lang="ts">
    import type { ConfirmationModalPropsInterface } from "../Interfaces/ConfirmationModalPropsInterface";
    import PopUpContainer from "../../../PopUp/PopUpContainer.svelte";
    export let props: ConfirmationModalPropsInterface;
    $: ({ handleAccept, handleClose, acceptLabel, closeLabel } = props);
    // When set, the question is a card: the icon in a gradient tile, the title in the brand gradient, the text under it.
    export let title: string | undefined = undefined;
    const SLOTS = $$props.$$slots;

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            handleClose();
        }
    };
</script>

<svelte:window on:keydown={onKeyDown} />

<PopUpContainer extraClasses="max-w-[380px]">
    {#if SLOTS.icon || title}
        <div class="flex flex-col items-center gap-2 pt-1">
            {#if SLOTS.icon}
                <span class="confirm-tile grid place-items-center h-11 w-11 rounded-xl text-white" aria-hidden="true">
                    <slot name="icon" />
                </span>
            {/if}
            {#if title}
                <h2 class="confirm-title u-text-gradient m-0 text-lg font-bold leading-6">{title}</h2>
            {/if}
        </div>
    {/if}
    <slot />
    <!-- Two pills: the quiet one to decline, the gradient one to accept. -->
    <div class="buttons-wrapper flex items-center justify-center p-2 gap-2 pointer-events-auto mt-2">
        <button
            type="button"
            class="u-cta-secondary h-11 w-1/2 m-0 px-4 rounded-full justify-center text-sm font-bold responsive-message"
            on:click={handleClose}>{closeLabel}</button
        >
        <button
            type="button"
            class="u-cta h-11 w-1/2 m-0 px-4 rounded-full justify-center text-sm font-bold"
            on:click={handleAccept}>{acceptLabel}</button
        >
    </div>
</PopUpContainer>

<style>
    .confirm-tile {
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -10px rgba(134, 41, 252, 0.7);
    }
    /* The gradient title is text in the brand colours; the font family is the page's. */
    .confirm-title {
        font-family: inherit;
    }
</style>
