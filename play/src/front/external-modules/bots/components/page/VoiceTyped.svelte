<script lang="ts">
    // A speech server of the person's own that lists no voices (#1874): the Voice row asks for the voice's name. The name is heard
    // before it is kept ("Hear <name> say hello"), and Use asks the server once more, silently, and saves only when audio comes back.
    // A name the server refused, or a server that did not answer, is one red line under the field. It stands in for the voice
    // list at the door (voice off) and for the picker (Change).
    import { createEventDispatcher } from "svelte";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import { botApiService } from "../../services/BotApiService";
    import { helloFailureOf, voiceNameFailureOf, type VoiceNameFailure } from "../../voiceModel";
    import PageButton from "./PageButton.svelte";
    import VoiceHello from "./VoiceHello.svelte";
    import { IconChevronLeft, IconLoader2 } from "@wa-icons";

    export let botId: string;
    export let botName: string;
    /** Where it is asked: at the door (voice off) or when changing the voice of a bot that speaks */
    export let mode: "door" | "change" = "door";
    /** "your speech server", or "Sara’s speech server", for the middle of a sentence */
    export let server: string;
    /** The same, for the start of one ("Your speech server") */
    export let serverStart: string;
    /** The name the bot speaks with now (change only) */
    export let currentName: string | undefined = undefined;
    /** At the door: the speech server and model the name is heard from, as voice is not on yet to say it */
    export let source: { providerId: string; model: string } | undefined = undefined;
    /** Saving is under way */
    export let busy = false;
    export let onBack: () => void = () => undefined;
    /** Keeps the name: called once the server has said hello with it */
    export let onUse: (name: string) => void | Promise<void>;

    const dispatch = createEventDispatcher<{ refresh: undefined }>();

    let name = mode === "change" ? currentName ?? "" : "";
    let problem: VoiceNameFailure | null = null;
    let checking = false;
    /** The hello is being asked of the server: the server makes one at a time, so Use waits for it */
    let hearing = false;

    $: v = $LL.mapEditor.edit.bots.page.voice;
    $: typed = name.trim();
    $: same = mode === "change" && typed === currentName;
    $: canUse = typed !== "" && !same && !checking && !hearing && !busy && problem !== "rejected";
    $: useLabel = checking ? v.checkingVoice({ voice: typed }) : typed ? v.use({ voice: typed }) : v.useThisVoice();
    $: bad =
        problem === "rejected"
            ? v.voiceNameRejected({ server: serverStart, voice: typed })
            : problem === "unreachable"
            ? v.speechServerSilent({ server: serverStart })
            : "";

    function edit(value: string) {
        name = value;
        problem = null;
    }

    async function use() {
        if (!canUse) return;
        const asked = typed;
        problem = null;
        checking = true;
        try {
            await botApiService.checkBotVoiceName(botId, $locale, { voiceId: asked, source });
        } catch (e) {
            // The name was changed while the server was answering: that answer is about another name
            if (typed === asked) {
                problem = voiceNameFailureOf(e);
                // The page is out of date (voice was turned off) or the source changed: ask again how the voice stands
                if (helloFailureOf(e).kind === "off") dispatch("refresh");
            }
            return;
        } finally {
            checking = false;
        }
        if (typed === asked) await onUse(asked);
    }
</script>

{#if mode === "change"}
    <button type="button" class="vt-back" data-testid="bot-voice-picker-back" on:click={onBack}>
        <IconChevronLeft font-size="18" />{v.back()}
    </button>
    <div class="vt-cap2" data-testid="bot-voice-picker-title">{v.typedTitle({ bot: botName, server })}</div>
{:else}
    <div class="vt-cap" data-testid="bot-voice-door-caption">{v.typedCaption({ server })}</div>
{/if}

<label class="vt-field" class:bad={problem !== null}>
    <input
        type="text"
        value={name}
        maxlength="255"
        autocomplete="off"
        autocapitalize="off"
        autocorrect="off"
        spellcheck="false"
        placeholder={v.typedPlaceholder()}
        aria-label={v.typedLabel()}
        aria-invalid={problem !== null ? "true" : undefined}
        data-testid="bot-voice-typed"
        on:input={(e) => edit(e.currentTarget.value)}
    />
</label>
{#if bad}
    <p class="vt-err" role="alert" data-testid="bot-voice-typed-error">{bad}</p>
{:else}
    <p class="vt-m">{v.typedHelp({ server: serverStart })}</p>
{/if}

<VoiceHello
    {botId}
    paidByKey={server}
    free
    voiceName={typed}
    blocked={checking}
    bind:working={hearing}
    {source}
    locale={$locale}
    on:problem={(e) => (problem = e.detail)}
    on:refresh={() => dispatch("refresh")}
/>

{#if mode === "door"}
    <button type="button" class="vt-go" data-testid="bot-voice-go" disabled={!canUse} on:click={() => void use()}>
        {#if checking}<IconLoader2 class="vt-spin" font-size="18" />{/if}{useLabel}
    </button>
{:else}
    <div class="vt-save">
        <PageButton tall on:click={onBack}>{v.keep()}</PageButton>
        <PageButton tall go testId="bot-voice-use" disabled={!canUse} on:click={() => void use()}>{useLabel}</PageButton
        >
    </div>
{/if}

<style>
    .vt-field {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 48px;
        padding: 0 14px;
        border-radius: 14px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.3);
        color: rgba(244, 242, 250, 0.64);
    }
    .vt-field:focus-within {
        box-shadow: inset 0 0 0 2px #a78bfa;
    }
    .vt-field.bad {
        box-shadow: inset 0 0 0 1px rgba(255, 138, 122, 0.8);
    }
    .vt-field input {
        flex: 1;
        min-width: 0;
        border: 0;
        background: transparent;
        font: inherit;
        /* 16px keeps a phone from zooming in on the field */
        font-size: 16px;
        color: #fff;
        outline: none;
    }
    .vt-m {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.35;
        color: rgba(244, 242, 250, 0.64);
    }
    .vt-err {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #ff8a7a;
    }
    .vt-cap {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(244, 242, 250, 0.64);
    }
    .vt-cap2 {
        font-size: 15px;
        font-weight: 700;
        overflow-wrap: anywhere;
    }
    .vt-back {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        align-self: flex-start;
        height: 44px;
        margin: -8px 0 -6px -8px;
        padding: 0 8px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.8);
        cursor: pointer;
    }
    :global([dir="rtl"]) .vt-back :global(svg) {
        transform: scaleX(-1);
    }
    .vt-back:focus-visible,
    .vt-go:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .vt-go {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        width: 100%;
        height: 48px;
        margin: 2px 0 0;
        border: 0;
        border-radius: 999px;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        font: inherit;
        font-size: 15px;
        font-weight: 700;
        color: #fff;
        cursor: pointer;
    }
    .vt-go:disabled {
        opacity: 0.5;
        cursor: default;
    }
    .vt-go :global(.vt-spin) {
        animation: vt-turn 1s linear infinite;
    }
    @keyframes vt-turn {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .vt-go :global(.vt-spin) {
            animation: none;
        }
    }
    .vt-save {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding-top: 4px;
    }
</style>
