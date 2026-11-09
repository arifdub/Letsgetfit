# Data and privacy (Phase 1)

Phase 1 has no server-side processing. This note records what the app holds so later phases can build on it. The privacy policy and EU (GDPR) review required before any health-related data is collected on a server are part of Phase 4.

## What is stored, and where

All data stays in the visitor's browser (`localStorage`, key `letsgetfit.data`) on their device.

| Data | Purpose |
|---|---|
| Age, height, weight, equation coefficient (female/male), activity level, pregnancy or breastfeeding answer | To calculate the estimates and decide eligibility |
| Workout entries (date, activity, duration, notes, optional estimate) | The user's own log |
| Weight entries (date, weight, notes) | The user's own log |
| Unit preference | Display only |

- Nothing is sent to letsgetfit.site or anyone else. The Content Security Policy blocks requests to other origins.
- There is no analytics, tracking, advertising, cookies or third-party script.
- Users can download their data as JSON and delete all of it from **Settings**.
- The web server keeps standard access logs (IP address, time, URL, user agent) under the host's own retention policy. No form data reaches the server.

## Before later phases

- **Phase 2:** food search requests go through our PHP endpoint to USDA FoodData Central. Only the search text is sent, never profile data. Document the processor and log retention.
- **Phase 4:** before storing any health-related data server-side, complete a data inventory, lawful basis, retention periods, processor list, access controls, privacy policy and an EU privacy review (including whether a DPIA is needed). Keep personal data out of analytics, error payloads and routine logs.
- **Phase 5:** photos are sent to an AI provider only after explicit consent. They are stripped of metadata and deleted after processing by default.
