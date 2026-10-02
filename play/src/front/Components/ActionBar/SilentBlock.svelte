<script lang="ts">
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconMute } from "@wa-icons";

    /** Where the bar is: "above" it on phones (bar at the bottom), "below" it elsewhere (bar at the top). */
    export let placement: "above" | "below";
</script>

<!-- The same dark surface as the other panels, so the text reads on any floor, with an amber tile so it is noticed.
     The explanation shows everywhere: nothing to tap.
     "above": phones, where the bar is at the bottom. Placed against the whole bar, centred and never wider than the
     screen, above the device tab.
     "below": everywhere else, where the bar is at the top. Under the microphone and camera, as before. -->
<div
    class="silent-block {placement === 'above'
        ? 'bottom-full inset-x-0 mx-auto mb-10 max-w-[22rem]'
        : 'top-20 start-0 w-max max-w-[min(22rem,calc(100vw-1rem))]'} flex absolute z-0 u-surface rounded-2xl text-white text-start transition-all pointer-events-auto items-start gap-3 px-3 py-2.5"
    role="status"
    aria-live="polite"
    transition:fly={{ y: 30, duration: 400 }}
>
    <span class="silent-tile shrink-0 grid place-items-center h-8 w-8 rounded-lg" aria-hidden="true">
        <IconMute font-size="18" />
    </span>
    <div class="min-w-0">
        <div class="m-0 text-sm font-semibold leading-5">{$LL.camera.my.silentZone()}</div>
        <div class="text-xs leading-4 text-white/80">{$LL.camera.my.silentZoneDesc()}</div>
    </div>
</div>

<style>
    .silent-tile {
        color: #e9c74c;
        background: rgba(233, 199, 76, 0.16);
        box-shadow: inset 0 0 0 1px rgba(233, 199, 76, 0.25);
    }
    @media (prefers-reduced-motion: reduce) {
        .silent-block {
            transition: none;
        }
    }
</style>
