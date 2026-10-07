<script lang="ts">
    import { createEventDispatcher, onDestroy, onMount } from "svelte";
    import type { OpenWebsitePropertyData } from "@workadventure/map-editor";
    import type { KlaxoonEvent } from "@workadventure/shared-utils";
    import {
        CardsException,
        CardsService,
        ExcalidrawException,
        GoogleWorkSpaceException,
        GoogleWorkSpaceService,
        KlaxoonException,
        KlaxoonService,
        MediaLinkManager,
        TldrawException,
        YoutubeService,
        EraserException,
        YoutubeException,
    } from "@workadventure/shared-utils";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import youtubeSvg from "../../images/applications/icon_youtube.svg";
    import klaxoonSvg from "../../images/applications/icon_klaxoon.svg";
    import googleDocsSvg from "../../images/applications/icon_google_docs.svg";
    import googleSheetsSvg from "../../images/applications/icon_google_sheets.svg";
    import googleSlidesSvg from "../../images/applications/icon_google_slides.svg";
    import googleDriveSvg from "../../images/applications/icon_google_drive.svg";
    import eraserSvg from "../../images/applications/icon_eraser.svg";
    import excalidrawSvg from "../../images/applications/icon_excalidraw.svg";
    import cardPng from "../../images/applications/icon_cards.svg";
    import tldrawJpeg from "../../images/applications/icon_tldraw.jpeg";
    import pickerSvg from "../../images/applications/picker.svg";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import { GOOGLE_DRIVE_PICKER_APP_ID, GOOGLE_DRIVE_PICKER_CLIENT_ID } from "../../../Enum/EnvironmentVariable";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import {
        ON_ACTION_TRIGGER_BUTTON,
        ON_ACTION_TRIGGER_ENTER,
        ON_ICON_TRIGGER_BUTTON,
    } from "../../../WebRtc/LayoutManager";
    import USelect from "../../UI/USelect.svelte";
    import PropertyEditorBase from "./PropertyEditorBase.svelte";
    import PanelSwitch from "./PanelSwitch.svelte";
    import PolicyChips from "./PolicyChips.svelte";
    import { IconAlertTriangle, IconLink } from "@wa-icons";

    export let property: OpenWebsitePropertyData;
    export let triggerOnActionChoosen: boolean = property.trigger === ON_ACTION_TRIGGER_BUTTON;
    export let triggerOptionActivated = true;
    export let icon = "resources/icons/icon_link.png";
    export let isArea = false;

    let optionAdvancedActivated = shouldDisplayAdvancedOption();

    let embeddable = true;
    let embeddableLoading = false;
    let error = "";
    let warning = "";
    let oldNewTabValue = property.newTab;
    let isLinkValid = true;
    // The permissions of the iFrame Allow list. Undefined (no list at all) hides the field, as before.
    let policy: string[] | undefined = undefined;
    const policyOptions: string[] = [
        "accelerometer",
        "ambient-light-sensor",
        "autoplay",
        "battery",
        "browsing-topics",
        "camera",
        "document-domain",
        "encrypted-media",
        "execution-while-not-rendered",
        "execution-while-out-of-viewport",
        "fullscreen",
        "gamepad",
        "geolocation",
        "gyroscope",
        "hid",
        "identity-credentials-get",
        "idle-detection",
        "local-fonts",
        "magnetometer",
        "microphone",
        "midi",
        "otp-credentials",
        "payment",
        "picture-in-picture",
        "publickey-credentials-get",
        "screen-wake-lock",
        "serial",
        "speaker-selection",
        "storage-access",
        "usb",
        "web-share",
        "window-management",
        "xr-spatial-tracking",
    ];

    const dispatch = createEventDispatcher<{
        change: string | null | undefined;
        close: undefined;
    }>();

    function shouldDisplayAdvancedOption(): boolean {
        return !!(property.policy || property.allowAPI || !property.closable || property.width || property.newTab);
    }

    // The parameter that determines if the link has already been checked, like if it's embeddable or not.
    // If the link cannot be embedded, we suggest that the user open a new tab automatically.
    let firstCheckLink = false;

    onMount(() => {
        // if the link is not set, try to open the picker
        if (property.link == undefined || property.link === "") {
            firstCheckLink = true; // It will use to set new tab automatically if the link is not embeddable
            openPicker();
        }

        // check if the link is embeddable
        checkWebsiteProperty().catch((e) => {
            console.error("Error checking embeddable website", e);
        });

        // Format policy for the iFrame Allow chips
        policy = property.policy
            ?.split(";")
            .map((value) => value.trim())
            .filter((value) => value !== "");

        if (property.forceNewTab == true) {
            property.newTab = true;
        }
    });

    function onTriggerValueChange() {
        triggerOnActionChoosen = property.trigger === ON_ACTION_TRIGGER_BUTTON;
        dispatch("change");
    }

    function onNewTabValueChange() {
        if (property.newTab) {
            if (property.trigger === ON_ICON_TRIGGER_BUTTON) {
                property.trigger = ON_ACTION_TRIGGER_ENTER;
            }
            // remove embed link
            if (property.link) {
                if (property.application == "googleDocs") {
                    property.link = GoogleWorkSpaceService.getGoogleWorkSpaceBasicUrl(new URL(property.link));
                } else if (property.application == "googleSheets") {
                    property.link = GoogleWorkSpaceService.getGoogleWorkSpaceBasicUrl(new URL(property.link));
                } else if (property.application == "googleSlides") {
                    property.link = GoogleWorkSpaceService.getGoogleWorkSpaceBasicUrl(new URL(property.link));
                } else if (property.application == "klaxoon") {
                    property.link = KlaxoonService.getKlaxoonBasicUrl(new URL(property.link));
                } else if (property.application == "cards") {
                    property.link = CardsService.getCardsLink(new URL(property.link), localUserStore.getAuthToken());
                }
            }
        } else {
            // remove embed link
            if (property.link) {
                if (property.application == "googleDocs") {
                    property.link = GoogleWorkSpaceService.getGoogleDocsEmbedUrl(new URL(property.link));
                } else if (property.application == "googleSheets") {
                    property.link = GoogleWorkSpaceService.getGoogleSheetsEmbedUrl(new URL(property.link));
                } else if (property.application == "googleSlides") {
                    property.link = GoogleWorkSpaceService.getGoogleSlidesEmbedUrl(new URL(property.link));
                } else if (property.application == "klaxoon") {
                    property.link = KlaxoonService.getKlaxoonEmbedUrl(
                        new URL(property.link),
                        connectionManager.klaxoonToolClientId
                    );
                } else if (property.application == "cards") {
                    property.link = CardsService.getCardsLink(new URL(property.link), localUserStore.getAuthToken());
                }
            }
        }
        dispatch("change");
    }

    function onValueChange() {
        dispatch("change", property.link);
    }

    async function checkWebsiteProperty(protocolChecked = false): Promise<void> {
        try {
            if (property.link == undefined || property.link == "") return;
            // if the link is not a website, we don't need to check if it is embeddable
            embeddableLoading = true;
            error = "";
            warning = "";
            try {
                // A pasted link without a scheme (e.g. "youtu.be/ID") is not a valid URL yet: add the scheme first
                if (!/^[a-z][a-z0-9+.-]*:/i.test(property.link.trim())) {
                    property.link = "https://" + property.link.trim();
                }
                const mediaLink = new MediaLinkManager(property.link);

                // Vérify that the link matches with properties
                if (property.application != "website") mediaLink.linkMatchWithApplicationIdOrName(property.application);

                const embedLink = await mediaLink.getEmbedLink({
                    klaxoonId: connectionManager.klaxoonToolClientId,
                    excalidrawDomains: connectionManager.excalidrawToolDomains,
                });
                if (embedLink != property.link) property.link = embedLink;

                if (property.application == "youtube")
                    property.buttonLabel =
                        property.buttonLabel != undefined && property.buttonLabel != ""
                            ? property.buttonLabel
                            : YoutubeService.getTitleFromYoutubeUrl(new URL(property.link)) ??
                              $LL.mapEditor.properties.youtube.label();

                embeddable = true;
                optionAdvancedActivated = false;
                property.newTab = oldNewTabValue;
            } catch (e) {
                if (e instanceof YoutubeException.YoutubeException) error = $LL.mapEditor.properties.youtube.error();
                else if (e instanceof ExcalidrawException.ExcalidrawException)
                    error = $LL.mapEditor.properties.excalidraw.error();
                else if (e instanceof EraserException.EraserLinkException)
                    error = $LL.mapEditor.properties.eraser.error();
                else if (e instanceof KlaxoonException.KlaxoonException)
                    error = $LL.mapEditor.properties.klaxoon.error();
                else if (e instanceof GoogleWorkSpaceException.GoogleSlidesException)
                    error = $LL.mapEditor.properties.googleSlides.error();
                else if (e instanceof GoogleWorkSpaceException.GoogleSheetsException)
                    error = $LL.mapEditor.properties.googleSheets.error();
                else if (e instanceof GoogleWorkSpaceException.GoogleDocsException)
                    error = $LL.mapEditor.properties.googleDocs.error();
                else if (e instanceof CardsException.CardsLinkException) error = $LL.mapEditor.properties.cards.error();
                else if (e instanceof TldrawException.TldrawLinkException)
                    error = $LL.mapEditor.properties.tldraw.error();
                else error = $LL.mapEditor.properties.openWebsite.errorEmbeddableLink();

                embeddable = false;
                property.link = null;
                throw e;
            } finally {
                embeddableLoading = false;
                onValueChange();
            }

            if (property.regexUrl) {
                try {
                    const regexUrl = new URL(property.regexUrl);
                    const regex = new RegExp(property.regexUrl.replace("?", "[?]"), "g");
                    if (property.link.indexOf(regexUrl.host) != -1) {
                        // if property has "targetEmbedableLink" transform the link to embedable link with regex
                        if (property.targetEmbedableUrl) {
                            const matches = regex.exec(property.link);
                            if (matches) {
                                property.link = property.targetEmbedableUrl.replace(/\$[0-9]+/g, (match) => {
                                    const index = parseInt(match.substring(1));
                                    return matches[index] ?? "";
                                });
                            }
                        }
                    } else if (property.targetEmbedableUrl) {
                        const url = new URL(property.link);
                        if (property.targetEmbedableUrl?.indexOf(url.host) == -1) {
                            // If the link exists but is not the same of embedable link target, their is an error
                            error = `${$LL.mapEditor.properties.openWebsite.errorEmbeddableLink()} (${
                                property.regexUrl
                            })`;
                            property.link = null;
                            throw new Error(error);
                        }
                    } else {
                        throw new Error(error);
                    }
                    if (property.forceNewTab == true) {
                        embeddable = false;
                        optionAdvancedActivated = false;
                        property.newTab = true;
                    } else {
                        embeddable = true;
                    }
                } catch (e) {
                    console.info("Error to check embeddable website", e);
                    embeddable = false;
                    error = error ?? $LL.mapEditor.properties.openWebsite.errorInvalidUrl();
                    property.link = null;
                    throw e;
                } finally {
                    embeddableLoading = false;
                    onValueChange();
                }
            }

            if (property.application == "website") {
                if (!protocolChecked) {
                    // if the link is not a website, we don't need to check if it is embeddable

                    if (
                        property.link != undefined &&
                        property.link != "" &&
                        !property.link.startsWith("http://") &&
                        !property.link.startsWith("https://")
                    ) {
                        property.link = "https://" + property.link;
                        embeddableLoading = false;
                        warning = "";
                        onValueChange();
                        setTimeout(() => {
                            checkWebsiteProperty(true).catch((e) => {
                                console.error("Error checking embeddable website", e);
                            });
                        }, 10);
                        return;
                    }
                }
            }

            // allow to check if the link is embeddable
            checkEmbeddableLink();
        } catch (e) {
            console.info("Error checking embeddable website", e);
            embeddableLoading = false;
        }
    }

    function checkEmbeddableLink(): void {
        if (property.forceNewTab) return;
        if (property.link == undefined || !isLinkValid) {
            embeddableLoading = false;
            warning = warning ? warning : $LL.mapEditor.properties.openWebsite.errorInvalidUrl();
            return;
        }

        gameManager
            .getCurrentGameScene()
            .connection?.queryEmbeddableWebsite(property.link)
            .then((answer) => {
                if (answer) {
                    if (answer.message) {
                        warning = answer.message;
                    }
                    if (!answer.state) {
                        throw new Error(answer.message);
                    }
                    embeddable = answer.embeddable;
                    property.newTab = oldNewTabValue;
                    if (answer.embeddable) {
                        if (!oldNewTabValue) {
                            //optionAdvancedActivated = false;
                        }
                    } else {
                        //optionAdvancedActivated = true;
                        if (firstCheckLink) property.newTab = true;
                        embeddable = false;
                    }
                    optionAdvancedActivated = shouldDisplayAdvancedOption();
                }
            })
            .catch((e: unknown) => {
                embeddable = true;
                if (e instanceof Error) {
                    warning = e.message;
                } else {
                    warning = $LL.mapEditor.properties.openWebsite.errorEmbeddableLink();
                }
                console.info("Error checking embeddable website", e);
            })
            .finally(() => {
                embeddableLoading = false;
                onValueChange();
            });
    }

    function onKeyPressed() {
        dispatch("change", property.link);
    }

    function openKlaxoonActivityPicker() {
        if (
            !connectionManager.klaxoonToolClientId ||
            property.type !== "openWebsite" ||
            property.application !== "klaxoon"
        ) {
            console.info("openKlaxoonActivityPicker: app is not a klaxoon app");
            return;
        }
        windowKlaxoonActivityPicker = KlaxoonService.openKlaxoonActivityPicker(
            connectionManager.klaxoonToolClientId,
            (payload: KlaxoonEvent) => {
                property.link = KlaxoonService.getKlaxoonEmbedUrl(
                    new URL(payload.url),
                    connectionManager.klaxoonToolClientId
                );
                property.poster = payload.imageUrl ?? undefined;
                property.buttonLabel = payload.title ?? undefined;
                // check if the link is embeddable
                checkWebsiteProperty().catch((e) => {
                    console.error("Error checking embeddable website", e);
                });
            }
        );
    }

    function openPicker() {
        closePicker();
        // if klaxoon, open Activity Picker
        if (property.application === "klaxoon") {
            openKlaxoonActivityPicker();
        }

        // create function to handle link seclected
        const handlerLinkSelected = (link: string): void => {
            property.link = link;
            checkWebsiteProperty().catch((e) => {
                console.error("Error checking embeddable website", e);
            });
        };

        // create function to handle error
        const handlerLinkError = (error: string): void => {
            console.error("Error Google Picker", error);
        };

        // if google, open Google Picker
        if (GOOGLE_DRIVE_PICKER_CLIENT_ID && GOOGLE_DRIVE_PICKER_APP_ID) {
            // property application is "googleDocs", open picker with google docs view id
            if (property.application == "googleDocs") {
                GoogleWorkSpaceService.initGooglePicker(
                    GOOGLE_DRIVE_PICKER_CLIENT_ID,
                    GOOGLE_DRIVE_PICKER_APP_ID,
                    window.google.picker.ViewId.DOCUMENTS
                )
                    .then(handlerLinkSelected)
                    .catch(handlerLinkError);
            }

            // property application is "googleSheets", open picker with google sheets view id
            if (property.application == "googleSheets") {
                GoogleWorkSpaceService.initGooglePicker(
                    GOOGLE_DRIVE_PICKER_CLIENT_ID,
                    GOOGLE_DRIVE_PICKER_APP_ID,
                    window.google.picker.ViewId.SPREADSHEETS
                )
                    .then(handlerLinkSelected)
                    .catch(handlerLinkError);
            }

            // property application is "googleSlides", open picker with google slides view id
            if (property.application == "googleSlides") {
                GoogleWorkSpaceService.initGooglePicker(
                    GOOGLE_DRIVE_PICKER_CLIENT_ID,
                    GOOGLE_DRIVE_PICKER_APP_ID,
                    window.google.picker.ViewId.PRESENTATIONS
                )
                    .then(handlerLinkSelected)
                    .catch(handlerLinkError);
            }

            // property application is "googleDrive", open picker with google drive view id
            if (property.application == "googleDrive") {
                GoogleWorkSpaceService.initGooglePicker(
                    GOOGLE_DRIVE_PICKER_CLIENT_ID,
                    GOOGLE_DRIVE_PICKER_APP_ID,
                    window.google.picker.ViewId.DOCS
                )
                    .then(handlerLinkSelected)
                    .catch(handlerLinkError);
            }

            analyticsClient.openPicker(property.application);
        }
    }

    let windowKlaxoonActivityPicker: Window | null = null;
    function closePicker() {
        if (windowKlaxoonActivityPicker != undefined) windowKlaxoonActivityPicker.close();
    }

    function openApplicationWithoutPicker() {
        if (property.application === "cards") {
            window.open("https://app.cards-microlearning.com/", "_blank");
        }
        if (property.application === "eraser") {
            window.open("https://app.eraser.io/dashboard/all", "_blank");
        }
        if (property.application === "excalidraw") {
            window.open("https://excalidraw.com/", "_blank");
        }
        if (property.application === "tldraw") {
            window.open("https://tldraw.com/", "_blank");
        }

        analyticsClient.openApplicationWithoutPicker(property.application);
    }

    function handlePolicyChange(values: string[]) {
        policy = values;
        property.policy = values.reduce((policyStr, value) => `${policyStr}${value};`, "");
        onValueChange();
    }

    function onTriggerSelect(value: string) {
        property.trigger = value as OpenWebsitePropertyData["trigger"];
        onTriggerValueChange();
    }

    function onWidthInput(event: Event) {
        property.width = Number((event.currentTarget as HTMLInputElement).value);
        onValueChange();
    }

    // What the width slider shows: the saved width, or the 50 % every link starts with
    $: widthValue = property.width ?? 50;

    $: triggerOptions = [
        { value: ON_ACTION_TRIGGER_ENTER, label: $LL.mapEditor.properties.openWebsite.triggerShowImmediately() },
        ...(property.newTab
            ? []
            : [{ value: ON_ICON_TRIGGER_BUTTON, label: $LL.mapEditor.properties.openWebsite.triggerOnClick() }]),
        { value: ON_ACTION_TRIGGER_BUTTON, label: $LL.mapEditor.properties.openWebsite.triggerOnAction() },
    ];

    $: linkPlaceholder =
        property.application === "youtube"
            ? $LL.mapEditor.properties.youtube.linkPlaceholder()
            : property.placeholder ?? $LL.mapEditor.properties.openWebsite.linkPlaceholder();

    $: pickerLabel = isAppWithPicker(property.application)
        ? $LL.mapEditor.properties.openWebsite.openPickerSelector()
        : `${$LL.mapEditor.properties.openWebsite.openApplication()} ${property.application}`;

    function isAppWithPicker(application: string | undefined): boolean {
        return (
            application === "googleDocs" ||
            application === "googleSheets" ||
            application === "googleSlides" ||
            application === "klaxoon" ||
            application === "googleDrive"
        );
    }

    function isAppWithoutPicker(application: string | undefined): boolean {
        return (
            application === "cards" ||
            application === "eraser" ||
            application === "excalidraw" ||
            application === "tldraw"
        );
    }

    onDestroy(() => {
        closePicker();
    });
