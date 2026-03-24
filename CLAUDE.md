# CLAUDE.md — Solar Quote Tool

## Before Starting Any Task
Before writing any code or files, confirm your understanding of what's being asked.
Restate the task briefly and get user approval before proceeding.

## Deployment
- **Production is GitHub Pages on `main`.** Real users are on this branch right now.
- **Commit locally only.** Do NOT push to `main` unless the user explicitly says "deploy" or "push".
- Test locally by opening `index.html` from the repo folder before deploying.

## What to Update on Every Change
When committing changes, also update these if relevant:
- `guide.html` — user-facing documentation (field tables, quick start steps)
- `solar_quote_tool_architecture.html` — Mermaid-based architecture doc
- Auto-memory (`MEMORY.md`) — stable patterns and decisions

## Project Purpose
Quote builder for solar + battery systems. Sales reps configure a system (panels, battery,
inverter, accessories, backup, mounting) and get a live customer price with PDF generation.
Two manufacturers: Sigenergy and SolaX. Admin panel manages contractors, pricing, and users.

## Tech Stack
- **Frontend**: Vanilla JS, no framework, no build step — static HTML/CSS/JS
- **Backend**: Supabase (PostgreSQL + REST API + Edge Functions)
- **Hosting**: GitHub Pages (main branch)
- **CDN**: supabase-js v2.98.0, jsPDF + AutoTable (SRI-pinned)
- **APIs**: Google Maps JS API, Places API, Distance Matrix API

## Folder Structure
```
├── index.html          # Quote builder UI
├── app.js              # Core quote logic (~4500 lines)
├── admin.html          # Admin interface (contractors, pricing, users)
├── admin.js            # Admin logic (~2100 lines)
├── style.css           # Shared styles (~1700 lines)
├── config.json         # Structural rules (CEC tables, STC zones, mounting, battery rules)
├── guide.html          # User guide with screenshots
├── screenshots/        # Guide screenshots (12 PNGs)
├── BDS_Logo_-_Black.png / BDSLogoClaer.png  # Branding
├── supabase/
│   ├── config.toml
│   └── functions/      # Edge Functions (admin-users)
├── reference/          # Specs, price lists, manuals (not deployed)
└── CLAUDE.md           # This file
```

## Key Architecture Decisions
- `config.json` holds structural/rules data only. All pricing lives in Supabase typed tables.
- `reconstructConfig()` merges DB pricing into structural config → single `CONFIG` object.
- Fallback chain: Supabase DB → config.json → embedded DEFAULT_CONFIG.
- Four parallel init calls on DOMContentLoaded: loadConfig, loadReps, loadContractors, initAutocomplete.
- `calculateQuote()` is the central engine — runs on every input change (150ms debounce for text).
- Quotes are saved as JSONB in Supabase with full BOM snapshot at save time.
- STC rebates are driven by the admin-set Install Period in business_params. The install period determines both the PV deeming period and battery STC factor automatically from hard-coded legislated schedules (`PV_DEEMING_SCHEDULE`, `BATTERY_STC_SCHEDULE` in app.js). Battery tiers (0-14kWh @100%, 14-28 @60%, 28-50 @15%) are hard-coded and apply from May 1 2026. Urgency banner compares current price against the next scheduled step-down.

## Code Conventions
- Vanilla JS throughout — `var` in older code, `let`/`const` in newer. No classes or modules.
- Functions use `function name()` declarations (hoisted). Arrow functions only in callbacks.
- DOM queries use `document.getElementById()` / `document.querySelector()`.
- Segmented toggles: hidden `<select>` + `.seg-group` div with `.seg-btn` buttons. `bindSegmentedButtons()` auto-wires all at init. Use `syncSegmentedFromSelect(id)` to sync programmatically.
- State is mostly in DOM elements + a `state` object synced via `syncStateFromDOM()`.
- Global variables at top of app.js (currentManufacturer, currentContractorId, etc.).
- Date format: always AU `DD/MM/YYYY` — use manual formatting `(d.getDate()+'').padStart(2,'0')+'/'+(d.getMonth()+1+'').padStart(2,'0')+'/'+d.getFullYear()`, never rely on `toLocaleDateString()` locale.
- Section comments: `// ==================== SECTION NAME ====================`
- Admin uses `allTables` dict keyed by table name, `TYPE_TO_TABLE`, `TABLE_COLUMNS` for type-specific rendering.

## Database
- **Product tables (10)**: panels, inverters, battery_modules, gateways, ev_chargers, accessories, addons, battery_mounting, mounting_kits, mounting_parts
- **Reference tables**: battery_packages, solax_bms_components, business_params
- **Operations tables**: quotes, reps, contractors, rate_card_items
- 6 product tables have promotional discount columns (discount_pct, discount_from, discount_to)
- RLS enabled on all admin tables with policies for BOTH `anon` and `authenticated` roles
- When adding new tables, always add policies for both roles

