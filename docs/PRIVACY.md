# Data and privacy (Phases 1–2)

The only server-side processing is the Phase 2 food search proxy, described below. This note records what the app holds so later phases can build on it. The privacy policy and EU (GDPR) review required before any health-related data is collected on a server are part of Phase 4.

## What is stored, and where

All data stays in the visitor's browser (`localStorage`, key `letsgetfit.data`) on their device.

| Data | Purpose |
|---|---|
| Age, height, weight, equation coefficient (female/male), activity level, pregnancy or breastfeeding answer | To calculate the estimates and decide eligibility |
| Workout entries (date, activity, duration, notes, optional estimate) | The user's own log |
| Weight entries (date, weight, notes) | The user's own log |
| Food diary and saved foods | The user's own log |
| Unit preference | Display only |

- The only data sent to the server is **food search text** (and the visitor's IP address, as with any web request). Our PHP endpoint forwards the search text to USDA FoodData Central (a US government service, which acts as a processor of the query). Search text is not logged. Results are cached by query text, with no link to who searched. IP addresses are used only in hashed form (HMAC) for rate limiting, and those files are pruned after 24 hours.
- Profile, diary, workouts and weights are never sent. The Content Security Policy blocks requests to other origins.
- There is no analytics, tracking, advertising, cookies or third-party script.
- Users can download their data as JSON and delete all of it from **Settings**.
- The web server keeps standard access logs (IP address, time, URL, user agent) under the host's own retention policy. Apart from food search text, no form data reaches the server.

## Before later phases

- **Phase 4:** before storing any health-related data server-side, complete a data inventory, lawful basis, retention periods, processor list, access controls, privacy policy and an EU privacy review (including whether a DPIA is needed). Keep personal data out of analytics, error payloads and routine logs.
- **Phase 5:** photos are sent to an AI provider only after explicit consent. They are stripped of metadata and deleted after processing by default.
