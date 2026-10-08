<script lang="ts">
    import { onMount } from "svelte";
    import type { FriendSettings, FriendSettingsUpdate } from "@workadventure/messages";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { friendsStore } from "../../../Chat/Stores/FriendsStore";
    import { runFriendAction } from "../../../Chat/Components/UserList/FriendActions";
    import SettingSection from "./SettingSection.svelte";
    import SettingSwitch from "./SettingSwitch.svelte";
    import SettingChoice from "./SettingChoice.svelte";

    /**
     * Friends, in the general settings of a signed-in player: who can invite you, who can send friend requests, being
     * found by name, and whether friends see where you are. Saved in Orbit, so they follow you to every world and device.
     * People you blocked are listed underneath, each with Unblock.
     */
    export let open = false;
    export let onToggle: () => void;
    export let onClose: () => void;

    let settings: FriendSettings | undefined;
    let failed = false;
    let saveFailed = false;

    onMount(() => {
        friendsStore
            .settings()
            .then((loaded) => (settings = loaded))
            .catch((e) => {
                console.error("Friends: could not load the settings", e);
                failed = true;
            });
    });

    $: blocked = $friendsStore.status === "signedOut" ? [] : $friendsStore.list?.blocked ?? [];

    $: requestOptions = [
        {
            value: "anyone",
            label: $LL.chat.friends.settings.requestsFromAnyone(),
            hint: $LL.chat.friends.settings.requestsFromAnyoneHint(),
        },
        {
            value: "shared_world",
            label: $LL.chat.friends.settings.requestsFromSharedWorld(),
            hint: $LL.chat.friends.settings.requestsFromSharedWorldHint(),
        },
        {
            value: "nobody",
            label: $LL.chat.friends.settings.requestsFromNobody(),
            hint: $LL.chat.friends.settings.requestsFromNobodyHint(),
        },
    ];

    // Shown at once, and put back if Orbit refuses it. Only the latest save may write back.
    let latestSave = 0;
    async function save(update: FriendSettingsUpdate) {
        if (!settings) return;
        const request = ++latestSave;
        const before = settings;
        settings = { ...before, ...(update as Partial<FriendSettings>) };
        saveFailed = false;
        let saved: FriendSettings | undefined;
        try {
            saved = await friendsStore.settings(update);
        } catch (e) {
            console.error("Friends: could not save the settings", e);
            if (request === latestSave) {
                show(before);
                saveFailed = true;
            }
            return;
        }
        if (saved && request === latestSave) show(saved);
    }

    function show(value: FriendSettings) {
        settings = value;
    }

    // The page opens one choice at a time and knows this section as one: which of its two choices is open is ours.
    let which: "ring" | "requests" = "requests";
    function toggle(choice: "ring" | "requests") {
        if (open && which !== choice) {
            which = choice;
            return;
        }
        which = choice;
        onToggle();
    }

    $: ringOptions = [
        {
            value: "friends_and_members",
            label: $LL.chat.friends.settings.ringFromEveryone(),
            hint: $LL.chat.friends.settings.ringFromEveryoneHint(),
        },
        {
            value: "friends",
            label: $LL.chat.friends.settings.ringFromFriends(),
            hint: $LL.chat.friends.settings.ringFromFriendsHint(),
        },
        {
            value: "nobody",
            label: $LL.chat.friends.settings.ringFromNobody(),
            hint: $LL.chat.friends.settings.ringFromNobodyHint(),
        },
    ];

    function selectRingFrom(value: string) {
        onClose();
        save({ ringFrom: value }).catch((e) => console.error(e));
    }

    function selectRequestsFrom(value: string) {
        onClose();
        save({ friendRequestsFrom: value }).catch((e) => console.error(e));
    }
</script>

<SettingSection title={$LL.chat.friends.settings.title()}>
    {#if settings}
        <SettingChoice
            id="friend-ring-from"
            label={$LL.chat.friends.settings.ringFrom()}
            value={settings.ringFrom === "nobody" || settings.ringFrom === "friends"
                ? settings.ringFrom
                : "friends_and_members"}
            options={ringOptions}
            open={open && which === "ring"}
            onToggle={() => toggle("ring")}
            onSelect={selectRingFrom}
        />
        <SettingChoice
            id="friend-requests-from"
            label={$LL.chat.friends.settings.requestsFrom()}
            value={settings.friendRequestsFrom}
            options={requestOptions}
            open={open && which === "requests"}
            onToggle={() => toggle("requests")}
            onSelect={selectRequestsFrom}
        />
        <SettingSwitch
            id="findable-by-name-toggle"
            label={$LL.chat.friends.settings.findable()}
            hint={$LL.chat.friends.settings.findableHint()}
            checked={settings.findableByName}
            onChange={() => settings && save({ findableByName: !settings.findableByName })}
        />
        <SettingSwitch
            id="friends-see-location-toggle"
            label={$LL.chat.friends.settings.seeLocation()}
            hint={$LL.chat.friends.settings.seeLocationHint()}
            checked={settings.friendsSeeLocation}
            onChange={() => settings && save({ friendsSeeLocation: !settings.friendsSeeLocation })}
        />
        {#if saveFailed}
            <p class="u-set-hint m-0 px-4 pb-2" role="status">{$LL.chat.friends.settings.saveFailed()}</p>
        {/if}
    {:else if failed}
        <p class="u-set-hint m-0 px-4 py-2">{$LL.chat.friends.settings.loadFailed()}</p>
    {/if}
    {#if blocked.length > 0}
        <div class="flex flex-col px-4 pt-2 pb-1" data-testid="blockedPeople">
            <span class="u-set-label pb-1">{$LL.chat.friends.blockedPeople()}</span>
            {#each blocked as person (person.uuid)}
                <div class="flex min-h-10 items-center gap-2">
                    <span class="min-w-0 flex-auto truncate text-sm">{person.name}</span>
                    <button
                        type="button"
                        class="u-cta-secondary m-0 flex h-8 shrink-0 items-center rounded-full px-3 text-xs font-bold text-white"
                        aria-label={$LL.chat.friends.unblockUser({ userName: person.name })}
                        on:click={() =>
                            runFriendAction(person.uuid, person.name, "unblock").catch((e) => console.error(e))}
                    >
                        {$LL.chat.friends.unblock()}
                    </button>
                </div>
            {/each}
        </div>
    {/if}
</SettingSection>
