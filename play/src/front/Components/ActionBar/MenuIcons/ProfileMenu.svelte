<script lang="ts">
    import * as Sentry from "@sentry/svelte";
    import { clickOutside } from "svelte-outside";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { onMount, onDestroy, setContext } from "svelte";
    import type { SvelteComponentTyped } from "svelte";
    import type { Readable } from "svelte/store";
    import { derived, get } from "svelte/store";
    import type { AreaData } from "@workadventure/map-editor";
    import { availabilityStatusStore, enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";

    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import type { RightMenuItem } from "../../../Stores/MenuStore";
    import {
        SubMenusInterface,
        userIsConnected,
        adminDashboardActivatedStore,
        openedMenuStore,
        showMenuItem,
        rightActionBarMenuItems,
    } from "../../../Stores/MenuStore";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { ENABLE_OPENID, SENTRY_DSN_FRONT } from "../../../Enum/EnvironmentVariable";
    import Woka from "../../Woka/WokaFromUserId.svelte";
    import Companion from "../../Companion/Companion.svelte";
    import ChevronDownIcon from "../../Icons/ChevronDownIcon.svelte";
    import ProfilIcon from "../../Icons/ProfilIcon.svelte";
    import CamSettingsIcon from "../../Icons/CamSettingsIcon.svelte";
    import SettingsIcon from "../../Icons/SettingsIcon.svelte";
    import XIcon from "../../Icons/XIcon.svelte";
    import MenuBurgerIcon from "../../Icons/MenuBurgerIcon.svelte";
    import DeskIcon from "../../Icons/DeskIcon.svelte";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import { getColorHexOfStatus, getStatusInformation, getStatusLabel } from "../../../Utils/AvailabilityStatus";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import AvailabilityStatusList from "../AvailabilityStatus/AvailabilityStatusList.svelte";
    import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
    import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
    import { LoginScene, LoginSceneName } from "../../../Phaser/Login/LoginScene";
    import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
    import { SelectCharacterScene, SelectCharacterSceneName } from "../../../Phaser/Login/SelectCharacterScene";
    import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
    import { SelectCompanionScene, SelectCompanionSceneName } from "../../../Phaser/Login/SelectCompanionScene";
    import { EnableCameraScene, EnableCameraSceneName } from "../../../Phaser/Login/EnableCameraScene";
    import { createFloatingUiActions } from "../../../Utils/svelte-floatingui";
    import ActionBarButton from "../ActionBarButton.svelte";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { canOpenOrbit, openOrbitMenu } from "../../../external-modules/admin-api/index";
    import ContextualMenuItems from "./ContextualMenuItems.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import { IconBug, IconLogout, IconSearch } from "@wa-icons";

    // The ActionBarButton component is displayed differently in the profile menu.
    // We use the context to decide how to render it.
    setContext("profileMenu", true);
    setContext("inMenu", true);

    let userName = gameManager.getPlayerName() || "";
    let profileButton: HTMLButtonElement;

    // Escape closes the open menu and puts the focus back on its button, so the keyboard picks up where it was.
    function closeOnEscape(event: KeyboardEvent) {
        if (event.key !== "Escape" || $openedMenuStore !== "profileMenu") return;
        event.stopPropagation();
        openedMenuStore.close("profileMenu");
        profileButton?.focus();
    }
    let hasPersonalDesk = false;
    let personalAreaData: AreaData | null = null;
    let isInsidePersonalDesk = false;

    // Check if user has a personal desk and if they're inside it
    function checkPersonalDesk() {
        const userUUID = localUserStore.getLocalUser()?.uuid;
        if (!userUUID) {
            hasPersonalDesk = false;
            personalAreaData = null;
            isInsidePersonalDesk = false;
            return;
        }

        const gameScene = gameManager.getCurrentGameScene();
        if (!gameScene) {
            hasPersonalDesk = false;
            personalAreaData = null;
            isInsidePersonalDesk = false;
            return;
        }

        const gameMapFrontWrapper = gameScene.getGameMapFrontWrapper();
        const personalAreas =
            gameMapFrontWrapper.areasManager?.getAreasByPropertyType("personalAreaPropertyData") ?? [];

        // Find the user's personal area
        for (const area of personalAreas) {
            const property = area.areaData.properties.find((property) => property.type === "personalAreaPropertyData");
            if (property && property.ownerId === userUUID) {
                hasPersonalDesk = true;
                personalAreaData = area.areaData;

                // Check if the current player is inside the personal desk
                const currentPlayer = gameScene.CurrentPlayer;
                if (currentPlayer && personalAreaData) {
                    isInsidePersonalDesk = gameMapFrontWrapper.isInsideAreaByCoordinates(
                        {
                            x: personalAreaData.x,
                            y: personalAreaData.y,
                            width: personalAreaData.width,
                            height: personalAreaData.height,
                        },
                        { x: currentPlayer.x, y: currentPlayer.y }
                    );
                } else {
                    isInsidePersonalDesk = false;
                }
                return;
            }
        }

        hasPersonalDesk = false;
        personalAreaData = null;
        isInsidePersonalDesk = false;
    }

    let checkInterval: ReturnType<typeof setInterval> | null = null;

    // Subscribe to menu state changes
    const unsubscribeOpenedMenuStore = openedMenuStore.subscribe((menuState) => {
        if (checkInterval) clearInterval(checkInterval);
        if (menuState === "profileMenu") {
            // Menu opened - start checking
            checkPersonalDesk();
            // Start checking periodically
            checkInterval = setInterval(() => {
                checkPersonalDesk();
            }, 2000);
        }
    });

    onMount(() => {
        // Check once on mount to set initial state
        checkPersonalDesk();

        // Unsubscribe from the opened menu store
        return () => {
            unsubscribeOpenedMenuStore();
            // Clear the interval
            if (checkInterval) clearInterval(checkInterval);
        };
    });

    onDestroy(() => {
        unsubscribeOpenedMenuStore();
        if (checkInterval) clearInterval(checkInterval);
    });

    const statusToShow: Array<RequestedStatus | AvailabilityStatus.ONLINE> = [
        AvailabilityStatus.ONLINE,
        AvailabilityStatus.BUSY,
        AvailabilityStatus.BACK_IN_A_MOMENT,
        AvailabilityStatus.DO_NOT_DISTURB,
    ];

    function showWokaNameMenuItem() {
        return connectionManager.currentRoom?.opidWokaNamePolicy !== "force_opid";
    }

    function openEditNameScene() {
        loginSceneVisibleStore.set(true);
        gameManager.leaveGame(LoginSceneName, new LoginScene());
    }

    function openEditSkinScene() {
        selectCharacterSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCharacterSceneName, new SelectCharacterScene());
    }

    function openEditCompanionScene() {
        selectCompanionSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCompanionSceneName, new SelectCompanionScene());
    }

    function openEnableCameraScene() {
        enableCameraSceneVisibilityStore.showEnableCameraScene();
        gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
        analyticsClient.editCamera();
    }

    async function openFeedbackScene() {
        // Get the instance returned by `feedbackIntegration()`
        const feedbackIntegrationInstance = Sentry.feedbackIntegration({
            colorScheme: "system",
            showBranding: false,
            enableScreenshot: true,
            formTitle: $LL.actionbar.issueReport.formTitle(),
            emailLabel: $LL.actionbar.issueReport.emailLabel(),
            nameLabel: $LL.actionbar.issueReport.nameLabel(),
            messageLabel: $LL.actionbar.issueReport.descriptionLabel(),
            messagePlaceholder: $LL.actionbar.issueReport.descriptionPlaceholder(),
            submitButtonLabel: $LL.actionbar.issueReport.submitButtonLabel(),
            cancelButtonLabel: $LL.actionbar.issueReport.cancelButtonLabel(),
            confirmButtonLabel: $LL.actionbar.issueReport.confirmButtonLabel(),
            addScreenshotButtonLabel: $LL.actionbar.issueReport.addScreenshotButtonLabel(),
            removeScreenshotButtonLabel: $LL.actionbar.issueReport.removeScreenshotButtonLabel(),
            successMessageText: $LL.actionbar.issueReport.successMessageText(),
            removeHighlightText: $LL.actionbar.issueReport.removeHighlightText(),
            highlightToolText: $LL.actionbar.issueReport.highlightToolText(),
            hideToolText: $LL.actionbar.issueReport.hideToolText(),
            isRequiredLabel: "",
            onFormOpen: () => {
                // Disable the user inputs
                gameManager.getCurrentGameScene().userInputManager.disableControls("store");
                // Close the menu
                openedMenuStore.close("profileMenu");
            },
            onFormClose: () => {
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                // Remove the actor buttom from the DOM
                form?.close();
            },
            onSubmitSuccess: () => {
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                // Remove the actor buttom from the DOM
                form?.close();
            },
        });
        const form = await feedbackIntegrationInstance?.createForm();
        form?.appendToDom();
        form?.open();
    }

    async function goToPersonalDesk() {
        // Close the menu
        openedMenuStore.close("profileMenu");

        // Walk to the personal desk using the GameScene method
        try {
            await gameManager.getCurrentGameScene()?.walkToPersonalDesk();
        } catch (error) {
            console.error("Error while walking to personal desk", error);
            warningMessageStore.addWarningMessage($LL.actionbar.personalDesk.errorMoving(), { closable: true });
        }
    }

    async function unclaimPersonalDesk() {
        if (!personalAreaData) {
            checkPersonalDesk();
            if (!personalAreaData) {
                warningMessageStore.addWarningMessage($LL.actionbar.personalDesk.errorNotFound(), { closable: true });
                return;
            }
        }

        try {
            const gameScene = gameManager.getCurrentGameScene();
            const mapEditorModeManager = gameScene.getMapEditorModeManager();
            if (!mapEditorModeManager) {
                warningMessageStore.addWarningMessage($LL.actionbar.personalDesk.errorUnclaiming(), { closable: true });
                return;
            }
            // Use unclaim personal area method of the map editor mode manager
            await mapEditorModeManager.unclaimPersonalArea(personalAreaData as unknown as AreaData);

            // Update local state to check if the personal desk is unclaimed
            checkPersonalDesk();

            // Send analytics event
            analyticsClient.unclaimPersonalDesk();

            // Close the menu
            openedMenuStore.close("profileMenu");
        } catch (error) {
            console.error("Error while unclaiming personal desk", error);
            warningMessageStore.addWarningMessage($LL.actionbar.personalDesk.errorUnclaiming(), { closable: true });
        }
    }

    const [floatingUiRef, floatingUiContent, arrowAction] = createFloatingUiActions(
        {
            placement: "bottom-end",
        },
        8
    );

    let rightActionBarMenuItemsInBurgerMenu: Readable<RightMenuItem<SvelteComponentTyped>[]> = derived(
        rightActionBarMenuItems,
        ($rightActionBarMenuItems, set) => {
            const theDerived = derived(
                $rightActionBarMenuItems.map((item) => item.fallsInBurgerMenuStore),
                (items) => {
                    //set(items);
                    // Each time we enter here, a fallsInBurgerMenuStore has been updated OR a rightActionBarMenuItems has been updated
                    return items;
                }
            );
            const ghostSubscriptionUnsubscribe = theDerived.subscribe(() => {
                set(get(rightActionBarMenuItems).filter((item) => get(item.fallsInBurgerMenuStore)));
            });
            return () => ghostSubscriptionUnsubscribe();
        }
    );
