<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import ConfirmationModal from "../../../Components/ActionBar/AvailabilityStatus/Modals/ConfirmationModal.svelte";

    /**
     * Someone walked up while the person is on a call with a bot (game #2004, mock v10 Part 18 picture 10, Desktop 17).
     * Walking up is not a request, so the card says "{name} is here". It looks like the game's own Busy card (the same
     * ConfirmationModal) but has its OWN actions: the Busy card's accept resets the person's requested status to Online
     * (BubbleConfirmationModal handleAccept), and a call must never do that (check 63). Nothing here touches the status.
     * Nobody is interrupted until a tap: until then the newcomer hears nothing of the call and the bot hears nothing of them.
     *
     * Not in the mock as confirmed: Claude's pick that Khalid and GPT have not confirmed (mock README).
     */
    export let name: string;
    export let botName: string;
    export let onHoldAndTalk: () => void;
    export let onNotNow: () => void;

    $: props = {
        handleAccept: onHoldAndTalk,
        handleClose: onNotNow,
        acceptLabel: $LL.chat.brickCall.holdAndTalk(),
        closeLabel: $LL.chat.brickCall.notNow(),
    };
</script>

<div
    class="fixed z-[1000] bottom-0 start-0 right-0 m-auto w-max mobile:w-[98vw] md:max-w-[80%]"
    data-testid="call-walk-up-card"
>
    <div class="popups flex items-end relative w-full justify-center mobile:mb-24 mb-4">
        <ConfirmationModal {props}>
            <div class="grow text-center text-xl">{$LL.chat.brickCall.here({ name })}</div>
            <div class="mt-1 text-center text-sm text-white/70">{$LL.chat.brickCall.hereWait({ bot: botName })}</div>
        </ConfirmationModal>
    </div>
</div>

<style>
    .popups :global(.buttons-wrapper button) {
        padding-inline: 8px;
        white-space: nowrap;
    }
</style>
