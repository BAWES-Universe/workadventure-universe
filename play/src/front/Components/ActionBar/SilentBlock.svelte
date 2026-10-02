<script lang="ts">
    import { fly } from "svelte/transition";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconMute } from "@wa-icons";
</script>

<!-- The same dark surface as the other panels, so the text reads on any floor, with an amber tile so it is noticed.
     Above the bar on phones (clear of the device tab), below it on desktop. The explanation shows everywhere:
     nothing to tap. -->
<div
    class="silent-block absolute bottom-full mb-2.5 mobile:mb-14 inset-x-0 mx-auto @sm/actions:bottom-auto @sm/actions:mb-0 @sm/actions:!top-20 @sm/actions:right-auto @sm/actions:mx-0 z-0 u-surface rounded-2xl text-white text-start transition-all pointer-events-auto flex items-start gap-3 px-3 py-2.5 w-max max-w-[min(22rem,calc(100vw-1rem))]"
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
