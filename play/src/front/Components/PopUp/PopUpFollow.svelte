<script lang="ts">
    import { FOLLOW_REQUEST_TIMEOUT_MS } from "@workadventure/shared-utils";
    import type { FollowAnswer, FollowNote } from "../../Stores/FollowStore";
    import {
        acceptFollowRequest,
        endFollow,
        followAskedStore,
        followNameOf,
        followNoteStore,
        followRequestStartedAtStore,
        followRoleStore,
        followStateStore,
        followStopAskedStore,
        followUsersStore,
    } from "../../Stores/FollowStore";
    import LL from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import FollowWoka from "./FollowWoka.svelte";

    function name(userId: number | undefined): string {
        if (userId === undefined) {
            return "";
        }
        return gameManager.getCurrentGameScene().MapPlayersByKey.get(userId)?.playerName || followNameOf(userId);
    }

    function onKeyDown(e: KeyboardEvent) {
        // Escape answers "Not now", cancels the request, or stops a follow already going.
        if (e.key === "Escape" && $followStateStore !== "off") {
            endFollow();
        }
    }

    function noteText(note: FollowNote): string {
        const person = note.person ? name(note.person.userId) || note.person.name : "";
        switch (note.kind) {
            case "saidNo":
                return $LL.follow.notes.saidNo({ name: person });
            case "noAnswer":
                return $LL.follow.notes.noAnswer({ name: person });
            case "nobodySaidYes":
                return $LL.follow.notes.nobodySaidYes();
            case "cancelled":
                return $LL.follow.notes.cancelled({ leader: person });
            case "stoppedLeading":
                return $LL.follow.notes.stoppedLeading({ leader: person });
            case "timedOut":
                return $LL.follow.notes.timedOut();
        }
    }

    function answerText(answer: FollowAnswer): string {
        switch (answer) {
            case "waiting":
                return $LL.follow.request.state.waiting();
            case "following":
                return $LL.follow.request.state.following();
            case "declined":
                return $LL.follow.request.state.declined();
        }
    }

    // The bar empties over the 30 seconds to answer, from wherever it is when the card appears.
    $: remainingMs =
        $followRequestStartedAtStore === undefined
            ? 0
            : Math.max(0, $followRequestStartedAtStore + FOLLOW_REQUEST_TIMEOUT_MS - Date.now());

    $: isLeader = $followRoleStore === "leader";
    $: leader = isLeader ? undefined : $followUsersStore[0];
    $: several = $followAskedStore.length > 1;
    $: followingText =
        $followUsersStore.length === 1
            ? $LL.follow.interactStatus.followed.one({ follower: name($followUsersStore[0]) })
            : $followUsersStore.length === 2
            ? $LL.follow.interactStatus.followed.two({
                  firstFollower: name($followUsersStore[0]),
                  secondFollower: name($followUsersStore[1]),
              })
            : $LL.follow.interactStatus.followed.many({
                  followers: $followUsersStore.slice(0, -1).map(name).join(", "),
                  lastFollower: name($followUsersStore[$followUsersStore.length - 1]),
              });
</script>

<svelte:window on:keydown={onKeyDown} />

