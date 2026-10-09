<script lang="ts">
    import { openModal } from "svelte-modals";
    import { userIsConnected } from "../../Stores/MenuStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import SettingSwitch from "./Settings/SettingSwitch.svelte";
    import resetKeyStorageConfirmationModal from "./ResetKeyStorageConfirmationModal.svelte";

    let chatSounds: boolean = localUserStore.getChatSounds();
    let mychatID = localUserStore.getChatId();

    function changeChatSounds() {
        localUserStore.setChatSounds(chatSounds);
    }

    function openResetKeyStorage() {
        openModal(resetKeyStorageConfirmationModal);
    }
</script>

<!-- Chat: plain rows like the other settings pages. -->
<div class="u-set-section" data-testid="settings-chat">
    {#if gameManager.getCurrentGameScene().room.isChatEnabled}
        {#if $userIsConnected}
            <div class="u-set-row" style="cursor: default">
                <span class="u-set-text">
                    <span class="u-set-label">{$LL.menu.chat.matrixIDLabel()}</span>
                    <span class="u-set-hint select-all break-all">{mychatID}</span>
                </span>
            </div>
            <SettingSwitch
                id="chatSounds"
                label={$LL.menu.settings.chatSounds()}
                bind:checked={chatSounds}
                onChange={changeChatSounds}
            />
            <button type="button" class="u-set-row u-set-danger" on:click={openResetKeyStorage}>
                <span class="u-set-text"
                    ><span class="u-set-label">{$LL.menu.chat.resetKeyStorageUpButtonLabel()}</span></span
                >
            </button>
        {:else}
            <div class="u-set-row" style="cursor: default">
                <span class="u-set-text"><span class="u-set-hint">{$LL.chat.requiresLoginForChat()}</span></span>
            </div>
            <a class="u-set-row u-set-link" href="/login" on:click={() => analyticsClient.login()}>
                <span class="u-set-text"><span class="u-set-label">{$LL.menu.profile.login()}</span></span>
            </a>
        {/if}
    {/if}
</div>
