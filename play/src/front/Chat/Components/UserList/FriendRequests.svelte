<script lang="ts">
    import type { FriendRequest } from "@workadventure/messages";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import FriendAvatar from "./FriendAvatar.svelte";
    import FriendMenuButton from "./FriendMenuButton.svelte";
    import { relativeTime } from "./Friends";
    import { runFriendAction } from "./FriendActions";
    import { IconCheck, IconForbid } from "@wa-icons";

    /**
     * The Requests view: requests waiting for you, as cards with Accept and Not now (Block under ⋮), what being
     * friends shares, then the ones you sent, which you can cancel. "Not now" tells the sender nothing.
     */
    export let incoming: FriendRequest[];
    export let outgoing: FriendRequest[];
    export let query = "";

    let busy = new Set<string>();

    function matches(request: FriendRequest): boolean {
        return query === "" || request.name.toLocaleLowerCase().includes(query);
    }

    $: incomingShown = incoming.filter(matches);
    $: outgoingShown = outgoing.filter(matches);

    async function act(request: FriendRequest, action: "accept" | "ignore" | "cancel" | "block") {
        busy = new Set(busy).add(request.uuid);
        await runFriendAction(request.uuid, request.name, action);
        busy.delete(request.uuid);
        busy = new Set(busy);
    }

    function detail(request: FriendRequest): string {
        if (request.sharedWorld) return $LL.chat.friends.sharedWorld({ world: request.sharedWorld });
        return $LL.chat.friends.wantsToBeFriends();
    }
</script>

<div class="flex flex-col" data-testid="friendRequests">
    {#if incomingShown.length > 0}
        <h3 class="m-0 flex h-11 items-center gap-2.5 px-4 text-sm font-bold">
            <span class="u-eyebrow truncate">{$LL.chat.friends.waitingForYou()}</span>
            <span class="u-count shrink-0">{incomingShown.length}</span>
        </h3>
        <ul class="m-0 flex list-none flex-col gap-2 px-2 pb-2">
            {#each incomingShown as request (request.uuid)}
                <li
                    class="flex flex-col gap-2 rounded-[14px] border border-solid border-[#8629fc]/30 bg-[#8629fc]/10 p-2.5"
                    data-testid={`incoming-${request.name}`}
                >
                    <div class="flex min-w-0 items-center gap-2">
                        <FriendAvatar />
                        <div class="ms-1 flex min-w-0 flex-col">
                            <span class="truncate text-sm font-bold">{request.name}</span>
                            <span class="truncate text-xs text-white/70">{detail(request)}</span>
                        </div>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button
                            type="button"
                            class="u-cta m-0 flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-sm font-bold text-white disabled:opacity-60"
                            aria-label={$LL.chat.friends.acceptFrom({ userName: request.name })}
                            disabled={busy.has(request.uuid)}
                            data-testid={`accept-${request.name}`}
                            on:click={() => act(request, "accept")}
                        >
                            <IconCheck font-size="16" />
                            {$LL.chat.friends.accept()}
                        </button>
                        <button
                            type="button"
                            class="u-cta-secondary m-0 flex h-9 min-w-0 flex-1 items-center justify-center rounded-full px-3 text-sm font-bold text-white disabled:opacity-60"
                            aria-label={$LL.chat.friends.notNowFrom({ userName: request.name })}
                            disabled={busy.has(request.uuid)}
                            data-testid={`not-now-${request.name}`}
                            on:click={() => act(request, "ignore")}
                        >
                            {$LL.chat.friends.notNow()}
                        </button>
                        <FriendMenuButton
                            label={$LL.chat.userList.moreActions({ userName: request.name })}
                            items={[
                                {
                                    key: "block",
                                    label: $LL.chat.friends.block(),
                                    icon: IconForbid,
                                    danger: true,
                                    act: () => act(request, "block"),
                                },
                            ]}
                        />
                    </div>
                </li>
            {/each}
        </ul>
        <p class="m-0 px-4 pb-3 text-xs text-white/60">{$LL.chat.friends.requestsExplainer()}</p>
    {/if}

    {#if outgoingShown.length > 0}
        <h3 class="m-0 flex h-11 items-center gap-2.5 px-4 text-sm font-bold">
            <span class="u-eyebrow truncate">{$LL.chat.friends.youSent()}</span>
            <span class="u-count shrink-0">{outgoingShown.length}</span>
        </h3>
        <ul class="m-0 flex list-none flex-col p-0 pb-2">
            {#each outgoingShown as request (request.uuid)}
                <li class="flex items-center gap-2 px-4 py-2" data-testid={`outgoing-${request.name}`}>
                    <FriendAvatar />
                    <div class="ms-1 flex min-w-0 flex-auto flex-col">
                        <span class="truncate text-sm font-bold">{request.name}</span>
                        <span class="truncate text-xs text-white/60"
                            >{$LL.chat.friends.sent({ when: relativeTime(request.at, Date.now(), $locale) })}</span
                        >
                    </div>
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-bold text-white disabled:opacity-60"
                        aria-label={$LL.chat.friends.cancelTo({ userName: request.name })}
                        disabled={busy.has(request.uuid)}
                        data-testid={`cancel-${request.name}`}
                        on:click={() => act(request, "cancel")}
                    >
                        {$LL.chat.friends.cancel()}
                    </button>
                </li>
            {/each}
        </ul>
    {/if}

    {#if incomingShown.length === 0 && outgoingShown.length === 0}
        <p class="m-0 px-4 py-6 text-center text-sm text-white/50">{$LL.chat.friends.noRequests()}</p>
    {/if}
</div>
