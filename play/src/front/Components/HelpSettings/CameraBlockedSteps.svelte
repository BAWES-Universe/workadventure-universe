<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import type { CameraHelpKind } from "../../WebRtc/CameraHelp";

    /** The steps for an iPhone or iPad. Computers and Android keep the pictures, so they have no steps here. */
    export let kind: Exclude<CameraHelpKind, "other">;
</script>

<ol class="camera-steps m-0 grid list-none gap-2 p-0 text-start text-sm leading-5 text-white/85">
    <li>{$LL.camera.help.steps.tryAgain()}</li>
    {#if kind === "ios-app"}
        <li>{$LL.camera.help.steps.closeApp()}</li>
        <li>{$LL.camera.help.steps.settingsApp()}</li>
    {:else}
        <li>{$LL.camera.help.steps.settingsTab()}</li>
    {/if}
</ol>
{#if kind === "ios-app"}
    <p class="m-0 text-start text-xs leading-5 text-white/60">{$LL.camera.help.steps.olderIphone()}</p>
{/if}

<style>
    .camera-steps {
        counter-reset: step;
    }
    .camera-steps li {
        counter-increment: step;
        display: grid;
        grid-template-columns: 1.25rem minmax(0, 1fr);
        gap: 0.5rem;
    }
    .camera-steps li::before {
        content: counter(step);
        font-weight: 700;
        font-size: 0.75rem;
        line-height: 1.25rem;
        text-align: center;
        color: #c4b5fd;
    }
</style>
