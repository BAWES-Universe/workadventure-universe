import * as Sentry from "@sentry/node";
// conversationIdIntegration is only exported from @sentry/core, not @sentry/node
import { conversationIdIntegration } from "@sentry/core";

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
            // Always sample gen_ai transactions at 100% for complete AI monitoring
            // Non-AI traffic uses the configured background rate
            tracesSampler: (samplingContext: any) => {
                // gen_ai.agent transactions are our async AI processing spans
                if (samplingContext.attributes?.span_type === "gen_ai") {
                    return 1.0;
                }
                return SENTRY_TRACES_SAMPLE_RATE;
            },
            streamGenAiSpans: true,
            // Enable span streaming pipeline — required for gen_ai child spans to be
            // properly batched with their parent transaction in the OTel-based SDK.
            // Without this, each span is exported individually (via SentrySpanExporter)
            // and gen_ai.chat child spans never appear nested under gen_ai.agent.
            traceLifecycle: "stream",
            attachStacktrace: true,
            // Only capture warn/error logs to avoid spamming from debug logging
            enableLogs: true,
            integrations: [
                Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
            ],
        };

        Sentry.init(sentryOptions);

        // Add conversation tracking integration for AI Monitoring Conversations tab
        (Sentry as any).addIntegration(conversationIdIntegration());

        console.info("Sentry initialized (AI monitoring + error/warn logging)");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}
