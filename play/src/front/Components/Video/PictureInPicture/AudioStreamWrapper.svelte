<script lang="ts">
    import { selectDefaultSpeaker, speakerSelectedStore } from "../../../Stores/MediaStore";
    import { userActivationManager } from "../../../Stores/UserActivationStore";
    import type { VideoBox } from "../../../Space/Space";
    import { silencedVoiceBotsStore, voiceBotSpaceUserIdsStore } from "../../../Chat/Bots/VoiceBots";
    import AudioStream from "./AudioStream.svelte";

    export let videoBox: VideoBox;
    const streamable = videoBox.streamable;

    // A voice bot's sound: it does not play when we chose not to hear bots (text only, or speak and read), and the
    // Voice button is told when the browser will not start it.
    $: botSpaceUserId =
        $streamable?.spaceUserId && $voiceBotSpaceUserIdsStore.has($streamable.spaceUserId)
            ? $streamable.spaceUserId
            : undefined;
    $: silenced = botSpaceUserId !== undefined && $silencedVoiceBotsStore.has(botSpaceUserId);
</script>

{#if $streamable && ($streamable?.media.type === "webrtc" || $streamable?.media.type === "livekit") && !$streamable.muteAudio && !silenced}
    {#await userActivationManager.waitForUserActivation()}
        <!-- waiting for user activation -->
    {:then value}
        {#if $streamable.media.streamStore}
            <AudioStream
                streamStore={$streamable.media.streamStore}
                volume={$streamable.volume}
                outputDeviceId={$speakerSelectedStore}
                isBlocked={$streamable.media.isBlocked}
                voiceBotSpaceUserId={botSpaceUserId}
                on:selectOutputAudioDeviceError={() => selectDefaultSpeaker()}
            />
        {/if}
    {/await}
{/if}
