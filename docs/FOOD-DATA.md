# Food data: model, sources and evaluation

## Data model (browser storage schema v2)

Schema v2 adds two collections to `letsgetfit.data`. Version 1 data (profile, workouts and weights) is upgraded in place and kept unchanged. Tests cover this in `tests/unit/store.test.mjs` and the e2e test "Phase 1 data is kept after the upgrade".

**`foods`** is the user's library ("My foods"), with one record per distinct food:

| Field | Meaning |
|---|---|
| `id` | Stable UUID |
| `source` | `custom` or `usda-fdc` |
| `sourceId` | FoodData Central `fdcId` (string), or `null` for custom foods |
| `name`, `brand` | As shown |
| `kind` | `generic` or `branded` |
| `preparation` | `raw`, `cooked`, `not-applicable` or `unspecified` |
| `dataType` | FoodData Central data type (Foundation, SR Legacy, Survey (FNDDS) or Branded) |
| `basis` | `100g`, or `100ml` for some branded drinks |
| `per100g` | `{ energy, protein, carbohydrate, fat, fibre, iron, calcium, potassium, vitaminD, vitaminB12 }`. A number, or `null` when unknown. |
| `nutrientUnits` | Explicit unit for every value: kcal, g, mg or µg |
| `servingOptions` | `[{ label, grams }]` |
| `createdAt`, `updatedAt`, `lastUsedAt` | UTC ISO 8601 timestamps |

**`diary`** holds one record per food eaten:

