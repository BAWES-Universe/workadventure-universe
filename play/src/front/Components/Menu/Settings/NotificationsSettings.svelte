<script lang="ts">
    import { onMount } from "svelte";
    import { LL, locale } from "../../../../i18n/i18n-svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import { installApp } from "../../../Install/InstallWiring";
    import { currentInstallEnvironment } from "../../../Install/InstallPlatform";
    import { blockedSteps } from "../../../Notification/Push/NotificationCardState";
    import {
        BROWSER_NAMES,
        describeDevice,
        pushAvailability,
        refreshThisDevice,
        subscribeThisDevice,
        thisDeviceIdStore,
        thisDeviceStateStore,
        turnOffThisDevice,
        turnOnThisDevice,
        updateThisDeviceState,
    } from "../../../Notification/Push/PushDevice";
    import type { DmSource, PushDeviceView, PushSettings } from "../../../Notification/Push/PushSettings";
    import {
        lastNotifiedLabel,
        QUIET_HOURS_CHOICES,
        quietHoursLabel,
        quietHoursValue,
    } from "../../../Notification/Push/PushSettings";
    import { raceTimeout } from "../../../Utils/PromiseUtils";
    import SettingSection from "./SettingSection.svelte";
    import SettingSwitch from "./SettingSwitch.svelte";
    import SettingChoice from "./SettingChoice.svelte";

    /**
     * Settings > Notifications (#863, approved mock v4): this device's own switch (or the steps to unblock it, or the
     * Home Screen way on an iPhone tab), what to be notified about, from whom and how, and the devices that get them.
     * What and who are saved in Orbit for the account; the switch is this browser's alone. Guests only have the switch,
     * for notifications while Universe is open.
     */
    export let openChoice: string | undefined;
    export let onToggleChoice: (id: string) => void;

    const signedIn = localUserStore.isLogged();
    const availability = pushAvailability();
    const device = describeDevice(currentInstallEnvironment());
    const deviceWord =
        device.os === "iphone" ? "iPhone" : device.os === "ipad" ? "iPad" : $LL.notification.push.device[device.kind]();
    const steps = blockedSteps(device);
    const REFRESH_WAIT_MS = 5000;

    let settings: PushSettings | undefined;
    let devices: PushDeviceView[] = [];
    /**
     * True once Orbit says it sends notifications while Universe is closed. Until then, and on a server without them,
     * the switch is for the open window only.
     */
    let pushSetUp = false;
    let loadFailed = false;
    let saveFailed = false;
    let switchFailed = false;
    let ignoreFollowRequests = localUserStore.getIgnoreFollowRequests();
    let deviceOn = $thisDeviceStateStore === "on";

    $: words = $LL.notification.push.settings;
    $: deviceHint = signedIn && pushSetUp && availability === "ready" ? words.deviceHint() : words.deviceHintOpenOnly();

    onMount(() => {
        updateThisDeviceState();
        if (!signedIn) return;
        // Saves this browser again first where it is on, so it is listed and known as This device. A browser that
        // takes too long to subscribe doesn't hold the rest of the section back.
        raceTimeout(refreshThisDevice(), REFRESH_WAIT_MS)
            .catch((error) => console.warn("Notifications: this device could not be saved again", error))
            .then(() => botApiService.getPushOverview())
            .then((overview) => {
                // No Orbit on this server: only the switch, for the open window
                if (overview === null) return;
                if (!overview) {
                    loadFailed = true;
                    return;
                }
                settings = overview.settings;
                confirmed = overview.settings;
                devices = overview.devices;
                pushSetUp = overview.publicKey !== null;
            })
            .catch((error) => {
                console.error("Notifications: could not load the settings", error);
                loadFailed = true;
            });
    });

    $: deviceOn = $thisDeviceStateStore === "on";

    function changeDevice() {
        switchFailed = false;
        analyticsClient.settingNotification(deviceOn ? "true" : "false");
        if (!deviceOn) {
            turnOffThisDevice($thisDeviceIdStore, false).catch((error) => console.error(error));
            return;
        }
        if (Notification.permission === "granted") {
            localUserStore.setNotification(true);
            updateThisDeviceState();
            subscribeThisDevice()
                .then(enableThisDevice)
                .catch((error) => {
                    console.error(error);
                    return false;
                })
                .then((on) => {
                    if (!on) couldNotTurnOn();
                })
                .catch(() => undefined);
            return;
        }
        // Straight from the tap: Safari and Firefox open their box only then.
        turnOnThisDevice()
            .then(async (result) => {
                if (result === "on") {
                    if (!(await enableThisDevice("saved"))) couldNotTurnOn();
                    return;
                }
                if (result === "failed") switchFailed = true;
                deviceOn = false;
            })
            .catch((error) => console.error(error));
    }

    /**
     * A device switched off before keeps that in Orbit when saved again: switching it on here says so. False when
     * Orbit has not got it on.
     */
    async function enableThisDevice(result: "saved" | "notSetUp" | "failed"): Promise<boolean> {
        if (result === "failed") return false;
        const id = $thisDeviceIdStore;
        // Switched off again while this was on its way: Off stands, Orbit is not told On
        if (!localUserStore.getNotification()) return true;
        // Not in Orbit (this server sends none while Universe is closed, or a guest, who may still hold the id of an
        // earlier session): on in the open window only
        if (result === "notSetUp" || !signedIn || !id) return true;
        if (!(await botApiService.setPushDeviceEnabled(id, true))) return false;
        await reloadDevices();
        return true;
    }

    /** Orbit could not be reached: the switch goes back to off, and says so. */
    function couldNotTurnOn() {
        localUserStore.setNotification(false);
        updateThisDeviceState();
        deviceOn = false;
        switchFailed = true;
    }

    async function reloadDevices() {
        const overview = await botApiService.getPushOverview();
        if (overview) devices = overview.devices;
    }

    // Shown at once, and put back to what Orbit last confirmed if it refuses. Only the latest save may write back.
    let latestSave = 0;
    let confirmed: PushSettings | undefined;
    async function save(change: Partial<PushSettings>) {
        if (!settings) return;
        const request = ++latestSave;
        settings = { ...settings, ...change };
        saveFailed = false;
        const saved = await botApiService.updatePushSettings(change);
        if (saved) confirmed = saved;
        if (request !== latestSave || !confirmed) return;
        show(confirmed);
        saveFailed = !saved;
    }

    function show(value: PushSettings) {
        settings = value;
    }

    function toggle(
        key: "directMessages" | "friendRequests" | "memberships" | "friendInRoom" | "friendLive" | "previews"
    ) {
        if (!settings) return;
        save({ [key]: !settings[key] }).catch((error) => console.error(error));
    }

    $: dmFromOptions = [
        { value: "friends_members", label: words.dmFromFriendsMembers(), hint: words.dmFromFriendsMembersHint() },
        { value: "friends", label: words.dmFromFriends() },
        { value: "anyone", label: words.dmFromAnyone(), hint: words.dmFromAnyoneHint() },
    ];

    function selectDmFrom(value: string) {
        onToggleChoice("notifications-dm-from");
        save({ dmFrom: value as DmSource }).catch((error) => console.error(error));
    }

    $: quietHoursOptions = [
        { value: "off", label: words.quietHoursOff() },
        ...QUIET_HOURS_CHOICES.map((choice) => ({
            value: `${choice.start}-${choice.end}`,
            label: quietHoursLabel(choice.start, choice.end, $locale),
        })),
    ];

    function selectQuietHours(value: string) {
        onToggleChoice("notifications-quiet-hours");
        const choice = QUIET_HOURS_CHOICES.find((option) => `${option.start}-${option.end}` === value);
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        save({ quietHours: choice ? { ...choice, timeZone } : null }).catch((error) => console.error(error));
    }

    function changeIgnoreFollowRequests() {
        analyticsClient.settingRequestFollow(ignoreFollowRequests ? "true" : "false");
        localUserStore.setIgnoreFollowRequests(ignoreFollowRequests);
    }

    function removeDevice(target: PushDeviceView) {
        devices = devices.filter((listed) => listed.id !== target.id);
        const removing =
            target.id === $thisDeviceIdStore
                ? turnOffThisDevice(target.id, true)
                : botApiService.removePushDevice(target.id).then((removed) => {
                      if (!removed) throw new Error("Orbit did not remove the device");
                  });
        removing.catch((error) => {
            console.error("Notifications: could not remove the device", error);
            reloadDevices().catch(() => undefined);
        });
    }

    function deviceLine(listed: PushDeviceView): string {
        if (listed.id === $thisDeviceIdStore) return words.thisDeviceRow();
        if (!listed.enabled) return words.deviceOff();
        if (!listed.lastNotifiedAt) return words.noNotificationYet();
        return words.lastNotified({ when: lastNotifiedLabel(listed.lastNotifiedAt, Date.now(), $locale) });
    }

    function addToHomeScreen() {
        installApp.install("menu").catch((error) => console.error(error));
    }
