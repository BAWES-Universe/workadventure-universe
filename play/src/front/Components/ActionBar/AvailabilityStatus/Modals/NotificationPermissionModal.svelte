<script lang="ts">
    import type { ConfirmationModalPropsInterface } from "../Interfaces/ConfirmationModalPropsInterface";
    import LL from "../../../../../i18n/i18n-svelte";
    import { helpNotificationSettingsVisibleStore } from "../../../../Stores/HelpSettingsStore";
    import { localUserStore } from "../../../../Connection/LocalUserStore";
    import { popupStore } from "../../../../Stores/PopupStore";
    import ConfirmationModal from "./ConfirmationModal.svelte";
    import { IconBell } from "@wa-icons";

    let loading = false;

    const confirmationModalProps: ConfirmationModalPropsInterface = {
        handleAccept: () => {
            if (!("Notification" in window)) {
                popupStore.removePopup("notification_permission_modal");
                return;
            }
            loading = true;
            Notification.requestPermission()
                .then((response) => {
                    if (response === "granted") {
                        localUserStore.setNotification(true);
                        helpNotificationSettingsVisibleStore.set(false);
                    } else {
                        console.error("Notification permission status: ", response);
                        helpNotificationSettingsVisibleStore.set(true);
                    }
                })
                .catch((e) => {
                    console.error(e);
                })
                .finally(() => {
                    popupStore.removePopup("notification_permission_modal");
                    loading = false;
                });
        },
        handleClose: () => {
            popupStore.removePopup("notification_permission_modal");
        },
        acceptLabel: $LL.statusModal.turnOn(),
        closeLabel: $LL.statusModal.notNow(),
    };
</script>

<ConfirmationModal props={confirmationModalProps} title={$LL.statusModal.allowNotification()}>
    <IconBell slot="icon" font-size="22" />
    <div id="notificationPermission" class="text-sm leading-5 text-white/80">
        {$LL.statusModal.allowNotificationExplanation()}
    </div>
    {#if loading}
        <div class="absolute inset-0 bg-black/50 flex items-center justify-center">
            <div
                style="border-top-color:transparent"
                class="w-16 h-16 border-2 border-white border-solid rounded-full animate-spin mb-5"
            />
        </div>
    {/if}
</ConfirmationModal>
