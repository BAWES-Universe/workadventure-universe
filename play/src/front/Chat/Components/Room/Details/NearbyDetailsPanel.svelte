<script lang="ts">
    import { getContext, hasContext } from "svelte";
    import { readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import LL, { locale } from "../../../../../i18n/i18n-svelte";
    import type { ProximityChatRoom } from "../../../Connection/Proximity/ProximityChatRoom";
    import { openRoomDetailsIdStore } from "../../../Stores/ChatDetailsStore";
    import TopRowAvatar from "../../TopRow/TopRowAvatar.svelte";
    import { formatPeopleNames, resolveTopRowState } from "../../TopRow/TopRowSummary";
    import { nearbyTitleLines } from "../Thread/nearbyTitle";
    import { PERSON_COLOUR_CONTEXT, type PersonColourOf } from "../../../Stores/ChatUserWokaStore";
    import { selectedProximitySessionStore } from "../../../Stores/ProximitySessionStore";
    import { sessionOfStay } from "../../../Connection/Proximity/ProximitySessions";
    import { endedConversation } from "./NearbyConversation";
    import { sentLabel } from "./SharedItems";
    import SharedSummary from "./SharedSummary.svelte";
    import ArtifactsSummary from "./ArtifactsSummary.svelte";
    import { IconChevronLeft, IconChevronRight, IconMessageCircle2 } from "@wa-icons";

    /**
     * The proximity chat's details, over the conversation: who is here now and what was shared in it, or for one that
     * ended, who you were with (#1615). It has no pins and no settings. Back returns to the conversation.
     */
    export let room: ProximityChatRoom;

    const MAX_STACKED_AVATARS = 3;
    const participants = room.participants;
    const spaceKind = room.spaceKind;
    const spaceName = room.name;
    const sessions = room.sessions;

    // Each woka sits on the person's colour from People, as in the chat list.
    const colourOf: Readable<PersonColourOf> = hasContext(PERSON_COLOUR_CONTEXT)
        ? getContext(PERSON_COLOUR_CONTEXT)
        : readable(() => undefined);
    const direction = document.documentElement.getAttribute("dir") || "ltr";

    // The same people as the chat's header: those a message sent now goes to.
    $: state = resolveTopRowState({
        spaceKind: $spaceKind,
        spaceName: $spaceName,
        participants: $participants,
        areas: [],
    });
    // The conversation the chat shows, when it is one that ended: its details are about it, not the chat now.
    $: ended =
        $selectedProximitySessionStore === undefined
            ? undefined
            : endedConversation(sessionOfStay($sessions, $selectedProximitySessionStore), (list) =>
                  formatPeopleNames(list, { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames })
              );
    $: people = ended ? ended.people : state.kind === "withPeople" ? state.people : [];
    $: names = formatPeopleNames(
        people.map((person) => person.name),
        { two: $LL.chat.topRow.twoNames, more: $LL.chat.topRow.moreNames }
    );
    $: ({ title, subtitle, isLive } = ended
        ? {
              title: ended.title,
              subtitle:
                  (ended.isArea ? $LL.chat.session.meetingTag() : $LL.chat.session.proximityTag()) +
                  (ended.endedAt
                      ? $LL.chat.topRow.separator() +
                        $LL.chat.session.endedAt({ time: sentLabel(new Date(ended.endedAt), $locale) })
                      : ""),
              isLive: false,
          }
        : nearbyTitleLines(state, names, $LL));

    function close() {
        openRoomDetailsIdStore.set(undefined);
    }
</script>

<div
    class="nearby-details absolute inset-0 z-[100] flex flex-col"
    data-testid="nearbyDetailsPanel"
    data-chat-layer="panel"
>
    <div class="p-2 flex items-center gap-1 border border-solid border-x-0 border-b border-t-0 border-white/10">
        <button
            type="button"
            class="p-3 text-white hover:bg-white/10 rounded-2xl aspect-square w-12 shrink-0"
            data-testid="nearbyDetailsBack"
            aria-label={$LL.chat.details.title()}
            on:click={close}
        >
            {#if direction === "rtl"}
                <IconChevronRight font-size="20" />
            {:else}
                <IconChevronLeft font-size="20" />
            {/if}
        </button>
        <div class="px-2 text-md font-bold">{$LL.chat.details.title()}</div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div class="flex flex-col items-center gap-1.5 pt-1 text-center">
            <div class="mb-1.5 flex items-center" aria-hidden="true">
                {#if people.length > 0}
                    {#each people.slice(0, MAX_STACKED_AVATARS) as person, index (person.id)}
                        <span class={index === 0 ? "" : "-ms-8"} style:z-index={MAX_STACKED_AVATARS - index}>
                            <TopRowAvatar
                                pictureStore={person.pictureStore}
                                name={person.name}
                                color={$colourOf(person.chatId, person.name)}
                                size="xl"
                            />
                        </span>
                    {/each}
                {:else}
                    <span class="grid h-[88px] w-[88px] place-items-center rounded-full bg-white/10 text-white/70">
                        <IconMessageCircle2 font-size="32" />
                    </span>
                {/if}
            </div>
            <div class="max-w-full break-words text-lg font-bold leading-6" data-testid="nearbyDetailsName">
                {title}
            </div>
            <div class="flex max-w-full items-center gap-1.5 text-xs text-white/60">
                {#if isLive}
                    <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden="true" />
                {/if}
                <span class="truncate">{subtitle}</span>
            </div>
        </div>

        <ArtifactsSummary {room} />

        <SharedSummary {room} note={$LL.chat.details.keptOnAccount()} />

        <div class="details-group" data-testid="nearbyDetailsHereNow">
            <div class="details-heading">
                {ended ? $LL.chat.session.youWereWith() : $LL.chat.details.hereNow()} · {people.length}
            </div>
            {#each people as person (person.id)}
                <div class="u-menu-row !m-0 cursor-default">
                    <TopRowAvatar
                        pictureStore={person.pictureStore}
                        name={person.name}
                        color={$colourOf(person.chatId, person.name)}
                        ring={false}
                    />
                    <span class="u-menu-label truncate">{person.name}</span>
                </div>
            {:else}
                <p class="m-0 px-2 pb-2 pt-1 text-sm text-white/60">{subtitle}</p>
            {/each}
        </div>
    </div>
</div>

<style>
    .details-group {
        display: flex;
        flex-direction: column;
        gap: 2px;
        padding: 4px;
        border-radius: 14px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .details-heading {
        padding: 0.4rem 0.5rem 0.2rem;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.55);
    }
</style>
