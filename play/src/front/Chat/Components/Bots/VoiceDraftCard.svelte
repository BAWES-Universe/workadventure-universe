<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import { splitTentativeWord, type BotVoiceDraft } from "../../Bots/BotVoiceDraft";
    import { IconAlertCircle, IconMicrophoneOn } from "@wa-icons";

    /**
     * What a voice bot hears this person say (#1664), above their message box and for their eyes only.
     * live: the words fill in, the newest one quieter, with a caret. lost: some words did not come through, nothing was
     * sent, and the words wait for Edit, Send or Discard.
     */
    export let draft: BotVoiceDraft;
    export let onEdit: (turnId: string) => void;
    export let onSend: (turnId: string) => void;
    export let onDiscard: (turnId: string) => void;

    $: lost = draft.state === "lost";
    $: live = draft.state === "live";
    $: words = live ? splitTentativeWord(draft.text) : { settled: draft.text, tentative: "" };
</script>

<div class="draft" class:lost data-testid="voiceDraft" data-state={draft.state}>
    <div class="top">
        {#if lost}
            <IconAlertCircle font-size="14" />
            <span data-testid="voiceDraftNote">{$LL.chat.voiceDraft.lost()}</span>
        {:else}
            <span class="rec" />
            <IconMicrophoneOn font-size="14" />
            <span data-testid="voiceDraftNote">{$LL.chat.voiceDraft.onlyYou()}</span>
        {/if}
    </div>
    <div class="words" dir="auto" data-testid="voiceDraftWords">
        {words.settled}<span class="tail">{words.tentative}</span>{#if live}<span class="caret" />{/if}
    </div>
    {#if !live}
        <div class="acts">
            <button type="button" class="b" data-testid="voiceDraftEdit" on:click={() => onEdit(draft.turnId)}>
                {$LL.chat.voiceDraft.edit()}
            </button>
            <button type="button" class="b go" data-testid="voiceDraftSend" on:click={() => onSend(draft.turnId)}>
                {$LL.chat.voiceDraft.send()}
            </button>
            <button type="button" class="b" data-testid="voiceDraftDiscard" on:click={() => onDiscard(draft.turnId)}>
                {$LL.chat.voiceDraft.discard()}
            </button>
        </div>
    {/if}
</div>

<style>
    .draft {
        margin: 0 12px 8px;
        padding: 10px 14px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.05);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.35);
        color: #fff;
    }
    .top {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.6);
    }
    .lost .top {
        color: #f5c27a;
    }
    .rec {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 0 0 3px rgba(134, 41, 252, 0.3);
    }
    .words {
        margin-top: 4px;
        font-size: 15px;
        line-height: 1.4;
        overflow-wrap: anywhere;
    }
    .tail {
        color: rgba(255, 255, 255, 0.45);
    }
    .caret {
        display: inline-block;
        width: 2px;
        height: 16px;
        margin-left: 2px;
        vertical-align: -3px;
        background: #a78bfa;
    }
    .acts {
        display: flex;
        gap: 8px;
        margin-top: 10px;
    }
    .b {
        height: 44px;
        padding: 0 16px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }
    .b.go {
        background: linear-gradient(135deg, #8629fc, #4156f6);
    }
    .b:focus-visible {
        outline: 2px solid rgba(196, 181, 253, 0.9);
        outline-offset: 2px;
    }
</style>