<div class="follow-popup flex w-full justify-center text-white">
    {#if $followStateStore === "requesting"}
        <!-- The card: the leader waiting for answers, or the question to the one asked. -->
        <div
            class="u-surface pointer-events-auto w-full mobile:mx-1 sm:w-[400px] overflow-hidden rounded-2xl text-start"
            role="dialog"
            aria-labelledby="follow-card-title"
            data-testid="follow-card"
        >
            {#if isLeader}
                <div class="flex items-center gap-3 px-4 pt-3.5 {several ? 'pb-2' : 'pb-3'}">
                    {#if $followAskedStore.length === 1}
                        <FollowWoka userId={$followAskedStore[0].userId} />
                    {/if}
                    <div class="min-w-0">
                        <p id="follow-card-title" class="m-0 text-base font-semibold normal-case leading-[22px]">
                            {#if $followAskedStore.length === 1}
                                {$LL.follow.request.titleOne({
                                    name: name($followAskedStore[0].userId) || $followAskedStore[0].name,
                                })}
                            {:else if several}
                                {$LL.follow.request.titleMany({ count: $followAskedStore.length })}
                            {:else}
                                {$LL.follow.interactStatus.waitingFollowers()}
                            {/if}
                        </p>
                        <p class="follow-muted m-0 mt-0.5 text-[13px] leading-[18px]">
                            {several ? $LL.follow.request.anyone() : $LL.follow.request.waiting()}
                        </p>
                    </div>
                </div>
                {#if several}
                    <ul class="m-0 list-none px-4 pb-2.5" data-testid="follow-asked-list">
                        {#each $followAskedStore as person (person.userId)}
                            <li
                                class="flex items-center gap-2.5 border-0 border-t border-solid border-white/[0.06] py-2 text-sm"
                            >
                                <FollowWoka userId={person.userId} small />
                                <span class="min-w-0 flex-1 truncate">{name(person.userId) || person.name}</span>
                                <span
                                    class="flex-none text-xs follow-answer-{person.answer}"
                                    data-testid="follow-answer-{person.answer}">{answerText(person.answer)}</span
                                >
                            </li>
                        {/each}
                    </ul>
                {/if}
            {:else}
                <div class="flex items-center gap-3 px-4 pb-3 pt-3.5">
                    {#if leader !== undefined}
                        <FollowWoka userId={leader} />
                    {/if}
                    <div class="min-w-0">
                        <p id="follow-card-title" class="m-0 text-base font-semibold normal-case leading-[22px]">
                            {$LL.follow.question.title({ leader: name(leader) })}
                        </p>
                        <p class="follow-muted m-0 mt-0.5 text-[13px] leading-[18px]">
                            {$LL.follow.question.desc({ leader: name(leader) })}
                        </p>
                    </div>
                </div>
            {/if}

            <div class="mx-4 mb-3 h-[3px] overflow-hidden rounded-sm bg-white/[0.08]" aria-hidden="true">
                {#key $followRequestStartedAtStore}
                    <i
                        class="follow-countdown block h-full origin-left rtl:origin-right"
                        style="--follow-from: {remainingMs / FOLLOW_REQUEST_TIMEOUT_MS}; --follow-ms: {remainingMs}ms;"
                    />
                {/key}
            </div>

            <div class="flex gap-2 px-3 pb-3">
                {#if isLeader}
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold"
                        data-testid="follow-cancel"
                        on:click={endFollow}>{$LL.follow.request.cancel()}</button
                    >
                {:else}
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold"
                        data-testid="follow-decline"
                        on:click={endFollow}>{$LL.follow.question.notNow()}</button
                    >
                    <button
                        type="button"
                        class="u-cta m-0 flex h-11 flex-1 items-center justify-center rounded-full px-4 text-sm font-bold"
                        data-testid="follow-accept"
                        on:click={acceptFollowRequest}>{$LL.follow.question.follow()}</button
                    >
                {/if}
            </div>
        </div>
    {:else if $followStateStore === "active"}
        <!-- Leading or following: a small pill, so the map stays clear. Stop ends it (for everyone, for a leader). -->
        <div
            class="u-surface pointer-events-auto flex min-w-0 max-w-full items-center gap-2.5 rounded-full py-1.5 pe-1.5 ps-2 text-sm font-semibold"
            data-testid="follow-pill"
        >
            {#if isLeader}
                {#if $followUsersStore.length > 0}
                    <FollowWoka userId={$followUsersStore[0]} small />
                {/if}
                {#if !$followStopAskedStore}
                    <span class="min-w-0 truncate">{followingText}</span>
                {/if}
            {:else}
                {#if leader !== undefined}
                    <FollowWoka userId={leader} small />
                {/if}
                {#if !$followStopAskedStore}
                    <span class="min-w-0 truncate">{$LL.follow.interactStatus.following({ leader: name(leader) })}</span
                    >
                {/if}
            {/if}
            {#if $followStopAskedStore}
                <!-- F during a follow asks first, as it used to. -->
                <span class="min-w-0 truncate" data-testid="follow-stop-question"
                    >{isLeader
                        ? $LL.follow.interactMenu.stop.leader()
                        : $LL.follow.interactMenu.stop.follower({ leader: name(leader) })}</span
                >
                <button
                    type="button"
                    class="u-cta-secondary m-0 flex h-8 flex-none items-center rounded-full px-3.5 text-[13px] font-bold"
                    data-testid="follow-stop-no"
                    on:click={() => followStopAskedStore.set(false)}>{$LL.follow.interactMenu.no()}</button
                >
                <button
                    type="button"
                    class="u-cta m-0 flex h-8 flex-none items-center rounded-full px-3.5 text-[13px] font-bold"
                    data-testid="follow-stop-yes"
                    on:click={endFollow}>{$LL.follow.interactMenu.yes()}</button
                >
            {:else}
                <button
                    type="button"
                    class="u-cta-secondary m-0 flex h-8 flex-none items-center rounded-full px-3.5 text-[13px] font-bold"
                    data-testid="follow-stop"
                    on:click={endFollow}>{$LL.follow.stop()}</button
                >
            {/if}
        </div>
    {:else if $followNoteStore}
        <!-- How it ended, for three seconds. -->
        <div
            class="u-surface flex min-w-0 max-w-full items-center gap-2.5 rounded-full py-2.5 pe-4 {$followNoteStore.person
                ? 'ps-2.5'
                : 'ps-4'} text-sm"
            role="status"
            data-testid="follow-note"
        >
            {#if $followNoteStore.person}
                <FollowWoka userId={$followNoteStore.person.userId} small />
            {/if}
            <span class="min-w-0 truncate">{noteText($followNoteStore)}</span>
        </div>
    {/if}
</div>

<style>
    .follow-muted {
        color: #b9b3d1;
    }
    .follow-answer-waiting {
        color: #b9b3d1;
    }
    .follow-answer-following {
        color: #86efac;
    }
    .follow-answer-declined {
        color: #fca5a5;
    }
    .follow-countdown {
        background: linear-gradient(90deg, #8629fc, #4156f6);
        transform: scaleX(0);
        animation: follow-countdown var(--follow-ms) linear forwards;
    }
    @keyframes follow-countdown {
        from {
            transform: scaleX(var(--follow-from));
        }
        to {
            transform: scaleX(0);
        }
    }
</style>
