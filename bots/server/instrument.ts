import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN_BOT;
const SENTRY_RELEASE = process.env.SENTRY_RELEASE;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT;
const parsedRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1");
const SENTRY_TRACES_SAMPLE_RATE = isNaN(parsedRate) ? 0.1 : parsedRate;

if (SENTRY_DSN) {
    try {
        const sentryOptions: Sentry.NodeOptions = {
            dsn: SENTRY_DSN,
            release: SENTRY_RELEASE,
            environment: SENTRY_ENVIRONMENT,
            tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
            streamGenAiSpans: true,
            attachStacktrace: true,
            // Only capture warn/error logs to avoid spamming from debug logging
            enableLogs: true,
            integrations: [
                Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
            ],
        };

        Sentry.init(sentryOptions);

        // Add conversation tracking integration for AI monitoring Conversations tab
        // conversationIdIntegration exists at runtime but not in @sentry/node type defs
        (Sentry as any).addIntegration((Sentry as any).conversationIdIntegration());

        console.info("Sentry initialized (AI monitoring + error/warn logging)");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}
