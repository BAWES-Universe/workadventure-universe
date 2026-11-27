<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import LL, { locale } from "../../../i18n/i18n-svelte";
    import type { ArtifactCoWebsite } from "../../WebRtc/CoWebsite/ArtifactCoWebsite";
    import {
        ArtifactRequestError,
        artifactLink,
        fetchArtifact,
        fetchArtifactCode,
        fetchArtifactVersions,
        publishArtifact,
        restoreArtifactVersion,
        shareArtifact,
        type ArtifactOpenScope,
        type ArtifactVersionInfo,
        type OpenedArtifact,
    } from "../../Artifacts/ArtifactApi";
    import { artifactBadge } from "../../Artifacts/artifactBadge";
    import { pagePayments } from "../../Artifacts/PagePayments";
    import { describePayLine, type PayAction } from "../../Artifacts/payLineView";
    import { nearbyPeopleNames } from "../../Artifacts/nearbyPeople";
    import type { ArtifactKind } from "../../Artifacts/artifactCard";
    import { whenLabel } from "../../Artifacts/whenLabel";
    import { mayOfferSendTo } from "../../Artifacts/sendTo";
    import { openSendTo } from "../../Artifacts/sendToStore";
    import { codeKindOfArtifact, codeLinesOf, coloredCodeBlocks } from "../../FileViewer/codeHighlight";
    import { renderMarkdown } from "../../FileViewer/textFiles";
    import { versionMenuRoom, VERSION_MENU_MIN_ROOM } from "../../Artifacts/versionMenuRoom";
    import { chatOwnSheetHeightStore } from "../../Chat/ChatSheetStore";
    import { windowSize } from "../../Stores/CoWebsiteStore";
    import { localUserStore } from "../../Connection/LocalUserStore";
    import { askOpenHereForRoom } from "../../Stores/OpenHereSheetStore";
    import OpenHereRow from "../EmbedScreens/OpenHereRow.svelte";
    import OpenHereItemIcon from "../EmbedScreens/OpenHereItemIcon.svelte";
    import CodeView from "./FileViewer/CodeView.svelte";
    import {
        fileNameOf,
        markdownFile,
        markdownTables,
        saveFile,
        spreadsheetFile,
    } from "../../Artifacts/artifactDownload";
    import {
        IconAlertTriangle,
        IconCheck,
        IconCode,
        IconCopy,
        IconDownload,
        IconEye,
        IconHistory,
        IconLoader,
        IconRefresh,
        IconShare,
    } from "@wa-icons";

    export let actualCowebsite: ArtifactCoWebsite;
    export let visible: boolean;

    /** Below this panel width (a phone) the row keeps to Versions. */
    const COMPACT_WIDTH = 440;
    /** The most lines of code drawn at once; a mini app is one file, so this is only a guard. */
    const MAX_CODE_LINES = 4000;
    /** How long Copy link reads "Link copied", as on the invite bar. */
    const COPIED_FOR_MS = 3000;
    /** A "Just you" address is asked for again this long before it stops, or a tenth of its life if that is less. */
    const RENEW_LEAD_MS = 60_000;
    /** Never asked for again sooner than this, however short its life. */
    const RENEW_MIN_WAIT_MS = 10_000;
    /** A new address that could not be fetched is asked for again after this long. */
    const RENEW_RETRY_MS = 30_000;
    /** The longest wait a browser's timer takes. */
    const MAX_TIMER_MS = 2 ** 31 - 1;
    /** How the artifacts' server says its owner keeps one to themselves, to someone in the chat it was made in. */
    const KEPT_PRIVATE = "kept_private";
    /**
     * How it says "Just you" cannot be had from it as it is: it is set up without what private files need, or it does not
     * know the choice yet. Nothing changed then.
     */
    const NO_PRIVATE_FILES = ["private_files_not_configured", "invalid_open_scope"];

    const id = actualCowebsite.artifactId;
    const versionStore = actualCowebsite.version;
    const summaryStore = actualCowebsite.summary;
    const link = artifactLink(id);

    let panelWidth = 0;
    let panelHeight = 0;
    let phase: "opening" | "ready" | "failed" = "opening";
    /** `private`: its owner keeps it to themselves ("Just you"), said to someone in the chat it was made in. */
    let failure: "gone" | "private" | "offline" = "offline";
    let opened: OpenedArtifact | undefined;
    let versions: ArtifactVersionInfo[] | undefined;
    let versionsFailed = false;
    /** Another version was asked for and could not be opened; the one that was showing stays. */
    let switchFailed = false;
    let menuOpen = false;
    /** The owner asked to restore the version showing, and the answer is on its way. */
    let restoring = false;
    let restoreFailed = false;
    /** The owner's Share list is open (one list drops down at a time). */
    let shareOpen = false;
    /** The Download list is open: only a document with a table has one, any other downloads its file at once. */
    let downloadOpen = false;
    let downloadButton: HTMLButtonElement | undefined;
    let downloadMenu: HTMLElement | undefined;
    /** A file is being made; a second tap waits for it. */
    let downloading = false;
    /** The short line under the document after a download: the file's name, or that it could not be made. */
    let downloadNote: { kind: "saved" | "failed"; name: string } | undefined;
    let downloadNoteTimer: ReturnType<typeof setTimeout> | undefined;
    /** How long the line stays. */
    const DOWNLOAD_NOTE_MS = 3000;
    /** A choice the owner just made, showing at once while it is on its way to be saved. */
    let pendingShare: ArtifactOpenScope | undefined;
    let shareFailed = false;
    /** The owner pressed Publish and the answer is on its way (game #2115). */
    let publishing = false;
    let publishFailed = false;
    let copied: "no" | "yes" | "failed" = "no";
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    /** The device has its own share sheet (phones, and most computers): Share sits beside Copy link, like invites. */
    const canShare = typeof navigator.share === "function";
    let menu: HTMLElement | undefined;
    let versionsButton: HTMLButtonElement | undefined;
    let shareButton: HTMLButtonElement | undefined;
    /** How tall the list may be, so it ends above the chat where the chat covers the window. */
    let menuRoom: number | undefined;
    /** The window was asked for room once while the list is open; it is not asked again until the list opens again. */
    let roomAsked = false;
    let codeOn = false;
    let text: { number: number; content: string } | undefined;
    let textFailed = false;
    let request = 0;
    /** The version showing now; what the version asked for is compared with. Counts the tries to open again. */
    let shownNumber: number | undefined;
    let attempt = 0;
    let textAttempt = 0;
    let destroyed = false;
    /**
     * When the address on show stops working. A "Just you" artifact opens at an address made for that one opening
     * (game #1994); every other address goes on working, and has none.
     */
    let addressEndsAt: number | undefined;
    let renewTimer: ReturnType<typeof setTimeout> | undefined;
    /** Counts the times the version on show was opened again: only the answer to the last one is used. */
    let renewal = 0;
    /**
     * Count the owner's own choices that came back: who can open it, and what was published, each on its own. An answer to
     * opening that was on its way when one came back may be older than it, so it does not write that choice over
     * (`withNewerChoices`); a choice of the other kind is left as the answer says.
     */
    let sharedChoices = 0;
    let publishedChoices = 0;
    /** A renewal was asked for while another opening was on its way, and is still wanted if that one does not come on show. */
    let renewWhenFree = false;
    /** An opening started while a version was on show, and dropped its renewal: set when it starts, cleared when it comes on show. */
    let renewalDropped = false;
    /** Counts the openings that came on show: a checkout asked for by the page of one is never told to the page of another. */
    let opening = 0;
    /** The address on show has stopped and a new one is on its way: nothing is drawn from the old one meanwhile. */
    let addressOver = false;

    // A page that takes payments asks for its checkout by message (game #2044); only this window's own frame is listened to
    let frameElement: HTMLIFrameElement | null | undefined;
    // Whether the page in the frame on show has loaded: a frame has a window before its page is there, and a payment result
    // sent in that time reaches nobody. Cleared each time the frame is drawn again (a new element, or another address).
    let frameLoaded = false;
    // The version each opening put on show: a page that asks for a checkout says the version of the opening it belongs to (the one on
    // show when it first spoke), so a page still showing while another version comes in never says the newer one
    const openingVersions = new Map<number, number>();
    let frameDrawn: { element: HTMLIFrameElement | null | undefined; url: string | null | undefined } | undefined;
    function watchFrame(element: HTMLIFrameElement | null | undefined, url: string | null | undefined) {
        if (frameDrawn && frameDrawn.element === element && frameDrawn.url === url) return;
        frameDrawn = { element, url };
        frameLoaded = false;
    }
    $: watchFrame(frameElement, opened?.version.url);
    const payments = pagePayments({
        artifactId: id,
        chat: () => actualCowebsite.chat,
        frame: () => frameElement?.contentWindow,
        loaded: () => frameLoaded,
        opening: () => opening,
        openWindow: () => window.open("about:blank", "_blank"),
        // A signed-in buyer's account is the buyer; a guest's own recovery code is (kept in this browser, for this page)
        buyer: () => (localUserStore.isLogged() ? "account" : "guest"),
        // A guest's receipt link opens Orbit's public page, which only exists for a page anyone with the link may open:
        // a Public one only once something is published, and not when that version is gone
        pageUrl: () =>
            openScope === "link" || (openScope === "public" && published && !publishedGone) ? link : undefined,
        // The version of the page that asked: Orbit never charges terms set on a newer one on it, and makes no new order for a
        // page that does not say which version it shows
        shownVersion: (at) => openingVersions.get(at),
    });
    const payLine = payments.line;
    // The line under the page: what it says and what can be pressed (the approved mock M1)
    let receiptCopied = false;
    // The receipt link, shown to be selected by hand when the browser would not copy it: it is the guest's way back to the purchase on another device
    let receiptByHand: string | undefined;
    let receiptTimer: ReturnType<typeof setTimeout> | undefined;
    $: if (!$payLine.paid) {
        receiptCopied = false;
        receiptByHand = undefined;
    }
    $: payView = describePayLine(
        $payLine,
        { copied: receiptCopied, locale: $locale, owner: opened?.you.owner ? { maker: makerName } : undefined },
        $LL.chat.artifacts
    );
    function payAction(action: PayAction) {
        if (action.kind === "check") payments.checkPayment();
        else if (action.kind === "restore") payments.restorePurchase();
        else if (action.kind === "copy") copyReceipt();
        else if (action.kind === "latest") openLatest();
    }
    /** The page was updated since it was opened: open what this person is shown now, fresh from Orbit, and clear the line. */
    function openLatest() {
        payments.dismiss();
        void load(undefined);
    }
    function copyReceipt() {
        const receipt = payments.receiptLink();
        if (!receipt) return;
        // The paid line this copy was started from: a guest's receipt link is the same for every checkout of this page, so it is the line that tells
        // whether the outcome still belongs to what the buyer sees
        const copiedFrom = $payLine.paid;
        const copying = navigator.clipboard?.writeText(receipt) ?? Promise.reject(new Error("No clipboard"));
        copying.then(
            () => {
                // Only for the line that was being copied from: a new checkout may have taken the line since
                if (destroyed || $payLine.paid !== copiedFrom) return;
                receiptByHand = undefined;
                receiptCopied = true;
                if (receiptTimer) clearTimeout(receiptTimer);
                receiptTimer = setTimeout(() => (receiptCopied = false), 8_000);
            },
            () => {
                if (destroyed || $payLine.paid !== copiedFrom) return;
                receiptByHand = receipt;
            }
        );
    }
    onMount(() => {
        window.addEventListener("message", payments.onMessage);
        return () => window.removeEventListener("message", payments.onMessage);
    });

    onDestroy(() => {
        payments.destroy();
        destroyed = true;
        if (copiedTimer) clearTimeout(copiedTimer);
        if (receiptTimer) clearTimeout(receiptTimer);
        if (downloadNoteTimer) clearTimeout(downloadNoteTimer);
        renewIn(undefined);
    });

    $: compact = panelWidth > 0 && panelWidth < COMPACT_WIDTH;
    $: kind = (opened?.artifact.kind ?? $summaryStore.kind) as ArtifactKind | undefined;
    $: makerName = opened?.artifact.makerName ?? $summaryStore.makerName ?? "";
    $: title = opened?.artifact.title ?? $summaryStore.title;
    $: shown = opened?.version;
    // A newer version may have been made while the window stayed open, and the list of versions is where that shows
    $: latest = (versions ?? []).reduce(
        (newest, version) => Math.max(newest, version.number),
        opened?.artifact.version ?? 0
    );
    $: isLatest = shown !== undefined && shown.number === latest;
    $: line = shown
        ? isLatest
            ? $LL.chat.artifacts.byVersion({ maker: makerName, version: shown.number })
            : $LL.chat.artifacts.byVersionOf({ maker: makerName, version: shown.number, count: latest })
        : makerName
        ? $LL.chat.artifacts.by({ maker: makerName })
        : "";
    $: badge = artifactBadge(kind, $LL);
    $: openScope = pendingShare ?? opened?.artifact.openScope;
    // What the owner published (game #2115): people who open it only by its link see this version, not the latest. Told to
    // its owner alone, who is the only one who sees any of what follows.
    $: published = opened?.artifact.published ?? undefined;
    $: publishedGone = published !== undefined && published.available === false;
    $: sharedByLink = opened?.artifact.openScope === "link" || opened?.artifact.openScope === "public";
    // The window says so, with Publish right there, once the latest version is newer than the one people see
    $: unpublishedChanges = published !== undefined && !publishedGone && published.version < latest;
    $: showPublishBar =
        phase === "ready" && !!opened?.you.owner && sharedByLink && unpublishedChanges && isLatest && !shareOpen;
    // "People in this chat" only while the owner is in the nearby chat it was made in, naming who is in it now;
    // otherwise the same choice reads "Just you", the only one who can open it then
    $: inItsChat =
        opened?.artifact.chatKind === "nearby" && opened.you.inChat && actualCowebsite.chat?.kind === "nearby";
    $: peopleHere = inItsChat && actualCowebsite.chat ? nearbyPeopleNames(actualCowebsite.chat.ref) : undefined;
    $: justYouHelp =
        opened?.artifact.chatKind === "dm"
            ? $LL.chat.artifacts.justYouDm({ maker: makerName })
            : opened?.artifact.chatKind === "nearby"
            ? $LL.chat.artifacts.justYouNearby()
            : "";
    // A document is drawn from its text, a drawing as a picture, a page or app in the locked frame.
    $: needsText = codeOn || kind === "markdown";
    // Download: of the version on show, made from its text. Dimmed until that text is here.
    $: textReady = !!text && !!opened && text.number === opened.version.number;
    $: documentTables = kind === "markdown" && textReady && text ? markdownTables(text.content) : [];
    // Send to a friend, a chat or a Brick: its owner always, anyone else only while it opens by its link (see mayOfferSendTo)
    $: canSendTo =
        kind === "markdown" &&
        !!opened &&
        mayOfferSendTo({ owner: opened.you.owner, openScope: opened.artifact.openScope });
    $: if (!textReady) downloadOpen = false;

    // Open when the window starts, and again whenever a version other than the one showing is asked for.
    $: syncVersion($versionStore, attempt);
    // Clearing a failure (a tap on Try again) reads the text again
    $: if (phase === "ready" && opened && needsText) ensureText(opened.version.number, textAttempt);

    function syncVersion(wanted: number | undefined, _attempt: number) {
        if (shownNumber !== undefined && (wanted === undefined || wanted === shownNumber)) {
            // Back to the version on show: an opening of another one that is still on its way is no longer wanted
            if (opened) {
                request++;
                phase = "ready";
                // The opening that was cancelled had dropped the renewal of the one on show
                lookAfterRenewal();
            }
            return;
        }
        void load(wanted);
    }

    function ensureText(number: number, _attempt: number) {
        if (text?.number === number || textFailed) return;
        void loadText(number);
    }

    async function load(version: number | undefined) {
        const mine = ++request;
        const choicesBefore = choicesNow();
        // A renewal of the version on show that is still on its way is out of date from the moment another opening starts:
        // if it answers "kept private" while this opening is still loading, it must not put away the opening that is coming.
        // One that is only waiting for its time is cancelled too, and renewAddress does nothing until this opening ends.
        renewal++;
        renewIn(undefined);
        // A version on show (if any) lost its renewal: it is set up again if this opening does not come on show
        renewalDropped = true;
        switchFailed = false;
        // A failed restore was about the version that was showing
        restoreFailed = false;
        phase = "opening";
        try {
            const answer = await fetchArtifact(id, actualCowebsite.chat, version);
            if (destroyed || mine !== request) return;
            opened = withNewerChoices(answer, choicesBefore);
            shownNumber = answer.version.number;
            // What this opening shows is newer than any renewal of a version that was on show before it: that one is not used,
            // also when the same version is on show again (1, then 2, then 1)
            renewal++;
            renewWhenFree = false;
            // This opening brings its own address and timer (watchAddress below): nothing was dropped that needs setting up again
            renewalDropped = false;
            opening++;
            openingVersions.set(opening, answer.version.number);
            if (openingVersions.size > 16) openingVersions.delete(openingVersions.keys().next().value as number);
            text = undefined;
            textFailed = false;
            summaryStore.set({
                title: answer.artifact.title,
                kind: answer.artifact.kind as ArtifactKind,
                makerName: answer.artifact.makerName,
            });
            // What the window shows is now a concrete version, so a card for it can show as open.
            if ($versionStore !== answer.version.number) versionStore.set(answer.version.number);
            watchAddress(answer.version);
            phase = "ready";
        } catch (error) {
            if (destroyed || mine !== request) return;
            failure = failureOf(error);
            if (failure === "private") {
                // Its owner made it "Just you" while it was open here: what was showing goes too
                putAway("private");
                return;
            }
            if (opened) {
                // Another version could not be opened: keep the one showing, and say so.
                switchFailed = true;
                versionStore.set(opened.version.number);
                phase = "ready";
                // A renewal of the one showing that was due or on its way was dropped when this opening started: look after it again
                lookAfterRenewal();
                return;
            }
            phase = "failed";
        }
    }

    async function loadText(number: number) {
        try {
            const answer = await fetchArtifactCode(id, number, actualCowebsite.chat);
            if (destroyed || opened?.version.number !== number) return;
            text = { number, content: answer.content };
        } catch (error) {
            console.warn("Could not read an artifact's text", error);
            if (!destroyed) textFailed = true;
        }
    }

    function failureOf(error: unknown): "gone" | "private" | "offline" {
        if (!(error instanceof ArtifactRequestError) || error.status !== 404) return "offline";
        return error.code === KEPT_PRIVATE ? "private" : "gone";
    }

    /** This person can no longer open it: what was showing is put away, and the window says why. */
    function putAway(why: "gone" | "private") {
        request++;
        forgetAddress();
        opened = undefined;
        shownNumber = undefined;
        text = undefined;
        menuOpen = false;
        shareOpen = false;
        downloadOpen = false;
        failure = why;
        phase = "failed";
    }

    function retry() {
        forgetAddress();
        opened = undefined;
        shownNumber = undefined;
        textFailed = false;
        phase = "opening";
        attempt++;
    }

    function forgetAddress() {
        renewIn(undefined);
        addressEndsAt = undefined;
        addressOver = false;
    }

    /** The version on show was left without its renewal while another opening was on its way: set one up again. */
    function lookAfterRenewal() {
        // Nothing was dropped (the opening came on show, or the version was never opened again): the timer in place is the right one
        if (!renewalDropped) return;
        renewalDropped = false;
        // A page whose address stopped (addressOver) waits behind the loading line for the renewal that this opening cut off: it is set up again at once
        if (opened && (renewWhenFree || addressOver || (opened.version.url !== null && opened.version.urlHasMedia))) {
            renewIn(addressOver ? 0 : renewWait(opened.version));
        }
        renewWhenFree = false;
    }

    /**
     * How long until the version on show is to be renewed: from when its address stops (known, whatever happened to its timer meanwhile),
     * the same lead watchAddress uses; at once when that time has come. Only a renewal with no address end to go by waits the quick retry.
     */
    function renewWait(version: ArtifactVersionInfo): number {
        const life = version.urlLifeMs;
        if (addressEndsAt === undefined || life === undefined || !version.urlHasMedia) return RENEW_RETRY_MS;
        return Math.max(0, addressEndsAt - Math.min(RENEW_LEAD_MS, life / 10) - Date.now());
    }

    /** Opens the version on show again after `wait`, in place of any wait already set; with none, never. */
    function renewIn(wait: number | undefined) {
        if (renewTimer) clearTimeout(renewTimer);
        renewTimer = wait === undefined ? undefined : setTimeout(() => void renewAddress(), wait);
    }

    // A "Just you" artifact opens at an address made for that one opening, which stops after a while. A page with songs,
    // pictures or videos beside it goes on fetching them from there, so it is opened again at a new address just before
    // that. Any other page has all it needs already and is left alone: it is opened again only when its frame is drawn
    // again, by the game (toggleCode) or, after the address stopped, by the browser (redrawIfStopped).
    function watchAddress(version: ArtifactVersionInfo) {
        forgetAddress();
        const life = version.urlLifeMs;
        if (version.url === null || life === undefined) return;
        addressEndsAt = Date.now() + life;
        if (!version.urlHasMedia) return;
        const wait = Math.max(RENEW_MIN_WAIT_MS, life - Math.min(RENEW_LEAD_MS, life / 10));
        if (wait <= MAX_TIMER_MS) renewIn(wait);
    }

    function addressStopped(): boolean {
        return addressEndsAt !== undefined && Date.now() >= addressEndsAt;
    }

    /** The version on show is opened again where it is, quietly: its address stopped, or its files moved. */
    async function renewAddress() {
        renewIn(undefined);
        if (destroyed || shownNumber === undefined) return;
        // Another version is being opened: that one brings its own address; a renewal asked for meanwhile waits for its end
        if (phase === "opening") {
            renewWhenFree = true;
            return;
        }
        const turn = ++renewal;
        const choicesBefore = choicesNow();
        const number = shownNumber;
        // Dropped when another version came on show meanwhile, it was put away, or it was asked for again
        const stale = () => destroyed || turn !== renewal || shownNumber !== number;
        try {
            const answer = await fetchArtifact(id, actualCowebsite.chat, number);
            if (stale()) return;
            opened = withNewerChoices(answer, choicesBefore);
            watchAddress(answer.version);
        } catch (error) {
            if (stale()) return;
            const why = failureOf(error);
            if (why === "offline") {
                console.warn("Could not open an artifact again at a new address", error);
                renewIn(RENEW_RETRY_MS);
            } else {
                putAway(why);
            }
        }
    }

    /**
     * An answer to opening that was asked for before one of the owner's choices came back keeps that choice as it now is:
     * the answer may have been made before it.
     */
    function withNewerChoices(answer: OpenedArtifact, before: { shared: number; published: number }): OpenedArtifact {
        if (!opened) return answer;
        const sharedSince = sharedChoices !== before.shared;
        const publishedSince = publishedChoices !== before.published;
        if (!sharedSince && !publishedSince) return answer;
        return {
            ...answer,
            artifact: {
                ...answer.artifact,
                ...(sharedSince ? { openScope: opened.artifact.openScope } : {}),
                ...(publishedSince ? { published: opened.artifact.published } : {}),
            },
        };
    }

    const choicesNow = () => ({ shared: sharedChoices, published: publishedChoices });

    /** Nothing is drawn from the address in hand any more: the version on show waits for a new one. */
    function drawFromNewAddress() {
        addressOver = true;
        void renewAddress();
    }

    // The browser draws the frame (or the drawing) again by itself. From an address that has stopped it shows nothing,
    // so nothing is drawn until it is opened again at a new one.
    function redrawIfStopped() {
        if (addressStopped()) drawFromNewAddress();
    }

    // The frame has loaded: what a checkout ended with while the buyer was in Code view (it has no frame then) is told to it now.
    // From an address that has stopped it shows nothing, so it waits for the frame of the new one.
    function onFrameLoad() {
        // From an address that has stopped it shows nothing: it is not a page that can hear anything
        frameLoaded = !addressStopped();
        if (frameLoaded) payments.frameReady();
        redrawIfStopped();
    }

    // The list drops down from the button. On a phone the window sits behind the chat, so the list ends above the chat,
    // and is measured again as the window or the chat moves.
    $: if ((menuOpen || shareOpen) && menu) measureMenu(panelHeight, $windowSize.height, $chatOwnSheetHeightStore);

    function measureMenu(_panelHeight: number, viewportHeight: number, chatHeight: number) {
        const panel = menu?.parentElement;
        if (!menu || !panel) return;
        menuRoom = versionMenuRoom({
            menuTop: menu.getBoundingClientRect().top,
            windowBottom: panel.getBoundingClientRect().bottom,
            viewportHeight,
            chatHeight,
        });
        if (menuRoom < VERSION_MENU_MIN_ROOM && !roomAsked) {
            roomAsked = true;
            askOpenHereForRoom();
        }
    }

    // A tap anywhere else puts the list away. A tap inside the app does not reach the game, so it leaves the list open.
    function onPointerDown(event: PointerEvent) {
        if (!menuOpen && !shareOpen && !downloadOpen) return;
        const target = event.target;
        if (
            target instanceof Node &&
            (menu?.contains(target) ||
                downloadMenu?.contains(target) ||
                versionsButton?.contains(target) ||
                shareButton?.contains(target) ||
                downloadButton?.contains(target))
        ) {
            return;
        }
        menuOpen = false;
        shareOpen = false;
        downloadOpen = false;
    }

    // A document with no table and nobody to send it to has one file to give, so a tap on Download gives it. Otherwise the person chooses.
    function toggleDownload() {
        if (!textReady || downloading) return;
        if (documentTables.length === 0 && !canSendTo) {
            void download("markdown");
            return;
        }
        downloadOpen = !downloadOpen;
        if (!downloadOpen) return;
        menuOpen = false;
        shareOpen = false;
    }

    /**
     * Opens "Send to…" for the version on show: its file is made from that version's text (an older one is named as such), and
     * a link goes with the document's own link setting.
     */
    function sendToOthers() {
        if (!text || !opened || kind !== "markdown" || !canSendTo) return;
        const source = text.content;
        const name = fileNameOf(title ?? "", "md", isLatest ? undefined : opened.version.number);
        downloadOpen = false;
        openSendTo({
            fileName: name,
            makeFile: () => Promise.resolve(new File([markdownFile(source)], name, { type: "text/markdown" })),
            link: link
                ? {
                      url: link,
                      openScope: opened.artifact.openScope,
                      owner: opened.you.owner,
                      published: opened.artifact.published,
                      latest,
                  }
                : undefined,
        });
    }

    function showDownloadNote(kind: "saved" | "failed", name = "") {
        downloadNote = { kind, name };
        if (downloadNoteTimer) clearTimeout(downloadNoteTimer);
        downloadNoteTimer = setTimeout(() => (downloadNote = undefined), DOWNLOAD_NOTE_MS);
    }

    /** The file is made from the version that was on show when it was asked for, which is named when it is not the latest. */
    async function download(what: "markdown" | "spreadsheet") {
        if (!text || !opened || downloading || kind !== "markdown") return;
        const source = text.content;
        const tables = documentTables;
        const name = fileNameOf(
            title ?? "",
            what === "markdown" ? "md" : "xlsx",
            isLatest ? undefined : opened.version.number
        );
        downloadOpen = false;
        downloading = true;
        try {
            const blob =
                what === "markdown"
                    ? markdownFile(source)
                    : await spreadsheetFile(tables, (number) => $LL.chat.artifacts.tableTab({ number }));
            if (destroyed) return;
            saveFile(blob, name);
            showDownloadNote("saved", name);
        } catch (error) {
            console.warn("Could not make an artifact's file", error);
            if (!destroyed) showDownloadNote("failed");
        } finally {
            downloading = false;
        }
    }

    function toggleVersions() {
        menuOpen = !menuOpen;
        if (!menuOpen) return;
        shareOpen = false;
        downloadOpen = false;
        roomAsked = false;
        menuRoom = undefined;
        void loadVersions();
    }

    async function loadVersions() {
        versionsFailed = false;
        try {
            versions = await fetchArtifactVersions(id, actualCowebsite.chat);
        } catch (error) {
            console.warn("Could not list an artifact's versions", error);
            versionsFailed = true;
        }
    }

    function toggleShare() {
        shareOpen = !shareOpen;
        if (!shareOpen) return;
        menuOpen = false;
        downloadOpen = false;
        roomAsked = false;
        menuRoom = undefined;
        shareFailed = false;
        publishFailed = false;
        copied = "no";
    }

    // Publishes the version the owner has on show, and only while it is the latest (`isLatest`): a newer one made meanwhile
    // (a bot's, say) has to be opened first (Back to latest), so nothing is ever published unseen. The buttons name that same
    // version. Only the owner has them; Orbit checks it again.
    function publish() {
        if (!opened || publishing || pendingShare || !isLatest) return;
        publishing = true;
        publishFailed = false;
        void publishArtifact(id, opened.version.number, actualCowebsite.chat).then(
            (artifact) => {
                if (destroyed) return;
                publishing = false;
                if (!opened) return;
                publishedChoices++;
                opened = {
                    ...opened,
                    artifact: {
                        ...opened.artifact,
                        // Only what was published: who can open it is not this answer's to say, and a choice made while
                        // it was on its way would be written over by it
                        published: artifact.published ? { ...artifact.published, available: true } : null,
                    },
                };
            },
            (error) => {
                if (destroyed) return;
                publishing = false;
                console.warn("Could not publish an artifact", error);
                publishFailed = true;
            }
        );
    }

    // Saved at once, one choice at a time: the list shows the choice while it is on its way, and goes back if it fails.
    // `otherwise` is the choice to save instead when "Just you" cannot be had from the artifacts' server as it is.
    function setSharing(change: ArtifactOpenScope, otherwise?: ArtifactOpenScope) {
        if (!opened || pendingShare || publishing || change === opened.artifact.openScope) return;
        const before = opened.artifact.openScope;
        pendingShare = change;
        shareFailed = false;
        copied = "no";
        void shareArtifact(id, { openScope: change }, actualCowebsite.chat).then(
            (artifact) => {
                if (destroyed) return;
                pendingShare = undefined;
                if (!opened) return;
                sharedChoices++;
                opened = {
                    ...opened,
                    artifact: {
                        ...opened.artifact,
                        openScope: artifact.openScope,
                    },
                };
                // To or from "Just you" its files move, and the address they had stops: the version on show is opened
                // again where they are now. A document is drawn from its text, and has no address.
                if ((before === "me" || artifact.openScope === "me") && kind !== "markdown") void renewAddress();
            },
            (error) => {
                if (destroyed) return;
                pendingShare = undefined;
                if (otherwise && error instanceof ArtifactRequestError && NO_PRIVATE_FILES.includes(error.code)) {
                    setSharing(otherwise);
                    return;
                }
                console.warn("Could not change who can open an artifact", error);
                shareFailed = true;
            }
        );
    }

    // Away from the chat it was made in, the first choice reads "Just you" for both ways of keeping it: with its chat,
    // where nobody else is, and to its owner alone. Picked after "Anyone with the link" it keeps the file itself to its
    // owner, so what the link gave out stops for good, and its line says so. Where that cannot be had, it goes back to
    // its chat, as before.
    function pickJustYou() {
        if (openScope === "link" || openScope === "public") setSharing("me", "chat");
    }

    function copyLink() {
        if (!link) return;
        const copying = navigator.clipboard?.writeText(link) ?? Promise.reject(new Error("No clipboard"));
        copying.then(
            () => {
                if (destroyed) return;
                copied = "yes";
                if (copiedTimer) clearTimeout(copiedTimer);
                copiedTimer = setTimeout(() => {
                    if (copied === "yes") copied = "no";
                }, COPIED_FOR_MS);
            },
            () => {
                if (!destroyed) copied = "failed";
            }
        );
    }

    function shareLink() {
        if (!link) return;
        navigator.share({ title, url: link }).catch((error: unknown) => {
            // Closing the share sheet is not a failure: do not copy behind the person's back.
            if (error instanceof DOMException && error.name === "AbortError") return;
            copyLink();
        });
    }

    function pickVersion(number: number) {
        menuOpen = false;
        versionStore.set(number);
    }

    function backToLatest() {
        versionStore.set(latest);
    }

    // The version showing becomes the latest again, as a new version made from it: the window then shows that one.
    function restoreShown() {
        if (!opened || restoring) return;
        const number = opened.version.number;
        restoring = true;
        restoreFailed = false;
        void restoreArtifactVersion(id, number, actualCowebsite.chat).then(
            (answer) => {
                if (destroyed) return;
                restoring = false;
                if ($versionStore !== number) {
                    // The person went on to another version meanwhile and stays there; the list shows the new one.
                    if (menuOpen) void loadVersions();
                    else versions = undefined;
                    return;
                }
                // The list is read again the next time it opens, with the new version in it. One opened while the
                // restore was on its way is put away, as picking a version does.
                menuOpen = false;
                versions = undefined;
                versionStore.set(answer.version.number);
            },
            (error) => {
                console.warn("Could not restore a version of an artifact", error);
                if (destroyed) return;
                restoring = false;
                // Said only over the version it was about
                if ($versionStore === number) restoreFailed = true;
            }
        );
    }

    function retryText() {
        textFailed = false;
        textAttempt++;
    }

    function toggleCode() {
        codeOn = !codeOn;
        retryText();
        // Back from the Code view the game draws the frame again itself. A private address is made for one drawing, and
        // not every browser keeps what ties a locked frame to it, so the frame is drawn from a new one.
        if (!codeOn && addressEndsAt !== undefined) drawFromNewAddress();
    }

    $: codeLines = text ? codeLinesOf(text.content) : [];
    $: documentHtml = kind === "markdown" && text ? renderMarkdown(text.content) : "";
