<script lang="ts">
    import { onMount, onDestroy, afterUpdate } from "svelte";
    import {
        botApiService,
        type McpServer,
        type CreateMcpServerDto,
        type McpServerTestResult,
    } from "../services/BotApiService";
    import PageButton from "./page/PageButton.svelte";
    import { IconChevronDown, IconPlus, IconTool } from "@wa-icons";

    export let botId: string;
    /** Told the servers after every load, so the Tools group can say what the bot has. */
    export let onServers: ((servers: McpServer[]) => void) | undefined = undefined;

    // ─── State ─────────────────────────────────────────────────────────────────────

    let servers: McpServer[] = [];
    let isLoading = true;
    let loadError: string | null = null;

    // Modal state
    let showModal = false;
    let editingServer: McpServer | null = null; // null = add mode, non-null = edit mode
    let modalName = "";
    let modalServerUrl = "";
    let modalAuthType: "none" | "bearer" | "api-key" | "oauth" = "none";
    let modalAuthConfig = "";
    let modalOauthAuthorizeUrl = "";
    let modalOauthTokenUrl = "";
    let modalOauthClientId = "";
    let modalOauthClientSecret = "";
    let modalOauthScopes = "";
    let modalHeaders: { key: string; value: string }[] = [];
    let modalLoading = false;
    let modalError: string | null = null;

    let editingExistingOauth = false;

    // Test connection state
    let testingServerId: string | null = null;
    /** The server opened to show its tools and actions; one at a time. */
    let openServerId: string | null = null;
    let testError: Record<string, string> = {};

    // Remove confirmation state
    let removingServerId: string | null = null;
    let removingLoading = false;

    let lastBotId = "";

    // ─── Lifecycle ──────────────────────────────────────────────────────────────────

    $: if (botId && botId !== lastBotId) {
        lastBotId = botId;
        void loadServers();
    }

    // Track the previous connecting server ID to detect when a flow completes
    // (regardless of how — postMessage, manual close, error, timeout).
    let _prevConnectingServerId: string | null = null;

    // When oauthConnectingServerId transitions from a value to null, reload
    // servers to pick up the updated oauthConnected / test result state.
    // This single reactive statement covers ALL exit paths, eliminating the
    // need to duplicate loadServers() calls in every handler.
    function refreshServersOnFlowComplete(prevServerId: string) {
        void loadServers().then(() => {
            const server = servers.find((s) => s.id === prevServerId);
            if (server?.oauthConnected) {
                void handleTestConnection(server.id);
            }
        });
    }

    $: {
        const prev = _prevConnectingServerId;
        _prevConnectingServerId = oauthConnectingServerId;
        if (prev !== null && oauthConnectingServerId === null) {
            refreshServersOnFlowComplete(prev);
        }
    }

    onMount(() => {
        // onMount is not needed — the reactive statement above already
        // triggers loadServers when botId is first assigned during init.
        // Keeping both would fire a redundant duplicate API call.

        // If this page was loaded as an OAuth popup (redirect from callback), close it
        if (window.location.search.includes("oauth=success") || window.location.search.includes("oauth=error")) {
            window.close();
        }
    });

    // ─── API calls ──────────────────────────────────────────────────────────────────

    async function loadServers() {
        if (!botApiService.isInitialized()) {
            loadError = "Bot API service not initialized";
            isLoading = false;
            return;
        }

        isLoading = true;
        loadError = null;

        try {
            servers = await botApiService.getBotMcpServers(botId);
            onServers?.(servers);
        } catch (error) {
            console.error("[BotMcpServersEditor] Error loading MCP servers:", error);
            loadError = "Failed to load MCP servers";
        } finally {
            isLoading = false;
        }
    }

    function openAddModal() {
        editingServer = null;
        modalName = "";
        modalServerUrl = "";
        modalAuthType = "none";
        modalAuthConfig = "";
        modalOauthAuthorizeUrl = "";
        modalOauthTokenUrl = "";
        modalOauthClientId = "";
        modalOauthClientSecret = "";
        modalOauthScopes = "";
        modalHeaders = [];
        modalError = null;
        showModal = true;
    }

    function openEditModal(server: McpServer) {
        editingServer = server;
        modalName = server.name;
        modalServerUrl = server.serverUrl;
        modalAuthType = server.authType;
        modalAuthConfig = server.authConfig || "";
        // OAuth config is encrypted — can't pre-populate individual fields.
        // Reset to empty so handleSaveServer's hasOAuthInput check works correctly.
        modalOauthAuthorizeUrl = "";
        modalOauthTokenUrl = "";
        modalOauthClientId = "";
        modalOauthClientSecret = "";
        modalOauthScopes = "";
        modalHeaders = server.headers ? Object.entries(server.headers).map(([key, value]) => ({ key, value })) : [];
        modalError = null;
        showModal = true;

        // When editing an existing OAuth server, seed afterUpdate prev values
        // so it doesn't trigger a stale OAuth discovery. The server is already
        // configured and working — re-discovering is unnecessary and can fail
        // if the provider is temporarily unreachable (Attio, etc.), showing
        // a misleading "not found" error.
        if (server.authType === "oauth") {
            if (server.oauthConnected) {
                // Connected server — show badge, no editable OAuth fields
                editingExistingOauth = true;
                _prevOauthAuthType = server.authType;
                _prevOauthServerUrl = server.serverUrl;
                oauthDiscoveryState = "discovered";
                discoveryRegistrationStatus = null;
            }
            // Not connected — let afterUpdate trigger discovery normally,
            // form fields will show for manual setup
        }
    }

    function closeModal() {
        showModal = false;
        editingServer = null;
        modalLoading = false;
        modalError = null;
        // Reset OAuth state to prevent stale values bleeding into next modal open
        modalAuthType = "none";
        modalServerUrl = "";
        modalOauthAuthorizeUrl = "";
        modalOauthTokenUrl = "";
        modalOauthClientId = "";
        modalOauthClientSecret = "";
        modalOauthScopes = "";
        // Cancel any in-flight or pending discovery before resetting state
        if (discoveryAbortController) {
            discoveryAbortController.abort();
            discoveryAbortController = null;
        }
        if (discoveryDebounceTimer) {
            clearTimeout(discoveryDebounceTimer);
            discoveryDebounceTimer = null;
        }
        oauthDiscoveryState = "idle";
        discoveryRegistrationStatus = null;
        editingExistingOauth = false;
        _prevOauthAuthType = null;
        _prevOauthServerUrl = null;
    }

    async function handleSaveServer() {
        // Validate
        if (!modalName.trim()) {
            modalError = "Server name is required";
            return;
        }
        if (!modalServerUrl.trim()) {
            modalError = "Server URL is required";
            return;
        }

        modalLoading = true;
        modalError = null;

        try {
            const data: CreateMcpServerDto = {
                name: modalName.trim(),
                serverUrl: modalServerUrl.trim(),
                authType: modalAuthType,
            };
            if (modalAuthType === "oauth") {
                if (editingServer && (editingServer.authType as string) === "oauth") {
                    // When editing an existing OAuth server, preserve existing
                    // encrypted credentials/tokens. For connected servers, there are
                    // no editable OAuth fields (scopes/credentials are set at authorization
                    // time). For disconnected, authConfig comes from the else branch.
                    if (editingExistingOauth) {
                        // Connected OAuth server — no editable fields besides name/headers.
                        // Scopes and credentials are set at authorization time and cannot be
                        // changed without re-authorizing (per OAuth spec / industry pattern).
                        // authConfig is omitted → backend preserves existing value.
                        //
                        // If the URL changed, the old authConfig (tokens/credentials) would be
                        // preserved against the new URL — a mismatch that breaks connectivity.
                        // Require the user to revert the URL or re-authorize.
                        if (modalServerUrl.trim() !== editingServer.serverUrl) {
                            modalError =
                                "Cannot change the URL of a connected OAuth server. " +
                                "Revert the URL or disconnect and re-authorize with the new provider.";
                            modalLoading = false;
                            return;
                        }
                    } else {
                        // Editing a disconnected OAuth server — the user originally
                        // configured this server's OAuth credentials. The edit modal
                        // resets all OAuth fields to empty (they're encrypted and
                        // can't be pre-populated). Discovery auto-fills them after
                        // a 500ms debounce, but the user might save before it runs.
                        //
                        // If the URL changed and discovery hasn't completed yet,
                        // block the save — otherwise the backend preserves the old
                        // authConfig against the new URL (mismatched credentials).
                        if (
                            modalServerUrl.trim() !== editingServer.serverUrl &&
                            oauthDiscoveryState !== "discovered" &&
                            !modalOauthAuthorizeUrl.trim() &&
                            !modalOauthTokenUrl.trim()
                        ) {
                            modalError =
                                oauthDiscoveryState === "not_found"
                                    ? "Could not auto-discover OAuth endpoints for this URL. " +
                                      "Fill in the OAuth fields manually to continue."
                                    : "OAuth discovery is still in progress for the new server URL. " +
                                      "Wait for auto-discovery or fill in the OAuth fields manually.";
                            modalLoading = false;
                            return;
                        }
                        // Only check Client ID/Secret for manual discovery — auto fills them
                        // from the API response (may be null for PKCE public clients)
                        const hasOAuthInput =
                            modalOauthAuthorizeUrl.trim() ||
                            modalOauthTokenUrl.trim() ||
                            (discoveryRegistrationStatus !== "auto" &&
                                (modalOauthClientId.trim() || modalOauthClientSecret.trim())) ||
                            modalOauthScopes.trim();
                        if (hasOAuthInput) {
                            // Validate required fields before serializing — a partial
                            // object would overwrite the existing complete authConfig.
                            if (discoveryRegistrationStatus !== "auto") {
                                if (
                                    !modalOauthAuthorizeUrl.trim() ||
                                    !modalOauthTokenUrl.trim() ||
                                    !modalOauthClientId.trim() ||
                                    !modalOauthClientSecret.trim()
                                ) {
                                    modalError =
                                        "Authorize URL, Token URL, Client ID, and Client Secret are required for OAuth authentication";
                                    modalLoading = false;
                                    return;
                                }
                            } else if (!modalOauthAuthorizeUrl.trim() || !modalOauthTokenUrl.trim()) {
                                modalError = "Authorize URL and Token URL are required for OAuth authentication";
                                modalLoading = false;
                                return;
                            }
                            data.authConfig = JSON.stringify({
                                authorizeUrl: modalOauthAuthorizeUrl.trim(),
                                tokenUrl: modalOauthTokenUrl.trim(),
                                clientId:
                                    discoveryRegistrationStatus === "auto" && !modalOauthClientId.trim()
                                        ? null
                                        : modalOauthClientId.trim(),
                                clientSecret:
                                    discoveryRegistrationStatus === "auto" && !modalOauthClientSecret.trim()
                                        ? null
                                        : modalOauthClientSecret.trim(),
                                scopes: modalOauthScopes.trim(),
                            });
                        }
                    }
                    // If preserveExisting or no input, authConfig is omitted → server preserves existing value
                } else {
                    // When creating, require OAuth fields
                    // For auto-discovered public clients (PKCE), clientId/clientSecret are managed server-side
                    if (discoveryRegistrationStatus !== "auto") {
                        if (
                            !modalOauthAuthorizeUrl.trim() ||
                            !modalOauthTokenUrl.trim() ||
                            !modalOauthClientId.trim() ||
                            !modalOauthClientSecret.trim()
                        ) {
                            modalError =
                                "Authorize URL, Token URL, Client ID, and Client Secret are required for OAuth authentication";
                            modalLoading = false;
                            return;
                        }
                    } else if (!modalOauthAuthorizeUrl.trim() || !modalOauthTokenUrl.trim()) {
                        // Even for auto-discovered servers, authorize and token URLs are always required
                        modalError = "Authorize URL and Token URL are required for OAuth authentication";
                        modalLoading = false;
                        return;
                    }
                    data.authConfig = JSON.stringify({
                        authorizeUrl: modalOauthAuthorizeUrl.trim(),
                        tokenUrl: modalOauthTokenUrl.trim(),
                        clientId:
                            discoveryRegistrationStatus === "auto" && !modalOauthClientId.trim()
                                ? null
                                : modalOauthClientId.trim(),
                        clientSecret:
                            discoveryRegistrationStatus === "auto" && !modalOauthClientSecret.trim()
                                ? null
                                : modalOauthClientSecret.trim(),
                        scopes: modalOauthScopes.trim(),
                    });
                }
            } else if (modalAuthType !== "none" && modalAuthConfig.trim()) {
                data.authConfig = modalAuthConfig.trim();
            }
            const filtered = modalHeaders.filter((h) => h.key.trim());
            if (filtered.length > 0) {
                data.headers = Object.fromEntries(filtered.map((h) => [h.key.trim(), h.value]));
            } else {
                data.headers = {};
            }

            if (editingServer) {
                // Update existing server
                const updated = await botApiService.updateBotMcpServer(botId, editingServer.id, data);
                servers = servers.map((s) => (s.id === updated.id ? updated : s));
            } else {
                // Create new server
                const created = await botApiService.createBotMcpServer(botId, data);
                servers = [...servers, created];
            }

            closeModal();
        } catch (error) {
            console.error("[BotMcpServersEditor] Error saving MCP server:", error);
            modalError = `Failed to save server: ${error instanceof Error ? error.message : "Unknown error"}`;
        } finally {
            modalLoading = false;
        }
    }

    async function handleRemoveServer(serverId: string) {
        removingLoading = true;
        try {
            await botApiService.deleteBotMcpServer(botId, serverId);
            servers = servers.filter((s) => s.id !== serverId);
            // Clean up error state (reassign to trigger Svelte reactivity)
            testError = Object.fromEntries(Object.entries(testError).filter(([id]) => id !== serverId));
            removingServerId = null;
        } catch (error) {
            console.error("[BotMcpServersEditor] Error removing MCP server:", error);
            removingServerId = null;
        } finally {
            removingLoading = false;
        }
    }

    async function handleTestConnection(serverId: string) {
        testingServerId = serverId;
        try {
            const rawResult = await botApiService.testBotMcpServer(botId, serverId);
            const result: McpServerTestResult = {
                success: rawResult.success === true,
                tools: (rawResult.toolNames || []).map((name: string) => ({ name })),
                error: rawResult.error || undefined,
            };

            if (result.success) {
                // Reload servers from API to get updated lastTestResult / lastTestedAt
                void loadServers();
            } else {
                testError = { ...testError, [serverId]: result.error || "Connection failed" };
                // Reload servers so the persisted lastTestResult (with error details) is
                // reflected immediately — otherwise the template won't render the error
                // because server.lastTestResult is still null in the cached array
                void loadServers();
            }
        } catch (error) {
            console.error("[BotMcpServersEditor] Error testing MCP server:", error);
            testError = { ...testError, [serverId]: "Connection test failed" };
        } finally {
            testingServerId = null;
        }
    }

    // OAuth flow state (per-server, like testingServerId)
    let oauthConnectingServerId: string | null = null;
    let oauthCleanup: (() => void) | null = null;

    // OAuth discovery state
    let oauthDiscoveryState: "idle" | "discovering" | "discovered" | "not_found" = "idle";
    let discoveryRegistrationStatus: "auto" | "manual" | null = null;
    let discoveryAbortController: AbortController | null = null;
    let discoveryDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    // Track previous values to detect changes in afterUpdate
    let _prevOauthAuthType: string | null = null;
    let _prevOauthServerUrl: string | null = null;

    afterUpdate(() => {
        if (_prevOauthAuthType === modalAuthType && _prevOauthServerUrl === modalServerUrl) {
            return;
        }
        _prevOauthAuthType = modalAuthType;
        _prevOauthServerUrl = modalServerUrl;

        if (discoveryDebounceTimer) {
            clearTimeout(discoveryDebounceTimer);
            discoveryDebounceTimer = null;
        }

        // Abort any in-flight discovery request — the URL or auth type has
        // changed, so stale results from a prior request would populate the
        // form with wrong data.
        if (discoveryAbortController) {
            discoveryAbortController.abort();
            discoveryAbortController = null;
        }

        if (modalAuthType === "oauth" && modalServerUrl.trim()) {
            if (!/^https?:\/\/.+/i.test(modalServerUrl.trim())) {
                oauthDiscoveryState = "idle";
                discoveryRegistrationStatus = null;
            } else {
                // Reset state and clear form fields until new discovery
                // completes — stale auto-filled values from the old URL
                // would bypass the save guard and let mismatched credentials
                // through.
                oauthDiscoveryState = "idle";
                discoveryRegistrationStatus = null;
                modalOauthAuthorizeUrl = "";
                modalOauthTokenUrl = "";
                modalOauthClientId = "";
                modalOauthClientSecret = "";
                modalOauthScopes = "";
                discoveryDebounceTimer = setTimeout(() => {
                    void discoverOAuthEndpoints();
                }, 500);
            }
        } else {
            oauthDiscoveryState = "idle";
            discoveryRegistrationStatus = null;
        }
    });

    onDestroy(() => {
        if (discoveryDebounceTimer) clearTimeout(discoveryDebounceTimer);
        if (discoveryAbortController) {
            discoveryAbortController.abort();
            discoveryAbortController = null;
        }
        if (oauthCleanup) {
            oauthCleanup();
            oauthCleanup = null;
        }
    });

    async function discoverOAuthEndpoints() {
        // Cancel any in-flight discovery request
        if (discoveryAbortController) {
            discoveryAbortController.abort();
        }
        discoveryAbortController = new AbortController();
        const signal = discoveryAbortController.signal;

        oauthDiscoveryState = "discovering";
        try {
            const callbackUrl = `${window.location.origin}/api/oauth/mcp-callback`;
            const data = await botApiService.discoverMcpOAuthEndpoints(modalServerUrl.trim(), callbackUrl, signal);
            if (signal.aborted) return;
            if (data.discovered) {
                discoveryRegistrationStatus = (data.registrationStatus as "auto" | "manual") || null;
                oauthDiscoveryState = "discovered";
                // Auto-fill form fields if empty
                if (!modalOauthAuthorizeUrl && data.authorizeUrl) modalOauthAuthorizeUrl = data.authorizeUrl;
                if (!modalOauthTokenUrl && data.tokenUrl) modalOauthTokenUrl = data.tokenUrl;
                if (!modalOauthClientId && data.clientId) modalOauthClientId = data.clientId;
                if (!modalOauthClientSecret && data.clientSecret) modalOauthClientSecret = data.clientSecret;
                // Auto-fill scopes from discovery results (required by many providers)
                if (!modalOauthScopes && data.scopesSupported) modalOauthScopes = data.scopesSupported.join(" ");
            } else {
                if (!signal.aborted) oauthDiscoveryState = "not_found";
            }
        } catch {
            if (!signal.aborted) oauthDiscoveryState = "not_found";
        }
    }

    async function handleOAuthConnect(serverId: string) {
        oauthConnectingServerId = serverId;

        // Clean up any previous listener or focus handler before starting a new flow
        if (oauthCleanup) {
            oauthCleanup();
            oauthCleanup = null;
        }

        // Open a blank popup immediately before the async call, so the browser
        // still recognizes this as user-initiated and doesn't block the popup.
        // After startOAuth resolves, we navigate the placeholder to the authorize URL.
        const popup = window.open("", "oauth-popup", "width=600,height=700");
        if (!popup) {
            console.error("[BotMcpServersEditor] Popup blocked");
            oauthConnectingServerId = null;
            return;
        }

        try {
            const redirectUrl = window.location.href.split("?")[0].split("#")[0];
            const callbackUrl = `${window.location.origin}/api/oauth/mcp-callback`;
            const authorizeUrl = await botApiService.startOAuth(botId, serverId, redirectUrl, callbackUrl);

            // Navigate the placeholder popup to the actual authorize URL.
            // eslint-disable-next-line require-atomic-updates
            popup.location.href = authorizeUrl;

            // Listen for postMessage from the OAuth popup callback page.
            // The callback page sends postMessage immediately (before its
            // 5-second countdown), so the main window updates right away.
            const messageHandler = (event: MessageEvent) => {
                if (event.origin !== window.location.origin) return;
                if (event.data?.type === "oauth-success") {
                    if (oauthCleanup) {
                        oauthCleanup();
                        oauthCleanup = null;
                    }
                    oauthConnectingServerId = null;
                    // Note: loadServers() is handled by the reactive $: block that
                    // watches oauthConnectingServerId transitions — don't call it here.
                } else if (event.data?.type === "oauth-failure") {
                    if (oauthCleanup) {
                        oauthCleanup();
                        oauthCleanup = null;
                    }
                    oauthConnectingServerId = null;
                }
            };

            window.addEventListener("message", messageHandler);

            // Focus event fallback: when the user returns focus to this window
            // and the popup is gone (closed manually before completing OAuth),
            // clean up the connecting state. This replaces the old 500ms
            // popup.closed polling which caused false-positives during
            // cross-origin navigation in multi-hop OAuth flows (e.g. Sentry).
            const onFocus = () => {
                try {
                    if (popup.closed) {
                        window.removeEventListener("focus", onFocus);
                        window.removeEventListener("message", messageHandler);
                        oauthConnectingServerId = null;
                    }
                } catch {
                    // Cross-origin — popup may be inaccessible during navigation
                }
            };
            window.addEventListener("focus", onFocus);

            oauthCleanup = () => {
                window.removeEventListener("message", messageHandler);
                window.removeEventListener("focus", onFocus);
            };
        } catch (error) {
            console.error("[BotMcpServersEditor] OAuth error:", error);
            oauthConnectingServerId = null;
            // Close the placeholder popup when startOAuth fails
            try {
                popup.close();
            } catch {
                // popup may already be closed
            }
        }
    }

    /** One line under a server's name: what it gives the bot, or why it doesn't. */
    function statusLine(server: McpServer): string {
        const result = server.lastTestResult;
        if (server.authType === "oauth" && !server.oauthConnected) return "Needs you to connect it";
        if (!result) return "Not tested yet";
        if (!result.success) return testError[server.id] || result.error || "Can't connect";
        const count = result.toolCount ?? 0;
        return `${count} tool${count !== 1 ? "s" : ""} · Connected`;
    }

    function getStatusDot(server: McpServer): string {
        const result = server.lastTestResult;
        if (!result) return "untested";
        return result.success ? "ok" : "failed";
    }
