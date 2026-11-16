<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import { IconPhoneCall } from "@wa-icons";

    /**
     * The call button in the chat header of a bot that can be called (game #2004, mock v10 Part 18 picture 1). It is only
     * drawn when the caller may call this bot (Orbit's "Call" rule answered Yes, and the bot has a voice), so a bot that
     * cannot be called shows nothing at all and its chat looks as it does today.
     */
    export let onCall: () => void;
    export let disabled = false;
</script>

<button
    type="button"
    class="call-button"
    {disabled}
    aria-label={$LL.chat.brickCall.button()}
    data-testid="call-button"
    on:click={onCall}
>
    <IconPhoneCall font-size="22" />
</button>

<style>
    .call-button {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: 0;
        display: grid;
        place-items: center;
        color: #fff;
        background: transparent;
    }
    .call-button:disabled {
        opacity: 0.5;
    }
</style>
