import * as dotenv from "dotenv";
import * as Sentry from "@sentry/node";

dotenv.config();

const SENTRY_DSN = process.env.SENTRY_DSN_DISCORD_BOT;
// "" must read as unset: the image default is ENV RELEASE_VERSION="", and an empty string
// would otherwise be reported to Sentry as a release name.
const RELEASE_VERSION = process.env.RELEASE_VERSION || process.env.SENTRY_RELEASE || undefined;
const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT;
const parsedRate = parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || "0.1");
const SENTRY_TRACES_SAMPLE_RATE = isNaN(parsedRate) ? 0.1 : parsedRate;

if (SENTRY_DSN) {
    try {
        const sentryOptions: Sentry.NodeOptions = {
            dsn: SENTRY_DSN,
            release: RELEASE_VERSION,
            environment: SENTRY_ENVIRONMENT,
            tracesSampleRate: SENTRY_TRACES_SAMPLE_RATE,
            attachStacktrace: true,
        };

        Sentry.init(sentryOptions);
        console.info("Sentry initialized");
    } catch (e) {
        console.error("Error while initializing Sentry", e);
    }
}
