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
            // Always sample gen_ai transactions at 100% for complete AI monitoring
            // Non-AI traffic uses the configured background rate
            tracesSampler: (samplingContext: any) => {
                // gen_ai.agent transactions are our async AI processing spans
                if (samplingContext.attributes?.span_type === "gen_ai") {
                    return 1.0;
                }
                return SENTRY_TRACES_SAMPLE_RATE;
            },
            // streamGenAiSpans: true is REQUIRED for Conversations tab.
            // Without this, gen_ai spans stay bundled in the parent transaction
            // and Conversations can't process them.
            streamGenAiSpans: true,
            attachStacktrace: true,
            // Only capture warn/error logs to avoid spamming from debug logging
            enableLogs: true,
            integrations: [
                Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
            ],
        };

        Sentry.init(sentryOptions);

        console.info("Sentry initialized (AI monitoring + error/warn logging)");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}