</script>

<svelte:window on:pointerdown={onPointerDown} />

<div
    class="artifact"
    class:hidden={!visible}
    bind:clientWidth={panelWidth}
    bind:clientHeight={panelHeight}
    data-testid="artifactPanel"
>
    <OpenHereRow name={title} {line}>
        <span slot="icon"><OpenHereItemIcon {badge} /></span>
        {#if phase === "ready" && opened}
            <button
                type="button"
                class="open-here-action"
                class:picked={menuOpen}
                title={$LL.chat.artifacts.versions()}
                aria-label={$LL.chat.artifacts.versions()}
                aria-expanded={menuOpen}
                data-testid="artifactVersions"
                bind:this={versionsButton}
                on:click={toggleVersions}><IconHistory font-size="22" /></button
            >
            {#if opened.you.owner}
                <button
                    type="button"
                    class="open-here-action"
                    class:picked={shareOpen}
                    title={$LL.chat.artifacts.share()}
                    aria-label={$LL.chat.artifacts.share()}
                    aria-expanded={shareOpen}
                    data-testid="artifactShare"
                    bind:this={shareButton}
                    on:click={toggleShare}><IconShare font-size="22" /></button
                >
            {/if}
            {#if kind === "markdown"}
                <button
                    type="button"
                    class="open-here-action"
                    class:picked={downloadOpen}
                    title={$LL.chat.artifacts.download()}
                    aria-label={$LL.chat.artifacts.download()}
                    aria-expanded={documentTables.length > 0 || canSendTo ? downloadOpen : undefined}
                    disabled={!textReady || downloading}
                    data-testid="artifactDownload"
                    bind:this={downloadButton}
                    on:click={toggleDownload}><IconDownload font-size="22" /></button
                >
            {/if}
            {#if !compact}
                <button
                    type="button"
                    class="open-here-action"
                    class:picked={codeOn}
                    title={codeOn ? $LL.chat.artifacts.preview() : $LL.chat.artifacts.code()}
                    aria-label={codeOn ? $LL.chat.artifacts.preview() : $LL.chat.artifacts.code()}
                    aria-pressed={codeOn}
                    data-testid="artifactCode"
                    on:click={toggleCode}
                >
                    {#if codeOn}<IconEye font-size="22" />{:else}<IconCode font-size="22" />{/if}
                </button>
            {/if}
        {/if}
    </OpenHereRow>

    {#if phase === "ready" && opened && !isLatest}
        <div class="old-note" data-testid="artifactOldNote">
            <span>{$LL.chat.artifacts.oldVersionNote({ version: opened.version.number, latest })}</span>
            <span class="old-actions">
                <button type="button" class="quiet" on:click={backToLatest}>{$LL.chat.artifacts.backToLatest()}</button>
                {#if opened.you.owner}
                    <button
                        type="button"
                        class="quiet"
                        disabled={restoring}
                        data-testid="artifactRestore"
                        on:click={restoreShown}
                        >{#if restoring}<IconLoader font-size="16" class="spin" />{/if}
                        {$LL.chat.artifacts.restoreThis()}</button
                    >
                {/if}
            </span>
        </div>
    {/if}

    {#if showPublishBar && published}
        <div class="old-note" data-testid="artifactUnpublished">
            <span>{$LL.chat.artifacts.publishBar({ version: published.version, latest })}</span>
            <span class="old-actions">
                <button
                    type="button"
                    class="go publish-pill"
                    disabled={publishing || !!pendingShare}
                    data-testid="artifactPublishBar"
                    on:click={publish}
                    >{#if publishing}<IconLoader font-size="16" class="spin" />{/if}
                    {$LL.chat.artifacts.publish()}</button
                >
            </span>
        </div>
    {/if}

    {#if publishFailed && !shareOpen}
        <div class="old-note" role="alert" data-testid="artifactPublishFailed">
            <span>{$LL.chat.artifacts.publishFailed()}</span>
        </div>
    {/if}

    {#if restoreFailed}
        <div class="old-note" role="alert" data-testid="artifactRestoreFailed">
            <span>{$LL.chat.artifacts.restoreFailed()}</span>
        </div>
    {/if}

    {#if switchFailed}
        <div class="old-note" role="alert" data-testid="artifactSwitchFailed">
            <span>{failure === "offline" ? $LL.chat.artifacts.cantReach() : $LL.chat.artifacts.cantOpen()}</span>
        </div>
    {/if}

    <div class="stage">
        {#if phase === "opening" && !opened}
            <div class="state" role="status">
                <IconLoader font-size="28" class="spin" />
                <span>{$LL.chat.artifacts.opening()}</span>
            </div>
        {:else if phase === "failed"}
            <div class="state" role="alert" data-testid="artifactFailed" data-failure={failure}>
                <IconAlertTriangle font-size="28" />
                <b>{failure === "offline" ? $LL.chat.artifacts.cantReach() : $LL.chat.artifacts.cantOpen()}</b>
                <span
                    >{failure === "private"
                        ? $LL.chat.artifacts.keptPrivate()
                        : failure === "gone"
                        ? $LL.chat.artifacts.cantOpenHelp()
                        : $LL.chat.artifacts.cantReachHelp()}</span
                >
                {#if failure === "offline"}
                    <button type="button" class="quiet" on:click={retry}
                        ><IconRefresh font-size="16" /> {$LL.chat.artifacts.tryAgain()}</button
                    >
                {/if}
            </div>
        {:else if opened}
            {#if codeOn}
                <div class="code" data-testid="artifactCodeView">
                    {#if text}
                        <CodeView
                            lines={codeLines.slice(0, MAX_CODE_LINES)}
                            copyText={text.content}
                            codeKind={codeKindOfArtifact(kind)}
                            totalLines={codeLines.length}
                        />
                        {#if codeLines.length > MAX_CODE_LINES}<p class="cut">{$LL.chat.artifacts.codeCut()}</p>{/if}
                    {:else if textFailed}
                        <div class="state" role="alert">
                            <b>{$LL.chat.artifacts.cantReach()}</b>
                            <button type="button" class="quiet" on:click={retryText}
                                >{$LL.chat.artifacts.tryAgain()}</button
                            >
                        </div>
                    {:else}
                        <div class="state" role="status"><IconLoader font-size="28" class="spin" /></div>
                    {/if}
                </div>
            {:else if kind === "markdown"}
                <div class="document code-colors" data-testid="artifactDocument" use:coloredCodeBlocks={documentHtml}>
                    {#if text}
                        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                        {@html documentHtml}
                    {:else if textFailed}
                        <div class="state" role="alert">
                            <b>{$LL.chat.artifacts.cantReach()}</b>
                            <button type="button" class="quiet" on:click={retryText}
                                >{$LL.chat.artifacts.tryAgain()}</button
                            >
                        </div>
                    {:else}
                        <div class="state" role="status"><IconLoader font-size="28" class="spin" /></div>
                    {/if}
                </div>
            {:else if opened.version.url === null || addressOver}
                <!-- No address to draw it from yet: a new one is on its way. Never from anywhere else. -->
                <div class="state" role="status"><IconLoader font-size="28" class="spin" /></div>
            {:else if kind === "svg"}
                <!-- A picture cannot run anything, whatever the drawing holds. -->
                <img
                    class="drawing"
                    src={opened.version.url}
                    alt={title}
                    referrerpolicy="no-referrer"
                    on:error={redrawIfStopped}
                />
            {:else}
                <!-- The locked box: its scripts run, but the page has no origin of its own, no network except common
                     libraries, and no way into the game. The address is outside the game's own. A link in it opens in
                     a new tab when tapped, as the other site itself (a booking, a map), never in place of the game.
                     Each opening gets a frame of its own: the page of the one before goes at the switch, so nothing it says
                     afterwards comes from this window's frame, and a page heard here first spoke in the opening on show. -->
                {#key opening}
                    <iframe
                        title={$LL.chat.artifacts.frameTitle({ title, maker: makerName })}
                        src={opened.version.url}
                        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                        referrerpolicy="no-referrer"
                        allow=""
                        data-testid="artifactFrame"
                        bind:this={frameElement}
                        on:load={onFrameLoad}
                    />
                {/key}
                {#if payView}
                    <div class="pay-line" class:closable={payView.closable} role="status" data-testid="artifactPayLine">
                        {#if payView.closable}
                            <button
                                type="button"
                                class="pay-x"
                                aria-label={$LL.chat.artifacts.payClose()}
                                data-testid="artifactPayClose"
                                on:click={() => payments.dismiss()}>×</button
                            >
                        {/if}
                        <p class="pay-a">{payView.title}</p>
                        {#if payView.sub}<p class="pay-s">{payView.sub}</p>{/if}
                        {#if payView.actions.length > 0}
                            <div class="pay-acts">
                                {#each payView.actions as action (action.kind)}
                                    {#if action.kind === "resume"}
                                        <a
                                            class="pay-btn"
                                            class:cta={action.style === "primary"}
                                            href={action.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            data-testid="artifactPayContinue">{action.label}</a
                                        >
                                    {:else}
                                        <button
                                            type="button"
                                            class="pay-btn"
                                            class:cta={action.style === "primary"}
                                            disabled={action.kind === "copy" && action.disabled === true}
                                            data-testid="artifactPay-{action.kind}"
                                            on:click={() => payAction(action)}>{action.label}</button
                                        >
                                    {/if}
                                {/each}
                            </div>
                        {/if}
                        {#if receiptByHand}
                            <p class="pay-s" role="alert">{$LL.chat.artifacts.copyFailed()}</p>
                            <code
                                class="link-text"
                                aria-label={$LL.chat.artifacts.payReceiptLinkLabel()}
                                data-testid="artifactReceiptText">{receiptByHand}</code
                            >
                        {/if}
                    </div>
                {/if}
            {/if}
        {/if}
    </div>

    {#if downloadOpen}
        <div class="menu download-menu" bind:this={downloadMenu} data-testid="artifactDownloadMenu">
            <button
                type="button"
                class="menu-row"
                data-testid="artifactDownloadMarkdown"
                on:click={() => download("markdown")}
            >
                <span class="menu-text">
                    <b>{$LL.chat.artifacts.downloadDocument()}</b>
                    <small>{$LL.chat.artifacts.downloadDocumentHelp()}</small>
                </span>
            </button>
            {#if documentTables.length > 0}
                <button
                    type="button"
                    class="menu-row"
                    data-testid="artifactDownloadSheet"
                    on:click={() => download("spreadsheet")}
                >
                    <span class="menu-text">
                        <b>{$LL.chat.artifacts.downloadSheet()}</b>
                        <small>{$LL.chat.artifacts.downloadSheetHelp()}</small>
                    </span>
                </button>
            {/if}
            {#if canSendTo}
                <button type="button" class="menu-row" data-testid="artifactSendTo" on:click={sendToOthers}>
                    <span class="menu-text">
                        <b>{$LL.chat.sendTo.title()}</b>
                        <small>{$LL.chat.sendTo.rowHelp()}</small>
                    </span>
                </button>
            {/if}
        </div>
    {/if}

    {#if downloadNote}
        <div
            class="download-note"
            class:failed={downloadNote.kind === "failed"}
            role={downloadNote.kind === "failed" ? "alert" : "status"}
            data-testid="artifactDownloadNote"
        >
            {downloadNote.kind === "failed"
                ? $LL.chat.artifacts.downloadFailed()
                : $LL.chat.artifacts.downloadSaved({ name: downloadNote.name })}
        </div>
    {/if}

    {#if menuOpen || shareOpen}
        <div
            class="menu"
            bind:this={menu}
            style:max-height={menuRoom !== undefined ? `${menuRoom}px` : undefined}
            data-testid={shareOpen ? "artifactShareMenu" : "artifactVersionMenu"}
        >
            {#if shareOpen}
                <b class="menu-title" id="artifact-open-scope-{id}">{$LL.chat.artifacts.whoCanOpen()}</b>
                <div class="choices" role="radiogroup" aria-labelledby="artifact-open-scope-{id}">
                    {#if inItsChat}
                        <button
                            type="button"
                            role="radio"
                            class="choice"
                            class:picked={openScope === "me"}
                            aria-checked={openScope === "me"}
                            disabled={!!pendingShare || publishing}
                            data-testid="artifactOpenMe"
                            on:click={() => setSharing("me")}
                        >
                            <span class="menu-text"
                                ><b>{$LL.chat.artifacts.justYou()}</b><small>{$LL.chat.artifacts.justYouOnly()}</small
                                ></span
                            >
                            <span class="radio" />
                        </button>
                        <button
                            type="button"
                            role="radio"
                            class="choice"
                            class:picked={openScope === "chat"}
                            aria-checked={openScope === "chat"}
                            disabled={!!pendingShare || publishing}
                            data-testid="artifactOpenChat"
                            on:click={() => setSharing("chat")}
                        >
                            <span class="menu-text"
                                ><b>{$LL.chat.artifacts.openChat()}</b>{#if $peopleHere?.length}<small
                                        data-testid="artifactOpenChatPeople">{$peopleHere.join(", ")}</small
                                    >{/if}</span
                            >
                            <span class="radio" />
                        </button>
                    {:else}
                        <button
                            type="button"
                            role="radio"
                            class="choice"
                            class:picked={openScope !== "link" && openScope !== "public"}
                            aria-checked={openScope !== "link" && openScope !== "public"}
                            disabled={!!pendingShare || publishing}
                            data-testid="artifactOpenChat"
                            on:click={pickJustYou}
                        >
                            <span class="menu-text" data-testid="artifactOpenJustYou"
                                ><b>{$LL.chat.artifacts.justYou()}</b>{#if openScope !== "chat"}<small
                                        data-testid="artifactOpenJustYouOnly">{$LL.chat.artifacts.justYouOnly()}</small
                                    >{:else if justYouHelp}<small>{justYouHelp}</small>{/if}</span
                            >
                            <span class="radio" />
                        </button>
                    {/if}
                    <button
                        type="button"
                        role="radio"
                        class="choice"
                        class:picked={openScope === "link"}
                        aria-checked={openScope === "link"}
                        disabled={!!pendingShare || publishing}
                        data-testid="artifactOpenLink"
                        on:click={() => setSharing("link")}
                    >
                        <span class="menu-text"
                            ><b>{$LL.chat.artifacts.openLink()}</b><small>{$LL.chat.artifacts.openLinkHelp()}</small
                            ></span
                        >
                        <span class="radio" />
                    </button>
                    <button
                        type="button"
                        role="radio"
                        class="choice"
                        class:picked={openScope === "public"}
                        aria-checked={openScope === "public"}
                        disabled={!!pendingShare || publishing}
                        data-testid="artifactOpenPublic"
                        on:click={() => setSharing("public")}
                    >
                        <span class="menu-text"
                            ><b>{$LL.chat.artifacts.openPublic()}</b><small>{$LL.chat.artifacts.openPublicHelp()}</small
                            ></span
                        >
                        <span class="radio" />
                    </button>
                </div>
                {#if openScope === "public" || openScope === "link"}
                    {#if publishedGone}
                        <div class="publish-box" data-testid="artifactPublishedGone">
                            <b class="unavailable">{$LL.chat.artifacts.publicUnavailable()}</b>
                            <small>{$LL.chat.artifacts.publicUnavailableHelp()}</small>
                            {#if isLatest}
                                <button
                                    type="button"
                                    class="go publish-full"
                                    disabled={publishing || !!pendingShare}
                                    data-testid="artifactPublish"
                                    on:click={publish}>{$LL.chat.artifacts.publishVersion({ version: latest })}</button
                                >
                            {:else}
                                <button
                                    type="button"
                                    class="go publish-full"
                                    data-testid="artifactPublishOpenLatest"
                                    on:click={backToLatest}>{$LL.chat.artifacts.backToLatest()}</button
                                >
                            {/if}
                        </div>
                    {:else if published}
                        <div class="publish-row" data-testid="artifactPublished">
                            <span class="publish-text">
                                <b class="published"
                                    ><IconCheck font-size="16" />
                                    {$LL.chat.artifacts.publishedStatus({
                                        version: published.version,
                                        time: whenLabel(published.at),
                                    })}</b
                                >
                                {#if published.version < latest}
                                    <small>{$LL.chat.artifacts.unpublishedChanges({ version: latest })}</small>
                                {/if}
                            </span>
                            {#if published.version < latest}
                                {#if isLatest}
                                    <button
                                        type="button"
                                        class="go publish-pill"
                                        disabled={publishing || !!pendingShare}
                                        data-testid="artifactPublish"
                                        on:click={publish}
                                        >{#if publishing}<IconLoader font-size="16" class="spin" />{/if}
                                        {$LL.chat.artifacts.publish()}</button
                                    >
                                {:else}
                                    <button
                                        type="button"
                                        class="go publish-pill"
                                        data-testid="artifactPublishOpenLatest"
                                        on:click={backToLatest}>{$LL.chat.artifacts.backToLatest()}</button
                                    >
                                {/if}
                            {/if}
                        </div>
                    {:else if openScope === "public"}
                        <div class="publish-box" data-testid="artifactNotPublished">
                            <b>{$LL.chat.artifacts.notPublished()}</b>
                            <small>{$LL.chat.artifacts.publishHelp()}</small>
                            {#if isLatest}
                                <button
                                    type="button"
                                    class="go publish-full"
                                    disabled={publishing || !!pendingShare}
                                    data-testid="artifactPublish"
                                    on:click={publish}>{$LL.chat.artifacts.publishVersion({ version: latest })}</button
                                >
                            {:else}
                                <button
                                    type="button"
                                    class="go publish-full"
                                    data-testid="artifactPublishOpenLatest"
                                    on:click={backToLatest}>{$LL.chat.artifacts.backToLatest()}</button
                                >
                            {/if}
                        </div>
                    {:else}
                        <p class="menu-note pin" data-testid="artifactLinkFollows">
                            {$LL.chat.artifacts.linkFollows()}
                        </p>
                    {/if}
                    {#if publishFailed}
                        <p class="menu-note" role="alert" data-testid="artifactPublishFailedMenu">
                            {$LL.chat.artifacts.publishFailed()}
                        </p>
                    {/if}
                {/if}
                {#if shareFailed}
                    <p class="menu-note" role="alert" data-testid="artifactShareFailed">
                        {$LL.chat.artifacts.shareFailed()}
                    </p>
                {:else if (openScope === "link" || (openScope === "public" && published && !publishedGone)) && link}
                    <div class="link-actions">
                        {#if canShare}
                            <button
                                type="button"
                                class="glass"
                                disabled={!!pendingShare}
                                data-testid="artifactShareLink"
                                on:click={shareLink}><IconShare font-size="18" /> {$LL.chat.artifacts.share()}</button
                            >
                        {/if}
                        <button
                            type="button"
                            class="go"
                            class:wide={canShare}
                            disabled={!!pendingShare}
                            data-testid="artifactCopyLink"
                            on:click={copyLink}
                        >
                            {#if copied === "yes"}
                                <IconCheck font-size="18" />
                                <span role="status" data-testid="artifactLinkCopied"
                                    >{$LL.chat.artifacts.linkCopied()}</span
                                >
                            {:else}
                                <IconCopy font-size="18" /> {$LL.chat.artifacts.copyLink()}
                            {/if}
                        </button>
                    </div>
                    {#if copied === "failed"}
                        <p class="menu-note" role="alert">{$LL.chat.artifacts.copyFailed()}</p>
                        <code class="link-text" data-testid="artifactLinkText">{link}</code>
                    {/if}
                {:else if openScope === "chat" && inItsChat}
                    <p class="menu-note">{$LL.chat.artifacts.openChatNote()}</p>
                {:else if openScope === "me" && inItsChat}
                    <p class="menu-note" data-testid="artifactJustYouNote">{$LL.chat.artifacts.justYouNote()}</p>
                {/if}
            {:else}
                <b class="menu-title">{$LL.chat.artifacts.versions()}</b>
                {#if versionsFailed}
                    <p class="menu-note">{$LL.chat.artifacts.cantReach()}</p>
                {:else if !versions}
                    <p class="menu-note">{$LL.chat.artifacts.loadingVersions()}</p>
                {:else}
                    {#each versions as version (version.number)}
                        <button
                            type="button"
                            class="menu-row"
                            class:picked={opened?.version.number === version.number}
                            on:click={() => pickVersion(version.number)}
                        >
                            <span class="vnum">{version.number}</span>
                            <span class="menu-text">
                                <b>
                                    {version.number === latest
                                        ? $LL.chat.artifacts.versionLatest({ version: version.number })
                                        : $LL.chat.artifacts.versionRow({ version: version.number })}
                                </b>
                                {#if version.summary}<small>{version.summary}</small>{/if}
                                <small>
                                    {version.askedByName
                                        ? $LL.chat.artifacts.askedAt({
                                              name: version.askedByName,
                                              time: whenLabel(version.createdAt),
                                          })
                                        : $LL.chat.artifacts.madeAt({ time: whenLabel(version.createdAt) })}
                                </small>
                            </span>
                        </button>
                    {/each}
                    <p class="menu-note">{$LL.chat.artifacts.versionsNote()}</p>
                {/if}
            {/if}
        </div>
    {/if}
</div>

<style>
    .artifact {
        position: relative;
        display: flex;
        flex-direction: column;
        width: 100%;
        height: 100%;
        color: #fff;
        font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .hidden {
        display: none;
    }
    .stage {
        position: relative;
        flex: 1;
        min-height: 0;
        background: #0a0814;
        overflow: auto;
    }
    .pay-line {
        position: absolute;
        bottom: max(12px, env(safe-area-inset-bottom));
        left: 50%;
        z-index: 2;
        display: grid;
        gap: 8px;
        max-width: calc(100% - 24px);
        padding: 12px 16px;
        border-radius: 16px;
        background: #15121f;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        font-size: 14px;
        color: #f3f1fa;
        text-align: center;
        transform: translateX(-50%);
    }
    .pay-line.closable {
        padding-right: 44px;
    }
    .pay-line p {
        margin: 0;
    }
    .pay-a {
        font-weight: 600;
    }
    .pay-s {
        font-size: 13px;
        line-height: 1.4;
        color: #b3acc7;
    }
    .pay-acts {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        margin-top: 4px;
    }
    .pay-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 18px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        font: inherit;
        font-weight: 700;
        color: #fff;
        text-decoration: none;
        cursor: pointer;
    }
    .pay-btn.cta {
        border-color: transparent;
        background: linear-gradient(90deg, #8629fc, #4156f6);
    }
    .pay-btn:disabled {
        cursor: default;
        opacity: 0.7;
    }
    .pay-x {
        position: absolute;
        top: 4px;
        right: 4px;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 0;
        background: transparent;
        font-size: 20px;
        color: rgba(255, 255, 255, 0.6);
        cursor: pointer;
    }
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #0a0814;
    }
    .drawing {
        display: block;
        max-width: 100%;
        max-height: 100%;
        margin: 0 auto;
        padding: 12px;
        box-sizing: border-box;
    }
    .document {
        padding: 16px;
        font-size: 15px;
        line-height: 1.55;
        overflow-wrap: anywhere;
    }
    /* The game's own heading styles are big and capital; a document reads like a document. */
    .document :global(h1),
    .document :global(h2),
    .document :global(h3),
    .document :global(h4) {
        margin: 1.2em 0 0.4em;
        font-family: inherit;
        font-weight: 700;
        line-height: 1.25;
        text-transform: none;
        letter-spacing: 0;
    }
    .document :global(h1) {
        font-size: 24px;
    }
    .document :global(h2) {
        font-size: 20px;
    }
    .document :global(h3),
    .document :global(h4) {
        font-size: 16px;
    }
    .document :global(:first-child) {
        margin-top: 0;
    }
    .document :global(p),
    .document :global(ul),
    .document :global(ol),
    .document :global(blockquote),
    .document :global(pre) {
        margin: 0 0 0.8em;
    }
    .document :global(pre) {
        padding: 10px 12px;
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.06);
        overflow: auto;
    }
    .document :global(code) {
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 13px;
    }
    .document :global(a) {
        color: #c4b5fd;
    }
    /*
     * A table: the document's "break anywhere" rule would shrink every column to one letter and make each row thousands of
     * pixels tall, so a cell keeps to one line and a table wider than the window scrolls sideways inside the document. The
     * page's own table style (outer space, stretched rows, centred headings) never applies.
     */
    .document :global(table) {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 0 0 0.8em;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        border: 0;
        border-radius: 0;
        border-collapse: collapse;
        font-size: 13px;
    }
    .document :global(th),
    .document :global(td) {
        height: auto;
        padding: 5px 10px;
        border: 1px solid rgba(255, 255, 255, 0.18);
        text-align: left;
        text-transform: none;
        letter-spacing: normal;
        vertical-align: top;
        white-space: nowrap;
        overflow-wrap: normal;
        word-break: normal;
    }
    .document :global(th) {
        background: rgba(255, 255, 255, 0.08);
        font-weight: 700;
    }
    .state {
        height: 100%;
        min-height: 160px;
        box-sizing: border-box;
        padding: 24px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 10px;
        text-align: center;
        color: rgba(255, 255, 255, 0.75);
    }
    .state b {
        color: #fff;
        font-size: 16px;
    }
    .state span {
        max-width: 36ch;
        font-size: 14px;
    }
    .state :global(.spin),
    .quiet :global(.spin) {
        animation: artifact-spin 1s linear infinite;
    }
    @keyframes artifact-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .state :global(.spin),
        .quiet :global(.spin) {
            animation: none;
        }
    }
    .publish-box {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 12px 4px 4px;
    }
    .publish-box > small,
    .publish-text > small {
        color: rgba(255, 255, 255, 0.72);
        font-size: 13px;
    }
    .publish-box .unavailable {
        color: #fdba74;
        font-size: 14px;
    }
    .publish-row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 4px 4px;
    }
    .publish-text {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .publish-text .published {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        color: #c4b5fd;
        font-size: 14px;
    }
    .go.publish-full {
        width: 100%;
        margin-top: 8px;
    }
    .go.publish-pill {
        flex: 0 0 auto;
        width: auto;
        min-height: 44px;
        padding: 0 22px;
    }
    .menu-note.pin {
        margin-top: 8px;
    }
    .old-note {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px 10px;
        padding: 8px 12px;
        font-size: 13px;
        background: rgba(134, 41, 252, 0.14);
        border-bottom: 1px solid rgba(167, 139, 250, 0.35);
    }
    .old-note > span:first-child {
        flex: 1;
        min-width: 180px;
    }
    .old-actions {
        display: flex;
        gap: 6px;
    }
    .quiet {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.06);
        color: #fff;
        font: 600 13px inherit;
        font-family: inherit;
        cursor: pointer;
    }
    .quiet:disabled {
        cursor: default;
        opacity: 0.7;
    }
    .quiet:focus-visible,
    .menu-row:focus-visible,
    .choice:focus-visible,
    .go:focus-visible,
    .glass:focus-visible {
        outline: 2px solid #c4b5fd;
        outline-offset: 2px;
    }
    .code {
        min-height: 100%;
        background: #0f0c19;
    }
    .cut {
        margin: 0;
        padding: 0 12px 12px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .menu {
        position: absolute;
        top: 60px;
        inset-inline-end: 8px;
        z-index: 5;
        box-sizing: border-box;
        width: min(340px, calc(100% - 16px));
        max-height: calc(100% - 76px);
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px;
        border-radius: 18px;
        background: linear-gradient(160deg, rgb(31 28 47 / 0.98), rgb(20 18 30 / 0.99));
        box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 0 0 1px rgba(167, 139, 250, 0.18),
            0 18px 40px rgb(0 0 0 / 0.5);
    }
    .menu-title {
        font-size: 12px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: rgba(255, 255, 255, 0.6);
        padding: 6px 6px 2px;
    }
    .download-menu {
        min-width: 240px;
    }
    .download-note {
        position: absolute;
        inset-inline: 12px;
        bottom: max(16px, env(safe-area-inset-bottom));
        z-index: 6;
        margin-inline: auto;
        width: fit-content;
        max-width: calc(100% - 24px);
        padding: 9px 14px;
        border: 1px solid rgba(255, 255, 255, 0.16);
        border-radius: 999px;
        background: rgba(42, 38, 64, 0.96);
        color: #fff;
        font-size: 13px;
        text-align: center;
        overflow-wrap: anywhere;
        pointer-events: none;
    }
    .download-note.failed {
        border-color: rgba(248, 113, 113, 0.6);
        background: rgba(74, 31, 38, 0.97);
    }
    .menu-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        min-height: 48px;
        padding: 8px;
        border: 0;
        border-radius: 12px;
        background: transparent;
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .menu-row:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .menu-row.picked {
        background: rgba(134, 41, 252, 0.14);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.7);
    }
    .vnum {
        flex: none;
        width: 32px;
        height: 32px;
        border-radius: 10px;
        display: grid;
        place-items: center;
        font-weight: 700;
        font-size: 14px;
        background: rgba(255, 255, 255, 0.08);
    }
    .menu-text {
        display: flex;
        flex-direction: column;
        min-width: 0;
        line-height: 1.3;
    }
    .menu-text b {
        font-size: 14px;
    }
    .menu-text small {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.6);
    }
    .menu-note {
        margin: 4px 6px 2px;
        font-size: 12px;
        color: rgba(255, 255, 255, 0.55);
    }
    .choices {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .choice {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 5px 12px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(255, 255, 255, 0.03);
        color: #fff;
        font: inherit;
        text-align: start;
        cursor: pointer;
    }
    .choice .menu-text {
        flex: 1;
    }
    .choice:hover {
        background: rgba(255, 255, 255, 0.08);
    }
    .choice.picked {
        background: rgba(134, 41, 252, 0.18);
        border-color: rgba(167, 139, 250, 0.7);
    }
    .choice:disabled {
        cursor: default;
    }
    .radio {
        flex: none;
        width: 20px;
        height: 20px;
        box-sizing: border-box;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.35);
    }
    .choice.picked .radio {
        border: 0;
        background: radial-gradient(circle, #fff 0 4px, transparent 4.5px), linear-gradient(135deg, #8629fc, #4156f6);
    }
    /* Share and Copy link side by side, as on the invite bar (InviteFooter): Copy link takes the larger share. */
    .link-actions {
        display: flex;
        gap: 8px;
        margin: 4px 0 0;
    }
    .go,
    .glass {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        gap: 8px;
        min-height: 44px;
        margin: 0;
        border-radius: 999px;
        font-family: inherit;
        font-size: 14px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .go.wide {
        flex: 1.4;
    }
    .glass {
        border: 1px solid rgba(255, 255, 255, 0.12);
        background: rgba(255, 255, 255, 0.08);
    }
    .go:disabled,
    .glass:disabled {
        cursor: default;
        opacity: 0.7;
    }
    .go {
        border: 0;
        background: linear-gradient(135deg, #8629fc, #4156f6);
        box-shadow: 0 8px 24px -8px rgba(134, 41, 252, 0.7);
    }
    .link-text {
        margin: 0 6px 2px;
        padding: 8px 10px;
        border-radius: 10px;
        background: #0f0c19;
        font-size: 12px;
        overflow-wrap: anywhere;
        user-select: all;
    }
</style>