| Field | Meaning |
|---|---|
| `id`, `localDate` (YYYY-MM-DD, the user's local date), `meal` (breakfast, lunch, dinner or snacks) | |
| `foodId` | Library food it came from. The entry does not depend on it. |
| `source`, `sourceId`, `name`, `brand`, `kind`, `preparation`, `basis` | Copied from the food |
| `servingG` | Grams eaten (millilitres when `basis` is `100ml`) |
| `per100g`, `nutrientUnits` | **Snapshot** of the food's values when it was logged |
| `nutrients` | Snapshot scaled to `servingG` |

Rules:

- **Unknown is not zero.** `null` stays `null` through scaling. Day totals add the known values and count the unknowns per nutrient. The diary then shows "at least …" and "1 of 2 unknown", plus a notice that totals are incomplete.
- **Old entries never change.** Editing an entry's grams recalculates from that entry's own snapshot. Editing or deleting a library food, or a change in FoodData Central, does not affect logged entries.
- **Duplicates.** Library foods are matched by `source` + `sourceId`. Custom foods are matched by normalised name, brand and preparation, so "Brown soda bread" and "brown  soda-bread" count as the same food. Creating a duplicate offers "use the saved food" or "update the saved food". Search results are de-duplicated server-side by `fdcId` and by name, brand and type.
- **Raw, cooked and branded** are shown as badges. Raw and cooked versions of the same food are separate foods, because their values per 100 g differ.
- **Browser re-validation.** The browser re-checks every value from the server (`foodFromApi`). It converts units, rejects negative or implausible values (for example over 100 g of protein per 100 g) by making them unknown, and accepts only known sources and safe IDs.

## USDA FoodData Central adapter

- **Endpoints:** `GET /api/foods.php?q=<2–100 chars>&type=all|generic|branded` and `GET /api/health.php`. Both are thin entry points in `public/api/`. The code lives in `server/src/`, which is deployed outside the web root.
- **Upstream:** `GET {fdc_base_url}/foods/search?query=…&pageSize=25&dataType=…`. The key is sent in the `X-Api-Key` header, never in the URL. Without a key, the public `DEMO_KEY` is used, which has very low limits.
- **Timeouts:** 4 s to connect and 8 s in total (configurable). Responses are capped at 2 MB, and TLS is verified.
- **Rate limits:** 30 searches per visitor per 5 minutes, keyed by an HMAC of the IP address, so no IP is stored. There is also a site-wide cap of 900 a clock hour, under FoodData Central's 1,000 an hour per key.
- **Cache:** JSON files in `<private>/storage/cache` for 7 days, keyed by normalised query and type. Cached results do not count towards the rate limit.
- **Errors:** responses are `{ error, message }` with codes `invalid_query` (400), `rate_limited` (429), `upstream_busy` (503), `not_configured` (503), `timeout` (504), `upstream_unavailable` (502) and `server_error` (500). Every message points to manual entry. Logs record only the error type, never search text or secrets.
- **Nutrient mapping (FDC nutrient number → LetsGetFit):**

  | Nutrient | FDC number(s) | Notes |
  |---|---|---|
  | energy | 208 (kcal), then 958 / 957 (Atwater, used by Foundation foods), then 268 (kJ, converted) | |
  | protein | 203 | |
  | carbohydrate | 205 | by difference |
  | fat | 204 | |
  | fibre | 291 | |
  | iron | 303 | |
  | calcium | 301 | |
  | potassium | 306 | |
  | vitamin D | 328 (µg), else 324 (IU ÷ 40) | |
  | vitamin B12 | 418 | |

  Records that only have `nutrientId` are mapped through the equivalent IDs (for example 1008 → 208). Units are converted (g, mg, µg; kcal, kJ). Missing values stay unknown.
- **Basis:** FoodData Central search values are per 100 g. Branded products sold by volume (serving unit `ml`) are marked `100ml`, and the app tells the user that amounts are treated as millilitres.
- **Attribution** is shown on the Food page and returned in every response: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central. FoodData Central data is in the public domain (CC0), and USDA asks for this citation.

**Running without production credentials:**
- Without PHP (for example `npm run serve`), the app detects that `api/health.php` is missing, explains that search is unavailable, and opens on "My foods" and "New food".
- The PHP tests use a fake HTTP client (`tests/php/`). The API integration tests run a real `php -S` against a mock FoodData Central (`tests/php/mock-fdc.php`) with the fixture `tests/php/fixtures/fdc-search-apple.json`.
- The browser tests mock `/api/*` with the same normalised format.

## Open Food Facts: evaluation (not adopted yet)

Open Food Facts is the likeliest source for **Irish and EU branded products and barcodes**. This evaluation is from published project documentation as understood on 9 November 2026. **Re-check the licence and API terms at openfoodfacts.org before building on it.**

| Topic | Finding | Impact |
|---|---|---|
| Licence | Database: Open Database Licence (ODbL) 1.0. Individual contents: Database Contents Licence. Product photos: Creative Commons BY-SA. | Attribution is required wherever data is shown. If we ever publish a database derived from it, that database must be shared under ODbL. Storing per-user diary snapshots and showing them to that user is a produced work, which needs attribution but no share-alike. Do not redistribute product photos without BY-SA attribution. |
| Attribution | Credit "Open Food Facts" with a link, and state the ODbL licence. | Add a line next to the USDA attribution once adopted. |
| API terms | Read API needs no key but asks for a custom `User-Agent` identifying the app and a contact. Documented limits are about 100 product reads a minute and about 10 searches a minute per IP. Bulk use should go through their data exports. | Proxy through our PHP endpoint with caching and our own User-Agent. Use product (barcode) lookups rather than free-text search. |
| Data completeness | Crowd-sourced from EU-style labels: energy (kJ/kcal), fat, saturates, carbohydrate, sugars, protein and salt are usually present. Fibre is often missing (it is optional on EU labels). Vitamins and minerals are rarely present. Quality and freshness vary, and some Irish own-label products are missing or outdated. | Fits the "unknown, not zero" model. Most micronutrients will show as unknown. Show the source clearly and let users correct values in a custom copy. |
| Units | Values per 100 g or 100 ml, with a `nutrition_data_per` field. Salt and sodium are both present. | Map to `basis` the same way as FoodData Central branded products. |

**Recommendation:** adopt Open Food Facts later as a **barcode lookup** for branded products, behind the same PHP adapter pattern (server-side cache, rate limits, User-Agent, attribution), and only after manual and FoodData Central entries have been in real use. Barcode scanning (camera) waits until that product lookup works, as the brief requires. Neither is part of this release.
