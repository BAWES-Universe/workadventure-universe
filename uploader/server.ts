import * as Sentry from "@sentry/node";
import App from "./src/App";
import {
    SENTRY_DSN,
    SENTRY_RELEASE,
    SENTRY_ENVIRONMENT,
    SENTRY_TRACES_SAMPLE_RATE,
} from "./src/Enum/EnvironmentVariable";

// Sentry integration
if (SENTRY_DSN != undefined) {
    try {
        const sentryOptions: Sentry.NodeOptions = {
            dsn: SENTRY_DSN,
            release: SENTRY_RELEASE,
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

App.listen(8080, () => {
    console.log(`WorkAdventure uploader starting on port 8080!`);
})

export {}