</script>

<PropertyEditorBase
    on:close={() => {
        dispatch("close");
    }}
    on:keypress={onKeyPressed}
>
    <span slot="header" class="flex justify-center items-center">
        {#if property.application === "youtube"}
            <img
                class="w-6 me-1"
                src={youtubeSvg}
                alt={$LL.mapEditor.properties.youtube.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.youtube.label()}
        {:else if property.application === "klaxoon"}
            <img
                class="w-6 me-1"
                src={klaxoonSvg}
                alt={$LL.mapEditor.properties.klaxoon.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.klaxoon.label()}
        {:else if property.application === "googleDocs"}
            <img
                class="w-6 me-1"
                src={googleDocsSvg}
                alt={$LL.mapEditor.properties.googleDocs.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.googleDocs.label()}
        {:else if property.application === "googleSheets"}
            <img
                class="w-6 me-1"
                src={googleSheetsSvg}
                alt={$LL.mapEditor.properties.googleSheets.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.googleSheets.label()}
        {:else if property.application === "googleSlides"}
            <img
                class="w-6 me-1"
                src={googleSlidesSvg}
                alt={$LL.mapEditor.properties.googleSlides.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.googleSlides.label()}
        {:else if property.application === "googleDrive"}
            <img
                class="w-6 me-1"
                src={googleDriveSvg}
                alt={$LL.mapEditor.properties.googleDrive.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.googleDrive.label()}
        {:else if property.application === "eraser"}
            <img
                class="w-6 me-1"
                src={eraserSvg}
                alt={$LL.mapEditor.properties.eraser.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.eraser.label()}
        {:else if property.application === "excalidraw"}
            <img class="w-6 me-1" src={excalidrawSvg} alt={$LL.mapEditor.properties.excalidraw.description()} />
            {$LL.mapEditor.properties.excalidraw.label()}
        {:else if property.application === "cards"}
            <img class="w-6 me-1" src={cardPng} alt={$LL.mapEditor.properties.cards.description()} draggable="false" />
            {$LL.mapEditor.properties.cards.label()}
        {:else if property.application === "tldraw"}
            <img class="w-6 me-1" src={tldrawJpeg} alt={$LL.mapEditor.properties.tldraw.description()} />
            {$LL.mapEditor.properties.tldraw.label()}
        {:else if property.application === "website"}
            <img
                class="w-6 me-1"
                src={icon}
                alt={$LL.mapEditor.properties.openWebsite.description()}
                draggable="false"
            />
            {$LL.mapEditor.properties.openWebsite.label()}
        {:else}
            <img class="w-6 me-1" src={property.icon} alt={property.label} draggable="false" />
            {property.label}
        {/if}
    </span>
    <span slot="content" class="op">
        {#if property.poster}
            <div class="text-center">
                <img class="w-20 me-1" src={property.poster} alt="" draggable="false" />
            </div>
        {/if}

        {#if isArea}
            <div class="op-field">
                <span class="op-label">{$LL.mapEditor.properties.openWebsite.trigger()}</span>
                <USelect
                    label={$LL.mapEditor.properties.openWebsite.trigger()}
                    value={property.trigger}
                    options={triggerOptions}
                    onSelect={onTriggerSelect}
                />
            </div>
        {/if}

        <div class="op-field">
            <label for="tabLink" class="op-label">{$LL.mapEditor.properties.openWebsite.linkLabel()}</label>
            <div class="op-line">
                <div class="u-join-field op-link" class:u-join-field-error={error !== ""}>
                    <IconLink font-size="18" class="flex-none text-white/75" />
                    <input
                        id="tabLink"
                        type="url"
                        placeholder={linkPlaceholder}
                        bind:value={property.link}
                        on:keypress={onKeyPressed}
                        on:change={onValueChange}
                        on:blur={() => checkWebsiteProperty()}
                        disabled={embeddableLoading}
                    />
                </div>

                {#if isAppWithPicker(property.application)}
                    <button
                        type="button"
                        class="u-cta-secondary op-picker"
                        on:click|preventDefault|stopPropagation={openPicker}
                    >
                        <img src={pickerSvg} alt="" draggable="false" />
                        {pickerLabel}
                    </button>
                {:else if isAppWithoutPicker(property.application)}
                    <button
                        type="button"
                        class="u-cta-secondary op-picker"
                        on:click|preventDefault|stopPropagation={openApplicationWithoutPicker}
                    >
                        <img src={pickerSvg} alt="" draggable="false" />
                        {pickerLabel}
                    </button>
                {/if}
            </div>
            {#if error !== ""}
                <div class="u-error-line">{error}</div>
            {/if}
            {#if warning !== ""}
                <div class="op-warn">
                    <IconAlertTriangle font-size="16" class="flex-none" />
                    <span>{warning}</span>
                </div>
            {/if}
            {#if !embeddable && property.newTab == false && error === ""}
                <div class="op-warn">
                    <IconAlertTriangle font-size="16" class="flex-none" />
                    <span
                        >{$LL.mapEditor.properties.openWebsite.messageNotEmbeddableLink()}.
                        <a
                            href="https://workadventu.re/map-building/troubleshooting.md#content-issues-embedding-a-website"
                            target="_blank">{$LL.mapEditor.properties.openWebsite.findOutMoreHere()}</a
                        ></span
                    >
                </div>
            {/if}
        </div>

        {#if !property.hideButtonLabel}
            <div class="op-field">
                <label for="linkButton" class="op-label">{$LL.mapEditor.entityEditor.buttonLabel()}</label>
                <div class="u-join-field">
                    <input id="linkButton" type="text" bind:value={property.buttonLabel} on:change={onValueChange} />
                </div>
            </div>
        {/if}

        <PanelSwitch
            id="advancedOption"
            strong
            label={$LL.mapEditor.properties.advancedOptions()}
            bind:value={optionAdvancedActivated}
        />

        <div class:active={optionAdvancedActivated} class="advanced-option op-group">
            {#if (isArea && triggerOptionActivated && triggerOnActionChoosen) || !isArea}
                <div class="op-field">
                    <label for="triggerMessage" class="op-label"
                        >{$LL.mapEditor.properties.openWebsite.triggerMessage()}</label
                    >
                    <div class="u-join-field">
                        <input
                            id="triggerMessage"
                            type="text"
                            placeholder={$LL.trigger.object()}
                            bind:value={property.triggerMessage}
                            on:change={onValueChange}
                        />
                    </div>
                </div>
            {/if}

            <PanelSwitch
                id="newTab"
                label={$LL.mapEditor.properties.openWebsite.newTabLabel()}
                bind:value={property.newTab}
                onChange={() => {
                    // The "newTab" property won't be changed automatically by the service.
                    firstCheckLink = false;
                    oldNewTabValue = property.newTab;
                    onNewTabValueChange();
                }}
                disabled={property.forceNewTab}
            />

            {#if property.forceNewTab == true}
                <div class="op-warn">
                    <IconAlertTriangle font-size="16" class="flex-none" />
                    <span>{$LL.mapEditor.properties.openWebsite.forcedInNewTab()}</span>
                </div>
            {/if}

            <PanelSwitch
                id="hideUrl"
                label={$LL.mapEditor.properties.openWebsite.hideUrlLabel()}
                bind:value={property.hideUrl}
                onChange={() => {
                    onValueChange();
                }}
                disabled={property.newTab}
            />

            {#if !property.newTab}
                <div class="op-slider">
                    <div class="op-slider-top">
                        <label for="websiteWidth">{$LL.mapEditor.properties.openWebsite.width()}</label>
                        <span class="op-slider-value">{widthValue} %</span>
                    </div>
                    <div class="op-track">
                        <div class="op-track-fill" style="width: {((widthValue - 15) / (85 - 15)) * 100}%" />
                        <div class="op-track-thumb" style="left: {((widthValue - 15) / (85 - 15)) * 100}%" />
                        <input
                            id="websiteWidth"
                            type="range"
                            min={15}
                            max={85}
                            value={widthValue}
                            on:input={onWidthInput}
                        />
                    </div>
                    <div class="op-slider-ends"><span>15 %</span><span>85 %</span></div>
                </div>

                <PanelSwitch
                    id="closable"
                    label={$LL.mapEditor.properties.openWebsite.closable()}
                    bind:value={property.closable}
                    onChange={onValueChange}
                />

                <PanelSwitch
                    id="allowAPI"
                    label={$LL.mapEditor.properties.openWebsite.allowAPI()}
                    bind:value={property.allowAPI}
                    onChange={onValueChange}
                />

                {#if policy != undefined}
                    <div class="op-field">
                        <span class="op-label">{$LL.mapEditor.properties.openWebsite.policy()}</span>
                        <PolicyChips value={policy} options={policyOptions} onChange={handlePolicyChange} />
                    </div>
                {/if}
            {/if}
        </div>
    </span>
</PropertyEditorBase>

<style lang="scss">
    .op {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: 0;
    }
    .op-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 0;
    }
    .op-label {
        padding-inline-start: 2px;
        font-size: 0.8125rem;
        font-weight: 500;
        color: rgba(255, 255, 255, 0.72);
    }
    .op-line {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .op-link {
        flex: 1 1 12rem;
    }
    .op-picker {
        display: inline-flex;
        flex: none;
        align-items: center;
        gap: 6px;
        max-width: 100%;
        height: 3rem;
        margin: 0;
        padding: 0 16px;
        border-radius: 999px;
        font: inherit;
        font-size: 0.8125rem;
        font-weight: 600;
        cursor: pointer;
        img {
            width: 18px;
            height: 18px;
        }
    }
    .op-warn {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        padding: 10px 12px;
        border-radius: 12px;
        background: rgba(251, 191, 36, 0.1);
        box-shadow: inset 0 0 0 1px rgba(251, 191, 36, 0.32);
        color: #fde7a6;
        font-size: 0.8125rem;
        line-height: 1.4;
        :global(svg) {
            margin-top: 1px;
            color: #fbbf24;
        }
        a {
            color: #fff;
            font-weight: 600;
        }
    }
    .advanced-option {
        display: none;

        &.active {
            display: flex;
        }
    }
    .op-group {
        flex-direction: column;
        gap: 12px;
        padding: 12px;
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.04);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
    }
    .op-slider {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .op-slider-top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 0.9375rem;
    }
    .op-slider-value {
        padding: 3px 10px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font-size: 0.8125rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
    }
    .op-track {
        position: relative;
        height: 6px;
        margin-inline: 11px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.14);
    }
    .op-track-fill {
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        border-radius: 999px;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .op-track-thumb {
        position: absolute;
        top: -8px;
        width: 22px;
        height: 22px;
        margin-inline-start: -11px;
        border-radius: 999px;
        background: #fff;
        box-shadow: 0 0 0 4px rgba(134, 41, 252, 0.25), 0 2px 6px rgba(0, 0, 0, 0.4);
        pointer-events: none;
    }
    .op-track input {
        position: absolute;
        /* The tap area is the 44px band around the track, and runs the full track so the thumb ends reach 15 % and 85 % */
        inset-block: -19px;
        inset-inline: -11px;
        width: calc(100% + 22px);
        height: 44px;
        margin: 0;
        opacity: 0;
        cursor: pointer;
    }
    .op-slider-ends {
        display: flex;
        justify-content: space-between;
        font-size: 0.6875rem;
        color: rgba(255, 255, 255, 0.4);
        font-variant-numeric: tabular-nums;
    }
</style>
