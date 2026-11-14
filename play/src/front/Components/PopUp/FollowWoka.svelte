<script lang="ts">
    import { getColorByString } from "../../Utils/ColorGenerator";
    import WokaFromUserId from "../Woka/WokaFromUserId.svelte";

    export let userId: number | string;
    // 44px in the cards, 30px in the pills, the notes and the list rows.
    export let small = false;
    /** When given, its first letter fills the frame until the Woka is found (a reconnect, a scene change), instead of an empty ring. */
    export let fallbackName: string | undefined = undefined;

    let resolved = false;
    $: initial = fallbackName && !resolved ? fallbackName.charAt(0) : "";
</script>

<!-- The person's front-facing Woka, the picture the People list shows, in a round frame with the violet ring. -->
<span
    class="follow-woka flex-none grid place-items-center overflow-hidden rounded-full bg-white/[0.08] {small
        ? 'h-[30px] w-[30px]'
        : 'h-11 w-11'}"
    class:small
    style:background-color={initial && fallbackName ? getColorByString(fallbackName) : undefined}
    aria-hidden="true"
>
    {#if initial}
        <span class="font-bold uppercase text-white {small ? 'text-xs' : 'text-base'}" data-testid="follow-woka-initial"
            >{initial}</span
        >
    {/if}
    {#key userId}
        <WokaFromUserId bind:resolved {userId} placeholderSrc="" customWidth={small ? "30px" : "44px"} />
    {/key}
</span>

<style>
    .follow-woka {
        box-shadow: 0 0 0 2px rgba(167, 139, 250, 0.6);
    }
    /* The picture fills the frame, a little low so the head sits in the middle. */
    .follow-woka :global(img) {
        transform: translateY(2px);
    }
    .follow-woka.small :global(img) {
        transform: translateY(1px);
    }
</style>
