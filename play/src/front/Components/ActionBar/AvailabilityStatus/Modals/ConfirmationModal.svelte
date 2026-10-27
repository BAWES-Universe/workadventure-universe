<script lang="ts">
    import type { ConfirmationModalPropsInterface } from "../Interfaces/ConfirmationModalPropsInterface";
    import PopUpContainer from "../../../PopUp/PopUpContainer.svelte";
    export let props: ConfirmationModalPropsInterface;
    $: ({ handleAccept, handleClose, acceptLabel, closeLabel } = props);

    const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            handleClose();
        }
    };
</script>

<svelte:window on:keydown={onKeyDown} />

<PopUpContainer extraClasses="max-w-[380px]">
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
