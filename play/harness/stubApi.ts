export const botApiService = {
    isInitialized: () => true,
    getBotMcpServers: async () => [{ id: "s1", name: "Tinyfish", url: "https://mcp.tinyfish.ai", enabled: true, authType: "none" }],
};
