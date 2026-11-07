<script lang="ts">
    // "Hear this voice say hello" (#1852): one short fixed line said in the voice and style the bot speaks with, so the maker
    // hears the real thing. The first time costs what a spoken reply costs: one of the person's voice replies on Universe AI, a
    // few characters of the lent key otherwise (the samples above stay free); the same voice heard again soon is kept and free.
    // While it plays, the row is the way to stop it. Nothing is said in any bubble.
    import { createEventDispatcher, onDestroy } from "svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import { botApiService } from "../../services/BotApiService";
    import { helloFailureOf, voiceNameFailureOf, type VoiceNameFailure } from "../../voiceModel";
    import { playingSample, stopSample, toggleSample } from "../../voicePlayer";
    import { IconLoader2, IconMessageCircle, IconPauseFilled } from "@wa-icons";

    export let botId: string;
    /** Whose key pays for the voice, as a phrase ("your ElevenLabs key"); null when Universe AI pays and it is one of the person's voice replies */
    export let paidByKey: string | null;
    /** The language the game is read in: the bot says hello in it unless its instructions say it speaks another */
    export let locale: string;
    /** A speech server of the person's own pays nobody: the line says so, and `paidByKey` names the server ("your speech server") (#1874) */
    export let free = false;
    /** A voice name typed for the person's own speech server and not saved yet: it is heard instead of the saved voice (empty: nothing to hear yet) */
    export let voiceName: string | undefined = undefined;
    /** Before voice is on: the speech server and model the typed name is heard from */
    export let source: { providerId: string; model: string } | undefined = undefined;
    /** Something else is asking the server a moment ago (Use checking the name): the server makes one hello at a time per person */
    export let blocked = false;
    /** The server is being asked for this hello: nothing else may ask it meanwhile */
    export let working = false;

    /** A hello and a sample share the one player, so one of them is heard at a time */
    const ID = "hello";
    /** setTimeout takes at most this many milliseconds */
    const LONGEST_WAIT_MS = 2 ** 31 - 1;

    const dispatch = createEventDispatcher<{ refresh: undefined; problem: VoiceNameFailure }>();

    let words: string | null = null;
    let failed = false;
    let usedUp: Date | null = null;
    let usedUpTimer: ReturnType<typeof setTimeout> | undefined;

    $: v = $LL.mapEditor.edit.bots.page.voice;
    $: typed = voiceName !== undefined;
    $: nothingToHear = voiceName === "";
    // Another name typed: the one being said is not the one in the field any more
    let heardName = voiceName;
    $: if (voiceName !== heardName) {
        heardName = voiceName;
        if ($playingSample === ID) stopSample();
    }
    $: playing = $playingSample === ID;
    // The words come with the audio; until they do the bot is still writing
    $: if (!playing) words = null;
    $: thinking = playing && words === null;
    $: working = thinking;
    $: saying = playing && words !== null;
    $: time = usedUp ? usedUp.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) : "";

    function waitUntilBack(resetsAt: Date) {
        clearTimeout(usedUpTimer);
        usedUp = resetsAt;
        usedUpTimer = setTimeout(
            () => (usedUp = null),
            Math.min(Math.max(resetsAt.getTime() - Date.now(), 0), LONGEST_WAIT_MS)
        );
    }

    async function hear() {
        if (usedUp || thinking || nothingToHear || blocked) return;
        failed = false;
        words = null;
        const asked = voiceName;
        await toggleSample(
            ID,
            async () => {
                try {
                    const hello =
                        voiceName === undefined
                            ? await botApiService.sayBotHello(botId, locale)
                            : await botApiService.sayBotHello(botId, locale, { voiceId: voiceName, source });
                    // Stopped (or another sample picked) while the bot was still writing: the words are not for anyone now
                    if ($playingSample === ID) words = hello.text;
                    return { url: hello.url, revoke: true };
                } catch (e) {
                    const why = helloFailureOf(e);
                    // The name in the field was changed while the server answered: this is about another name
                    const stale = typed && voiceName !== asked;
                    if (why.kind === "used-up") waitUntilBack(why.resetsAt);
                    // The page is out of date (voice was turned off) or the key was refused: ask again how the voice stands
                    // A typed name the server refused says nothing of the page being out of date: only voice being off does
                    if (why.kind === "off" || (why.kind === "provider" && !typed)) dispatch("refresh");
                    // A typed name that was not taken, or a server that did not answer, is said by the one red line next to the field
                    if (typed && !stale) dispatch("problem", voiceNameFailureOf(e));
                    throw e;
                }
            },
            () => {
                if (!usedUp) failed = true;
            }
        );
    }

    onDestroy(() => {
        clearTimeout(usedUpTimer);
        if ($playingSample === ID) stopSample();
    });
</script>

<button
    type="button"
    class="vh"
    class:dim={usedUp !== null || nothingToHear || blocked}
    disabled={usedUp !== null || thinking || nothingToHear || blocked}
    aria-busy={thinking}
    data-testid="bot-voice-hello"
    on:click={() => void hear()}
>
    <span class="vh-ico" class:on={playing} aria-hidden="true">
        {#if thinking}<IconLoader2 class="vh-spin" font-size="20" />{:else if saying}<IconPauseFilled
                font-size="20"
            />{:else}<IconMessageCircle font-size="22" />{/if}
    </span>
    <span class="vh-tx" aria-live="polite">
        <span class="vh-t">
            {#if thinking}{v.helloThinking()}{:else if saying}{v.helloSaying()}{:else if voiceName}{v.helloTitleNamed({
                    voice: voiceName,
                })}{:else}{v.helloTitle()}{/if}
        </span>
        <span class="vh-n" data-testid="bot-voice-hello-line">
            {#if saying}“{words}”{:else if usedUp}{v.helloUsedUp({ time })}{:else if !thinking}{free
                    ? v.helloLineOwn({ server: paidByKey ?? "" })
                    : paidByKey
                    ? v.helloLineKey({ key: paidByKey })
                    : v.helloLineUniverseAi()}{/if}
        </span>
    </span>
    {#if saying}<span class="vh-sr">{v.helloStop()}</span>{/if}
</button>
{#if failed && !typed}<p class="vh-error" role="alert" data-testid="bot-voice-hello-failed">
        {v.helloFailed()}
    </p>{/if}

<style>
    .vh {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        min-height: 56px;
        margin: 0;
        padding: 10px 12px;
        border: 0;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .vh:disabled {
        cursor: default;
    }
    .vh.dim {
        opacity: 0.55;
    }
    .vh:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vh-ico {
        flex: none;
        display: grid;
        place-items: center;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
    }
    .vh-ico.on {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .vh-ico :global(.vh-spin) {
        animation: vh-turn 1s linear infinite;
    }
    @keyframes vh-turn {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .vh-ico :global(.vh-spin) {
            animation: none;
        }
    }
    .vh-tx {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .vh-t {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .vh-n {
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
        overflow-wrap: anywhere;
    }
    .vh-sr {
        position: absolute;
        width: 1px;
        height: 1px;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
    }
    .vh-error {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #ff8a7a;
    }
</style>