</script>

<div class="mcp">
    {#if isLoading}
        <div class="mcp-row mcp-loading" aria-busy="true">
            <div class="mcp-tx"><span class="mcp-bar" /><span class="mcp-bar short" /></div>
        </div>
    {:else if loadError}
        <div class="mcp-row">
            <div class="mcp-tx">
                <div class="mcp-m mcp-bad">{loadError}</div>
            </div>
            <PageButton on:click={loadServers}>Retry</PageButton>
        </div>
    {:else if servers.length === 0}
        <div class="mcp-row">
            <span class="mcp-ico"><IconTool font-size="20" /></span>
            <div class="mcp-tx">
                <div class="mcp-t">No tools yet</div>
                <div class="mcp-m mcp-wrap">Tools let it look things up or make things</div>
            </div>
            <PageButton testId="bot-add-tool" on:click={openAddModal}><IconPlus font-size="16" />Add</PageButton>
        </div>
    {:else}
        <!-- The list's own heading carries Add, so it sits where the list starts rather than after it -->
        <div class="mcp-head">
            <span class="mcp-label">{servers.length === 1 ? "Uses 1 app" : `Uses ${servers.length} apps`}</span>
            <PageButton testId="bot-add-tool" on:click={openAddModal}><IconPlus font-size="16" />Add</PageButton>
        </div>
        {#each servers as server (server.id)}
            {@const expanded = openServerId === server.id}
            <div class="mcp-server" class:expanded>
                <button
                    type="button"
                    class="mcp-row mcp-toggle"
                    aria-expanded={expanded}
                    on:click={() => (openServerId = expanded ? null : server.id)}
                >
                    <span class="mcp-ico">
                        <IconTool font-size="20" />
                        <i class="mcp-dot {getStatusDot(server)}" />
                    </span>
                    <span class="mcp-tx">
                        <span class="mcp-t">{server.name}</span>
                        <span class="mcp-m" class:mcp-bad={getStatusDot(server) === "failed"}>{statusLine(server)}</span
                        >
                    </span>
                    <span class="mcp-chev"><IconChevronDown font-size="18" /></span>
                </button>
                {#if expanded}
                    <div class="mcp-body">
                        <div class="mcp-url" title={server.serverUrl}>{server.serverUrl}</div>
                        {#if server.lastTestResult?.success && server.lastTestResult?.toolNames?.length > 0}
                            <div class="mcp-tools" aria-label="Available tools">
                                {#each server.lastTestResult.toolNames as toolName (toolName)}
                                    <span>{toolName}</span>
                                {/each}
                            </div>
                        {/if}
                        <div class="mcp-actions">
                            {#if server.authType !== "oauth" || server.oauthConnected}
                                <button
                                    type="button"
                                    class="mcp-chip"
                                    on:click={() => handleTestConnection(server.id)}
                                    disabled={testingServerId === server.id}
                                >
                                    {testingServerId === server.id ? "Testing..." : "Test"}
                                </button>
                            {/if}
                            {#if server.authType === "oauth" && !server.oauthConnected}
                                <button
                                    type="button"
                                    class="mcp-chip mcp-good"
                                    on:click={() => handleOAuthConnect(server.id)}
                                    disabled={oauthConnectingServerId !== null}
                                >
                                    {oauthConnectingServerId === server.id ? "Connecting..." : "Connect"}
                                </button>
                            {/if}
                            <button type="button" class="mcp-chip" on:click={() => openEditModal(server)}>Edit</button>
                            {#if removingServerId === server.id}
                                <span class="mcp-m">Remove {server.name}?</span>
                                <button
                                    type="button"
                                    class="mcp-chip mcp-bad"
                                    on:click={() => handleRemoveServer(server.id)}
                                    disabled={removingLoading}
                                >
                                    Yes
                                </button>
                                <button type="button" class="mcp-chip" on:click={() => (removingServerId = null)}
                                    >No</button
                                >
                            {:else}
                                <button
                                    type="button"
                                    class="mcp-chip mcp-bad"
                                    on:click={() => (removingServerId = server.id)}
                                >
                                    Remove
                                </button>
                            {/if}
                        </div>
                    </div>
                {/if}
            </div>
        {/each}
    {/if}
</div>

<!-- Add/Edit Modal -->
{#if showModal}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <div
        role="presentation"
        class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
        tabindex="-1"
        on:click={closeModal}
    >
        <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
        <div
            role="dialog"
            aria-modal="true"
            class="mcp-dialog u-surface max-w-lg w-full max-h-[90vh] overflow-y-auto p-6"
            on:click|stopPropagation
        >
            <h3 class="text-lg font-semibold text-white mb-4">
                {editingServer ? "Edit MCP Server" : "Add MCP Server"}
            </h3>

            <div class="space-y-4">
                <!-- Server Name -->
                <div>
                    <label for="mcp-server-name" class="block text-sm text-white/80 mb-1.5 font-medium">
                        Server Name
                    </label>
                    <input
                        id="mcp-server-name"
                        type="text"
                        class="w-full px-3 py-2 mcp-input"
                        bind:value={modalName}
                        placeholder="My MCP Server"
                    />
                </div>

                <!-- Server URL -->
                <div>
                    <label for="mcp-server-url" class="block text-sm text-white/80 mb-1.5 font-medium">
                        Server URL
                    </label>
                    <input
                        id="mcp-server-url"
                        type="text"
                        class="w-full px-3 py-2 mcp-input"
                        bind:value={modalServerUrl}
                        placeholder="http://localhost:3001/mcp"
                    />
                </div>

                <!-- Auth Type -->
                <div>
                    <label for="mcp-auth-type" class="block text-sm text-white/80 mb-1.5 font-medium">
                        Auth Type
                    </label>
                    <select
                        id="mcp-auth-type"
                        class="w-full px-3 py-2 mcp-input"
                        bind:value={modalAuthType}
                        style="color: white; background-color: rgba(255, 255, 255, 0.05);"
                    >
                        <option value="none" style="background-color: rgba(0, 0, 0, 0.8); color: white;">None</option>
                        <option value="bearer" style="background-color: rgba(0, 0, 0, 0.8); color: white;"
                            >Bearer Token</option
                        >
                        <option value="api-key" style="background-color: rgba(0, 0, 0, 0.8); color: white;"
                            >API Key</option
                        >
                        <option value="oauth" style="background-color: rgba(0, 0, 0, 0.8); color: white;"
                            >OAuth (Connect)</option
                        >
                    </select>
                </div>

                <!-- Auth Value (shown when authType !== 'none' and !== 'oauth') -->
                {#if modalAuthType !== "none" && modalAuthType !== "oauth"}
                    <div>
                        <label for="mcp-auth-config" class="block text-sm text-white/80 mb-1.5 font-medium">
                            {modalAuthType === "bearer" ? "Bearer Token" : "API Key Value"}
                        </label>
                        <input
                            id="mcp-auth-config"
                            type="password"
                            class="w-full px-3 py-2 mcp-input"
                            bind:value={modalAuthConfig}
                            placeholder={editingServer
                                ? "Leave empty to keep existing"
                                : modalAuthType === "bearer"
                                ? "Enter bearer token..."
                                : "Enter API key..."}
                        />
                        {#if editingServer}
                            <p class="text-xs text-white/40 mt-1">
                                Token hidden for security. Leave blank to keep the current value.
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- OAuth provider config -->
                {#if modalAuthType === "oauth"}
                    {#if editingExistingOauth}
                        <div class="flex items-center gap-2 text-sm text-green-400 py-1">
                            <span class="inline-block h-2 w-2 rounded-full bg-green-400" />
                            OAuth configured
                        </div>
                    {:else if oauthDiscoveryState === "discovering"}
                        <div class="flex items-center gap-2 text-sm text-white/60 py-2">
                            <span
                                class="inline-block w-4 h-4 border-2 border-white/40 border-t-transparent rounded-full animate-spin"
                            />
                            Discovering OAuth endpoints...
                        </div>
                    {/if}

                    {#if oauthDiscoveryState === "discovered" && discoveryRegistrationStatus === "auto"}
                        <div class="flex items-center gap-2 text-sm text-green-400 py-1">
                            <span class="inline-block h-2 w-2 rounded-full bg-green-400" />
                            Auto-configured
                            <span class="text-white/40">— OAuth and credentials auto-discovered</span>
                        </div>
                        <div>
                            <label for="mcp-oauth-scopes" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Scopes (space-separated)
                            </label>
                            <input
                                id="mcp-oauth-scopes"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="read write"
                                bind:value={modalOauthScopes}
                            />
                        </div>
                    {/if}

                    {#if oauthDiscoveryState === "discovered" && discoveryRegistrationStatus === "manual"}
                        <div class="flex items-center gap-2 text-sm text-green-400 py-1">
                            <span class="inline-block h-2 w-2 rounded-full bg-green-400" />
                            Endpoints discovered
                            <span class="text-white/40">— provide client credentials from your provider</span>
                        </div>
                        <div>
                            <label for="mcp-oauth-client-id" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Client ID
                            </label>
                            <input
                                id="mcp-oauth-client-id"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="OAuth client ID from the provider"
                                bind:value={modalOauthClientId}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-client-secret" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Client Secret
                            </label>
                            <input
                                id="mcp-oauth-client-secret"
                                type="password"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="OAuth client secret"
                                bind:value={modalOauthClientSecret}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-scopes" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Scopes (space-separated)
                            </label>
                            <input
                                id="mcp-oauth-scopes"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="read write"
                                bind:value={modalOauthScopes}
                            />
                        </div>
                    {/if}

                    {#if oauthDiscoveryState === "not_found"}
                        <p class="text-sm text-white/60 py-1">
                            Could not auto-discover OAuth endpoints. Enter the details from your provider manually.
                        </p>
                        <div>
                            <label for="mcp-oauth-authorize-url" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Authorize URL
                            </label>
                            <input
                                id="mcp-oauth-authorize-url"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="https://app.provider.com/oauth/authorize"
                                bind:value={modalOauthAuthorizeUrl}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-token-url" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Token URL
                            </label>
                            <input
                                id="mcp-oauth-token-url"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="https://app.provider.com/oauth/token"
                                bind:value={modalOauthTokenUrl}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-client-id" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Client ID
                            </label>
                            <input
                                id="mcp-oauth-client-id"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="OAuth client ID from the provider"
                                bind:value={modalOauthClientId}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-client-secret" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Client Secret
                            </label>
                            <input
                                id="mcp-oauth-client-secret"
                                type="password"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="OAuth client secret"
                                bind:value={modalOauthClientSecret}
                            />
                        </div>
                        <div>
                            <label for="mcp-oauth-scopes" class="block text-sm text-white/80 mb-1.5 font-medium">
                                Scopes (space-separated)
                            </label>
                            <input
                                id="mcp-oauth-scopes"
                                type="text"
                                class="w-full px-3 py-2 mcp-input"
                                placeholder="read write"
                                bind:value={modalOauthScopes}
                            />
                        </div>
                    {/if}
                {/if}

                <!-- Extra Headers -->
                <div>
                    <div class="block text-sm text-white/80 mb-1.5 font-medium">Extra Headers</div>
                    {#each modalHeaders as header, i (i)}
                        <div class="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
                            <input
                                type="text"
                                class="min-w-0 px-3 py-2 mcp-input"
                                bind:value={modalHeaders[i].key}
                                placeholder="Header name"
                            />
                            <input
                                type="password"
                                class="min-w-0 px-3 py-2 mcp-input"
                                bind:value={modalHeaders[i].value}
                                placeholder="Value"
                            />
                            <button
                                class="mcp-chip mcp-bad"
                                on:click={() => {
                                    modalHeaders = modalHeaders.filter((_, idx) => idx !== i);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    {/each}
                    <button
                        class="mcp-chip mt-1"
                        on:click={() => {
                            modalHeaders = [...modalHeaders, { key: "", value: "" }];
                        }}
                    >
                        + Add Header
                    </button>
                </div>
            </div>

            <!-- Error -->
            {#if modalError}
                <div class="mt-4 p-3 border border-red-500/50 rounded bg-red-500/10 text-red-400 text-sm">
                    {modalError}
                </div>
            {/if}

            <!-- Actions -->
            <div class="flex items-center justify-end gap-3 mt-6">
                <button class="mcp-pill mcp-pill-q" on:click={closeModal}> Cancel </button>
                <button
                    class="mcp-pill u-cta disabled:opacity-50 disabled:cursor-not-allowed"
                    on:click={handleSaveServer}
                    disabled={modalLoading}
                >
                    {#if modalLoading}
                        Saving...
                    {:else}
                        {editingServer ? "Update Server" : "Add Server"}
                    {/if}
                </button>
            </div>
        </div>
    </div>
{/if}

<style>
    .mcp {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    /* The list's heading: how many, and Add */
    .mcp-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 0 0 0 8px;
    }
    .mcp-label {
        font-size: 12.5px;
        font-weight: 600;
        color: rgba(244, 242, 250, 0.64);
    }
    /* A server is one row; tapping it shows its tools and what you can do with it */
    .mcp-server {
        display: flex;
        flex-direction: column;
        border-radius: 12px;
    }
    .mcp-server.expanded {
        background: rgba(255, 255, 255, 0.06);
        padding-bottom: 10px;
    }
    .mcp-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 6px 8px;
        border-radius: 12px;
    }
    .mcp-toggle {
        width: 100%;
        margin: 0;
        border: 0;
        background: transparent;
        font: inherit;
        color: #fff;
        text-align: start;
        cursor: pointer;
    }
    @media (hover: hover) {
        .mcp-server:not(.expanded) .mcp-toggle:hover {
            background: rgba(255, 255, 255, 0.05);
        }
    }
    .mcp-toggle:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: -2px;
    }
    .mcp-chev {
        flex: none;
        display: grid;
        color: rgba(255, 255, 255, 0.5);
        transition: transform 150ms ease;
    }
    .expanded .mcp-chev {
        transform: rotate(180deg);
    }
    .mcp-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 2px 10px 0 50px;
    }
    .mcp-url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12px;
        color: rgba(244, 242, 250, 0.5);
    }
    /* Plain white icon, like the menu: no tile behind it. */
    .mcp-ico {
        position: relative;
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        color: rgba(255, 255, 255, 0.85);
    }
    .mcp-dot {
        position: absolute;
        right: -2px;
        bottom: -2px;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        box-shadow: 0 0 0 2px #1f1c2f;
    }
    .mcp-dot.untested {
        background: rgba(244, 242, 250, 0.42);
    }
    .mcp-dot.ok {
        background: #34d399;
    }
    .mcp-dot.failed {
        background: #ff705c;
    }
    .mcp-tx {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
    }
    .mcp-t,
    .mcp-tx .mcp-m {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mcp-tx .mcp-wrap {
        white-space: normal;
    }
    .mcp-t {
        font-size: 14px;
        font-weight: 600;
    }
    .mcp-m {
        font-size: 12.5px;
        line-height: 1.3;
        color: rgba(244, 242, 250, 0.64);
    }
    .mcp-bad {
        color: #ff8a7a;
    }
    .mcp-good {
        color: #6ee7b7;
    }
    .mcp-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
    }
    .mcp-chip {
        display: inline-flex;
        align-items: center;
        height: 28px;
        margin: 0;
        padding: 0 11px;
        border: 0;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.06);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        font: inherit;
        font-size: 12.5px;
        font-weight: 500;
        color: #fff;
        white-space: nowrap;
        cursor: pointer;
    }
    .mcp-chip.mcp-bad {
        color: #ff8a7a;
    }
    .mcp-chip.mcp-good {
        color: #6ee7b7;
    }
    .mcp-chip:disabled {
        opacity: 0.5;
        cursor: default;
    }
    @media (hover: hover) {
        .mcp-chip:not(:disabled):hover {
            background: rgba(255, 255, 255, 0.12);
        }
    }
    .mcp-chip:focus-visible,
    .mcp-pill:focus-visible {
        outline: 2px solid #a78bfa;
        outline-offset: 2px;
    }
    .mcp-tools {
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
    }
    .mcp-tools span {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(52, 211, 153, 0.1);
        font-size: 11px;
        color: rgba(110, 231, 183, 0.85);
    }
    .mcp-loading .mcp-tx {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }
    .mcp-bar {
        display: block;
        height: 10px;
        width: 70%;
        border-radius: 5px;
        background: rgba(255, 255, 255, 0.08);
    }
    .mcp-bar.short {
        width: 45%;
    }
    .mcp-dialog {
        border-radius: 24px;
        color: #fff;
    }
    .mcp-dialog :global(.mcp-input) {
        border: 0;
        border-radius: 12px;
        background: rgba(0, 0, 0, 0.25);
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.18);
        color: #fff;
        outline: none;
    }
    .mcp-dialog :global(.mcp-input::placeholder) {
        color: rgba(244, 242, 250, 0.42);
    }
    .mcp-dialog :global(.mcp-input:focus-visible) {
        box-shadow: inset 0 0 0 1px rgba(167, 139, 250, 0.6);
    }
    .mcp-dialog :global(.mcp-input option) {
        background: #14121e;
    }
    .mcp-pill {
        height: 40px;
        padding: 0 18px;
        border: 0;
        border-radius: 999px;
        font: inherit;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
    }
    .mcp-pill-q {
        background: rgba(255, 255, 255, 0.08);
        color: #fff;
    }
    @media (hover: hover) {
        .mcp-pill-q:hover {
            background: rgba(255, 255, 255, 0.14);
        }
    }
</style>
