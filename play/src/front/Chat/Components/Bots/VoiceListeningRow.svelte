<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import Woka from "../../../Components/Woka/Woka.svelte";
    import { currentVoiceSpaceStore } from "../../Bots/VoiceBots";

    /**
     * Round 8: above the message box in nearby chat, while a voice bot takes this person's microphone in their group (or
     * is turning it on, or a stop is not confirmed yet). It says so, with a direct Stop listening (Cancel while it turns
     * on), so the keyboard never hides the way to stop it. Alone with the bot, and when it doesn't listen, nothing shows.
     */
    $: view = $currentVoiceSpaceStore;
    $: bot = view?.bot;
    $: listening = bot?.state === "on" ? bot.listening : "";
    $: shown = listening === "on" || listening === "pending" || listening === "stopping" || listening === "checking";
    $: limited = bot?.listeningReason === "limit";
    $: on = listening === "on" && !limited;
    $: status =
        listening === "on"
            ? limited
                ? $LL.say.voice.listen.onLimit()
                : $LL.say.voice.listen.on()
            : listening === "pending"
            ? $LL.say.voice.listen.turningOn()
            : listening === "stopping"
            ? $LL.say.voice.listen.stopping()
            : $LL.say.voice.listen.checking();
    $: pictureStore = bot?.picture;

    function stop() {
        if (bot) view?.askToListen(bot.spaceUserId, "stop");
    }
</script>

{#if shown && bot}
    <div
        class="row"
        role="group"
        aria-label={$LL.say.voice.listen.rowLabel({ bot: bot.name, state: status })}
        data-testid="voiceListeningRow"
        data-state={listening}
    >
        <span class="woka" class:on aria-hidden="true">
            {#if $pictureStore}
                <Woka src={$pictureStore} customWidth="30px" />
            {/if}
        </span>
        <span class="text">
            <span class="name" dir="auto">{bot.name}</span>
            <span class="status"
                ><i class="dot" class:off={!on} aria-hidden="true" /><span dir="auto">{status}</span></span
            >
        </span>
        <!-- A stop not confirmed yet can be asked again -->
        {#if listening !== "stopping"}
            <button type="button" class="act" data-testid="voiceListeningRowStop" on:click={stop}
                >{listening === "pending" ? $LL.say.voice.listen.cancel() : $LL.say.voice.listen.stop()}</button
            >
        {/if}
    </div>
{/if}

<style>
    .row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 12px 8px;
        padding: 8px 8px 8px 10px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
        color: #fff;
    }
    .woka {
        display: grid;
        place-items: center;
        flex: none;
        width: 40px;
        height: 40px;
        border-radius: 9999px;
        background: #1f1c2f;
        box-shadow: 0 0 0 1px rgba(167, 139, 250, 0.3);
    }
    .woka.on {
        box-shadow: 0 0 0 2.5px #8629fc, 0 0 12px -2px rgba(134, 41, 252, 0.8);
    }
    .text {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: 2px;
    }
    .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 0.9375rem;
        font-weight: 700;
        line-height: 1.2;
    }
    .status {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 0.8125rem;
        line-height: 1.3;
        color: rgba(255, 255, 255, 0.72);
    }
    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 9999px;
        background: #4ade80;
    }
    .dot.off {
        background: #8b88a0;
    }
    /* UI standard secondary button: glass, thin edge, fully round, 44px */
    .act {
        flex: none;
        min-height: 44px;
        padding: 0 18px;
        border-radius: 9999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: inherit;
        font-weight: 700;
        font-size: 0.875rem;
        line-height: 1.2;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    @media (hover: hover) {
        .act:hover {
            background: rgba(255, 255, 255, 0.1);
        }
    }
    .act:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
</style>
