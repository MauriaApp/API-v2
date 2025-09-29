import Sentry from "@sentry/node";

Sentry.init({
    dsn: "https://a16510e790a3a1bd2421ecb554f91aef@o4510087561412608.ingest.us.sentry.io/4510103140106240",
    // Setting this option to true will send default PII data to Sentry.
    // For example, automatic IP address collection on events
    sendDefaultPii: true,
    tracesSampleRate: 1.0,
});
