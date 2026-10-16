<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import { isTouchDevice } from "../../Utils/TouchDevice";

    export let message: string;

    // A [SPACE] in the message is shown as the key chip: "Space" on a computer, "Tap" on a touch screen.
    $: parts = message.split($LL.trigger.spaceKeyboard());
    $: keyLabel = isTouchDevice() ? $LL.trigger.keyTap() : $LL.trigger.keySpace();
</script>

<span
    >{#each parts as part, index (index)}{#if index > 0}<kbd class="u-hint-key">{keyLabel}</kbd>{/if}{part}{/each}</span
>