</script>

<svelte:window on:keydown={closeOnEscape} />

<div data-testid="action-user" class="flex items-center transition-all pointer-events-auto">
    <!-- A real button: Tab reaches it, Enter and Space open the menu, and screen readers announce it. -->
    <button
        type="button"
        class="group profile-button u-surface-flat rounded-xl h-16 @sm/actions:h-14 @xl/actions:h-16 p-2 cursor-pointer text-start"
        aria-label={$LL.menu.icon.open.menu()}
        aria-haspopup="menu"
        aria-expanded={$openedMenuStore === "profileMenu"}
        bind:this={profileButton}
        use:floatingUiRef
        on:click|preventDefault={() => {
            openedMenuStore.toggle("profileMenu");
        }}
    >
        <div
            class="profile-burger h-12 w-12 @sm/actions:h-10 @sm/actions:w-10 @xl/actions:h-12 @xl/actions:w-12 p-1 m-0 items-center justify-center flex @md/actions:hidden"
        >
            {#if $openedMenuStore !== "profileMenu"}
                <!-- pointer-events-none is important for clickOutside to work. Otherwise, the
                     SVG is the target of the click, is removed from the DOM on click and considered to be
                     outside the main div -->
                <MenuBurgerIcon classList="pointer-events-none" />
            {:else}
                <XIcon classList="pointer-events-none" />
            {/if}
        </div>
        <div
            class="profile-pill hidden @md/actions:flex items-center h-full rounded-full transition-colors gap-2 pl-0 pr-3"
        >
            <div
                class="overflow-hidden p-2 flex items-center justify-center rounded-full h-full aspect-square relative"
            >
                <Woka userId={-1} placeholderSrc="" customWidth="30px" />
            </div>
            <div class="grow flex flex-row @xl/actions:flex-col justify-start text-start pr-2">
                <div
                    class="font-bold text-white leading-5 whitespace-nowrap select-none text-base @sm/actions:text-sm @xl/actions:text-base order-last @xl/actions:order-first flex items-center"
                >
                    <!-- Names can be 32 letters long: cut a long one, so the menu never pushes the bar apart. -->
                    <span class="truncate max-w-[11rem]" title={userName}>{userName}</span>
                </div>
                <div class="text-xxs bold whitespace-nowrap select-none flex items-center">
                    <div
                        class="aspect-square h-2 w-2 rounded-full me-1.5"
                        style="background-color: {getColorHexOfStatus($availabilityStatusStore)}"
                    />
                    <div
                        class="hidden @xl/actions:block"
                        style="color: {getColorHexOfStatus($availabilityStatusStore)};filter: brightness(200%);"
                    >
                        {getStatusLabel($availabilityStatusStore)}
                    </div>
                </div>
            </div>
            <div>
                <ChevronDownIcon
                    strokeWidth="2"
                    classList="transition-all opacity-50 {$openedMenuStore === 'profileMenu' ? 'rotate-180' : ''}"
                    height="h-4"
                    width="w-4"
                />
            </div>
        </div>
    </button>
    {#if $openedMenuStore === "profileMenu"}
        <!-- before:content-[''] before:absolute before:w-0 before:h-0 before:-top-[14px] before:right-6 before:border-solid before:border-8 before:border-transparent before:border-b-contrast/80 -->
        <!-- The whole menu stays on screen on a phone, however many items fall into it (logged in, apps, map tools,
             script items): the box is capped to the visible height minus the action bar, and scrolls inside. -->
        <div
            class="profile-menu absolute top-0 left-0 z-10 flex flex-col u-surface rounded-2xl p-1 w-64 max-w-[calc(100vw-10px)] text-white select-none"
            data-testid="profile-menu"
            use:floatingUiContent
            use:clickOutside={() => {
                openedMenuStore.close("profileMenu");
            }}
        >
            <div class="u-surface-arrow" use:arrowAction />
            <div class="profile-menu-scroll p-0 m-0 list-none overflow-y-auto overscroll-contain rounded-[12px]">
                <ExternalComponents zone="menuTop" />
                <AvailabilityStatusList statusInformation={getStatusInformation(statusToShow)} />
                <HeaderMenuItem label={$LL.menu.sub.profile()} />
                {#if showWokaNameMenuItem()}
                    <ActionBarButton
                        label={$LL.actionbar.profil()}
                        chevron
                        on:click={() => {
                            openEditNameScene();
                            analyticsClient.editName();
                        }}
                    >
                        <ProfilIcon />
                    </ActionBarButton>
                {/if}
                <ActionBarButton
                    label={$LL.actionbar.woka()}
                    chevron
                    imageTile
                    on:click={() => {
                        openEditSkinScene();
                        analyticsClient.editWoka();
                    }}
                >
                    <Woka userId={-1} placeholderSrc="" customWidth="32px" />
                </ActionBarButton>
                <ActionBarButton
                    label={$LL.actionbar.companion()}
                    chevron
                    imageTile
                    on:click={() => {
                        openEditCompanionScene();
                        analyticsClient.editCompanion();
                    }}
                >
                    <Companion
                        userId={-1}
                        placeholderSrc="../static/images/default-companion.png"
                        width="32px"
                        height="32px"
                    />
                </ActionBarButton>
                {#if hasPersonalDesk}
                    <ActionBarButton
                        label={$LL.actionbar.personalDesk.label()}
                        on:click={goToPersonalDesk}
                        state={isInsidePersonalDesk ? "disabled" : "normal"}
                        classList="group/btn-personal-desk"
                    >
                        <DeskIcon height="22" width="22" />
                    </ActionBarButton>
                    <ActionBarButton
                        label={$LL.actionbar.personalDesk.unclaim()}
                        on:click={unclaimPersonalDesk}
                        classList="group/btn-personal-desk"
                    >
                        <DeskIcon height="22" width="22" />
                    </ActionBarButton>
                {/if}
                <!--                                <button-->
                <!--                                    class="group flex p-2 gap-2 items-center hover:bg-white/10 transition-all cursor-pointer font-bold text-sm w-full pointer-events-auto text-left rounded"-->
                <!--                                >-->
                <!--                                    <div-->
                <!--                                        class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center"-->
                <!--                                    >-->
                <!--                                        <AchievementIcon />-->
                <!--                                    </div>-->
                <!--                                    <div class="text-left flex items-center">{$LL.actionbar.quest()}</div>-->
                <!--                                </button>-->
                {#if $adminDashboardActivatedStore && canOpenOrbit()}
                    <ActionBarButton
                        label="Menu & search"
                        chevron
                        on:click={() => {
                            if (openOrbitMenu()) openedMenuStore.close("profileMenu");
                        }}
                    >
                        <IconSearch />
                    </ActionBarButton>
                {/if}
                <HeaderMenuItem label={$LL.menu.sub.settings()} />
                <ActionBarButton label={$LL.actionbar.editCamMic()} chevron on:click={openEnableCameraScene}>
                    <CamSettingsIcon />
                </ActionBarButton>

                {#if SENTRY_DSN_FRONT != undefined && connectionManager.currentRoom?.isIssueReportEnabled}
                    <ActionBarButton
                        label={$LL.actionbar.issueReport.menuAction()}
                        chevron
                        on:click={openFeedbackScene}
                    >
                        <IconBug font-size="22" />
                    </ActionBarButton>
                {/if}

                <ActionBarButton
                    label={$LL.actionbar.allSettings()}
                    chevron
                    on:click={() => {
                        showMenuItem(SubMenusInterface.settings);
                        analyticsClient.openedMenu();
                        openedMenuStore.close("profileMenu");
                    }}
                >
                    <SettingsIcon />
                </ActionBarButton>

                <div class="@sm/actions:hidden items-center">
                    <!-- Hidden by CSS when the contextual items render nothing (it is then the only child). -->
                    <div class="u-menu-divider contextual-divider" />
                    <ContextualMenuItems />
                </div>

                <AdditionalMenuItems menu="profileMenu" />

                {#each $rightActionBarMenuItemsInBurgerMenu ?? [] as button (button.id)}
                    <svelte:component this={button.component} {...button.props} />
                {/each}

                {#if ENABLE_OPENID && $userIsConnected}
                    <div class="u-menu-divider" />
                    <button
                        type="button"
                        on:click={() => analyticsClient.logout()}
                        on:click={() => connectionManager.logout()}
                        class="u-menu-row u-danger group pointer-events-auto mb-0"
                    >
                        <span class="u-menu-tile">
                            <IconLogout height="20" width="20" />
                        </span>
                        <span class="u-menu-label">{$LL.menu.profile.logout()}</span>
                    </button>
                {/if}
            </div>
        </div>
    {/if}
</div>

<style>
    /* Never taller than what is visible above (phone) or below (desktop) the action bar: 6rem covers the bar at its
       tallest (16px padding + 64px button), the 8px gap to it and an 8px margin at the far edge. dvh follows the
       phone's browser bars; vh is the fallback for older browsers. */
    .profile-menu {
        max-height: calc(100vh - 6rem);
        max-height: calc(100dvh - 6rem);
    }
    .profile-menu-scroll {
        flex: 1 1 auto;
        min-height: 0;
        -webkit-overflow-scrolling: touch;
    }
    .contextual-divider:last-child {
        display: none;
    }
    /* The name and status light up only where hovering exists; a tap on a phone leaves nothing behind. */
    @media (hover: hover) {
        .group:hover .profile-pill {
            background-color: rgba(255, 255, 255, 0.08);
        }
    }
    /* Pressed (a tap on a phone, a click), and open: the bar's pressed grey, on the round burger or the name pill.
       Open is grey, not the gradient, which means switched on. */
    .profile-burger {
        border-radius: 9999px;
        transition: background-color 150ms ease;
    }
    .profile-button:active .profile-burger,
    .profile-button:active .profile-pill {
        background-color: rgba(255, 255, 255, 0.12);
    }
    .profile-button[aria-expanded="true"] .profile-burger,
    .profile-button[aria-expanded="true"] .profile-pill {
        background-color: rgba(255, 255, 255, 0.14);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
    }
    /* Reached with the keyboard: the same white ring as the bar's other buttons. */
    .profile-button:focus-visible {
        outline: none;
    }
    .profile-button:focus-visible .profile-pill,
    .profile-button:focus-visible .profile-burger {
        border-radius: 9999px;
        box-shadow: inset 0 0 0 2px #fff;
    }
    /* Touch: the same 64px pill as the other controls, whatever the width. */
    @media (pointer: coarse) {
        .profile-button.profile-button {
            height: 4rem;
        }
        .profile-burger.profile-burger {
            height: 3rem;
            width: 3rem;
        }
    }
</style>
