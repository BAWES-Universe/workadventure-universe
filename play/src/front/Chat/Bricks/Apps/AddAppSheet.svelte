<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import LL from "../../../../i18n/i18n-svelte";
    import PageButton from "../../../external-modules/bots/components/page/PageButton.svelte";
    import { botApiService } from "../../../external-modules/bots/services/BotApiService";
    import {
        NO_DISCOVERY,
        looksLikeLink,
        newAppBody,
        oauthFieldsDone,
        parseDiscovery,
        parseNewAppId,
        parseThings,
        reservedHeader,
        signsInByItself,
        type Discovery,
        type HeaderRow,
        type OAuthFields,
        type SentAs,
        type SignIn,
    } from "./AddApp";
    import AppSheet from "./AppSheet.svelte";
    import { loadMyApps } from "./AppsStore";
    import { signInInPopup } from "./Reconnect";
    import {
        IconChevronDown,
        IconChevronRight,
        IconCircleCheck,
        IconKey,
        IconLoader2,
        IconLock,
        IconWorld,
    } from "@wa-icons";

    /**
     * "Add your own app" (game #2001, mock Part 13): paste the app's link and Universe checks how it signs in. When the check
     * finds the app's own sign-in page, one button opens it. When it finds nothing the sheet asks "How does it sign in?" and
     * the person picks the sign-in page, a key or token, or no sign-in. Once it is connected it says what the app can do, and
     * "Done" opens the app's page to choose which Bricks use it.
     *
     * A key typed here goes straight to Orbit, which keeps it locked; it is never sent through a chat, and no Brick sees it.
     * The sheet is the place a later "Add a key" for a service with no link of its own plugs into.
     */
    export let onClose: () => void;
    /** The app is connected and the person chose Done: open its page */
    export let onDone: (appId: string) => void;

    type Phase = "empty" | "checking" | "found" | "pick" | "connected";
    type Trouble = "" | "failed" | "stopped" | "blocked" | "reserved";

    $: text = $LL.chat.brick.apps.addOwn;
    let phase: Phase = "empty";
    let link = "";
    let name = "";
    let nameTouched = false;
    let discovery: Discovery = NO_DISCOVERY;
    let signIn: SignIn = "oauth";
    let sentAs: SentAs = "bearer";
    let key = "";
    let oauth: OAuthFields = { authorizeUrl: "", tokenUrl: "", clientId: "", clientSecret: "", scopes: "" };
    let headers: HeaderRow[] = [];
    let headersOpen = false;
    let nextHeaderId = 0;
    let busy = false;
    let trouble: Trouble = "";
    let reserved = "";
    /** The app Orbit made for this sheet, kept so that a second tap on the sign-in button does not make a second one */
    let createdId: string | undefined;
    /** What that app was made from: if the person changes any of it before trying again, the old app is replaced */
    let createdFrom = "";
    /** The sheet was closed: an app that is still being made is taken away again when Orbit answers */
    let closed = false;
    let things: string[] | undefined;
    let linkInput: HTMLInputElement | undefined;

    let checkId = 0;
    let checkAbort: AbortController | undefined;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;

    $: linkOk = looksLikeLink(link);
    $: who = discovery.signsInWith ?? discovery.name ?? name;
    $: oauthDone = oauthFieldsDone(oauth, discovery.registration);
    $: canAdd = signIn === "key" ? key.trim() !== "" : signIn === "none";

    onMount(() => {
        // The sheet moves focus to itself first; the link field is where the person types
        void tick().then(() => linkInput?.focus());
    });

    onDestroy(() => {
        // The sheet can go away without its own close (signed out, the page changed): same clean-up as close
        closed = true;
        if (checkTimer) clearTimeout(checkTimer);
        checkAbort?.abort();
        dropUnfinished();
    });

    function forgetCheck() {
        if (checkTimer) clearTimeout(checkTimer);
        checkTimer = undefined;
        checkAbort?.abort();
        checkAbort = undefined;
        checkId++;
    }

    /** An app made for this sheet that never got signed in is taken away again: nothing half-made stays in Apps */
    function dropUnfinished() {
        const id = createdId;
        createdId = undefined;
        createdFrom = "";
        if (!id || phase === "connected") return;
        botApiService
            .disconnectMyApp(id)
            .catch((error: unknown) => console.warn("Could not drop the unfinished app", error));
    }

    function onLinkInput(event: Event) {
        forgetCheck();
        dropUnfinished();
        discovery = NO_DISCOVERY;
        phase = "empty";
        trouble = "";
        // `linkOk` is only brought up to date after this handler, so the link itself is looked at
        if (!looksLikeLink(link)) return;
        // A pasted link is checked at once; a typed one when the person stops for a moment
        const pasted = (event as InputEvent).inputType === "insertFromPaste";
        checkTimer = setTimeout(() => void check(), pasted ? 0 : 600);
    }

    async function check() {
        if (!looksLikeLink(link)) return;
        forgetCheck();
        const mine = checkId;
        checkAbort = new AbortController();
        const signal = checkAbort.signal;
        phase = "checking";
        let answer: unknown;
        try {
            answer = await botApiService.discoverMcpOAuthEndpoints(
                link.trim(),
                `${window.location.origin}/api/oauth/mcp-callback`,
                signal
            );
        } catch (error) {
            // An app that can't be reached, or an answer that is not understood, is "the app didn't say"
            if (!signal.aborted) console.warn("Could not check how the app signs in", error);
            answer = undefined;
        }
        if (mine !== checkId) return;
        discovery = parseDiscovery(answer);
        if (!nameTouched) name = discovery.name ?? text.namePlaceholder();
        oauth = {
            authorizeUrl: discovery.authorizeUrl,
            tokenUrl: discovery.tokenUrl,
            clientId: discovery.clientId,
            clientSecret: discovery.clientSecret,
            scopes: discovery.scopes,
            revocationUrl: discovery.revocationUrl,
        };
        signIn = "oauth";
        phase = signsInByItself(discovery) ? "found" : "pick";
    }

    function onNameInput() {
        nameTouched = true;
    }

    function appBody() {
        return newAppBody({
            name: name.trim() || text.namePlaceholder(),
            link,
            signIn: phase === "found" ? "oauth" : signIn,
            sentAs,
            key,
            oauth,
            headers,
        });
    }

    /**
     * The app this sheet made, made again when the person changed anything it was made from (the way in, a key, a header, the
     * name) after a try that did not finish. Its id comes back as a promise so the sign-in window can open first.
     */
    function theApp(): Promise<string> {
        const body = appBody();
        const from = JSON.stringify(body);
        if (createdId && createdFrom === from) return Promise.resolve(createdId);
        dropUnfinished();
        return create(body, from);
    }

    /** Makes the app in Orbit, with the way in the person gave */
    async function create(body: ReturnType<typeof appBody>, from: string): Promise<string> {
        try {
            const id = parseNewAppId(await botApiService.addMyApp(body));
            if (!id) throw new Error("Orbit did not say which app it made");
            if (closed) {
                // The sheet was closed while Orbit was making it: nobody is left to finish it
                botApiService
                    .disconnectMyApp(id)
                    .catch((error: unknown) => console.warn("Could not drop the app", error));
                throw new Error("The sheet was closed");
            }
            createdId = id;
            createdFrom = from;
            return id;
        } catch (error) {
            console.warn("Could not add the app", error);
            if (!closed) trouble = "failed";
            throw error;
        }
    }

    function headersFine(): boolean {
        const refused = reservedHeader(headers);
        if (refused === undefined) return true;
        reserved = refused;
        trouble = "reserved";
        headersOpen = true;
        return false;
    }

    /** Opens the app's own sign-in page. Called straight from the tap, so the browser lets the window open. */
    async function startSignIn() {
        if (busy || !headersFine()) return;
        busy = true;
        trouble = "";
        const creating = theApp();
        // If the window can't open the rejection is not awaited anywhere else; it has already been said on the sheet
        creating.catch(() => undefined);
        try {
            const result = await signInInPopup(creating);
            // A window that could not open answers before the app is made: the sheet stays busy until Orbit has answered, so a
            // second tap cannot make a second app
            await creating.catch(() => undefined);
            // `create()` said so on the sheet while the window was open: the type system cannot see that
            if ((trouble as Trouble) === "failed") return;
            if (result === "done") await connected();
            else trouble = result === "blocked" ? "blocked" : "stopped";
        } catch (error) {
            console.warn("The sign-in did not finish", error);
            if (trouble === "") trouble = "failed";
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
    }

    /** A key or no sign-in: nothing opens, the app is connected as soon as it exists */
    async function addApp() {
        if (busy || !canAdd || !headersFine()) return;
        busy = true;
        trouble = "";
        try {
            await theApp();
            await connected();
        } catch {
            // said on the sheet by create()
        } finally {
            // eslint-disable-next-line require-atomic-updates
            busy = false;
        }
    }

    async function connected() {
        const id = createdId;
        if (!id) return;
        // What it can do, from the app itself. Orbit may not say (yet): the sheet then just says "Connected".
        things = parseThings(await botApiService.getMyAppThings(id).catch(() => undefined));
        phase = "connected";
        loadMyApps(true).catch((error: unknown) => console.warn("Could not read your apps", error));
    }

    function close() {
        closed = true;
        forgetCheck();
        dropUnfinished();
        onClose();
    }

    function done() {
        if (createdId) onDone(createdId);
        else onClose();
    }

    function addHeader() {
        headers = [...headers, { id: ++nextHeaderId, key: "", value: "" }];
        headersOpen = true;
    }

    function removeHeader(index: number) {
        headers = headers.filter((_, at) => at !== index);
    }
</script>

<AppSheet
    title={text.title()}
    sub={text.sub()}
    onClose={close}
    closeLabel={text.close()}
    stickyButtons
    testId="addAppSheet"
>
    <label class="fl">
        <span class="lb">{text.link()}</span>
        <input
            bind:this={linkInput}
            bind:value={link}
            on:input={onLinkInput}
            class="in"
            class:on={phase === "empty"}
            type="url"
            inputmode="url"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            disabled={phase === "connected" || busy}
            placeholder={text.linkPlaceholder()}
            data-testid="addAppLink"
        />
    </label>

    {#if phase !== "empty" && phase !== "checking"}
        <label class="fl">
            <span class="lb">{text.name()}</span>
            <input
                bind:value={name}
                on:input={onNameInput}
                class="in"
                type="text"
                autocomplete="off"
                disabled={phase === "connected" || busy}
                placeholder={text.namePlaceholder()}
                data-testid="addAppName"
            />
            {#if discovery.name && !nameTouched}<span class="hint" data-testid="addAppNameHint">{text.nameHint()}</span
                >{/if}
        </label>
    {/if}

    {#if phase === "checking"}
        <div class="row" data-testid="addAppChecking">
            <span class="ico spin"><IconLoader2 font-size="20" /></span>
            <span class="tx"><span class="t">{text.checking()}</span></span>
        </div>
    {:else if phase === "found"}
        <div class="row" data-testid="addAppFound">
            <span class="ico ok"><IconLock font-size="20" /></span>
            <span class="tx">
                <span class="t">{text.signsIn({ who })}</span>
                <span class="m">{text.signsInFound({ who })}</span>
            </span>
        </div>
    {:else if phase === "connected"}
        <div class="row" data-testid="addAppConnected">
            <span class="ico ok"><IconCircleCheck font-size="20" /></span>
            <span class="tx">
                {#if things}
                    <span class="t">{text.connectedThings({ count: things.length })}</span>
                    <span class="m">{text.connectedList({ things: things.join(", ") })}</span>
                {:else}
                    <span class="t">{text.connected()}</span>
                    <span class="m">{text.connectedNext()}</span>
                {/if}
            </span>
        </div>
    {:else if phase === "pick"}
        <div class="ask">
            <span class="t">{text.howTitle()}</span>
            <span class="m">{text.howSub()}</span>
        </div>
        <div class="opts" role="radiogroup" aria-label={text.howTitle()}>
            <button
                type="button"
                role="radio"
                aria-checked={signIn === "oauth"}
                class="opt"
                class:sel={signIn === "oauth"}
                data-testid="addAppHowOauth"
                on:click={() => (signIn = "oauth")}
            >
                <span class="oi"><IconLock font-size="20" /></span>
                <span class="tx"
                    ><span class="t">{text.howOauth()}</span><span class="m">{text.howOauthHint()}</span></span
                >
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={signIn === "key"}
                class="opt"
                class:sel={signIn === "key"}
                data-testid="addAppHowKey"
                on:click={() => (signIn = "key")}
            >
                <span class="oi"><IconKey font-size="20" /></span>
                <span class="tx"><span class="t">{text.howKey()}</span><span class="m">{text.howKeyHint()}</span></span>
            </button>
            <button
                type="button"
                role="radio"
                aria-checked={signIn === "none"}
                class="opt"
                class:sel={signIn === "none"}
                data-testid="addAppHowNone"
                on:click={() => (signIn = "none")}
            >
                <span class="oi"><IconWorld font-size="20" /></span>
                <span class="tx"
                    ><span class="t">{text.howNone()}</span><span class="m">{text.howNoneHint()}</span></span
                >
            </button>
        </div>
        {#if signIn === "oauth"}
            <div class="grid">
                <label class="fl"
                    ><span class="lb">{text.authorizeAddress()}</span><input
                        class="in"
                        type="url"
                        autocomplete="off"
                        bind:value={oauth.authorizeUrl}
                        placeholder={text.authorizePlaceholder()}
                        data-testid="addAppAuthorize"
                    /></label
                >
                <label class="fl"
                    ><span class="lb">{text.tokenAddress()}</span><input
                        class="in"
                        type="url"
                        autocomplete="off"
                        bind:value={oauth.tokenUrl}
                        placeholder={text.tokenPlaceholder()}
                        data-testid="addAppToken"
                    /></label
                >
                <label class="fl"
                    ><span class="lb">{text.clientId()}</span><input
                        class="in"
                        type="text"
                        autocomplete="off"
                        bind:value={oauth.clientId}
                        placeholder={text.fromService()}
                        data-testid="addAppClientId"
                    /></label
                >
                <label class="fl"
                    ><span class="lb">{text.clientSecret()}</span><input
                        class="in"
                        type="password"
                        autocomplete="off"
                        bind:value={oauth.clientSecret}
                        placeholder={text.fromService()}
                        data-testid="addAppClientSecret"
                    /></label
                >
            </div>
        {:else if signIn === "key"}
            <label class="fl">
                <span class="lb">{text.key()}</span>
                <input
                    class="in"
                    class:on={key !== ""}
                    type="password"
                    autocomplete="off"
                    bind:value={key}
                    data-testid="addAppKey"
                />
            </label>
            <div class="fl">
                <span class="lb" id="addAppSentAs">{text.sentAs()}</span>
                <div class="chips" role="radiogroup" aria-labelledby="addAppSentAs">
                    <button
                        type="button"
                        role="radio"
                        aria-checked={sentAs === "bearer"}
                        class="chip"
                        class:sel={sentAs === "bearer"}
                        data-testid="addAppSentBearer"
                        on:click={() => (sentAs = "bearer")}>{text.bearer()}</button
                    >
                    <button
                        type="button"
                        role="radio"
                        aria-checked={sentAs === "api-key"}
                        class="chip"
                        class:sel={sentAs === "api-key"}
                        data-testid="addAppSentApiKey"
                        on:click={() => (sentAs = "api-key")}>{text.apiKey()}</button
                    >
                </div>
                <span class="hint">{text.sentAsHint()}</span>
            </div>
            <p class="note" data-testid="addAppKeyNote">{text.keyNote()}</p>
        {/if}
    {/if}

    {#if phase === "found" || phase === "pick"}
        <button
            type="button"
            class="more"
            aria-expanded={headersOpen}
            data-testid="addAppExtra"
            on:click={() => (headersOpen = !headersOpen)}
        >
            <span>{text.extraHeaders()}</span>
            <span class="m"
                >{headers.filter((header) => header.key.trim()).length > 0
                    ? text.extraSome({ count: headers.filter((header) => header.key.trim()).length })
                    : text.extraNone()}</span
            >
            {#if headersOpen}<IconChevronDown font-size="18" />{:else}<IconChevronRight font-size="18" />{/if}
        </button>
        {#if headersOpen}
            <div class="hdrs">
                {#each headers as header, index (header.id)}
                    <div class="hdr">
                        <input
                            class="in"
                            type="text"
                            autocomplete="off"
                            aria-label={text.headerName()}
                            placeholder={text.headerName()}
                            bind:value={header.key}
                            data-testid="addAppHeaderName"
                        />
                        <input
                            class="in"
                            type="text"
                            autocomplete="off"
                            aria-label={text.headerValue()}
                            placeholder={text.headerValue()}
                            bind:value={header.value}
                            data-testid="addAppHeaderValue"
                        />
                        <button
                            type="button"
                            class="hdr-x"
                            aria-label={text.removeHeader()}
                            on:click={() => removeHeader(index)}>×</button
                        >
                    </div>
                {/each}
                <div><PageButton testId="addAppAddHeader" on:click={addHeader}>{text.addHeader()}</PageButton></div>
            </div>
        {/if}
    {/if}

    {#if trouble === "failed"}
        <p class="bad" data-testid="addAppFailed">{text.failed()}</p>
    {:else if trouble === "stopped"}
        <p class="bad" data-testid="addAppStopped">{text.signInStopped()}</p>
    {:else if trouble === "blocked"}
        <p class="bad" data-testid="addAppBlocked">{text.signInBlocked()}</p>
    {:else if trouble === "reserved"}
        <p class="bad" data-testid="addAppReserved">{text.headerReserved({ name: reserved })}</p>
    {/if}

    <svelte:fragment slot="buttons">
        <PageButton tall testId="addAppCancel" on:click={close}>{text.cancel()}</PageButton>
        {#if phase === "found"}
            <PageButton tall go disabled={busy} testId="addAppSignIn" on:click={() => void startSignIn()}
                >{busy ? text.waiting() : text.signsInWithButton({ who })}</PageButton
            >
        {:else if phase === "connected"}
            <PageButton tall go testId="addAppDone" on:click={done}>{text.done()}</PageButton>
        {:else if phase === "pick" && signIn === "oauth"}
            <PageButton
                tall
                go
                disabled={busy || !oauthDone}
                testId="addAppSaveSignIn"
                on:click={() => void startSignIn()}>{busy ? text.waiting() : text.saveAndSignIn()}</PageButton
            >
        {:else if phase === "pick"}
            <PageButton tall go disabled={busy || !canAdd} testId="addAppAdd" on:click={() => void addApp()}
                >{text.addApp()}</PageButton
            >
        {:else}
            <PageButton
                tall
                go
                disabled={!linkOk || phase === "checking"}
                testId="addAppNext"
                on:click={() => void check()}>{text.next()}</PageButton
            >
        {/if}
    </svelte:fragment>
</AppSheet>

<style>
    .fl {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .lb {
        font-size: 13px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.82);
    }
    .in {
        width: 100%;
        height: 44px;
        box-sizing: border-box;
        margin: 0;
        padding: 0 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 12px;
        background: rgba(255, 255, 255, 0.04);
        font: inherit;
        font-size: 14px;
        color: #fff;
    }
    .in.on {
        border-color: rgba(167, 139, 250, 0.7);
    }
    .in::placeholder {
        color: rgba(244, 242, 250, 0.4);
    }
    .in:focus,
    .in:focus-visible {
        outline: none;
        box-shadow: none;
        border-color: rgba(167, 139, 250, 0.7);
    }
    .in:disabled {
        opacity: 0.7;
    }
    .hint {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.56);
    }
    .note {
        margin: 0;
        font-size: 12.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.56);
    }
    .bad {
        margin: 0;
        font-size: 13px;
        line-height: 1.4;
        color: #ff8a7a;
    }
    .row {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 6px 8px;
    }
    .ico {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        height: 28px;
        color: rgba(255, 255, 255, 0.85);
    }
    .ico.ok {
        color: #4ade80;
    }
    .ico.spin {
        color: #c4b5fd;
    }
    .ico.spin :global(svg) {
        animation: add-spin 1s linear infinite;
    }
    @keyframes add-spin {
        to {
            transform: rotate(360deg);
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .ico.spin :global(svg) {
            animation: none;
        }
    }
    .tx {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }
    .row .t {
        font-size: 15px;
        font-weight: 700;
    }
    .row .m {
        font-size: 13.5px;
        line-height: 1.4;
        color: rgba(244, 242, 250, 0.64);
    }
    .ask {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-top: 4px;
    }
    .ask .t {
        font-size: 15px;
        font-weight: 700;
    }
    .ask .m {
        font-size: 13px;
        color: rgba(244, 242, 250, 0.64);
    }
    .opts {
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .opt {
        display: flex;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-height: 52px;
        margin: 0;
        padding: 6px 10px;
        border: 0;
        border-radius: 14px;
        background: transparent;
        box-sizing: border-box;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    .opt.sel {
        background: rgba(134, 41, 252, 0.16);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.45);
    }
    .opt:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .oi {
        display: grid;
        place-items: center;
        flex: none;
        width: 28px;
        color: rgba(255, 255, 255, 0.85);
    }
    .opt .t {
        font-size: 14px;
        font-weight: 600;
    }
    .opt .m {
        font-size: 12.5px;
        color: rgba(244, 242, 250, 0.64);
    }
    .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
    }
    .grid .in {
        min-width: 0;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        height: 40px;
        margin: 0;
        padding: 0 14px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        color: #fff;
        cursor: pointer;
    }
    .chip.sel {
        background: rgba(134, 41, 252, 0.22);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .chip:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .more {
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 44px;
        margin: 0;
        padding: 0 4px;
        border: 0;
        background: none;
        color: #fff;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }
    .more span:first-child {
        flex: 1;
        text-align: start;
    }
    .more .m {
        font-weight: 500;
        color: rgba(244, 242, 250, 0.56);
    }
    .hdrs {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .hdr {
        display: grid;
        grid-template-columns: 1fr 1fr 32px;
        align-items: center;
        gap: 8px;
    }
    .hdr .in {
        min-width: 0;
    }
    .hdr-x {
        height: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.08);
        font: inherit;
        font-size: 18px;
        color: #fff;
        cursor: pointer;
    }
</style>