</script>

<div class="u-set-col">
    <SettingSection title={words.thisDevice()}>
        {#if availability === "iphone-tab"}
            <div class="u-set-row u-set-notice">
                <span class="u-set-text">
                    <span class="u-set-label">{$LL.notification.push.iphone.title({ device: deviceWord })}</span>
                    <span class="u-set-hint">{$LL.notification.push.iphone.body({ device: deviceWord })}</span>
                </span>
            </div>
            <div class="u-set-row">
                <button
                    type="button"
                    class="u-cta h-11 w-full m-0 px-4 rounded-full justify-center text-sm font-bold"
                    on:click={addToHomeScreen}
                >
                    {$LL.notification.push.iphone.addToHomeScreen()}
                </button>
            </div>
        {:else if availability === "unsupported" && typeof Notification === "undefined"}
            <p class="u-set-hint m-0 px-4 py-2">{words.unsupported()}</p>
        {:else if $thisDeviceStateStore === "blocked"}
            <div class="u-set-row u-set-notice" data-testid="notifications-blocked">
                <span class="u-set-text">
                    <span class="u-set-label">
                        {device.installed
                            ? words.blockedAppTitle()
                            : words.blockedTitle({ browser: BROWSER_NAMES[device.browser] })}
                    </span>
                    <span class="u-set-hint">{words.blockedBody()}</span>
                </span>
            </div>
            <ol class="u-set-steps">
                {#each steps as step (step.key)}
                    <li>{$LL.notification.push.blocked.steps[step.group][step.key]()}</li>
                {/each}
            </ol>
        {:else}
            <SettingSwitch
                id="notification-toggle"
                label={words.deviceSwitch()}
                hint={deviceHint}
                bind:checked={deviceOn}
                onChange={changeDevice}
            />
            {#if switchFailed}
                <p class="u-set-hint m-0 px-4 pb-2" role="status">{words.failed()}</p>
            {/if}
        {/if}
    </SettingSection>

    {#if settings}
        <SettingSection title={words.notifyMeAbout()}>
            <SettingSwitch
                id="notify-direct-messages"
                label={words.directMessages()}
                hint={words.directMessagesHint()}
                checked={settings.directMessages}
                onChange={() => toggle("directMessages")}
            />
            <SettingSwitch
                id="notify-friend-requests"
                label={words.friendRequests()}
                hint={words.friendRequestsHint()}
                checked={settings.friendRequests}
                onChange={() => toggle("friendRequests")}
            />
            <SettingSwitch
                id="notify-memberships"
                label={words.memberships()}
                hint={words.membershipsHint()}
                checked={settings.memberships}
                onChange={() => toggle("memberships")}
            />
            <SettingSwitch
                id="notify-friend-in-room"
                label={words.friendInRoom()}
                hint={words.friendInRoomHint()}
                checked={settings.friendInRoom}
                onChange={() => toggle("friendInRoom")}
            />
            <SettingSwitch
                id="notify-friend-live"
                label={words.friendLive()}
                checked={settings.friendLive}
                onChange={() => toggle("friendLive")}
            />
        </SettingSection>
    {:else if loadFailed}
        <p class="u-set-hint m-0 px-4 py-2">{words.loadFailed()}</p>
    {/if}
</div>

<div class="u-set-col">
    <SettingSection title={words.whoAndHow()}>
        {#if settings}
            <SettingChoice
                id="notifications-dm-from"
                label={words.dmFrom()}
                value={settings.dmFrom}
                options={dmFromOptions}
                open={openChoice === "notifications-dm-from"}
                onToggle={() => onToggleChoice("notifications-dm-from")}
                onSelect={selectDmFrom}
            />
            <SettingSwitch
                id="notify-previews"
                label={words.previews()}
                hint={words.previewsHint()}
                checked={settings.previews}
                onChange={() => toggle("previews")}
            />
            <SettingChoice
                id="notifications-quiet-hours"
                label={words.quietHours()}
                value={quietHoursValue(settings.quietHours)}
                options={quietHoursOptions}
                open={openChoice === "notifications-quiet-hours"}
                onToggle={() => onToggleChoice("notifications-quiet-hours")}
                onSelect={selectQuietHours}
            />
        {/if}
        <SettingSwitch
            id="ignoreFollowRequests-toggle"
            label={$LL.menu.settings.ignoreFollowRequests()}
            bind:checked={ignoreFollowRequests}
            onChange={changeIgnoreFollowRequests}
        />
        {#if saveFailed}
            <p class="u-set-hint m-0 px-4 pb-2" role="status">{words.saveFailed()}</p>
        {/if}
    </SettingSection>

    {#if settings && devices.length > 0}
        <SettingSection title={words.yourDevices()}>
            {#each devices as listed (listed.id)}
                <div class="u-set-row u-set-device" data-testid="notification-device">
                    <span class="u-set-text">
                        <span class="u-set-label">{listed.label}</span>
                        <span class="u-set-hint">{deviceLine(listed)}</span>
                    </span>
                    <button
                        type="button"
                        class="u-set-device-remove"
                        aria-label={words.removeDevice({ device: listed.label })}
                        on:click={() => removeDevice(listed)}
                    >
                        {words.remove()}
                    </button>
                </div>
            {/each}
        </SettingSection>
    {/if}
</div>
