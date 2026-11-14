<script lang="ts">
    import { readable } from "svelte/store";
    import LL from "../../../../i18n/i18n-svelte";
    import Avatar from "../../Components/Avatar.svelte";
    import FollowWoka from "../../../Components/PopUp/FollowWoka.svelte";

    /**
     * Someone walked up while the person is on a call with a bot (game #2004, mock v10 Part 18 picture 10, Desktop 17).
     * Walking up is not a request, so the card says who walked up, then what each button does to the call: "Talk to
     * {name}" holds the call first and then joins the two people; "Stay with {bot}" leaves the call untouched. It is
     * drawn like the game's follow request card (same surface, title size, hint line and pills). Its two actions are the
     * call's own, never the Busy card's: that card's accept resets the person's requested status to Online
     * (BubbleConfirmationModal handleAccept), and a call must never do that (check 63). Nothing here touches the status.
     * It has no Escape shortcut: Escape belongs to whatever menu or sheet is open, and must not answer this card for the person. Nobody is interrupted until a tap: until then the newcomer hears nothing of the call and the bot hears nothing of them.
     *
     * Not in the mock as confirmed: Claude's pick that Khalid and GPT have not confirmed (mock README).
     */
    export let name: string;
    /** Their account id: the card shows their Woka the way the follow request card does. A coloured initial until the Woka is found, or when the id is not known. */
    export let wokaId: string | undefined = undefined;
    export let botName: string;
    export let onHoldAndTalk: () => void;
    export let onNotNow: () => void;

    const picture = readable<string | undefined>(undefined);
</script>

<div
    class="fixed z-[1000] bottom-0 start-0 right-0 m-auto w-max mobile:w-[98vw] md:max-w-[80%]"
    data-testid="call-walk-up-card"
>
    <div class="popups flex items-end relative w-full justify-center mobile:mb-24 mb-4">
        <div
            class="u-surface pointer-events-auto w-full mobile:mx-1 sm:w-[400px] overflow-hidden rounded-2xl text-start text-white"
            role="dialog"
            aria-labelledby="walk-up-title"
        >
            <div class="flex items-center gap-3 px-4 pb-3 pt-3.5">
                {#if wokaId}
                    <FollowWoka userId={wokaId} fallbackName={name} />
                {:else}
                    <Avatar pictureStore={picture} fallbackName={name} size="lg" />
                {/if}
                <div class="min-w-0">
                    <p id="walk-up-title" class="m-0 text-base font-semibold normal-case leading-[22px]">
                        {$LL.chat.brickCall.walkUpTitle({ name })}
                    </p>
                    <p class="m-0 mt-0.5 text-[13px] leading-[18px] text-white/60">
                        {$LL.chat.brickCall.walkUpHold({ bot: botName })}
                    </p>
                </div>
            </div>
            <div class="flex gap-2 px-3 pb-3">
                <button
                    type="button"
                    class="u-cta-secondary m-0 flex h-11 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="call-walk-up-stay"
                    on:click={onNotNow}
                >
                    <span class="truncate">{$LL.chat.brickCall.stayWith({ bot: botName })}</span>
                </button>
                <button
                    type="button"
                    class="u-cta m-0 flex h-11 min-w-0 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold"
                    data-testid="call-walk-up-talk"
                    on:click={onHoldAndTalk}
                >
                    <span class="truncate">{$LL.chat.brickCall.talkTo({ name })}</span>
                </button>
            </div>
        </div>
    </div>
</div>