## Patterns to Follow

### The Save/Load/Clear Trinity
Every new UI control must update all three — missing one causes data loss or stale state:
1. **`collectQuoteData()`** — save: read DOM value into the JSONB structure
2. **`loadQuote()`** — restore: write saved value back to DOM, then `syncSegmentedFromSelect()` for toggles
3. **`clearQuote()`** — reset: set to default value, sync toggles, clear derived state

### Adding a New Cost to the Quote
Follow this sequence — skipping a step causes price mismatches between UI, BOM, and PDF:
1. Define cost variable in `calculateQuote()`, set it in all three system-type branches (solar-only / battery-only / hybrid)
2. Add to the relevant subtotal (`totalPv`, `totalBattery`, `totalInstall`)
3. Add line to `buildBOM()` with `{ desc, sku, qty, unit, total, supplier_code }`
4. Add line to `generateQuote()` PDF output
5. If it affects the urgency banner, update `futurePriceNum` calculation
6. Save/load/clear the value (see trinity above)

### Adding a New Business Parameter
1. Add column to `business_params` table in Supabase
2. Merge into CONFIG in `reconstructConfig()`: `cfg.myParam = Number(businessParams.my_param) || 0`
3. Use in `calculateQuote()` via `CONFIG.myParam`
4. Add admin form field in `renderBusinessParams()` with `id="bpMyParam"`
5. Read it in `saveBusinessParams()` with `Number(document.getElementById('bpMyParam').value)`
6. Snapshot in `collectQuoteData()` totals if the value should be frozen at save time

### Adding a New Product Type
1. Create Supabase table with RLS policies for **both** `anon` and `authenticated` roles
2. Add to parallel query in `loadConfig()` and `reconstructConfig()`
3. Add to admin: `allTables`, `TYPE_TO_TABLE`, `TABLE_COLUMNS`, `renderTypeFields()`, `buildTypeData()`
4. Add population function in app.js (e.g., `populateNewType()`)

### Segmented Toggles
Always use the hidden `<select>` + `.seg-group` pattern:
- `bindSegmentedButtons()` auto-wires all toggles at init — no manual listener needed
- After programmatically changing the hidden select, call `syncSegmentedFromSelect(id)`
- In `loadQuote()`: set the select value first, then sync the buttons
- In `clearQuote()`: set default value, then sync

### Backup Logic
- Sigenergy: `#backupScope` toggle (Partial/Full Home) next to gateway. Auto-adds board upgrade addons and sets circuit counts.
- SolaX: `#solaxBackupType` 3-option toggle (None/Partial/Full Home). Auto-adds board upgrade addons, sets circuits, handles EPS box for Full Home.
- Both use `addAddonByLabel()` / `removeAddonByLabel()` to swap rate card addons

### Pricing & Discounts
- `getEffectivePrice(product)` for any price that could have a promotional discount
- 6 tables support discounts: panels, inverters, battery_modules, gateways, ev_chargers, accessories
- `collectActiveDiscounts()` snapshots at save; `checkExpiredDiscounts()` warns on load

### Other Patterns
- Commit messages: imperative, one-line summary. Co-authored-by Claude line added automatically.
- Console logging: `[OK]` success, `[!]` warning/error — helps trace init sequence
- Guard clauses: `if (!CONFIG.manufacturers) return;` at top of `calculateQuote()` and similar
- Null safety: use `?.` optional chaining + `|| fallback` for all config/DOM access
- Numeric conversion: `Number(value) || 0` for required numbers, `Number(value) || null` for optional
- XSS safety: `esc()` function in admin.js for all user-supplied values rendered as HTML
- Parallel loading: all init data loads fire in parallel via `Promise.all()` — never chain sequentially

## Files That Change Together
Features typically touch this set — check you haven't missed one:
- **app.js** + **index.html** + **style.css** — always (UI + logic + styling)
- **admin.js** + **admin.html** — if admin-configurable
- **guide.html** — user documentation (update after feature is tested)
- **MEMORY.md** + **solar_quote_tool_architecture.html** — stable patterns and architecture

## Things to Avoid
- Don't push to main without explicit permission.
- Don't add frameworks, bundlers, or build steps.
- Don't modify `config.json` for pricing changes — pricing lives in Supabase.
- Don't forget `authenticated` role when adding RLS policies.
- Don't use `whole_home` for SolaX backup — the values are now `none`, `partial`, `full`.
- Don't add a cost in `calculateQuote()` without also adding it to `buildBOM()` and `generateQuote()` — prices will mismatch.
- Don't set a segmented toggle value without calling `syncSegmentedFromSelect()` after — buttons will be out of sync.
- Don't chain init calls sequentially — use parallel `Promise.all()` to keep mobile load times fast.
- Don't assume DOM elements exist — guard with `var el = document.getElementById(id); if (el) ...`
- Don't use raw string concatenation for HTML with user data — always use `esc()` in admin.js.
