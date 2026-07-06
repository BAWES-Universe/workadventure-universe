<script lang="ts">
    import { onMount, onDestroy, afterUpdate } from "svelte";
    import {
        botApiService,
        type McpServer,
        type CreateMcpServerDto,
        type McpServerTestResult,
    } from "../services/BotApiService";

    export let botId: string;

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
                    } else {
                        // Only check Client ID/Secret for manual discovery — auto fills them
                        // from the API response (may be null for PKCE public clients)
                        const hasOAuthInput =
                            modalOauthAuthorizeUrl.trim() ||
                            modalOauthTokenUrl.trim() ||
                            (discoveryRegistrationStatus !== "auto" &&
                                (modalOauthClientId.trim() || modalOauthClientSecret.trim())) ||
                            modalOauthScopes.trim();
                        if (hasOAuthInput) {
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
    let oauthPollInterval: ReturnType<typeof setInterval> | null = null;

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

        if (modalAuthType === "oauth" && modalServerUrl.trim()) {
            if (!/^https?:\/\/.+/i.test(modalServerUrl.trim())) {
                oauthDiscoveryState = "idle";
                discoveryRegistrationStatus = null;
            } else {
                discoveryDebounceTimer = setTimeout(() => {
                    void discoverOAuthEndpoints();
                }, 500);
            }
        } else {
            discoveryAbortController?.abort();
            oauthDiscoveryState = "idle";
            discoveryRegistrationStatus = null;
        }
    });

    onDestroy(() => {
        if (discoveryDebounceTimer) clearTimeout(discoveryDebounceTimer);
        if (oauthPollInterval !== null) {
            clearInterval(oauthPollInterval);
            oauthPollInterval = null;
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
        try {
            const redirectUrl = window.location.href.split("?")[0].split("#")[0];
            const callbackUrl = `${window.location.origin}/api/oauth/mcp-callback`;
            const authorizeUrl = await botApiService.startOAuth(botId, serverId, redirectUrl, callbackUrl);

            const popup = window.open("about:blank", "oauth-popup", "width=600,height=700");
            if (!popup) {
                console.error("[BotMcpServersEditor] Popup blocked");
                oauthConnectingServerId = null;
                return;
            }
            popup.opener = null;
            popup.location.href = authorizeUrl;

            // Clear any existing interval before setting a new one
            if (oauthPollInterval !== null) {
                clearInterval(oauthPollInterval);
            }
            oauthPollInterval = setInterval(() => {
                try {
                    if (popup.closed) {
                        if (oauthPollInterval) {
                            clearInterval(oauthPollInterval);
                            oauthPollInterval = null;
                        }
                        oauthConnectingServerId = null;
                        void loadServers().then(() => {
                            const server = servers.find((s) => s.id === serverId);
                            // Only test if OAuth actually completed (oauthConnected flag set)
                            if (server?.oauthConnected) {
                                void handleTestConnection(serverId);
                            }
                        });
                    }
                } catch {
                    // Cross-origin during redirect
                }
            }, 500);
        } catch (error) {
            console.error("[BotMcpServersEditor] OAuth error:", error);
            oauthConnectingServerId = null;
        }
    }

    function getStatusDot(server: McpServer): string {
        const result = server.lastTestResult;
        if (!result) return "bg-gray-500"; // untested
        return result.success ? "bg-green-500" : "bg-red-500";
    }

    function getToolCount(server: McpServer): string {
        const result = server.lastTestResult;
        if (!result) return "";
        if (result.success) {
            const count = result.toolCount ?? 0;
            return `${count} tool${count !== 1 ? "s" : ""}`;
        }
        return testError[server.id] || result.error || "Error";
    }
</script>

<div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
        <h3 class="text-base text-white/80 normal-case font-semibold">MCP Servers</h3>
        <button
            class="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
            on:click={openAddModal}
        >
            + Add Server
        </button>
    </div>

    <p class="text-xs text-white/50 mb-2">
        Connect MCP (Model Context Protocol) servers to give your bot custom tools and data sources.
    </p>

    <!-- Loading state -->
    {#if isLoading}
        <div class="space-y-3">
            {#each [1, 2, 3] as _i (_i)}
                <div class="p-4 border border-white/20 rounded bg-white/5 animate-pulse">
                    <div class="h-4 bg-white/10 rounded w-3/4 mb-2" />
                    <div class="h-3 bg-white/10 rounded w-1/2" />
                </div>
            {/each}
        </div>

        <!-- Error loading -->
    {:else if loadError}
        <div class="p-4 border border-red-500/50 rounded bg-red-500/10 text-red-400 text-sm mb-2">
            {loadError}
        </div>
        <button
            class="text-xs text-blue-400 hover:text-blue-300 px-2 py-1 hover:bg-blue-500/10 rounded transition-colors"
            on:click={loadServers}
        >
            Retry
        </button>

        <!-- Empty state -->
    {:else if servers.length === 0}
        <div class="p-6 border border-dashed border-white/20 rounded bg-white/5 text-center">
            <p class="text-sm text-white/60 mb-3">No MCP servers configured. Add one to give your bot custom tools.</p>
            <button
                class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors"
                on:click={openAddModal}
            >
                + Add Server
            </button>
        </div>

        <!-- Server list -->
    {:else}
        <div class="space-y-3">
            {#each servers as server (server.id)}
                <div class="p-4 border border-white/20 rounded bg-white/5 hover:bg-white/[0.07] transition-colors">
                    <div class="flex items-start justify-between gap-4">
                        <div class="flex items-start gap-3 flex-1 min-w-0">
                            <!-- Status dot -->
                            <div class="flex-shrink-0 mt-1.5">
                                <div
                                    class="w-2.5 h-2.5 rounded-full {getStatusDot(server)}"
                                    title={server.lastTestResult?.success
                                        ? "Connected"
                                        : server.lastTestResult
                                        ? "Error"
                                        : "Untested"}
                                />
                            </div>
                            <div class="flex-1 min-w-0">
                                <div class="flex items-center gap-2 flex-wrap">
                                    <span class="text-sm text-white font-semibold">{server.name}</span>
                                    {#if server.lastTestResult?.success}
                                        <span class="text-xs text-green-400">{getToolCount(server)}</span>
                                    {:else if server.lastTestResult && !server.lastTestResult.success}
                                        <span
                                            class="text-xs text-red-400"
                                            title={testError[server.id] || server.lastTestResult.error}
                                        >
                                            {getToolCount(server)}
                                        </span>
                                    {/if}
                                </div>
                                <p class="text-xs text-white/50 mt-0.5 truncate">{server.serverUrl}</p>
                                {#if server.authType !== "none"}
                                    <span
                                        class="inline-block mt-1 text-[10px] uppercase text-white/30 bg-white/5 px-1.5 py-0.5 rounded"
                                    >
                                        {server.authType}
                                    </span>
                                {/if}
                            </div>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <!-- Test Connection button — hidden for OAuth servers until connected -->
                            {#if server.authType !== "oauth" || server.oauthConnected}
                                <button
                                    class="px-2 py-1 text-xs text-white/60 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
                                    on:click={() => handleTestConnection(server.id)}
                                    disabled={testingServerId === server.id}
                                >
                                    {#if testingServerId === server.id}
                                        Testing...
                                    {:else}
                                        Test
                                    {/if}
                                </button>
                            {/if}

                            <!-- OAuth Connect button — hidden after connected -->
                            {#if server.authType === "oauth" && !server.oauthConnected}
                                <button
                                    class="px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-white/5 hover:bg-green-500/10 rounded transition-colors"
                                    on:click={() => handleOAuthConnect(server.id)}
                                    disabled={oauthConnectingServerId !== null}
                                >
                                    {#if oauthConnectingServerId === server.id}
                                        Connecting...
                                    {:else}
                                        Connect OAuth
                                    {/if}
                                </button>
                            {/if}
                            <!-- OAuth connected badge -->
                            {#if server.authType === "oauth" && server.oauthConnected}
                                <span class="px-2 py-1 text-xs text-green-400 bg-green-500/10 rounded font-semibold">
                                    Connected ✓
                                </span>
                            {/if}

                            <!-- Edit button -->
                            <button
                                class="px-2 py-1 text-xs text-blue-400 hover:text-blue-300 bg-white/5 hover:bg-blue-500/10 rounded transition-colors"
                                on:click={() => openEditModal(server)}
                            >
                                Edit
                            </button>

                            <!-- Remove with inline confirmation -->
                            {#if removingServerId === server.id}
                                <div class="flex items-center gap-1">
                                    <span class="text-xs text-red-400">Remove {server.name}?</span>
                                    <button
                                        class="px-2 py-1 text-xs text-red-400 hover:bg-red-500/20 rounded transition-colors"
                                        on:click={() => handleRemoveServer(server.id)}
                                        disabled={removingLoading}
                                    >
                                        Yes
                                    </button>
                                    <button
                                        class="px-2 py-1 text-xs text-white/60 hover:text-white rounded transition-colors"
                                        on:click={() => (removingServerId = null)}
                                    >
                                        No
                                    </button>
                                </div>
                            {:else}
                                <button
                                    class="px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-white/5 hover:bg-red-500/10 rounded transition-colors"
                                    on:click={() => (removingServerId = server.id)}
                                >
                                    Remove
                                </button>
                            {/if}
                        </div>
                    </div>

                    <!-- Test result details -->
                    {#if server.lastTestResult?.success && server.lastTestResult?.toolNames?.length > 0}
                        <div class="mt-3 pt-2 border-t border-white/10">
                            <p class="text-xs text-white/50 mb-1">
                                Available tools ({server.lastTestResult.toolCount}):
                            </p>
                            <div class="flex flex-wrap gap-1.5">
                                {#each server.lastTestResult.toolNames as toolName (toolName)}
                                    <span class="text-[11px] text-green-300/80 bg-green-500/10 px-2 py-0.5 rounded">
                                        {toolName}
                                    </span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
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
            class="bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 border border-white/20"
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
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                        class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                            class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
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
                                class="w-full px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                placeholder="read write"
                                bind:value={modalOauthScopes}
                            />
                        </div>
                    {/if}
                {/if}

                <!-- Extra Headers -->
                <div>
                    <label class="block text-sm text-white/80 mb-1.5 font-medium">Extra Headers</label>
                    {#each modalHeaders as header, i (i)}
                        <div class="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
                            <input
                                type="text"
                                class="min-w-0 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                bind:value={modalHeaders[i].key}
                                placeholder="Header name"
                            />
                            <input
                                type="password"
                                class="min-w-0 px-3 py-2 border border-white/20 rounded bg-white/5 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                bind:value={modalHeaders[i].value}
                                placeholder="Value"
                            />
                            <button
                                class="px-2 py-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors"
                                on:click={() => {
                                    modalHeaders = modalHeaders.filter((_, idx) => idx !== i);
                                }}
                            >
                                ×
                            </button>
                        </div>
                    {/each}
                    <button
                        class="mt-1 px-3 py-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded transition-colors"
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
                <button
                    class="px-4 py-2 text-sm text-white/70 hover:text-white bg-white/5 hover:bg-white/10 rounded transition-colors"
                    on:click={closeModal}
                >
                    Cancel
                </button>
                <button
                    class="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
