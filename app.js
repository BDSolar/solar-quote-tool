// ====================
// Black Diamond Solar - Quote Builder
// Multi-Manufacturer Edition
// ====================

if (typeof CONFIG === 'undefined') var CONFIG = {};
let customAddonCount = 0, userChangedInverter = false;
let batteryQtys = {};
let currentManufacturer = 'sigenergy';
let currentBatteryTypeIdx = 0;
let selectedAccessories = [];
let currentQuoteId = null;
let dualStackResult = null; // holds dual-stack optimizer output when active
let dualStackEcOverride = { stack1: null, stack2: null }; // user EC upgrade overrides per stack
let parallelResult = null; // holds SolaX parallel battery optimizer output when active
let lastSystemMode = null; // tracks 'solar_only', 'battery_only', or 'hybrid' for inverter repopulation
let currentSystemType = 'hybrid'; // 'hybrid', 'battery_only', or 'pv_only'
let currentRepId = null; // selected rep UUID
let currentContractorId = null; // selected contractor UUID
let currentRateCardItems = []; // rate card items for selected contractor
let currentContractorRecord = null; // full contractor row
let rateCardResult = null; // result of calculateInstallationCosts()
let installationAddons = { standardItems: {}, checkboxItems: {}, addonItems: {} };

// ====================
// DEBOUNCE UTILITY
// ====================
function debounce(fn, ms) { let t; return function() { clearTimeout(t); t = setTimeout(fn, ms); }; }
const debouncedCalculateQuote = debounce(() => calculateQuote(), 150);

// ====================
// SUPABASE INIT
// ====================

const SUPABASE_URL = 'https://rjobiaevpjcwgmlhdevf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqb2JpYWV2cGpjd2dtbGhkZXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODA4ODMsImV4cCI6MjA4NzE1Njg4M30.tPdtYhznf7-Zc4BNFazTNsKu5ecUtUVPNcRM3bnGO0s';
let supabaseClient = null;
try {
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[OK] Supabase connected');
} catch (err) {
    console.warn('[!] Supabase init failed:', err);
}

// ====================
// ADMIN SESSION CHECK (shows BOM button for authenticated users)
// ====================
async function checkAdminSession() {
    if (!supabaseClient) return;
    try {
        var { data } = await supabaseClient.auth.getSession();
        if (data && data.session) {
            var btn = document.getElementById('bomBtn');
            if (btn) btn.style.display = '';
        }
    } catch (e) { /* silent */ }
}

// ====================
// REP LOADING
// ====================

async function loadReps() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('reps')
            .select('id, name').eq('active', true).order('name');
        if (error || !data) return;
        const sel = document.getElementById('repSelect');
        data.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id;
            o.textContent = r.name;
            sel.appendChild(o);
        });
        // Restore from localStorage
        const saved = localStorage.getItem('bds_rep_id');
        if (saved && data.find(r => r.id === saved)) {
            sel.value = saved;
            currentRepId = saved;
        }
        sel.addEventListener('change', function() {
            currentRepId = this.value || null;
            if (currentRepId) localStorage.setItem('bds_rep_id', currentRepId);
            else localStorage.removeItem('bds_rep_id');
        });
        console.log('[OK] Reps loaded (' + data.length + ')');
    } catch (e) {
        console.warn('[!] Failed to load reps:', e);
    }
}

// ====================
// CONTRACTOR + RATE CARD LOADING
// ====================

async function loadContractors() {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('contractors')
            .select('id, business_name').eq('active', true).order('business_name');
        if (error || !data) return;
        const sel = document.getElementById('contractorSelect');
        data.forEach(r => {
            const o = document.createElement('option');
            o.value = r.id;
            o.textContent = r.business_name;
            sel.appendChild(o);
        });
        // Restore from localStorage, or default to "Standard Rates"
        const saved = localStorage.getItem('bds_contractor_id');
        var match = saved && data.find(r => r.id === saved);
        if (!match) match = data.find(r => r.business_name === 'Standard Rates');
        if (match) {
            sel.value = match.id;
            currentContractorId = match.id;
            localStorage.setItem('bds_contractor_id', match.id);
            loadRateCard(match.id);
        }
        sel.addEventListener('change', function() {
            currentContractorId = this.value || null;
            if (currentContractorId) {
                localStorage.setItem('bds_contractor_id', currentContractorId);
                loadRateCard(currentContractorId);
            } else {
                localStorage.removeItem('bds_contractor_id');
                currentRateCardItems = [];
                currentContractorRecord = null;
                rateCardResult = null;
                installationAddons = { standardItems: {}, checkboxItems: {}, addonItems: {} };
                updateInstallCostsVisibility();
                calculateQuote();
            }
        });
        console.log('[OK] Contractors loaded (' + data.length + ')');
    } catch (e) {
        console.warn('[!] Failed to load contractors:', e);
    }
}

async function loadRateCard(contractorId, options) {
    if (!supabaseClient || !contractorId) return;
    var skipCalc = options && options.skipCalc;
    try {
        // Load contractor record
        const { data: ctr, error: ctrErr } = await supabaseClient.from('contractors')
            .select('*').eq('id', contractorId).single();
        if (ctrErr || !ctr) { console.warn('[!] Contractor not found'); return; }
        currentContractorRecord = ctr;

        // Load rate card items
        const { data: items, error: itemErr } = await supabaseClient.from('rate_card_items')
            .select('*').eq('contractor_id', contractorId).eq('active', true).order('sort_order');
        if (itemErr) { console.warn('[!] Rate card load error:', itemErr); return; }
        currentRateCardItems = items || [];

        // Initialize standard items as checked by default
        currentRateCardItems.forEach(function(item) {
            if (item.input_type === 'standard' && installationAddons.standardItems[item.id] === undefined) {
                installationAddons.standardItems[item.id] = true;
            }
        });

        updateInstallCostsVisibility();
        renderInstallationCostsUI();
        if (!skipCalc) calculateQuote();
        console.log('[OK] Rate card loaded (' + currentRateCardItems.length + ' items)');
    } catch (e) {
        console.warn('[!] Failed to load rate card:', e);
    }
}

function updateInstallCostsVisibility() {
    var section = document.getElementById('installCostsSection');
    var installPvGroup = document.getElementById('installPvGroup');
    var installBatGroup = document.getElementById('installBatGroup');
    if (currentContractorId && currentRateCardItems.length > 0) {
        if (section) section.style.display = '';
        if (installPvGroup) installPvGroup.style.display = 'none';
        if (installBatGroup) installBatGroup.style.display = 'none';
    } else {
        if (section) section.style.display = 'none';
        if (installPvGroup) installPvGroup.style.display = '';
        if (installBatGroup) installBatGroup.style.display = '';
    }
}

// ====================
// RATE CARD CALCULATION ENGINE
// ====================

function buildQuoteContext() {
    var gwSel = document.getElementById('gatewaySelect');
    var gwIdx = gwSel ? gwSel.selectedIndex : 0;
    var gwVal = gwSel ? gwSel.value : 'none';
    return {
        sysKw: state.sysKw || 0,
        panelCount: state.panelCount || 0,
        phase: state.phase || 'single_phase',
        roofType: state.roofType || 'metal',
        storey: parseInt(document.getElementById('storeyCount')?.value) || 1,
        arrays: state.numArrays || 1,
        has_pv: (state.sysKw || 0) > 0,
        has_battery: (state.desiredBatteryKwh || 0) > 0,
        dual_stack: dualStackResult !== null,
        has_backup: gwIdx > 0 && gwVal !== 'none',
        backupCircuitCount: parseInt(document.getElementById('backupCircuitCount')?.value) || 0,
        travelDistanceKm: parseInt(document.getElementById('travelDistanceKm')?.value) || 0
    };
}

function matchesConditions(conditions, ctx) {
    if (!conditions || Object.keys(conditions).length === 0) return true;
    for (var key in conditions) {
        if (!conditions.hasOwnProperty(key)) continue;
        var expected = conditions[key];
        var actual;
        // Map condition keys to context fields
        if (key === 'roof_type') actual = ctx.roofType;
        else if (key === 'phase') actual = ctx.phase;
        else if (key === 'storey') actual = ctx.storey;
        else if (key === 'has_pv') actual = ctx.has_pv;
        else if (key === 'has_battery') actual = ctx.has_battery;
        else if (key === 'dual_stack') actual = ctx.dual_stack;
        else if (key === 'has_backup') actual = ctx.has_backup;
        else actual = ctx[key];
        if (actual !== expected) return false;
    }
    return true;
}

function calculateItemCost(item, ctx, addons) {
    var rate = parseFloat(item.rate) || 0;
    var threshold = parseFloat(item.threshold) || 0;

    switch (item.pricing_type) {
        case 'per_watt': {
            var kw = ctx.sysKw || 0;
            if (item.threshold_type === 'under') {
                var cappedKw = Math.min(kw, threshold);
                return cappedKw * 1000 * rate;
            } else if (item.threshold_type === 'over') {
                var overKw = Math.max(0, kw - threshold);
                return overKw * 1000 * rate;
            }
            return kw * 1000 * rate;
        }
        case 'per_panel': {
            var qty = 0;
            if (item.input_type === 'addon') {
                var addonData = addons.addonItems[item.id];
                qty = addonData ? (parseInt(addonData.quantity) || 0) : 0;
            } else {
                qty = ctx.panelCount || 0;
            }
            return qty * rate;
        }
        case 'per_metre': {
            var addonData2 = addons.addonItems[item.id];
            var totalMetres = addonData2 ? (parseFloat(addonData2.value) || 0) : 0;
            if (item.threshold_type === 'after' && threshold > 0) {
                return Math.max(0, totalMetres - threshold) * rate;
            }
            return totalMetres * rate;
        }
        case 'per_circuit': {
            var circuits = ctx.backupCircuitCount || 0;
            return circuits * rate;
        }
        case 'per_km': {
            var distance = ctx.travelDistanceKm || 0;
            var travelThreshold = (currentContractorRecord && currentContractorRecord.travel_threshold_km) ? currentContractorRecord.travel_threshold_km : 80;
            if (item.threshold_type === 'after') {
                return Math.max(0, distance - travelThreshold) * rate;
            }
            return distance * rate;
        }
        case 'flat': {
            if (item.threshold_type === 'after' && threshold > 0 && item.applies_to) {
                var val = ctx[item.applies_to] || 0;
                var extra = Math.max(0, val - threshold);
                return extra * rate;
            }
            return rate;
        }
        case 'quoted': {
            var addonData3 = addons.addonItems[item.id];
            return addonData3 ? (parseFloat(addonData3.quotedAmount) || 0) : 0;
        }
        default:
            return 0;
    }
}

function calculateInstallationCosts(ctx, contractor, rateCardItems, addons) {
    var items = [];
    var total = 0;

    rateCardItems.forEach(function(item) {
        // Check conditions
        if (!matchesConditions(item.conditions, ctx)) return;

        // Check input_type eligibility
        if (item.input_type === 'auto') {
            // Auto items always included if conditions match
        } else if (item.input_type === 'standard') {
            // Standard: included unless user unchecked
            if (addons.standardItems[item.id] === false) return;
        } else if (item.input_type === 'checkbox') {
            // Checkbox: only included if user checked
            if (!addons.checkboxItems[item.id]) return;
        } else if (item.input_type === 'addon') {
            // Addon: only included if user added it
            if (!addons.addonItems[item.id]) return;
        }

        var cost = calculateItemCost(item, ctx, addons);
        cost = Math.round(cost * 100) / 100;
        if (cost > 0 || item.pricing_type === 'quoted') {
            items.push({
                id: item.id,
                label: item.label,
                category: item.category,
                pricing_type: item.pricing_type,
                input_type: item.input_type,
                rate: parseFloat(item.rate) || 0,
                cost: cost
            });
            total += cost;
        }
    });

    return { items: items, total: Math.round(total * 100) / 100 };
}

// ====================
// RATE CARD UI RENDERING
// ====================

function renderInstallationCostsUI() {
    var autoEl = document.getElementById('rcAutoItems');
    var standardEl = document.getElementById('rcStandardItems');
    var checkboxEl = document.getElementById('rcCheckboxItems');
    var addonSelect = document.getElementById('rcAddonSelect');
    if (!autoEl || !standardEl || !checkboxEl || !addonSelect) return;

    // Separate items by input_type
    var autoItems = [], standardItems = [], checkboxItems = [], addonItems = [];
    currentRateCardItems.forEach(function(item) {
        switch (item.input_type) {
            case 'auto': autoItems.push(item); break;
            case 'standard': standardItems.push(item); break;
            case 'checkbox': checkboxItems.push(item); break;
            case 'addon': addonItems.push(item); break;
        }
    });

    // Standard items: pill with checkbox, checked by default
    // Checkbox items: pill with checkbox, unchecked by default
    standardEl.innerHTML = '';
    standardItems.forEach(function(item) {
        if (installationAddons.standardItems[item.id] === undefined) installationAddons.standardItems[item.id] = true;
        var checked = installationAddons.standardItems[item.id] !== false;
        var div = document.createElement('div');
        div.className = 'auto-accessory' + (checked ? '' : ' acc-excluded');
        div.innerHTML = '<input type="checkbox" class="acc-pill-check" id="rcStd_' + item.id + '" ' + (checked ? 'checked' : '') + '><span class="auto-acc-label">' + esc(item.label) + '</span><span class="auto-acc-badge">' + (checked ? 'Included' : 'Excluded') + '</span>';
        div.querySelector('input').addEventListener('change', function() {
            onRcStandardToggle(item.id, this.checked);
            renderInstallationCostsUI();
        });
        standardEl.appendChild(div);
    });
    checkboxItems.forEach(function(item) {
        var checked = !!installationAddons.checkboxItems[item.id];
        var div = document.createElement('div');
        div.className = 'auto-accessory' + (checked ? '' : ' acc-excluded');
        div.innerHTML = '<input type="checkbox" class="acc-pill-check" id="rcCb_' + item.id + '" ' + (checked ? 'checked' : '') + '><span class="auto-acc-label">' + esc(item.label) + '</span><span class="auto-acc-badge">' + (checked ? 'Included' : 'Excluded') + '</span>';
        div.querySelector('input').addEventListener('change', function() {
            onRcCheckboxToggle(item.id, this.checked);
            renderInstallationCostsUI();
        });
        standardEl.appendChild(div);
    });
    checkboxEl.innerHTML = '';

    // Addon dropdown: populate with items not yet added
    addonSelect.innerHTML = '<option value="">Add item...</option>';
    addonItems.forEach(function(item) {
        if (!installationAddons.addonItems[item.id]) {
            var o = document.createElement('option');
            o.value = item.id;
            o.textContent = item.label;
            addonSelect.appendChild(o);
        }
    });
    addonSelect.onchange = function() {
        if (!this.value) return;
        addRcAddon(this.value);
        this.value = '';
    };

    // Render already-added addon rows
    renderRcAddonRows();

    // Show/hide backup circuits based on gateway/EPS selection
    updateBackupCircuitsVisibility();
    // Show/hide travel section based on whether travel item exists
    updateTravelVisibility();
}

function addRcAddon(itemId) {
    var item = currentRateCardItems.find(function(i) { return i.id === itemId; });
    if (!item) return;
    installationAddons.addonItems[itemId] = { quantity: 1, value: 0, quotedAmount: 0 };
    renderInstallationCostsUI();
    calculateQuote();
}

function removeRcAddon(itemId) {
    delete installationAddons.addonItems[itemId];
    renderInstallationCostsUI();
    calculateQuote();
}

function renderRcAddonRows() {
    var container = document.getElementById('rcAddonRows');
    if (!container) return;
    container.innerHTML = '';
    for (var itemId in installationAddons.addonItems) {
        if (!installationAddons.addonItems.hasOwnProperty(itemId)) continue;
        var item = currentRateCardItems.find(function(i) { return i.id === itemId; });
        if (!item) continue;
        var addonData = installationAddons.addonItems[itemId];
        var div = document.createElement('div');
        div.className = 'auto-accessory added-accessory';
        var qtyHtml = '';
        if (item.pricing_type === 'per_panel') {
            var qty = addonData.quantity || 0;
            qtyHtml = '<div class="addon-stepper" style="margin-left:auto;">' +
                '<button type="button" class="stepper-btn addon-stepper-btn rc-addon-qty-down" data-id="' + itemId + '">−</button>' +
                '<div class="addon-stepper-center"><span class="addon-stepper-num rc-addon-qty" data-id="' + itemId + '">' + qty + '</span><span class="addon-stepper-label">panels</span></div>' +
                '<input type="hidden" class="rc-addon-qty-input" data-id="' + itemId + '" value="' + qty + '">' +
                '<button type="button" class="stepper-btn addon-stepper-btn rc-addon-qty-up" data-id="' + itemId + '">+</button></div>';
        }
        div.innerHTML = '<svg class="auto-acc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
            '<span class="auto-acc-label">' + esc(item.label) + '</span>' +
            (qtyHtml || '<span class="auto-acc-badge">Added</span>') +
            '<button class="btn-remove-acc" title="Remove">&times;</button>';
        (function(id) {
            div.querySelector('.btn-remove-acc').addEventListener('click', function() { removeRcAddon(id); });
            var downBtn = div.querySelector('.rc-addon-qty-down');
            var upBtn = div.querySelector('.rc-addon-qty-up');
            var qtyDisplay = div.querySelector('.addon-stepper-num');
            var qtyHidden = div.querySelector('.rc-addon-qty-input');
            if (downBtn && upBtn && qtyDisplay && qtyHidden) {
                downBtn.addEventListener('click', function() {
                    var v = Math.max(0, (parseInt(qtyHidden.value) || 0) - 1);
                    qtyHidden.value = v;
                    qtyDisplay.textContent = v;
                    installationAddons.addonItems[id].quantity = v;
                    calculateQuote();
                });
                upBtn.addEventListener('click', function() {
                    var v = Math.min(99, (parseInt(qtyHidden.value) || 0) + 1);
                    qtyHidden.value = v;
                    qtyDisplay.textContent = v;
                    installationAddons.addonItems[id].quantity = v;
                    calculateQuote();
                });
            }
        })(itemId);
        container.appendChild(div);
    }
}


function onRcStandardToggle(itemId, checked) {
    installationAddons.standardItems[itemId] = checked;
    calculateQuote();
}

function onRcCheckboxToggle(itemId, checked) {
    installationAddons.checkboxItems[itemId] = checked;
    calculateQuote();
}

function updateInstallationCostsDisplay() {
    if (!rateCardResult || !currentContractorId) return;
    var autoEl = document.getElementById('rcAutoItems');
    if (!autoEl) return;

    // Group auto items by category for display
    var autoItems = rateCardResult.items.filter(function(i) { return i.input_type === 'auto'; });
    var categories = {};
    autoItems.forEach(function(item) {
        if (!categories[item.category]) categories[item.category] = [];
        categories[item.category].push(item);
    });

    var catLabels = { pv: 'PV Installation', electrical: 'Electrical', battery: 'Battery Installation', access: 'Access', travel: 'Travel' };
    var html = '';
    ['pv', 'electrical', 'battery', 'access', 'travel'].forEach(function(cat) {
        if (!categories[cat]) return;
        html += '<div class="rc-category-header">' + (catLabels[cat] || cat) + '</div>';
        categories[cat].forEach(function(item) {
            html += '<div class="rc-auto-row"><span>' + esc(item.label) + '</span><span class="rc-cost">' + fmtExGst(item.cost) + '</span></div>';
        });
    });
    autoEl.innerHTML = html;

    // Update subtotal
    var subtotalEl = document.getElementById('rcSubtotal');
    if (subtotalEl) subtotalEl.textContent = fmtExGst(rateCardResult.total);

    // Update right panel install subtotal
    var installSubEl = document.getElementById('installSubtotal');
    if (installSubEl) installSubEl.textContent = fmtExGst(rateCardResult.total);

    // Update addon row costs
    renderRcAddonRows();
}

function updateBackupCircuitsVisibility() {
    var el = document.getElementById('rcBackupCircuits');
    if (!el) return;
    var gwSel = document.getElementById('gatewaySelect');
    var hasBackup = gwSel && gwSel.selectedIndex > 0 && gwSel.value !== 'none';
    // Also check if backup circuit item exists in rate card
    var hasItem = currentRateCardItems.some(function(i) { return i.conditions && i.conditions.has_backup === true; });
    el.style.display = (hasBackup && hasItem && currentContractorId) ? '' : 'none';
}

function updateTravelVisibility() {
    var el = document.getElementById('rcTravelSection');
    if (!el) return;
    var hasItem = currentRateCardItems.some(function(i) { return i.category === 'travel'; });
    el.style.display = (hasItem && currentContractorId) ? '' : 'none';
}

// ====================
// GLOBAL UTILITIES
// ====================

const GST = 1.1;
const fmtIncGst = v => '$' + Math.round(v * GST).toLocaleString('en-AU');
const fmtExGst = v => '$' + Math.round(v).toLocaleString('en-AU');
const fmtExGstDecimal = v => '$' + v.toFixed(2);
const fmtKwh = v => (Math.floor(v * 10) / 10);

// STC scheme date boundary: May 1 2026 changes deeming period and battery rebate structure
const STC_MAY2026 = new Date(2026, 4, 1); // months are 0-indexed
function isPostMay2026() { return new Date() >= STC_MAY2026; }

// Deeming period: 5 years before May 2026, 4 years from May 2026
function getDeemingPeriod() { return isPostMay2026() ? 4 : 5; }

// Battery STC rebate — auto-switches between flat rate (pre-May) and tiered (post-May)
// Pre-May: flat rate from business_params (battery_rebate_per_kwh), capped at 50 kWh
// Post-May: tiered STC structure — 0-14 kWh @100%, 14-28 kWh @60%, 28-50 kWh @15%, STC factor 6.8
function calcBatteryRebate(usableKwh, rateOrStcPrice) {
    var capped = Math.min(usableKwh, 50);
    if (!isPostMay2026()) {
        return capped * rateOrStcPrice;
    }
    return calcBatteryRebateTiered(capped, rateOrStcPrice);
}

// Tiered battery STC rebate (May 2026+)
function calcBatteryRebateTiered(cappedKwh, stcPrice) {
    var stcs = 0;
    if (cappedKwh <= 14) {
        stcs = cappedKwh * 6.8;
    } else if (cappedKwh <= 28) {
        stcs = 14 * 6.8 + (cappedKwh - 14) * 6.8 * 0.6;
    } else {
        stcs = 14 * 6.8 + 14 * 6.8 * 0.6 + (cappedKwh - 28) * 6.8 * 0.15;
    }
    return Math.floor(stcs) * stcPrice;
}

// Future (post-May) battery rebate — used by urgency banner before May 2026
function calcBatteryRebateFuture(usableKwh, stcPrice) {
    return calcBatteryRebateTiered(Math.min(usableKwh, 50), stcPrice);
}

function getBmsName(bt) { return bt.id === 'tp_hs36' ? 'TBMS-MCS0800' : bt.id === 'tb_hs51' ? 'TBMS-S51-80' : (bt.bms_code || 'BMS'); }
function getBmsDesc(bt) { var n = getBmsName(bt); return n === 'BMS' ? 'Battery BMS' : 'BMS (' + n + ')'; }

function esc(s) {
    if (s == null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}


// ====================
// MANUFACTURER HELPERS
// ====================

function getMfg() { return CONFIG.manufacturers?.[currentManufacturer] || {}; }
function getBatteryType() { const m = getMfg(); return m.battery_types?.[currentBatteryTypeIdx] || m.battery_types?.[0] || {}; }
function getBatteryModules() { return (getBatteryType().modules || []).filter(m => m.enabled !== false); }
function getInverters(filterForSolarOnly) {
    var all = getMfg().inverters?.[state.phase] || [];
    if (filterForSolarOnly === true) {
        // Solar-only mode: show only solar_only inverters (if any exist), otherwise show all
        var solarOnlyInvs = all.filter(function(m) { return m.solar_only === true; });
        return solarOnlyInvs.length > 0 ? solarOnlyInvs : all;
    } else if (filterForSolarOnly === false) {
        // Battery mode: exclude solar_only inverters
        return all.filter(function(m) { return m.solar_only !== true; });
    }
    // No filter specified: return all
    return all;
}
function getInverterLabel() { return getMfg().inverter_label || 'Inverter'; }

function getMaxBatteryKwh() {
    var mfg = getMfg(), bt = getBatteryType();
    if (currentManufacturer === 'sigenergy') return 96;
    // SolaX: max depends on phase + battery type, with parallel
    var sp = state.phase === 'single_phase';
    var r = bt.rules || {};
    var cap = sp ? (r.max_modules_single || r.max_modules || 8) : (r.max_modules_three || r.max_modules || 13);
    var maxMod = cap * 2; // parallel doubles the cap
    var modules = getBatteryModules();
    var largestKwh = modules.reduce(function(mx, m) { return Math.max(mx, m.kwh); }, 0);
    return maxMod * largestKwh;
}

function updateBatteryMaxCap() {
    var max = getMaxBatteryKwh();
    var el = document.getElementById('desiredBatteryKwh');
    if (el) {
        el.max = max;
        if (parseFloat(el.value) > max) el.value = max;
    }
    syncBatteryStepperDisplay();
}

function getBatteryRules() {
    const r = getBatteryType().rules || {};
    const sp = state.phase === 'single_phase';
    return {
        max_modules: sp ? (r.max_modules_single || r.max_modules || 6) : (r.max_modules_three || r.max_modules || 13),
        max_kwh: r.max_kwh || 48,
        min_modules: sp ? (r.min_modules_single || 0) : (r.min_modules_three || 0)
    };
}

// ====================
// STATE OBJECT
// ====================

const state = {
    phase: 'single_phase', panelMode: 'panels', panelCount: 0, panelWattage: 450, panelCost: 200,
    panelManufacturer: '', panelModel: '', panelColour: '', panelWidthMm: 1134, panelHeightMm: 1800, panelSupplierCode: '',
    sysKw: 0, desiredBatteryKwh: 0, actualBatteryKwh: 0,
    invSku: '', invPrice: 0, invKw: 0, invMaxPv: 0, invSupplierCode: '',
    gpMargin: 0, salesCommission: 0, stcPrice: 0, deemingPeriod: 0, batteryRebatePerKwh: 0,
    installPvPerKw: 0, installBatPerStack: 0,
    roofType: 'metal', orientation: 'portrait', numRows: 1, numArrays: 1, tiltAngle: '10_15', kliplockProfile: 'kliplock_606', mountingType: 'ground', wallMountAutoSwitched: false
};

function syncStateFromDOM() {
    state.phase = document.getElementById('phaseType').value;
    state.panelMode = 'panels';
    state.roofType = document.getElementById('roofType').value;
    state.orientation = document.getElementById('panelOrientation').value;
    state.numRows = parseInt(document.getElementById('numRows').value) || 1;
    state.numArrays = parseInt(document.getElementById('numArrays').value) || 1;
    state.tiltAngle = document.getElementById('tiltAngle').value;
    var klpSel = document.getElementById('kliplockProfile');
    state.kliplockProfile = klpSel ? klpSel.value : 'kliplock_606';
    state.mountingType = document.getElementById('mountingType').value;
    if (state.mountingType === 'wall') state.wallMountAutoSwitched = false;
    state.gpMargin = parseFloat(document.getElementById('gpMargin').value) || 0;
    state.salesCommission = parseFloat(document.getElementById('salesCommission').value) || 0;
    state.stcPrice = parseFloat(document.getElementById('stcPrice').value) || 0;
    state.deemingPeriod = getDeemingPeriod();
    state.batteryRebatePerKwh = isPostMay2026() ? state.stcPrice : (parseFloat(document.getElementById('batteryRebatePerKwh').value) || 0);
    state.installPvPerKw = parseFloat(document.getElementById('installPerKwPv').value) || 0;
    state.installBatPerStack = parseFloat(document.getElementById('installPerStack').value) || 0;
    state.desiredBatteryKwh = parseFloat(document.getElementById('desiredBatteryKwh').value) || 0;
    const panelSel = document.getElementById('panelSelect');
    const panelOpt = panelSel.options[panelSel.selectedIndex];
    if (panelOpt) {
        state.panelWattage = parseFloat(panelOpt.dataset.wattage) || 450;
        state.panelCost = parseFloat(panelOpt.dataset.price) || 200;
        state.panelManufacturer = panelOpt.dataset.manufacturer || '';
        state.panelModel = panelOpt.dataset.model || '';
        state.panelColour = panelOpt.dataset.colour || '';
        state.panelWidthMm = parseInt(panelOpt.dataset.widthMm) || 1134;
        state.panelHeightMm = parseInt(panelOpt.dataset.heightMm) || 1800;
        state.panelSupplierCode = panelOpt.dataset.supplierCode || '';
    }
    state.panelCount = parseInt(document.getElementById('panelCount').value) || 0;
    state.sysKw = (state.panelCount * state.panelWattage) / 1000;
    const invSel = document.getElementById('inverterSelect');
    const invOpt = invSel.options[invSel.selectedIndex];
    if (invOpt) {
        state.invSku = invOpt.value || '';
        state.invPrice = parseFloat(invOpt.dataset.price) || 0;
        state.invKw = parseFloat(invOpt.dataset.kw) || 0;
        state.invMaxPv = parseFloat(invOpt.dataset.maxPv) || 0;
        state.invSupplierCode = invOpt.dataset.supplierCode || '';
    }
}

// ====================
// SYSTEM MODE HELPERS (Solar-only / Battery-only)
// ====================

function isSolarOnly() {
    return currentSystemType === 'pv_only';
}

function isBatteryOnly() {
    return currentSystemType === 'battery_only';
}
function includeBms() {
    return !isBatteryOnly() || (document.getElementById('battOnlyBms')?.checked ?? false);
}
function includeSensor() {
    return !isBatteryOnly() || (document.getElementById('battOnlySensor')?.checked ?? false);
}

function onSystemTypeChange() {
    var sel = document.getElementById('systemTypeSelect');
    currentSystemType = sel ? sel.value : 'hybrid';

    // Battery Only: set panels to 0
    if (currentSystemType === 'battery_only') {
        document.getElementById('panelCount').value = 0;
        syncStepperDisplay();
    }
    // PV Only: set battery to 0
    if (currentSystemType === 'pv_only') {
        document.getElementById('desiredBatteryKwh').value = 0;
        syncBatteryStepperDisplay();
    }

    // Update manufacturer options based on system type
    updateManufacturerOptions();

    // Update field visibility/state
    updateSystemModeUI();

    // Recalculate
    calculateQuote();
}

function updateManufacturerOptions() {
    var mfgSelect = document.getElementById('manufacturerSelect');
    if (!mfgSelect) return;
    
    var prevValue = mfgSelect.value;
    mfgSelect.innerHTML = '';
    
    if (currentSystemType === 'pv_only') {
        // PV Only: SolaX only (has solar-only inverters)
        var opt = document.createElement('option');
        opt.value = 'solax';
        opt.textContent = 'SolaX';
        mfgSelect.appendChild(opt);
        currentManufacturer = 'solax';
    } else {
        // Hybrid or Battery Only: All manufacturers
        Object.keys(CONFIG.manufacturers || {}).forEach(function(key) {
            var mfg = CONFIG.manufacturers[key];
            var opt = document.createElement('option');
            opt.value = key;
            opt.textContent = mfg.label || key;
            mfgSelect.appendChild(opt);
        });
        // Restore previous value if still available
        if (prevValue && mfgSelect.querySelector('option[value="' + prevValue + '"]')) {
            mfgSelect.value = prevValue;
            currentManufacturer = prevValue;
        } else {
            currentManufacturer = mfgSelect.value;
        }
    }
    
    // Trigger manufacturer change logic (same as switchManufacturer but without reading from select)
    currentBatteryTypeIdx = 0;
    userChangedInverter = false;
    dualStackResult = null;
    dualStackEcOverride = { stack1: null, stack2: null };
    parallelResult = null;
    selectedAccessories = selectedAccessories.filter(function(a) { return a.type === 'addon'; });
    batteryQtys = {};
    populateBatteryTypes();
       populateInverters();
    populateGateways();
    buildAccessoriesUI();
    updateBatteryMountVisibility();
    updateHeaderSubtitle();
    updateInverterSectionLabel();
       updatePowerSensorModel();
    applyManufacturerDefaults();
}

function setFieldDisabled(groupId, disabled) {
    var el = document.getElementById(groupId);
    if (el) {
        if (disabled) {
            el.classList.add('disabled');
        } else {
            el.classList.remove('disabled');
        }
    }
}

function updateSystemModeUI() {
    var solarOnly = isSolarOnly();
    var batteryOnly = isBatteryOnly();

    // --- Panel selection row (hide for battery-only) ---
    var panelRow = document.getElementById('panelSelectionRow');
    if (panelRow) {
        panelRow.style.display = batteryOnly ? 'none' : '';
    }

    // --- PV-related fields (disable when battery-only) ---
    setFieldDisabled('panelSelectGroup', batteryOnly);
    if (panelRow) panelRow.classList.toggle('disabled', batteryOnly);
    setFieldDisabled('roofTypeGroup', batteryOnly);
    setFieldDisabled('orientationGroup', batteryOnly);
    setFieldDisabled('numRowsGroup', batteryOnly);
    setFieldDisabled('numArraysGroup', batteryOnly);
    setFieldDisabled('installPvGroup', batteryOnly);

    // Tilt angle group (only if visible AND battery-only)
    var tiltGroup = document.getElementById('tiltAngleGroup');
    if (tiltGroup) {
        var tiltFormGroup = tiltGroup.querySelector('.form-group');
        if (tiltFormGroup) {
            if (batteryOnly) {
                tiltFormGroup.classList.add('disabled');
            } else {
                tiltFormGroup.classList.remove('disabled');
            }
        }
    }

    // --- Battery capacity stepper (hide for pv-only) ---
    var batCapRow = document.getElementById('batteryCapacityRow');
    if (batCapRow) {
        batCapRow.style.display = solarOnly ? 'none' : '';
    }

    // --- Battery-related fields (disable/hide when solar-only) ---
    setFieldDisabled('gatewayGroup', solarOnly);
    setFieldDisabled('powerSensorGroup', solarOnly);
    setFieldDisabled('mountingTypeGroup', solarOnly);
    setFieldDisabled('installBatGroup', solarOnly);

    // Battery type group (if visible)
    var btGroup = document.getElementById('batteryTypeGroup');
    if (btGroup) {
        btGroup.style.display = solarOnly ? 'none' : (currentManufacturer === 'solax' ? 'block' : 'none');
    }

    // --- Inverter visibility ---
    var invGroup = document.getElementById('inverterGroup');
    if (invGroup) {
        invGroup.style.display = '';
    }

    // Hide battery config panel for solar-only
    var batConfigPanel = document.getElementById('batteryConfigPanel');
    if (batConfigPanel) {
        batConfigPanel.style.display = solarOnly ? 'none' : '';
    }

    // Hide battery mount group for solar-only
    var batMountGroup = document.getElementById('batteryMountGroup');
    if (batMountGroup) {
        batMountGroup.style.display = solarOnly ? 'none' : '';
    }

    // Hide CEC/inverter warnings for solar-only
    if (solarOnly) {
        var warningsToHide = ['cecWarning', 'cecApproved', 'inverterWarning', 'inverterInfo', 'minModulesWarning', 'phaseCapWarning', 'wallMountWarningGroup'];
        warningsToHide.forEach(function(id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    // Detect mode change and repopulate inverters if needed
    var currentMode = solarOnly ? 'solar_only' : (batteryOnly ? 'battery_only' : 'hybrid');
    if (lastSystemMode !== currentMode) {
        lastSystemMode = currentMode;
        // Repopulate inverters with appropriate filter
        populateInverters();
        userChangedInverter = false; // Reset so auto-select can work
    }
}

// ====================
// SHARED HELPERS
// ====================

function getBatterySummary() {
    const bt = getBatteryType();
    const modules = getBatteryModules();
    let totalKwh = 0, totalModules = 0, usableKwh = 0, equipmentCost = 0;

    // If parallel is active, use parallel pricing (not single-system pricing)
    if (parallelResult && parallelResult.isParallel) {
        totalModules = parallelResult.totalModules;
        totalKwh = parallelResult.totalKwh;
        usableKwh = parallelResult.totalUsableKwh;
        equipmentCost = parallelResult.totalBatteryCost;
        return { totalKwh: totalKwh, totalModules: totalModules, usableKwh: usableKwh, equipmentCost: equipmentCost };
    }

    if (bt.use_package_pricing && bt.packages && modules.length === 1) {
        const mod = modules[0];
        const qty = batteryQtys[mod.kwh] || 0;
        totalModules = qty; totalKwh = qty * mod.kwh; usableKwh = qty * (mod.usable_kwh || mod.kwh);
        const pkg = bt.packages.find(p => p.modules === qty);
        if (pkg) { equipmentCost = pkg.price; }
        else if (qty > 0) { equipmentCost = qty * getEffectivePrice(mod) + (bt.bms_cost || 0); if (qty >= (bt.series_box_threshold || 999)) equipmentCost += (bt.series_box_cost || 0); }
    } else {
        modules.forEach(bat => {
            const q = batteryQtys[bat.kwh] || 0;
            totalKwh += q * bat.kwh; totalModules += q; usableKwh += q * (bat.usable_kwh || bat.kwh); equipmentCost += q * getEffectivePrice(bat);
        });
        if (totalModules > 0 && bt.bms_cost > 0) equipmentCost += bt.bms_cost;
        if (totalModules >= (bt.series_box_threshold || 999)) equipmentCost += (bt.series_box_cost || 0);
    }
    return { totalKwh: totalKwh, totalModules: totalModules, usableKwh: usableKwh, equipmentCost: equipmentCost };
}

function getMountingKitItems(panelCount, roofType, orientation, numRows, numArrays, tiltAngle, panelWidthMm, panelHeightMm) {
    const mk = CONFIG.mounting_kits;
    if (!mk || panelCount === 0) return { total: 0, items: [] };
    let items = [], total = 0;

    // --- Kliplock: individual clamps instead of base kits ---
    if (roofType === 'kliplock' && mk.kliplock) {
        const kl = mk.kliplock;
        const profileKey = state.kliplockProfile || kl.default_profile || 'kliplock_606';
        const profile = kl.profiles[profileKey] || kl.profiles['kliplock_606'];
        const panelsPerRow = Math.ceil(panelCount / numRows);

        // Kliplock clamps: 2 per panel
        const clampQty = panelCount * (kl.clamps_per_panel || 2);
        const clampCost = clampQty * profile.price;
        items.push({ desc: profile.label + ' Clamp', sku: '', qty: clampQty, unit: profile.price, total: clampCost, supplier_code: profile.supplier_code || '' });
        total += clampCost;

        // Mid clamps: (panelsPerRow - 1) per row
        const midQty = Math.max(0, panelsPerRow - 1) * numRows;
        if (midQty > 0) {
            const midCost = midQty * kl.mid_clamp.price;
            items.push({ desc: kl.mid_clamp.label, sku: '', qty: midQty, unit: kl.mid_clamp.price, total: midCost, supplier_code: kl.mid_clamp.supplier_code || '' });
            total += midCost;
        }

        // End clamps: 2 per row per array
        const endQty = 2 * numRows * numArrays;
        const endCost = endQty * kl.end_clamp.price;
        items.push({ desc: kl.end_clamp.label, sku: '', qty: endQty, unit: kl.end_clamp.price, total: endCost, supplier_code: kl.end_clamp.supplier_code || '' });
        total += endCost;

        // Earthing clips: 1 per panel
        const clipQty = panelCount * (kl.earthing_clip.per_panel || 1);
        const clipCost = clipQty * kl.earthing_clip.price;
        items.push({ desc: kl.earthing_clip.label, sku: '', qty: clipQty, unit: kl.earthing_clip.price, total: clipCost, supplier_code: kl.earthing_clip.supplier_code || '' });
        total += clipCost;

        // Earthing lugs: 2 per array
        const lugQty = (kl.earthing_lug.per_array || 2) * numArrays;
        const lugCost = lugQty * kl.earthing_lug.price;
        items.push({ desc: kl.earthing_lug.label, sku: '', qty: lugQty, unit: kl.earthing_lug.price, total: lugCost, supplier_code: kl.earthing_lug.supplier_code || '' });
        total += lugCost;

        // Rails: reuse existing rail calc
        const railLinesPerRow = orientation === 'landscape' ? mk.rails.landscape_per_row : mk.rails.portrait_per_row;
        const panelSpanMm = orientation === 'landscape' ? panelHeightMm : panelWidthMm;
        const clampGap = mk.rails.clamp_gap_mm || 25, railLengthMm = mk.rails.length_mm || 4800;
        const totalSpanMm = panelsPerRow * (panelSpanMm + clampGap);
        const physicalRailsPerLine = Math.ceil(totalSpanMm / railLengthMm), totalRails = physicalRailsPerLine * railLinesPerRow * numRows;
        const railCost = totalRails * mk.rails.price;
        items.push({ desc: 'Black Rail 4800mm', sku: '', qty: totalRails, unit: mk.rails.price, total: railCost, supplier_code: mk.rails.supplier_code || '', detail: panelsPerRow + ' panels/row, ' + physicalRailsPerLine + ' rails/line x ' + railLinesPerRow + ' lines x ' + numRows + ' rows' });
        total += railCost;

        // Splicers: reuse existing splicer calc
        const splicersPerLine = Math.max(0, physicalRailsPerLine - 1), totalSplicers = splicersPerLine * railLinesPerRow * numRows;
        if (totalSplicers > 0) { const sc = totalSplicers * mk.rails.splicer_price; items.push({ desc: 'Rail Splicer', sku: '', qty: totalSplicers, unit: mk.rails.splicer_price, total: sc, supplier_code: mk.rails.splicer_code || '' }); total += sc; }

        return { total: Math.round(total * 100) / 100, items };
    }

    const kitFamily = (roofType === 'metal' || roofType === 'flat') ? 'tin' : 'tile';
    const kit2kw = mk.kits[kitFamily + '_2kw'], kit1_5kw = mk.kits[kitFamily + '_1_5kw'];
    const qty2kw = Math.floor(panelCount / kit2kw.panels_covered), remainder = panelCount % kit2kw.panels_covered, qty1_5kw = remainder >= 1 ? 1 : 0;
    if (qty2kw > 0) { const c = qty2kw * kit2kw.price; items.push({ desc: kit2kw.label, sku: '', qty: qty2kw, unit: kit2kw.price, total: c, supplier_code: kit2kw.supplier_code || '' }); total += c; }
    if (qty1_5kw > 0) { items.push({ desc: kit1_5kw.label, sku: '', qty: 1, unit: kit1_5kw.price, total: kit1_5kw.price, supplier_code: kit1_5kw.supplier_code || '' }); total += kit1_5kw.price; }
    const railLinesPerRow = orientation === 'landscape' ? mk.rails.landscape_per_row : mk.rails.portrait_per_row;
    const panelSpanMm = orientation === 'landscape' ? panelHeightMm : panelWidthMm;
    const clampGap = mk.rails.clamp_gap_mm || 25, railLengthMm = mk.rails.length_mm || 4800;
    const panelsPerRow = Math.ceil(panelCount / numRows), totalSpanMm = panelsPerRow * (panelSpanMm + clampGap);
    const physicalRailsPerLine = Math.ceil(totalSpanMm / railLengthMm), totalRails = physicalRailsPerLine * railLinesPerRow * numRows;
    const railCost = totalRails * mk.rails.price;
    items.push({ desc: 'Black Rail 4800mm', sku: '', qty: totalRails, unit: mk.rails.price, total: railCost, supplier_code: mk.rails.supplier_code || '', detail: panelsPerRow + ' panels/row, ' + physicalRailsPerLine + ' rails/line x ' + railLinesPerRow + ' lines x ' + numRows + ' rows' });
    total += railCost;
    const splicersPerLine = Math.max(0, physicalRailsPerLine - 1), totalSplicers = splicersPerLine * railLinesPerRow * numRows;
    if (totalSplicers > 0) { const sc = totalSplicers * mk.rails.splicer_price; items.push({ desc: 'Rail Splicer', sku: '', qty: totalSplicers, unit: mk.rails.splicer_price, total: sc, supplier_code: mk.rails.splicer_code || '' }); total += sc; }
    if (roofType === 'flat') { const tilt = mk.tilt_angles[tiltAngle]; if (tilt) { const c = panelCount * tilt.price; items.push({ desc: 'Tilt Arm ' + tilt.label, sku: '', qty: panelCount, unit: tilt.price, total: c, supplier_code: tilt.supplier_code || '' }); total += c; } }
    if (numArrays > 1) { const extra = numArrays - 1; let partsCost = 0; (mk.split_array_surcharge.parts || []).forEach(p => { const qty = p.qty * extra, cost = qty * p.price; items.push({ desc: p.desc + ' (extra array)', sku: '', qty, unit: p.price, total: cost, supplier_code: p.supplier_code || '' }); partsCost += cost; }); const lc = extra * mk.split_array_surcharge.labour_surcharge; items.push({ desc: 'Extra Array Labour', sku: 'Labour', qty: extra, unit: mk.split_array_surcharge.labour_surcharge, total: lc, supplier_code: 'BDS:LABOUR' }); total += partsCost + lc; }
    if (orientation === 'landscape' && numRows > 0) { const le = mk.landscape_extras; const ap = (roofType === 'metal' || roofType === 'flat') ? le.tin_attachment_price : le.tile_attachment_price; const ac = (roofType === 'metal' || roofType === 'flat') ? (le.tin_attachment_code || '') : (le.tile_attachment_code || ''); const ta = numRows * le.attachments_per_row; const c = ta * ap; items.push({ desc: 'Landscape Attachments', sku: '', qty: ta, unit: ap, total: c, supplier_code: ac }); total += c; }
    return { total: Math.round(total * 100) / 100, items };
}

// ====================
// CONFIG LOADING
// ====================

document.addEventListener('DOMContentLoaded', () => { loadConfig(); loadReps(); loadContractors(); });

function validateConfig(cfg) {
    if (!cfg.panels) throw new Error('Config missing: panels');
    if (!cfg.manufacturers) throw new Error('Config missing: manufacturers');
    if (!cfg.installation) throw new Error('Config missing: installation');
    if (!cfg.rebates) throw new Error('Config missing: rebates');
    return true;
}

// ====================
// PRODUCT DISCOUNT HELPER
// ====================
function getEffectivePrice(product, field) {
    field = field || 'price';
    var base = Number(product[field]) || 0;
    if (product.discount_pct && product.discount_from && product.discount_to) {
        var now = new Date();
        var from = new Date(product.discount_from);
        var to = new Date(product.discount_to);
        to.setHours(23, 59, 59);
        if (now >= from && now <= to) {
            return base * (1 - product.discount_pct / 100);
        }
    }
    return base;
}

// ====================
// RECONSTRUCT CONFIG — merge DB pricing into structural config
// ====================
function reconstructConfig(baseConfig, tables, batteryPackages, bmsParts, businessParams) {
    const cfg = JSON.parse(JSON.stringify(baseConfig));

    // --- Business params ---
    cfg.gp_margin = Number(businessParams.gp_margin);
    cfg.sales_commission = Number(businessParams.sales_commission);
    cfg.default_panel_count = Number(businessParams.default_panel_count);
    cfg.default_battery_kwh = Number(businessParams.default_battery_kwh);
    cfg.installation.install_pv_per_kw = Number(businessParams.install_pv_per_kw);
    cfg.installation.install_battery_per_stack = Number(businessParams.install_battery_per_stack);
    cfg.rebates.stc_price = Number(businessParams.stc_price);
    cfg.rebates.stc_deeming_period = Number(businessParams.stc_deeming_period);
    cfg.rebates.battery_rebate_per_kwh = Number(businessParams.battery_rebate_per_kwh);
    var surcharges = businessParams.roof_surcharges || {};
    Object.keys(cfg.installation.roof_types).forEach(function(rt) {
        if (surcharges[rt] !== undefined) cfg.installation.roof_types[rt].surcharge = Number(surcharges[rt]);
    });

    // --- Panels (from panels table) ---
    var panelRows = (tables.panels || []).sort(function(a, b) { return a.sort_order - b.sort_order; });
    cfg.panels = panelRows.map(function(p) {
        return { manufacturer: p.manufacturer, model: p.model, wattage: p.wattage, price: Number(p.price),
                 colour: p.colour, width_mm: p.width_mm, height_mm: p.height_mm, supplier_code: p.supplier_code,
                 discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
    });

    // --- Per-manufacturer products ---
    ['sigenergy', 'solax'].forEach(function(mfr) {
        var mfg = cfg.manufacturers[mfr];
        if (!mfg) return;

        // Inverters (from inverters table)
        ['single_phase', 'three_phase'].forEach(function(phase) {
            var rows = (tables.inverters || []).filter(function(p) {
                return p.manufacturer === mfr && p.phase === phase;
            }).sort(function(a, b) { return a.sort_order - b.sort_order; });
            mfg.inverters[phase] = rows.map(function(p) {
                var obj = { sku: p.sku, kw: Number(p.kw), price: Number(p.price), max_pv_kw: Number(p.max_pv_kw), supplier_code: p.supplier_code,
                            discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
                if (p.solar_only) obj.solar_only = true;
                return obj;
            });
        });

        // Battery modules (from battery_modules table) + battery type costs
        (mfg.battery_types || []).forEach(function(bt) {
            var modRows = (tables.battery_modules || []).filter(function(p) {
                return p.manufacturer === mfr && p.battery_type_id === bt.id;
            }).sort(function(a, b) { return a.sort_order - b.sort_order; });
            bt.modules = modRows.map(function(p) {
                var obj = { kwh: Number(p.kwh), usable_kwh: Number(p.usable_kwh), price: Number(p.price), label: p.sku, supplier_code: p.supplier_code,
                            discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
                if (p.enabled === false) obj.enabled = false;
                return obj;
            });
            var dbBt = bmsParts.find(function(t) { return t.type_id === bt.id; });
            if (dbBt) {
                bt.bms_cost = Number(dbBt.bms_cost);
                bt.bms_code = dbBt.bms_code;
                bt.series_box_cost = Number(dbBt.series_box_cost);
                bt.series_box_code = dbBt.series_box_code;
            }
        });

        // Battery packages (SolaX tp_hs36) — unchanged
        var tp = (mfg.battery_types || []).find(function(bt) { return bt.id === 'tp_hs36'; });
        if (tp) {
            var pkgs = batteryPackages.filter(function(p) { return p.battery_type_id === 'tp_hs36' && p.active; })
                .sort(function(a, b) { return a.sort_order - b.sort_order; });
            tp.packages = pkgs.map(function(p) {
                return { modules: p.modules, kwh: Number(p.kwh), price: Number(p.price), sku: p.sku, includes: p.includes };
            });
        }

        // Gateways (from gateways table)
        ['single_phase', 'three_phase'].forEach(function(phase) {
            var rows = (tables.gateways || []).filter(function(p) {
                return p.manufacturer === mfr && p.phase === phase;
            }).sort(function(a, b) { return a.sort_order - b.sort_order; });
            mfg.gateways[phase] = rows.map(function(p) {
                return { sku: p.sku, price: Number(p.price), desc: p.description || '', supplier_code: p.supplier_code,
                         discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
            });
        });

        // EV chargers (from ev_chargers table)
        var evRows = (tables.ev_chargers || []).filter(function(p) {
            return p.manufacturer === mfr;
        }).sort(function(a, b) { return a.sort_order - b.sort_order; });
        mfg.ev_chargers = {};
        evRows.forEach(function(p) {
            var obj = { price: Number(p.price), desc: p.description || '', supplier_code: p.supplier_code,
                        discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
            if (p.phase) obj.phase = p.phase;
            mfg.ev_chargers[p.sku] = obj;
        });

        // Accessories (from accessories table)
        var accRows = (tables.accessories || []).filter(function(p) {
            return p.manufacturer === mfr;
        }).sort(function(a, b) { return a.sort_order - b.sort_order; });
        mfg.accessories = accRows.map(function(p) {
            var obj = { id: p.accessory_id, label: p.sku, desc: p.description || '',
                        discount_pct: p.discount_pct || 0, discount_from: p.discount_from || null, discount_to: p.discount_to || null };
            if (p.phase_dependent) {
                obj.price_single = Number(p.price);
                obj.price_three = Number(p.price_alt);
                obj.phase_dependent = true;
                obj.default_checked = p.default_checked || false;
                obj.supplier_code_single = p.supplier_code_single || p.supplier_code;
                obj.supplier_code_three = p.supplier_code_three || '';
            } else {
                obj.price = Number(p.price);
                obj.phase_dependent = false;
                obj.default_checked = p.default_checked || false;
                obj.supplier_code = p.supplier_code;
            }
            if (p.note) obj.note = p.note;
            return obj;
        });

        // Battery mounting (from battery_mounting table)
        var mountRows = (tables.battery_mounting || []).filter(function(p) {
            return p.manufacturer === mfr;
        });
        if (mountRows.length > 0) {
            var mountObj = { show: true };
            mountRows.forEach(function(p) {
                var key = p.mount_key;
                mountObj[key] = Number(p.price);
                mountObj[key + '_code'] = p.supplier_code;
            });
            mfg.battery_mounting = mountObj;
        }
    });

    // --- Mounting kits (from mounting_kits table) ---
    var kitRows = tables.mounting_kits || [];
    kitRows.forEach(function(p) {
        var kitKey = p.kit_family;
        if (cfg.mounting_kits && cfg.mounting_kits.kits && cfg.mounting_kits.kits[kitKey]) {
            cfg.mounting_kits.kits[kitKey].price = Number(p.price);
            cfg.mounting_kits.kits[kitKey].supplier_code = p.supplier_code;
            cfg.mounting_kits.kits[kitKey].label = p.sku;
        }
    });

    // --- Mounting parts (from mounting_parts table) ---
    var partRows = tables.mounting_parts || [];
    partRows.forEach(function(p) {
        var st = p.part_type;
        if (st === 'tilt_angle') {
            var tiltKey = p.tilt_key;
            if (cfg.mounting_kits && cfg.mounting_kits.tilt_angles && cfg.mounting_kits.tilt_angles[tiltKey]) {
                cfg.mounting_kits.tilt_angles[tiltKey].price = Number(p.price);
                cfg.mounting_kits.tilt_angles[tiltKey].supplier_code = p.supplier_code;
                cfg.mounting_kits.tilt_angles[tiltKey].label = p.sku;
            }
        } else if (st === 'split_array_part') {
            var parts = cfg.mounting_kits && cfg.mounting_kits.split_array_surcharge ? cfg.mounting_kits.split_array_surcharge.parts : null;
            if (parts) {
                var match = parts.find(function(pt) { return pt.supplier_code === p.supplier_code; });
                if (match) { match.price = Number(p.price); match.desc = p.sku; }
            }
        } else if (st === 'rail') {
            if (cfg.mounting_kits && cfg.mounting_kits.rails) {
                cfg.mounting_kits.rails.price = Number(p.price);
                cfg.mounting_kits.rails.supplier_code = p.supplier_code;
            }
        } else if (st === 'splicer') {
            if (cfg.mounting_kits && cfg.mounting_kits.rails) {
                cfg.mounting_kits.rails.splicer_price = Number(p.price);
                cfg.mounting_kits.rails.splicer_code = p.supplier_code;
            }
        } else if (st === 'landscape_tin') {
            if (cfg.mounting_kits && cfg.mounting_kits.landscape_extras) {
                cfg.mounting_kits.landscape_extras.tin_attachment_price = Number(p.price);
                cfg.mounting_kits.landscape_extras.tin_attachment_code = p.supplier_code;
            }
        } else if (st === 'landscape_tile') {
            if (cfg.mounting_kits && cfg.mounting_kits.landscape_extras) {
                cfg.mounting_kits.landscape_extras.tile_attachment_price = Number(p.price);
                cfg.mounting_kits.landscape_extras.tile_attachment_code = p.supplier_code;
            }
        } else if (st === 'kliplock_clamp') {
            var kl = cfg.mounting_kits && cfg.mounting_kits.kliplock;
            if (kl && kl.profiles && p.tilt_key && kl.profiles[p.tilt_key]) {
                kl.profiles[p.tilt_key].price = Number(p.price);
                kl.profiles[p.tilt_key].supplier_code = p.supplier_code;
                kl.profiles[p.tilt_key].label = p.sku;
            }
        } else if (st === 'mid_clamp') {
            var kl2 = cfg.mounting_kits && cfg.mounting_kits.kliplock;
            if (kl2) {
                kl2.mid_clamp.price = Number(p.price);
                kl2.mid_clamp.supplier_code = p.supplier_code;
                kl2.mid_clamp.label = p.sku;
            }
        }
    });

    // Populate kliplock end_clamp, earthing_clip, earthing_lug from split_array_part rows
    if (cfg.mounting_kits && cfg.mounting_kits.kliplock) {
        var kl = cfg.mounting_kits.kliplock;
        partRows.forEach(function(p) {
            if (p.part_type !== 'split_array_part') return;
            if (p.supplier_code === 'RAY:END-30/35') {
                kl.end_clamp.price = Number(p.price);
                kl.end_clamp.supplier_code = p.supplier_code;
                kl.end_clamp.label = p.sku;
            } else if (p.supplier_code === 'RAY:GC') {
                kl.earthing_clip.price = Number(p.price);
                kl.earthing_clip.supplier_code = p.supplier_code;
                kl.earthing_clip.label = p.sku;
            } else if (p.supplier_code === 'RAY:GLG') {
                kl.earthing_lug.price = Number(p.price);
                kl.earthing_lug.supplier_code = p.supplier_code;
                kl.earthing_lug.label = p.sku;
            }
        });
    }

    // Split array labour surcharge from business params
    if (cfg.mounting_kits && cfg.mounting_kits.split_array_surcharge) {
        cfg.mounting_kits.split_array_surcharge.labour_surcharge = Number(businessParams.split_array_labour);
    }

    return cfg;
}

async function loadConfig() {
    if (!CONFIG || !CONFIG.manufacturers) {
    // Step 1: Always load structural config from config.json (or embedded fallback)
    var baseConfig = null;
    try {
        var r = await fetch('config.json?v=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        baseConfig = await r.json();
        console.log('[OK] Structural config loaded from config.json');
    } catch (err) {
        console.warn('[!] Could not load config.json (' + err.message + '), using embedded fallback');
        baseConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    // Step 2: Try loading pricing from Supabase typed tables
    var dbLoaded = false;
    if (supabaseClient) {
        try {
            var results = await Promise.all([
                supabaseClient.from('panels').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('inverters').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('battery_modules').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('gateways').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('ev_chargers').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('accessories').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('battery_mounting').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('mounting_kits').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('mounting_parts').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('battery_packages').select('*').eq('active', true).order('sort_order'),
                supabaseClient.from('solax_bms_components').select('*').eq('active', true),
                supabaseClient.from('business_params').select('*').eq('active', true).limit(1).single()
            ]);
            var errs = results.map(function(r) { return r.error; }).filter(Boolean);
            var bpRes = results[11];
            if (errs.length === 0 && bpRes.data) {
                var tables = {
                    panels: results[0].data || [],
                    inverters: results[1].data || [],
                    battery_modules: results[2].data || [],
                    gateways: results[3].data || [],
                    ev_chargers: results[4].data || [],
                    accessories: results[5].data || [],
                    battery_mounting: results[6].data || [],
                    mounting_kits: results[7].data || [],
                    mounting_parts: results[8].data || []
                };
                var totalRows = Object.values(tables).reduce(function(s, arr) { return s + arr.length; }, 0);
                CONFIG = reconstructConfig(baseConfig, tables, results[9].data || [], results[10].data || [], bpRes.data);
                validateConfig(CONFIG);
                console.log('[OK] Config loaded with DB pricing (' + totalRows + ' products across 9 tables)');
                dbLoaded = true;
            } else {
                console.warn('[!] Supabase pricing load errors:', errs);
            }
        } catch (e) {
            console.warn('[!] Supabase pricing fetch failed:', e);
        }
    }

    // Step 3: Fallback — if config.json has no pricing (stripped), use embedded DEFAULT_CONFIG
    if (!dbLoaded) {
        var hasJsonPrices = baseConfig.panels && baseConfig.panels.length > 0 && baseConfig.panels[0].price > 0;
        if (hasJsonPrices) {
            CONFIG = baseConfig;
            console.log('[OK] Config loaded from config.json (local fallback, prices from JSON)');
        } else {
            console.warn('[!] config.json has no pricing data and DB unavailable, using embedded fallback');
            CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
        try { validateConfig(CONFIG); } catch (ve) {
            console.warn('[!] Config validation failed, using embedded fallback');
            CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
        }
    }
    } else { console.log('[OK] Config already loaded (preview mode)'); }
    if (!CONFIG || !CONFIG.manufacturers) {
        document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:var(--gray-100,#f5f5f5);color:var(--red,#ef4444);font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:18px;text-align:center;padding:20px;">Configuration failed to load. Please refresh the page.<br>If the problem persists, check that config.json is accessible.</div>';
        return;
    }
    currentManufacturer = 'sigenergy'; currentBatteryTypeIdx = 0;
    batteryQtys = {};
    document.getElementById('panelCount').value = CONFIG.default_panel_count;
    syncStepperDisplay(); updateStepperPanelLabel(); syncBatteryStepperDisplay(); updateStepperBatteryLabel();
    document.getElementById('installPerKwPv').value = CONFIG.installation.install_pv_per_kw;
    document.getElementById('installPerStack').value = CONFIG.installation.install_battery_per_stack;
    document.getElementById('stcPrice').value = CONFIG.rebates.stc_price;
    document.getElementById('stcDeemingPeriod').value = CONFIG.rebates.stc_deeming_period;
    document.getElementById('batteryRebatePerKwh').value = CONFIG.rebates.battery_rebate_per_kwh;
    document.getElementById('gpMargin').value = CONFIG.gp_margin;
    document.getElementById('salesCommission').value = CONFIG.sales_commission;
    populateManufacturers(); populatePanels(); populateBatteryTypes(); populateInverters(); populateGateways(); buildAccessoriesUI(); updateBatteryMountVisibility(); bindSegmentedButtons(); bindEvents(); updateRoofInfo(); updateZoneDisplay(); updateHeaderSubtitle(); updateInverterSectionLabel(); updatePowerSensorModel(); renderAutoAccessories(); applyManufacturerDefaults(); calculateQuote();
    document.querySelectorAll('input, select, textarea').forEach(el => { el.setAttribute('spellcheck', 'false'); el.setAttribute('autocorrect', 'off'); el.setAttribute('autocomplete', 'off'); });
}

// ====================
// MANUFACTURER SWITCHING
// ====================

function populateManufacturers() {
    const sel = document.getElementById('manufacturerSelect'); sel.innerHTML = '';
    const segGroup = document.getElementById('manufacturerSegGroup'); if (segGroup) segGroup.innerHTML = '';
    Object.entries(CONFIG.manufacturers || {}).forEach(([key, mfg]) => {
        const o = document.createElement('option'); o.value = key; o.textContent = mfg.label || key; sel.appendChild(o);
        if (segGroup) {
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'seg-btn'; btn.dataset.value = key; btn.textContent = mfg.label || key;
            if (key === currentManufacturer) btn.classList.add('active');
            btn.addEventListener('click', () => {
                segGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                sel.value = key; sel.dispatchEvent(new Event('change', { bubbles: true }));
            });
            segGroup.appendChild(btn);
        }
    });
    sel.value = currentManufacturer;
}

function switchManufacturer() {
    currentManufacturer = document.getElementById('manufacturerSelect').value;
    syncSegmentedFromSelect('manufacturerSelect');
    updateStepperBatteryLabel();
    currentBatteryTypeIdx = 0; userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null;
    selectedAccessories = selectedAccessories.filter(function(a) { return a.type === 'addon'; });
    batteryQtys = {}; populateBatteryTypes(); populateInverters(); populateGateways(); buildAccessoriesUI(); updateBatteryMountVisibility(); updateHeaderSubtitle(); updateInverterSectionLabel(); updatePowerSensorModel();
    applyManufacturerDefaults();
    calculateQuote();
}

function applyManufacturerDefaults() {
    var mfg = getMfg();
    // Battery type default (set before max calc so getBatteryType returns correct type)
    var btIdx = mfg.default_battery_type_idx || 0;
    var types = mfg.battery_types || [];
    if (btIdx < types.length) {
        currentBatteryTypeIdx = btIdx;
        var btSel = document.getElementById('batteryTypeSelect');
        if (btSel) btSel.value = btIdx;
        var segGroup = document.getElementById('batteryTypeSegGroup');
        if (segGroup) {
            segGroup.querySelectorAll('.seg-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.value == btIdx); });
        }
    }
    // Set default battery on first load, preserve user value on subsequent switches
    // Don't reset to default when in PV Only mode (battery intentionally 0)
    var batEl = document.getElementById('desiredBatteryKwh');
    var curBat = parseFloat(batEl.value) || 0;
    if (curBat <= 0 && !isSolarOnly()) batEl.value = CONFIG.default_battery_kwh;
    updateBatteryMaxCap();
    curBat = parseFloat(batEl.value) || 0;
    var maxBat = getMaxBatteryKwh();
    if (curBat > maxBat) batEl.value = maxBat;
    // Inverter default by kW
    var targetKw = mfg.default_inverter_kw || 0;
    if (targetKw > 0) {
        var invSel = document.getElementById('inverterSelect');
        for (var i = 0; i < invSel.options.length; i++) {
            if (parseFloat(invSel.options[i].dataset.kw) === targetKw) {
                invSel.selectedIndex = i;
                userChangedInverter = true;
                break;
            }
        }
    }
}

function updateHeaderSubtitle() { const el = document.getElementById('headerSubtitle'); if (el) el.textContent = (getMfg().label || 'Solar') + ' Residential Quote Builder'; }
function updateInverterSectionLabel() { const lbl = document.getElementById('inverterDropdownLabel'); if (lbl) lbl.textContent = getInverterLabel(); }

// ====================
// BATTERY TYPE SWITCHING
// ====================

function populateBatteryTypes() {
    const types = getMfg().battery_types || [], sel = document.getElementById('batteryTypeSelect'), group = document.getElementById('batteryTypeGroup');
    const segGroup = document.getElementById('batteryTypeSegGroup');
    if (types.length <= 1) { group.style.display = 'none'; currentBatteryTypeIdx = 0; }
    else {
        group.style.display = 'block';
        sel.innerHTML = ''; segGroup.innerHTML = '';
        types.forEach((bt, idx) => {
            const o = document.createElement('option'); o.value = idx; o.textContent = bt.label; sel.appendChild(o);
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'seg-btn' + (idx === currentBatteryTypeIdx ? ' active' : ''); btn.dataset.value = idx; btn.textContent = bt.label;
            btn.addEventListener('click', function() {
                segGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                sel.value = idx; sel.dispatchEvent(new Event('change', { bubbles: true }));
            });
            segGroup.appendChild(btn);
        });
        sel.value = currentBatteryTypeIdx;
    }
}

function switchBatteryType() {
    currentBatteryTypeIdx = parseInt(document.getElementById('batteryTypeSelect').value) || 0;
    userChangedInverter = false; batteryQtys = {}; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null;
    updateBatteryMaxCap();
    updateStepperBatteryLabel(); updatePowerSensorModel(); calculateQuote();
}

// ====================
// ACCESSORIES UI
// ====================

function getAllDropdownItems() {
    var items = [];
    // Manufacturer-specific accessories (excluding power sensor)
    var accs = (getMfg().accessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
    accs.forEach(function(acc) {
        var basePrice = acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price;
        var price = acc.discount_pct ? getEffectivePrice({ price: basePrice, discount_pct: acc.discount_pct, discount_from: acc.discount_from, discount_to: acc.discount_to }) : basePrice;
        items.push({ id: acc.id, label: acc.label, price: price, type: 'accessory', source: acc, desc: acc.desc || '', discount_pct: acc.discount_pct || 0, discount_from: acc.discount_from || null, discount_to: acc.discount_to || null });
    });
    // EV Charger (single entry that drills into models)
    var evChargers = getMfg().ev_chargers || {};
    if (Object.keys(evChargers).length > 0) {
        items.push({ id: 'ev_charger', label: 'EV Charger', price: 0, type: 'ev_charger_parent' });
    }
    return items;
}

function buildAccessoriesUI() {
    var container = document.getElementById('accessoriesContainer'); container.innerHTML = '';
    var items = getAllDropdownItems();
    // Dropdown row
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    var sel = document.createElement('select'); sel.id = 'accessoryDropdown'; sel.style.flex = '1';
    function showMainOptions() {
        sel.innerHTML = '<option value="">-- Select item to add --</option>';
        items.forEach(function(item, idx) {
            var o = document.createElement('option'); o.value = idx; o.textContent = item.label; sel.appendChild(o);
        });
    }
    showMainOptions();
    sel.addEventListener('change', function() {
        var val = sel.value; if (!val) return;
        // EV Charger model selected (from drill-down)
        if (val.startsWith('ev:')) {
            var evKey = val.substring(3);
            var evChargers = getMfg().ev_chargers || {};
            var ev = evChargers[evKey];
            if (ev) {
                selectedAccessories = selectedAccessories.filter(function(a) { return !a.id.startsWith('ev_'); });
                selectedAccessories.push({ id: 'ev_' + evKey, label: 'EV Charger — ' + ev.desc, price: getEffectivePrice(ev), originalPrice: ev.price, type: 'accessory', supplier_code: ev.supplier_code || '', desc: ev.desc || '', discount_pct: ev.discount_pct || 0, discount_from: ev.discount_from || null, discount_to: ev.discount_to || null });
                renderSelectedAccessories(); calculateQuote();
            }
            showMainOptions(); sel.value = '';
            return;
        }
        var idx = parseInt(val); if (isNaN(idx)) return;
        var item = items[idx];
        // EV Charger parent: drill into models
        if (item.type === 'ev_charger_parent') {
            var evChargers = getMfg().ev_chargers || {};
            sel.innerHTML = '<option value="">-- Select EV Charger --</option>';
            Object.entries(evChargers).forEach(function(pair) {
                var key = pair[0], val = pair[1];
                if (val.phase && val.phase !== state.phase) return;
                var o = document.createElement('option'); o.value = 'ev:' + key; o.textContent = val.desc; sel.appendChild(o);
            });
            sel.value = '';
            return;
        }
        if (selectedAccessories.find(function(a) { return a.id === item.id; })) { sel.value = ''; return; }
        // Meter board tiers are mutually exclusive
        if (item.id.startsWith('meter_board_')) {
            selectedAccessories = selectedAccessories.filter(function(a) { return !a.id.startsWith('meter_board_'); });
        }
        var entry = { id: item.id, label: item.label, price: item.price, type: item.type, supplier_code: item.supplier_code || '', desc: item.desc || '' };
        if (item.source) entry.source = item.source;
        selectedAccessories.push(entry);
        renderSelectedAccessories();
        sel.value = '';
        calculateQuote();
    });
    row.appendChild(sel); container.appendChild(row);
    // List container
    var list = document.createElement('div'); list.id = 'accessoryList'; container.appendChild(list);
    // Auto-add defaults on first build
    if (selectedAccessories.length === 0) {
        var accs = (getMfg().accessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
        accs.filter(function(a) { return a.default_checked; }).forEach(function(a) {
            var basePrice = a.phase_dependent ? (state.phase === 'single_phase' ? a.price_single : a.price_three) : a.price;
            var price = a.discount_pct ? getEffectivePrice({ price: basePrice, discount_pct: a.discount_pct, discount_from: a.discount_from, discount_to: a.discount_to }) : basePrice;
            selectedAccessories.push({ id: a.id, label: a.label, price: price, type: 'accessory', source: a, supplier_code: a.supplier_code || '', desc: a.desc || '' });
        });
    }
    renderSelectedAccessories();
}

function renderSelectedAccessories() {
    var list = document.getElementById('accessoryList'); if (!list) return; list.innerHTML = '';
    selectedAccessories.forEach(function(acc, i) {
        if (acc.type === 'accessory' && acc.source && acc.source.phase_dependent) {
            var basePrice = state.phase === 'single_phase' ? acc.source.price_single : acc.source.price_three;
            acc.price = acc.source.discount_pct ? getEffectivePrice({ price: basePrice, discount_pct: acc.source.discount_pct, discount_from: acc.source.discount_from, discount_to: acc.source.discount_to }) : basePrice;
        }
        // Legacy: old ev_charger type from saved quotes
        if (acc.type === 'ev_charger' && acc.evModel) acc.label = 'EV Charger — ' + (acc.evDesc || acc.evModel);
        var div = document.createElement('div');
        div.className = 'auto-accessory added-accessory';
        div.innerHTML = '<svg class="auto-acc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
            '<span class="auto-acc-label">' + esc(acc.label) + '</span>' +
            '<span class="auto-acc-badge">Added</span>' +
            '<button class="btn-remove-acc" title="Remove">&times;</button>';
        div.querySelector('.btn-remove-acc').addEventListener('click', (function(idx) { return function() { selectedAccessories.splice(idx, 1); renderSelectedAccessories(); calculateQuote(); }; })(i));
        list.appendChild(div);
    });
}

function updateAccessoryPrices() { renderSelectedAccessories(); buildAccessoriesUI(); updatePowerSensorModel(); renderAutoAccessories(); }

function updatePowerSensorModel() {
    var el = document.getElementById('powerSensorModel');
    var labelEl = document.getElementById('powerSensorLabel');
    var statusEl = document.getElementById('powerSensorStatus');
    if (!el) return;
    if (currentManufacturer === 'solax') {
        if (labelEl) labelEl.textContent = 'BMS';
        var bt = getBatteryType();
        if (!bt || !bt.bms_code) {
            el.textContent = 'Select battery type';
            if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
        } else {
            el.textContent = getBmsName(bt);
            if (statusEl) { statusEl.textContent = bt.bms_cost > 0 ? '$' + bt.bms_cost.toLocaleString() : 'Included'; statusEl.style.color = 'var(--green)'; }
        }
    } else {
        if (labelEl) labelEl.textContent = 'Power Sensor';
        el.textContent = state.phase === 'single_phase' ? 'Sigen Sensor SP-CT100' : 'Sigen Sensor TP-CT100';
        if (statusEl) { statusEl.textContent = 'Included'; statusEl.style.color = 'var(--green)'; }
    }
}

function renderAutoAccessories() {
    var container = document.getElementById('autoAccessories');
    if (!container) return;
    container.innerHTML = '';
    var solarOnly = isSolarOnly();
    var batteryOnly = isBatteryOnly();
    var items = [];

    // Power Sensor / BMS
    if (!solarOnly) {
        if (currentManufacturer === 'solax') {
            var bt = getBatteryType();
            if (bt && bt.bms_code) {
                items.push({ label: 'BMS: ' + getBmsName(bt), badge: bt.bms_cost > 0 ? '$' + bt.bms_cost.toLocaleString() : 'Included', toggleId: batteryOnly ? 'battOnlyBms' : null });
            }
        } else {
            var sensorModel = state.phase === 'single_phase' ? 'Sigen Sensor SP-CT100' : 'Sigen Sensor TP-CT100';
            items.push({ label: 'Power Sensor: ' + sensorModel, badge: 'Included', toggleId: batteryOnly ? 'battOnlySensor' : null });
        }
    }

    items.forEach(function(item) {
        var div = document.createElement('div');
        if (item.toggleId) {
            // Battery-only: show as toggleable checkbox (unchecked by default)
            var wasChecked = document.getElementById(item.toggleId)?.checked || false;
            div.className = 'auto-accessory' + (wasChecked ? '' : ' acc-excluded');
            div.innerHTML = '<input type="checkbox" class="acc-pill-check" id="' + item.toggleId + '" ' + (wasChecked ? 'checked' : '') + '>' +
                '<span class="auto-acc-label">' + item.label + '</span>' +
                '<span class="auto-acc-badge">' + (wasChecked ? item.badge : 'Excluded') + '</span>';
            div.querySelector('input').addEventListener('change', function() {
                div.classList.toggle('acc-excluded', !this.checked);
                div.querySelector('.auto-acc-badge').textContent = this.checked ? item.badge : 'Excluded';
                calculateQuote();
            });
        } else {
            div.className = 'auto-accessory';
            div.innerHTML = '<svg class="auto-acc-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' +
                '<span class="auto-acc-label">' + item.label + '</span>' +
                '<span class="auto-acc-badge">' + item.badge + '</span>';
        }
        container.appendChild(div);
    });
}

function getAccessoryCost() {
    var t = 0;
    selectedAccessories.forEach(function(acc) { t += acc.price || 0; });
    t += getPowerSensorCost();
    return t;
}

function getPowerSensorCost() {
    if (!includeSensor()) return 0;
    var acc = (getMfg().accessories || []).find(function(a) { return a.id === 'power_sensor'; });
    if (!acc) return 0;
    var basePrice = state.phase === 'single_phase' ? acc.price_single : acc.price_three;
    return acc.discount_pct ? getEffectivePrice({ price: basePrice, discount_pct: acc.discount_pct, discount_from: acc.discount_from, discount_to: acc.discount_to }) : basePrice;
}

function getAccessoryBomItems() {
    var items = [];
    selectedAccessories.forEach(function(acc) {
        if (acc.type === 'ev_charger') {
            if (acc.evModel && acc.price > 0) {
                items.push({ desc: 'EV Charger: ' + (acc.evDesc || acc.evModel), sku: acc.evModel, qty: 1, unit: acc.price, total: acc.price, supplier_code: acc.evSupplierCode || '' });
            }
        } else if (acc.type === 'accessory' && acc.source) {
            var basePrice = acc.source.phase_dependent ? (state.phase === 'single_phase' ? acc.source.price_single : acc.source.price_three) : acc.source.price;
            var price = acc.source.discount_pct ? getEffectivePrice({ price: basePrice, discount_pct: acc.source.discount_pct, discount_from: acc.source.discount_from, discount_to: acc.source.discount_to }) : basePrice;
            var code = acc.source.phase_dependent ? (state.phase === 'single_phase' ? (acc.source.supplier_code_single || '') : (acc.source.supplier_code_three || '')) : (acc.source.supplier_code || '');
            items.push({ desc: acc.label, sku: '', qty: 1, unit: price, total: price, supplier_code: code });
        } else {
            items.push({ desc: acc.label, sku: '', qty: 1, unit: acc.price, total: acc.price, supplier_code: acc.supplier_code || '' });
        }
    });
    return items;
}

function updateBatteryMountVisibility() { var el = document.getElementById('batteryMountGroup'); if (el) el.style.display = (getMfg().battery_mounting?.show !== false) ? 'grid' : 'none'; }

// ====================
// ZONE LOOKUP
// ====================

function lookupZone(postcode) { const pc = parseInt(postcode); if (isNaN(pc) || pc < 0 || pc > 9999) return null; for (const z of (CONFIG.rebates?.stc_zones || [])) { if (pc >= z[0] && pc <= z[1]) return { zone: z[2], rating: z[3] }; } return null; }
function updateZoneDisplay() { const pc = document.getElementById('installPostcode').value, info = document.getElementById('stcZoneInfo'), result = lookupZone(pc); if (!pc) { info.textContent = 'Enter postcode'; info.style.color = 'var(--gray-500)'; return; } if (!result) { info.textContent = 'Invalid postcode'; info.style.color = 'var(--red)'; return; } info.textContent = 'Zone ' + result.zone + ' -  Rating ' + result.rating; info.style.color = 'var(--green)'; }

// ====================
// SEGMENTED BUTTONS
// ====================

function bindSegmentedButtons() {
    document.querySelectorAll('.seg-group').forEach(group => {
        const targetId = group.dataset.target;
        const sel = document.getElementById(targetId);
        group.querySelectorAll('.seg-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                group.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (sel) { sel.value = btn.dataset.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            });
        });
    });
}

function syncSegmentedFromSelect(selectId) {
    var sel = document.getElementById(selectId);
    if (!sel) return;
    var group = document.querySelector('.seg-group[data-target="' + selectId + '"]');
    if (!group) return;
    group.querySelectorAll('.seg-btn').forEach(b => { b.classList.toggle('active', b.dataset.value === sel.value); });
}

// ====================
// PANEL STEPPER
// ====================

function syncStepperDisplay() {
    var v = parseInt(document.getElementById('panelCount').value) || 0;
    document.getElementById('stepperPanelNum').textContent = v;
}

function updateStepperPanelLabel() {
    var sel = document.getElementById('panelSelect');
    var opt = sel.options[sel.selectedIndex];
    var label = opt ? opt.textContent : '—';
    document.getElementById('stepperPanelLabel').textContent = label;
}

// ====================
// BATTERY STEPPER
// ====================

function syncBatteryStepperDisplay() {
    var v = parseInt(document.getElementById('desiredBatteryKwh').value) || 0;
    document.getElementById('stepperBatteryNum').textContent = v;
    var actual = state.actualBatteryKwh || 0;
    document.getElementById('batteryActualDisplay').textContent = actual > 0 ? actual.toFixed(1) + ' kWh' : '—';
}

function updateStepperBatteryLabel() {
    var mfg = getMfg();
    var bt = getBatteryType();
    var label = (mfg.label || '') + (bt.label ? ' ' + bt.label : '');
    document.getElementById('stepperBatteryLabel').textContent = label || '—';
}

// ====================
// EVENT BINDING
// ====================

function bindEvents() {
    const dedicatedIds = ['inverterSelect','phaseType','desiredBatteryKwh','manufacturerSelect','batteryTypeSelect','roofType','panelOrientation','numRows','numArrays','tiltAngle','gatewaySelect','installPostcode','systemTypeSelect'];
    document.querySelectorAll('input, select').forEach(el => { if (!dedicatedIds.includes(el.id)) { el.addEventListener('input', debouncedCalculateQuote); el.addEventListener('change', calculateQuote); } });
    document.getElementById('installPostcode').addEventListener('input', function() { this.value = this.value.replace(/\D/g, '').slice(0, 4); updateZoneDisplay(); calculateQuote(); });
    document.getElementById('systemTypeSelect').addEventListener('change', onSystemTypeChange);
    document.querySelectorAll('.sys-tab').forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.sys-tab').forEach(function(t) { t.classList.remove('active'); });
            tab.classList.add('active');
            var sel = document.getElementById('systemTypeSelect');
            sel.value = tab.dataset.value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });
    document.getElementById('manufacturerSelect').addEventListener('change', switchManufacturer);
    document.getElementById('batteryTypeSelect').addEventListener('change', switchBatteryType);
    document.getElementById('phaseType').addEventListener('change', () => { syncStateFromDOM(); userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null; populateInverters(); populateGateways(); updateAccessoryPrices(); updateBatteryMaxCap(); calculateQuote(); });
    document.getElementById('panelSelect').addEventListener('change', () => { updateStepperPanelLabel(); calculateQuote(); });
    document.getElementById('panelCountUp').addEventListener('click', () => { var el = document.getElementById('panelCount'); el.value = (parseInt(el.value) || 0) + 1; syncStepperDisplay(); calculateQuote(); });
    document.getElementById('panelCountDown').addEventListener('click', () => { var el = document.getElementById('panelCount'); var v = (parseInt(el.value) || 0) - 1; if (v < 0) v = 0; el.value = v; syncStepperDisplay(); calculateQuote(); });
    document.getElementById('batteryKwhUp').addEventListener('click', () => { var el = document.getElementById('desiredBatteryKwh'); var v = (parseInt(el.value) || 0) + 1; var max = getMaxBatteryKwh(); if (v > max) v = max; el.value = v; userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null; syncBatteryStepperDisplay(); calculateQuote(); });
    document.getElementById('batteryKwhDown').addEventListener('click', () => { var el = document.getElementById('desiredBatteryKwh'); var v = (parseInt(el.value) || 0) - 1; if (v < 0) v = 0; el.value = v; userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null; syncBatteryStepperDisplay(); calculateQuote(); });
    document.getElementById('numRowsUp').addEventListener('click', () => { var el = document.getElementById('numRows'); var v = (parseInt(el.value) || 1) + 1; if (v > 20) v = 20; el.value = v; calculateQuote(); });
    document.getElementById('numRowsDown').addEventListener('click', () => { var el = document.getElementById('numRows'); var v = (parseInt(el.value) || 1) - 1; if (v < 1) v = 1; el.value = v; calculateQuote(); });
    document.getElementById('numArraysUp').addEventListener('click', () => { var el = document.getElementById('numArrays'); var v = (parseInt(el.value) || 1) + 1; if (v > 10) v = 10; el.value = v; calculateQuote(); });
    document.getElementById('numArraysDown').addEventListener('click', () => { var el = document.getElementById('numArrays'); var v = (parseInt(el.value) || 1) - 1; if (v < 1) v = 1; el.value = v; calculateQuote(); });
    document.getElementById('inverterSelect').addEventListener('change', () => { userChangedInverter = true; calculateQuote(); });
    document.getElementById('roofType').addEventListener('change', updateRoofInfo);
    document.getElementById('panelOrientation').addEventListener('change', () => { calculateQuote(); });
    document.getElementById('numRows').addEventListener('input', () => { calculateQuote(); });
    document.getElementById('numArrays').addEventListener('input', () => { calculateQuote(); });
    document.getElementById('tiltAngle').addEventListener('change', () => { calculateQuote(); });
    document.getElementById('gatewaySelect').addEventListener('change', function() { updateBackupCircuitsVisibility(); calculateQuote(); });
    document.querySelectorAll('input[type="number"]').forEach(el => {
        el.addEventListener('click', function(e) { const rect = this.getBoundingClientRect(); if (e.clientX > rect.right - 30) { const mid = rect.top + rect.height / 2; if (e.clientY < mid) this.stepUp(); else this.stepDown(); this.dispatchEvent(new Event('input', { bubbles: true })); } });
        el.addEventListener('mousemove', function(e) { const rect = this.getBoundingClientRect(); this.style.cursor = (e.clientX > rect.right - 30) ? 'pointer' : 'text'; });
    });
    const searchInput = document.getElementById('quoteSearchInput');
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchQuotes(); });
}

// ====================
// POPULATE DROPDOWNS
// ====================

function populatePanels() {
    const sel = document.getElementById('panelSelect'); sel.innerHTML = '';
    CONFIG.panels.forEach((p, idx) => {
        const o = document.createElement('option'); o.value = idx;
        o.textContent = p.manufacturer + ' ' + p.model + ' ' + p.wattage + 'W ' + p.colour;
        o.dataset.wattage = p.wattage; o.dataset.price = getEffectivePrice(p); o.dataset.originalPrice = p.price; o.dataset.manufacturer = p.manufacturer; o.dataset.model = p.model;
        o.dataset.colour = p.colour; o.dataset.widthMm = p.width_mm || 1134; o.dataset.heightMm = p.height_mm || 1800; o.dataset.supplierCode = p.supplier_code || '';
        o.dataset.discountPct = p.discount_pct || 0; o.dataset.discountFrom = p.discount_from || ''; o.dataset.discountTo = p.discount_to || '';
        sel.appendChild(o);
    });
    updateStepperPanelLabel();
}

function populateInverters() {
    const sel = document.getElementById('inverterSelect'); sel.innerHTML = '';
    // Battery-only: add None option (customer may already have an inverter)
    if (isBatteryOnly()) {
        var none = document.createElement('option'); none.value = 'none'; none.textContent = 'None'; none.dataset.kw = '0'; none.dataset.price = '0'; none.dataset.originalPrice = '0'; none.dataset.maxPv = '0'; none.dataset.supplierCode = ''; none.dataset.solarOnly = 'false'; none.dataset.discountPct = '0'; none.dataset.discountFrom = ''; none.dataset.discountTo = '';
        sel.appendChild(none);
    }
    // Filter inverters based on system mode
    var solarOnly = isSolarOnly();
    var filterMode = solarOnly ? true : (currentSystemType === 'battery_only' || state.desiredBatteryKwh > 0 ? false : null);
    getInverters(filterMode).forEach(m => {
        const o = document.createElement('option'); o.value = m.sku;
        o.textContent = m.sku + ' - ' + m.kw + 'kW - Max PV: ' + m.max_pv_kw + 'kW';
        o.dataset.kw = m.kw; o.dataset.price = getEffectivePrice(m); o.dataset.originalPrice = m.price; o.dataset.maxPv = m.max_pv_kw; o.dataset.supplierCode = m.supplier_code || '';
        o.dataset.solarOnly = m.solar_only ? 'true' : 'false';
        o.dataset.discountPct = m.discount_pct || 0; o.dataset.discountFrom = m.discount_from || ''; o.dataset.discountTo = m.discount_to || '';
        sel.appendChild(o);
    });
    updateInverterSectionLabel();
}

function populateGateways() {
    const gateways = getMfg().gateways?.[state.phase] || [], sel = document.getElementById('gatewaySelect'); sel.innerHTML = '';
    const none = document.createElement('option'); none.value = 'none'; none.textContent = 'None'; none.dataset.price = '0'; sel.appendChild(none);
    gateways.forEach(m => { const o = document.createElement('option'); o.value = m.sku; o.textContent = m.desc; o.dataset.price = getEffectivePrice(m); o.dataset.originalPrice = m.price; o.dataset.supplierCode = m.supplier_code || ''; o.dataset.discountPct = m.discount_pct || 0; o.dataset.discountFrom = m.discount_from || ''; o.dataset.discountTo = m.discount_to || ''; sel.appendChild(o); });
}





// ====================
// BATTERY MANAGEMENT
// ====================

function updateBatteryUI() {
    const bat = getBatterySummary(), modules = getBatteryModules(), bt = getBatteryType();
    const sorted = [...modules].sort((a, b) => b.kwh - a.kwh);
    let parts = []; sorted.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) parts.push(q + 'x ' + b.kwh + 'kWh'); });
    let txt = parts.length ? parts.join(' + ') + ' = ' + fmtKwh(bat.totalKwh) + ' kWh' : 'No batteries selected';
    document.getElementById('batteryBreakdown').innerHTML = txt;
}

function optimizeBattery(desired) {
    const bt = getBatteryType(), modules = getBatteryModules(), rules = getBatteryRules();
    if (!modules.length) return { qtys: {}, total: 0, cost: 0 };
    if (desired <= 0 || desired > rules.max_kwh) { const r = {}; modules.forEach(b => r[b.kwh] = 0); return { qtys: r, total: 0, cost: 0 }; }
    const gpMargin = state.gpMargin / 100;

    // Package pricing (SolaX TP-HS36)
    if (bt.use_package_pricing && bt.packages && modules.length === 1) {
        const mod = modules[0]; let bestPkg = null, bestCost = Infinity;
        bt.packages.forEach(pkg => {
            if (pkg.modules > rules.max_modules || pkg.kwh < desired) return;
            const usable = pkg.modules * (mod.usable_kwh || mod.kwh);
            const cc = (pkg.price * (1 + gpMargin)) - calcBatteryRebate(usable, state.batteryRebatePerKwh);
            if (cc < bestCost || (cc === bestCost && pkg.kwh < (bestPkg?.kwh || Infinity))) { bestPkg = pkg; bestCost = cc; }
        });
        if (!bestPkg) { const sorted = [...bt.packages].filter(p => p.modules <= rules.max_modules).sort((a, b) => a.kwh - b.kwh); bestPkg = sorted.find(p => p.kwh >= desired) || sorted[sorted.length - 1]; }
        if (bestPkg) { const r = {}; r[mod.kwh] = bestPkg.modules; return { qtys: r, total: bestPkg.kwh, cost: bestCost }; }
    }

    // Single-module component pricing (SolaX TB-HS51)
    if (modules.length === 1) {
        const mod = modules[0], minMod = rules.min_modules || 0, maxMod = rules.max_modules;
        let bestQty = 0, bestCost = Infinity, bestKwh = 0;
        for (let q = Math.max(minMod, Math.ceil(desired / mod.kwh)); q <= maxMod; q++) {
            const kwh = q * mod.kwh; if (kwh < desired) continue;
            const usable = q * (mod.usable_kwh || mod.kwh);
            const ec = q * getEffectivePrice(mod) + (bt.bms_cost || 0) + (q >= (bt.series_box_threshold || 999) ? (bt.series_box_cost || 0) : 0);
            const cc = (ec * (1 + gpMargin)) - calcBatteryRebate(usable, state.batteryRebatePerKwh);
            if (cc < bestCost) { bestQty = q; bestCost = cc; bestKwh = kwh; }
        }
        const r = {}; r[mod.kwh] = bestQty; return { qtys: r, total: bestKwh, cost: bestCost };
    }

    // Multi-module (Sigenergy)
    const maxMod = rules.max_modules, maxKwh = rules.max_kwh;
    const sorted = [...modules].sort((a, b) => (getEffectivePrice(a) / a.kwh) - (getEffectivePrice(b) / b.kwh));
    let bestCombo = null, bestCC = Infinity, bestTotal = Infinity;
    function cc(ec, usable) { return ec * (1 + gpMargin) - calcBatteryRebate(usable, state.batteryRebatePerKwh); }
    function search(idx, qtys, tKwh, tUsable, tCost, tMod) {
        if (tKwh >= desired) { const c = cc(tCost, tUsable); if (c < bestCC || (c === bestCC && tKwh < bestTotal)) { bestCombo = Object.assign({}, qtys); bestCC = c; bestTotal = tKwh; } }
        if (idx >= sorted.length) return;
        const bat = sorted[idx], mq = Math.min(maxMod - tMod, Math.floor((maxKwh - tKwh) / bat.kwh) + 1);
        for (let q = 0; q <= mq; q++) {
            const nk = tKwh + q * bat.kwh, nu = tUsable + q * (bat.usable_kwh || bat.kwh), nm = tMod + q;
            if (nm > maxMod || nk > maxKwh + bat.kwh) break;
            qtys[bat.kwh] = q; search(idx + 1, qtys, nk, nu, tCost + q * getEffectivePrice(bat), nm);
        }
        qtys[bat.kwh] = 0;
    }
    const initQ = {}; modules.forEach(b => initQ[b.kwh] = 0); search(0, initQ, 0, 0, 0, 0);
    if (!bestCombo) { const fb = {}; modules.forEach(b => fb[b.kwh] = 0); return { qtys: fb, total: 0, cost: 0 }; }
    return { qtys: bestCombo, total: bestTotal, cost: bestCC };
}

// ====================
// DUAL-STACK OPTIMIZER (Sigenergy only)
// ====================

function optimizeDualStack(desired) {
    const mfg = getMfg(), phase = state.phase;
    const models = mfg.inverters?.[phase] || [];
    const cec = mfg.cec_approved;
    const combos = (cec?.type === 'inverter_battery_combo') ? cec[phase] : {};
    const bt = getBatteryType(), modules = getBatteryModules();
    const gpMargin = state.gpMargin / 100;
    const mountPrice = mfg.battery_mounting?.[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 202;
    const gateways = mfg.gateways?.[phase] || [];
    const gwPrice = gateways.length ? Math.min(...gateways.map(g => getEffectivePrice(g))) : 0;
    const gwObj = gateways.find(g => getEffectivePrice(g) === gwPrice) || gateways[0] || null;
    const labourPerStack = state.installBatPerStack;
    const sysKw = state.sysKw;

    // All CEC-approved kWh values for this phase (excluding 0)
    const allCecKwh = new Set();
    Object.values(combos).forEach(arr => arr.forEach(k => { if (k > 0) allCecKwh.add(k); }));
    const cecKwhList = [...allCecKwh].sort((a, b) => a - b);

    // For a given target kWh for one stack, find cheapest battery combo
    // Returns { qtys, totalKwh, equipCost, usableKwh } or null
    function bestStackBatteries(targetKwh) {
        if (targetKwh <= 0) return null;
        const maxMod = 6, maxKwh = 48;
        const sorted = [...modules].sort((a, b) => (getEffectivePrice(a) / a.kwh) - (getEffectivePrice(b) / b.kwh));
        let best = null, bestCost = Infinity;

        function srch(idx, qtys, tKwh, tUsable, tCost, tMod) {
            if (tKwh >= targetKwh) {
                // Must be CEC-approved kWh value
                if (!cecKwhList.includes(tKwh)) return;
                if (tCost < bestCost || (tCost === bestCost && tKwh < (best?.totalKwh || Infinity))) {
                    best = { qtys: Object.assign({}, qtys), totalKwh: tKwh, equipCost: tCost, usableKwh: tUsable };
                    bestCost = tCost;
                }
            }
            if (idx >= sorted.length) return;
            const bat = sorted[idx];
            const mq = Math.min(maxMod - tMod, Math.floor((maxKwh - tKwh) / bat.kwh) + 1);
            for (let q = 0; q <= mq; q++) {
                const nk = tKwh + q * bat.kwh, nu = tUsable + q * (bat.usable_kwh || bat.kwh), nm = tMod + q;
                if (nm > maxMod || nk > maxKwh + bat.kwh) break;
                qtys[bat.kwh] = q;
                srch(idx + 1, qtys, nk, nu, tCost + q * getEffectivePrice(bat), nm);
            }
            qtys[bat.kwh] = 0;
        }

        const initQ = {}; modules.forEach(b => initQ[b.kwh] = 0);
        srch(0, initQ, 0, 0, 0, 0);
        return best;
    }

    // Find cheapest EC for a stack given its kWh and PV allocation
    function bestEC(stackKwh, pvKw) {
        let cheapest = null;
        for (const m of models) {
            const k = getCecKey(m.sku);
            if (!combos[k] || !combos[k].includes(stackKwh)) continue;
            if (m.kw > 0 && pvKw / m.kw >= 1.4) continue;
            if (!cheapest || m.price < cheapest.price) cheapest = m;
        }
        return cheapest;
    }

    // Generate all valid stack kWh splits
    // stack1_kwh + stack2_kwh >= desired, each 5-48, each CEC-approved
    let bestResult = null, bestNetCost = Infinity;

    for (const s1kwh of cecKwhList) {
        if (s1kwh > 48) continue;
        const minS2 = desired - s1kwh;
        for (const s2kwh of cecKwhList) {
            if (s2kwh > 48) continue;
            if (s1kwh + s2kwh < desired) continue;
            // Enforce s1 >= s2 to avoid duplicate mirror combos
            if (s1kwh < s2kwh) continue;

            const bat1 = bestStackBatteries(s1kwh);
            const bat2 = bestStackBatteries(s2kwh);
            if (!bat1 || !bat2) continue;
            // bat1.totalKwh should equal s1kwh (CEC filter ensures this)
            if (bat1.totalKwh !== s1kwh || bat2.totalKwh !== s2kwh) continue;

            const totalModules1 = Object.values(bat1.qtys).reduce((s, v) => s + v, 0);
            const totalModules2 = Object.values(bat2.qtys).reduce((s, v) => s + v, 0);

            // Try PV splits: allocate panels to each EC
            // Each EC must handle its panels within 1.4x ratio
            for (let p1 = 0; p1 <= state.panelCount; p1++) {
                const p2 = state.panelCount - p1;
                const pv1kw = (p1 * state.panelWattage) / 1000;
                const pv2kw = (p2 * state.panelWattage) / 1000;

                const ec1 = bestEC(s1kwh, pv1kw);
                const ec2 = bestEC(s2kwh, pv2kw);
                if (!ec1 || !ec2) continue;

                // Total equipment cost
                const equipCost = ec1.price + ec2.price + bat1.equipCost + bat2.equipCost
                    + (2 * mountPrice) + gwPrice + (2 * labourPerStack);
                const totalUsable = bat1.usableKwh + bat2.usableKwh;
                const netCost = (equipCost * (1 + gpMargin)) - calcBatteryRebate(totalUsable, state.batteryRebatePerKwh);

                if (netCost < bestNetCost) {
                    bestNetCost = netCost;
                    bestResult = {
                        isDualStack: true,
                        stack1: { ec: ec1, batteryQtys: bat1.qtys, kwh: s1kwh, usableKwh: bat1.usableKwh, equipCost: bat1.equipCost, modules: totalModules1, panels: p1, pvKw: pv1kw },
                        stack2: { ec: ec2, batteryQtys: bat2.qtys, kwh: s2kwh, usableKwh: bat2.usableKwh, equipCost: bat2.equipCost, modules: totalModules2, panels: p2, pvKw: pv2kw },
                        totalKwh: s1kwh + s2kwh,
                        totalUsableKwh: totalUsable,
                        totalBatteryCost: bat1.equipCost + bat2.equipCost,
                        totalEcCost: ec1.price + ec2.price,
                        mountCost: 2 * mountPrice,
                        gwPrice: gwPrice,
                        gateway: gwObj,
                        labourCost: 2 * labourPerStack,
                        netCost: bestNetCost
                    };
                }
            }
        }
    }

    return bestResult;
}

// ====================
// SOLAX PARALLEL BATTERY OPTIMIZER
// ====================

function optimizeParallelBattery(desired) {
    var bt = getBatteryType(), modules = getBatteryModules();
    if (!modules.length || modules.length !== 1) return null;
    var mod = modules[0];
    var sp = state.phase === 'single_phase';
    var r = bt.rules || {};
    var singleCap = sp ? (r.max_modules_single || r.max_modules || 8) : (r.max_modules_three || r.max_modules || 13);
    var minMod = sp ? (r.min_modules_single || 2) : (r.min_modules_three || 3);
    var totalModulesNeeded = Math.ceil(desired / mod.kwh);

    // Not needed if fits in single system
    if (totalModulesNeeded <= singleCap) return null;

    // Check max parallel capacity
    var maxTotal = singleCap * 2;
    if (totalModulesNeeded > maxTotal) return null; // exceeds parallel max

    // Even split
    var sysA = Math.ceil(totalModulesNeeded / 2);
    var sysB = totalModulesNeeded - sysA;

    // Ensure each system meets minimum
    if (sysB < minMod) {
        sysB = minMod;
        sysA = totalModulesNeeded - sysB;
    }
    // Ensure each system does not exceed single cap
    if (sysA > singleCap) sysA = singleCap;
    if (sysB > singleCap) sysB = singleCap;
    // Recalc total in case of adjustments
    var actualTotal = sysA + sysB;
    if (actualTotal < totalModulesNeeded) return null;

    // Pricing per system
    var parallelBoxPrice = 860;
    var parallelBoxCode = 'SOLAX-BMS-PARALLEL-BOX-II-G1';

    function systemCost(numMod) {
        if (bt.use_package_pricing && bt.packages) {
            var pkg = bt.packages.find(function(p) { return p.modules === numMod; });
            if (pkg) return { cost: pkg.price, pkg: pkg, usable: numMod * (mod.usable_kwh || mod.kwh) };
        }
        // Component pricing
        var cost = numMod * getEffectivePrice(mod) + (bt.bms_cost || 0);
        if (numMod >= (bt.series_box_threshold || 999)) cost += (bt.series_box_cost || 0);
        return { cost: cost, pkg: null, usable: numMod * (mod.usable_kwh || mod.kwh) };
    }

    var costA = systemCost(sysA);
    var costB = systemCost(sysB);

    var totalKwh = actualTotal * mod.kwh;
    var totalUsable = costA.usable + costB.usable;
    var totalBatteryCost = costA.cost + costB.cost + parallelBoxPrice;

    return {
        isParallel: true,
        systemA: {
            modules: sysA,
            kwh: sysA * mod.kwh,
            usableKwh: costA.usable,
            equipCost: costA.cost,
            pkg: costA.pkg,
            needsSeriesBox: sysA >= (bt.series_box_threshold || 999)
        },
        systemB: {
            modules: sysB,
            kwh: sysB * mod.kwh,
            usableKwh: costB.usable,
            equipCost: costB.cost,
            pkg: costB.pkg,
            needsSeriesBox: sysB >= (bt.series_box_threshold || 999)
        },
        totalModules: actualTotal,
        totalKwh: totalKwh,
        totalUsableKwh: totalUsable,
        totalBatteryCost: totalBatteryCost,
        parallelBoxPrice: parallelBoxPrice,
        parallelBoxCode: parallelBoxCode
    };
}

function renderParallelBreakdown() {
    if (!parallelResult) return;
    var bt = getBatteryType();
    var mod = getBatteryModules()[0];
    var html = '<span style="color:var(--blue);font-weight:600;">PARALLEL BATTERY</span>';
    html += ' <span style="color:var(--text-secondary);font-size:12px;">(' + parallelResult.totalModules + ' modules split across 2 systems)</span>';

    html += '<div style="display:flex;gap:8px;margin-top:8px;">';

    // System A
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">System A</label>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + parallelResult.systemA.modules + 'x ' + mod.kwh + 'kWh = ' + fmtKwh(parallelResult.systemA.kwh) + ' kWh</div>';
    if (parallelResult.systemA.pkg) {
        html += '<div style="color:var(--text-quaternary);font-size:11px;margin-top:2px;">' + parallelResult.systemA.pkg.sku + '</div>';
    }
    if (parallelResult.systemA.needsSeriesBox) {
        html += '<div style="color:var(--text-quaternary);font-size:11px;">+ Series Box</div>';
    }
    html += '</div></div>';

    // System B
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">System B</label>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + parallelResult.systemB.modules + 'x ' + mod.kwh + 'kWh = ' + fmtKwh(parallelResult.systemB.kwh) + ' kWh</div>';
    if (parallelResult.systemB.pkg) {
        html += '<div style="color:var(--text-quaternary);font-size:11px;margin-top:2px;">' + parallelResult.systemB.pkg.sku + '</div>';
    }
    if (parallelResult.systemB.needsSeriesBox) {
        html += '<div style="color:var(--text-quaternary);font-size:11px;">+ Series Box</div>';
    }
    html += '</div></div>';

    html += '</div>';
    html += '<div style="color:var(--text-quaternary);font-size:11px;margin-top:4px;">+ BMS Parallel Box II G1</div>';

    document.getElementById('batteryBreakdown').innerHTML = html;
}

// Render dual-stack breakdown (display only, no manual adjustment)
function renderDualStackBreakdown() {
    if (!dualStackResult) return;
    var modules = getBatteryModules();
    var s1parts = [], s2parts = [];
    modules.forEach(function(b) { var q = dualStackResult.stack1.batteryQtys[b.kwh] || 0; if (q > 0) s1parts.push(q + 'x ' + b.kwh + 'kWh'); });
    modules.forEach(function(b) { var q = dualStackResult.stack2.batteryQtys[b.kwh] || 0; if (q > 0) s2parts.push(q + 'x ' + b.kwh + 'kWh'); });
    var ecKey1 = getCecKey(dualStackResult.stack1.ec.sku);
    var ecKey2 = getCecKey(dualStackResult.stack2.ec.sku);

    var html = '<span style="color:var(--blue);font-weight:600;">DUAL-STACK</span>';

    html += '<div style="display:flex;gap:8px;margin-top:8px;">';

    // Stack 1
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">Stack 1 - Inverter/Energy Controller</label>';
    html += '<select id="dualEcSelect1" onchange="changeDualStackEc(1)" style="width:100%;padding:7px 12px;border:1px solid var(--separator-hover);border-radius:8px;font-size:14px;font-family:inherit;font-weight:400;background:var(--bg-input);color:var(--text-primary);height:36px;letter-spacing:-0.01em;margin-bottom:6px;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 stroke=%27%236e6e73%27 stroke-width=%271.5%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer;">';
    html += getDualEcOptions(1);
    html += '</select>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + dualStackResult.stack1.panels + ' panels</div>';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + s1parts.join(' + ') + ' = ' + fmtKwh(dualStackResult.stack1.kwh) + ' kWh</div>';
    html += '</div></div>';

    // Stack 2
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">Stack 2 - Inverter/Energy Controller</label>';
    html += '<select id="dualEcSelect2" onchange="changeDualStackEc(2)" style="width:100%;padding:7px 12px;border:1px solid var(--separator-hover);border-radius:8px;font-size:14px;font-family:inherit;font-weight:400;background:var(--bg-input);color:var(--text-primary);height:36px;letter-spacing:-0.01em;margin-bottom:6px;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 stroke=%27%236e6e73%27 stroke-width=%271.5%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer;">';
    html += getDualEcOptions(2);
    html += '</select>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + dualStackResult.stack2.panels + ' panels</div>';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + s2parts.join(' + ') + ' = ' + fmtKwh(dualStackResult.stack2.kwh) + ' kWh</div>';
    html += '</div></div>';

    html += '</div>';

    document.getElementById('batteryBreakdown').innerHTML = html;
}

function getDualEcOptions(stackNum) {
    if (!dualStackResult) return '';
    var stack = stackNum === 1 ? dualStackResult.stack1 : dualStackResult.stack2;
    var mfg = getMfg(), phase = state.phase;
    var models = mfg.inverters?.[phase] || [];
    var cec = mfg.cec_approved;
    var combos = (cec?.type === 'inverter_battery_combo') ? cec[phase] : {};
    var pvKw = stack.pvKw;
    var stackKwh = stack.kwh;
    var currentSku = stack.ec.sku;
    var overrideSku = stackNum === 1 ? dualStackEcOverride.stack1 : dualStackEcOverride.stack2;
    var selectedSku = overrideSku || currentSku;

    // Find cheapest valid EC for this stack (the recommended one)
    var cheapestPrice = Infinity, cheapestSku = null;
    var validModels = [];
    for (var i = 0; i < models.length; i++) {
        var m = models[i];
        var k = getCecKey(m.sku);
        if (!combos[k] || !combos[k].includes(stackKwh)) continue;
        if (m.kw > 0 && pvKw / m.kw >= 1.4) continue;
        validModels.push(m);
        if (m.price < cheapestPrice) { cheapestPrice = m.price; cheapestSku = m.sku; }
    }

    var html = '';
    for (var j = 0; j < validModels.length; j++) {
        var mv = validModels[j];
        var label = getCecKey(mv.sku) + ' ' + mv.kw + 'kW';
        if (mv.sku === cheapestSku) label += ' *';
        html += '<option value="' + mv.sku + '"' + (mv.sku === selectedSku ? ' selected' : '') + '>' + label + '</option>';
    }
    return html;
}

function changeDualStackEc(stackNum) {
    var sel = document.getElementById('dualEcSelect' + stackNum);
    if (!sel || !dualStackResult) return;
    var sku = sel.value;
    var mfg = getMfg(), phase = state.phase;
    var models = mfg.inverters?.[phase] || [];
    var ec = models.find(function(m) { return m.sku === sku; });
    if (!ec) return;

    if (stackNum === 1) {
        dualStackEcOverride.stack1 = sku;
        dualStackResult.stack1.ec = ec;
    } else {
        dualStackEcOverride.stack2 = sku;
        dualStackResult.stack2.ec = ec;
    }
    dualStackResult.totalEcCost = dualStackResult.stack1.ec.price + dualStackResult.stack2.ec.price;

    calculateQuote();
}

// ====================
// CEC & INVERTER LOGIC
// ====================

function getCecKey(sku) { return sku.startsWith('SigenStor ') ? sku.replace('SigenStor ', '') : sku; }

function checkCec(sku, totalKwh, totalModules, phase) {
    const cec = getMfg().cec_approved; if (!cec) return { ok: false, msg: 'No CEC data' };
    if (cec.type === 'inverter_battery_combo') {
        const key = getCecKey(sku), combos = cec[phase];
        if (!combos || !combos[key]) return { ok: false, msg: 'No CEC data for ' + key };
        if (combos[key].includes(totalKwh)) return { ok: true, msg: '[OK] CEC approved: ' + key + ' + ' + fmtKwh(totalKwh) + 'kWh' };
        const nearest = combos[key].filter(k => k >= totalKwh).sort((a,b) => a-b)[0] || combos[key][combos[key].length - 1];
        return { ok: false, msg: '[!] ' + fmtKwh(totalKwh) + 'kWh not CEC approved with ' + key + '. Nearest: ' + fmtKwh(nearest) + 'kWh' };
    }
    if (cec.type === 'battery_system') {
        const bt = getBatteryType(), cecData = cec[bt.id];
        if (!cecData) return { ok: false, msg: 'No CEC data for ' + bt.id };
        const entry = cecData.entries?.find(e => e.modules === totalModules);
        if (entry) return { ok: true, msg: '[OK] CEC approved: ' + entry.model + ' -> ' + fmtKwh(entry.nominal_kwh) + ' kWh' };
        return { ok: false, msg: '[!] ' + totalModules + ' modules not CEC approved. Valid: ' + cecData.min + '-' + cecData.max + ' modules' };
    }
    return { ok: false, msg: 'Unknown CEC type' };
}

function cecShieldHtml(ok, detail) {
    var svgOk = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6L12 2z" fill="rgba(48,209,88,0.15)" stroke="#30d158" stroke-width="1.5"/><path d="M8.5 12L11 14.5L16 9" stroke="#30d158" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var svgWarn = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6L12 2z" fill="rgba(255,214,10,0.15)" stroke="#ffd60a" stroke-width="1.5"/><path d="M12 8v4.5M12 15.5v.5" stroke="#ffd60a" stroke-width="2" stroke-linecap="round"/></svg>';
    var label = ok ? 'CEC Approved' : 'Not CEC Approved';
    return (ok ? svgOk : svgWarn) + '<div class="shield-text"><div class="shield-label">' + label + '</div><div class="shield-detail">' + detail + '</div></div>';
}

function warnShieldHtml(title, detail) {
    var svg = '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2L4 6v5c0 5.25 3.4 10.15 8 11.5 4.6-1.35 8-6.25 8-11.5V6L12 2z" fill="rgba(255,214,10,0.15)" stroke="#ffd60a" stroke-width="1.5"/><path d="M12 8v4.5M12 15.5v.5" stroke="#ffd60a" stroke-width="2" stroke-linecap="round"/></svg>';
    return svg + '<div class="shield-text"><div class="shield-label">' + title + '</div><div class="shield-detail">' + detail + '</div></div>';
}

function autoSelectInverter(sysKw, battKwh, battModules, phase) {
    const mfg = getMfg(), models = mfg.inverters?.[phase] || [], cec = mfg.cec_approved;
    if (cec?.type === 'inverter_battery_combo') {
        const combos = cec[phase];
        for (const m of models) { const k = getCecKey(m.sku); if (sysKw / m.kw < 1.4 && combos[k] && combos[k].includes(battKwh)) return m.sku; }
        for (const m of models) { const k = getCecKey(m.sku); if (combos[k] && combos[k].includes(battKwh)) return m.sku; }
        return models[models.length - 1]?.sku || '';
    }
    // SolaX: just find smallest inverter where PV fits
    for (const m of models) { if (sysKw / m.kw < 1.4) return m.sku; }
    return models[models.length - 1]?.sku || '';
}

function updateInverterOptions(sysKw, battKwh, phase) {
    var sel = document.getElementById('inverterSelect');
    var mfg = getMfg(), cec = mfg.cec_approved;
    var combos = (cec && cec.type === 'inverter_battery_combo') ? (cec[phase] || {}) : null;
    var allModels = mfg.inverters?.[phase] || [];
    var currentSku = sel.value;
    var validModels = [];
    for (var i = 0; i < allModels.length; i++) {
        var m = allModels[i];
        var valid = true;
        if (sysKw / m.kw >= 1.4) valid = false;
        if (valid && combos && battKwh > 0) {
            var key = getCecKey(m.sku);
            if (!combos[key] || !combos[key].includes(battKwh)) valid = false;
        }
        if (valid) validModels.push(m);
    }
    // If no valid models, show all (avoid empty dropdown)
    if (validModels.length === 0) validModels = allModels;
    // Rebuild dropdown
    sel.innerHTML = '';
    var currentStillValid = false;
    for (var j = 0; j < validModels.length; j++) {
        var mv = validModels[j];
        var o = document.createElement('option');
        o.value = mv.sku;
        o.textContent = mv.sku + ' -  ' + mv.kw + 'kW -  Max PV: ' + mv.max_pv_kw + 'kW';
        o.dataset.kw = mv.kw; o.dataset.price = mv.price; o.dataset.maxPv = mv.max_pv_kw; o.dataset.supplierCode = mv.supplier_code || '';
        sel.appendChild(o);
        if (mv.sku === currentSku) currentStillValid = true;
    }
    // Restore selection or pick first valid
    if (currentStillValid) {
        sel.value = currentSku;
    } else {
        sel.selectedIndex = 0;
    }
    syncStateFromDOM();
}

// ====================
// ROOF & MOUNTING
// ====================

function updateRoofInfo() { const rt = document.getElementById('roofType').value; const tg = document.getElementById('tiltAngleGroup'); if (tg) tg.style.display = rt === 'flat' ? 'block' : 'none'; const kg = document.getElementById('kliplockProfileGroup'); if (kg) kg.style.display = rt === 'kliplock' ? 'block' : 'none'; calculateQuote(); }

// ====================
// CUSTOM ADD-ONS
// ====================

function addCustomAddon() {
    customAddonCount++; const c = document.getElementById('customAddons'), d = document.createElement('div');
    d.className = 'custom-addon'; d.id = 'custom-' + customAddonCount;
    d.innerHTML = '<input type="text" placeholder="Item name" id="customName-' + customAddonCount + '"><input type="number" placeholder="Cost" id="customCost-' + customAddonCount + '" value="0" step="1"><button class="btn-remove-icon" onclick="removeCustomAddon(' + customAddonCount + ')" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>';
    c.appendChild(d);
    document.getElementById('customName-' + customAddonCount).addEventListener('input', calculateQuote);
    document.getElementById('customCost-' + customAddonCount).addEventListener('input', calculateQuote);
}
function removeCustomAddon(id) { document.getElementById('custom-' + id).remove(); calculateQuote(); }

// ====================
// MAIN CALCULATION ENGINE
// ====================

function calculateQuote() {
    try {
        if (!CONFIG.manufacturers) return;
        syncStateFromDOM();

        // Update UI based on system mode (solar-only, battery-only, or hybrid)
        updateSystemModeUI();

        document.getElementById('panelKwDisplay').textContent = state.sysKw.toFixed(2) + ' kW';
        syncStepperDisplay();

        // Skip battery logic entirely for solar-only
        var solarOnly = isSolarOnly();
        var batteryOnly = isBatteryOnly();

        // Gateway: always allow None selection
        const gwSel = document.getElementById('gatewaySelect');
        if (gwSel.options[0] && gwSel.options[0].value === 'none') gwSel.options[0].disabled = false;
        const desired = state.desiredBatteryKwh;
        let actualKwh = 0;
        const isDualStack = currentManufacturer === 'sigenergy' && desired > 48;
        var isParallel = false;

        if (isDualStack) {
            // Sigenergy dual-stack path - always auto-optimize
            parallelResult = null;
            dualStackResult = optimizeDualStack(desired);
            if (dualStackResult) {
                // Apply EC overrides if user upgraded
                var mfgModels = getMfg().inverters?.[state.phase] || [];
                if (dualStackEcOverride.stack1) {
                    var ov1 = mfgModels.find(function(m) { return m.sku === dualStackEcOverride.stack1; });
                    if (ov1) { dualStackResult.stack1.ec = ov1; dualStackResult.totalEcCost = ov1.price + dualStackResult.stack2.ec.price; }
                }
                if (dualStackEcOverride.stack2) {
                    var ov2 = mfgModels.find(function(m) { return m.sku === dualStackEcOverride.stack2; });
                    if (ov2) { dualStackResult.stack2.ec = ov2; dualStackResult.totalEcCost = dualStackResult.stack1.ec.price + ov2.price; }
                }
                actualKwh = dualStackResult.totalKwh;
                // Set batteryQtys to combined for BOM/cost
                const modules = getBatteryModules();
                batteryQtys = {};
                modules.forEach(b => {
                    batteryQtys[b.kwh] = (dualStackResult.stack1.batteryQtys[b.kwh] || 0) + (dualStackResult.stack2.batteryQtys[b.kwh] || 0);
                });
                updateBatteryUI();
                renderDualStackBreakdown();
            } else {
                actualKwh = 0;
                dualStackResult = null;
                document.getElementById('batteryBreakdown').innerHTML = '<span style="color:#ef4444;">[!] No valid dual-stack combination found for ' + desired + ' kWh</span>';
            }
        } else {
            // Single-stack or SolaX parallel path
            dualStackResult = null;
            if (desired > 0) {
                // Try SolaX parallel first (returns null if not needed or not SolaX)
                if (currentManufacturer === 'solax') {
                    var parOpt = optimizeParallelBattery(desired);
                    if (parOpt) {
                        parallelResult = parOpt;
                        isParallel = true;
                        actualKwh = parOpt.totalKwh;
                        // Set batteryQtys to combined total for getBatterySummary
                        var mod = getBatteryModules()[0];
                        batteryQtys = {};
                        batteryQtys[mod.kwh] = parOpt.totalModules;
                        renderParallelBreakdown();
                    } else {
                        parallelResult = null;
                    }
                } else {
                    parallelResult = null;
                }
                // Standard single-stack if not parallel
                if (!isParallel) {
                    const opt = optimizeBattery(desired);
                    batteryQtys = opt.qtys; actualKwh = opt.total;
                    updateBatteryUI();
                    if (actualKwh > desired) document.getElementById('batteryBreakdown').innerHTML += ' <span style="color:var(--green);">(+' + fmtKwh(actualKwh - desired) + 'kWh, cheaper)</span>';
                }
            } else {
                parallelResult = null;
            }
        }
        state.actualBatteryKwh = actualKwh;
        document.getElementById('batteryConfigPanel').style.display = desired > 0 ? 'block' : 'none';
        syncBatteryStepperDisplay();
        renderAutoAccessories();

        // Min modules check (skip for parallel -- each system validated independently)
        const rules = getBatteryRules();
        const bat = getBatterySummary();
        const minWarn = document.getElementById('minModulesWarning');
        if (minWarn) {
            if (!isParallel && bat.totalModules > 0 && bat.totalModules < rules.min_modules) {
                minWarn.style.display = 'flex'; minWarn.innerHTML = warnShieldHtml('Minimum Modules', 'Minimum ' + rules.min_modules + ' modules required for ' + (state.phase === 'single_phase' ? 'single' : 'three') + ' phase.');
            } else { minWarn.style.display = 'none'; }
        }

        // Phase capacity warning - check if desired kWh exceeds system max
        const phaseCapWarn = document.getElementById('phaseCapWarning');
        if (phaseCapWarn) {
            var maxKwh = getMaxBatteryKwh();
            if (desired > maxKwh) {
                phaseCapWarn.style.display = 'flex';
                phaseCapWarn.innerHTML = warnShieldHtml('System Maximum', desired + ' kWh exceeds maximum capacity (' + fmtKwh(maxKwh) + ' kWh) for this configuration.');
            } else { phaseCapWarn.style.display = 'none'; }
        }

        // Wall mount limit check (Sigenergy: max 2 battery modules for wall mount)
        var wmWarnGroup = document.getElementById('wallMountWarningGroup');
        var wmWarn = document.getElementById('wallMountWarning');
        if (wmWarn && wmWarnGroup) {
            if (currentManufacturer === 'sigenergy' && bat.totalModules > 2 && state.mountingType === 'wall') {
                document.getElementById('mountingType').value = 'ground';
                syncSegmentedFromSelect('mountingType');
                state.mountingType = 'ground';
                state.wallMountAutoSwitched = true;
                wmWarnGroup.style.display = '';
                wmWarn.innerHTML = warnShieldHtml('Wall Mount Max 2 batteries.', 'Switched to Ground Mount.');
            } else if (state.wallMountAutoSwitched && bat.totalModules > 2) {
                wmWarnGroup.style.display = '';
                wmWarn.innerHTML = warnShieldHtml('Wall Mount Max 2 batteries.', 'Switched to Ground Mount.');
            } else {
                state.wallMountAutoSwitched = false;
                wmWarnGroup.style.display = 'none';
            }
        }

        if (!userChangedInverter) {
            if (isDualStack && dualStackResult) {
                // Show "Set Below per Stack" in main dropdown
                const sel = document.getElementById('inverterSelect');
                var hasPlaceholder = false;
                for (var pi = 0; pi < sel.options.length; pi++) { if (sel.options[pi].value === '_dual_stack_') { hasPlaceholder = true; break; } }
                if (!hasPlaceholder) { var ph = document.createElement('option'); ph.value = '_dual_stack_'; ph.textContent = 'Set Below per Stack'; sel.insertBefore(ph, sel.firstChild); }
                for (var si = 0; si < sel.options.length; si++) { if (sel.options[si].value === '_dual_stack_') { sel.selectedIndex = si; break; } }
                sel.disabled = true;
                syncStateFromDOM();
            } else {
                // Remove placeholder if present
                const sel2 = document.getElementById('inverterSelect');
                for (var ri = sel2.options.length - 1; ri >= 0; ri--) { if (sel2.options[ri].value === '_dual_stack_') sel2.remove(ri); }
                sel2.disabled = false;
                const rec = autoSelectInverter(state.sysKw, actualKwh, bat.totalModules, state.phase);
                for (let i = 0; i < sel2.options.length; i++) { if (sel2.options[i].value === rec) { sel2.selectedIndex = i; break; } }
                syncStateFromDOM();
            }
        } else if (!isDualStack) {
            const sel3 = document.getElementById('inverterSelect');
            for (var ri2 = sel3.options.length - 1; ri2 >= 0; ri2--) { if (sel3.options[ri2].value === '_dual_stack_') sel3.remove(ri2); }
            sel3.disabled = false;
        }

        // Grey out invalid inverter options
        if (!isDualStack) {
            updateInverterOptions(state.sysKw, actualKwh, state.phase);
        }

        document.getElementById('inverterInfo').style.display = 'none';
        if (!isDualStack && state.invKw > 0 && state.sysKw / state.invKw >= 1.4) {
            document.getElementById('inverterWarning').style.display = 'flex';
            document.getElementById('inverterWarning').innerHTML = warnShieldHtml('PV Oversizing', 'PV (' + state.sysKw.toFixed(1) + 'kW) / ' + getInverterLabel() + ' (' + state.invKw + 'kW) ratio exceeds 1.4. Select larger ' + getInverterLabel().toLowerCase() + '.');
        } else {
            document.getElementById('inverterWarning').style.display = 'none';
        }

        if (isDualStack && dualStackResult) {
            // CEC check each stack independently
            const cec1 = checkCec(dualStackResult.stack1.ec.sku, dualStackResult.stack1.kwh, dualStackResult.stack1.modules, state.phase);
            const cec2 = checkCec(dualStackResult.stack2.ec.sku, dualStackResult.stack2.kwh, dualStackResult.stack2.modules, state.phase);
            const bothOk = cec1.ok && cec2.ok;
            const ec1Key = getCecKey(dualStackResult.stack1.ec.sku);
            const ec2Key = getCecKey(dualStackResult.stack2.ec.sku);
            document.getElementById('cecApproved').style.display = bothOk ? 'flex' : 'none';
            document.getElementById('cecApproved').innerHTML = bothOk ? cecShieldHtml(true, 'Stack 1: ' + ec1Key + ' + ' + fmtKwh(dualStackResult.stack1.kwh) + ' kWh  /  Stack 2: ' + ec2Key + ' + ' + fmtKwh(dualStackResult.stack2.kwh) + ' kWh') : '';
            document.getElementById('cecWarning').style.display = !bothOk ? 'flex' : 'none';
            if (!bothOk) {
                var warnDetail = '';
                if (!cec1.ok) warnDetail += 'Stack 1 - ' + cec1.msg.replace(/^\[!?\]?\s*/, '') + ' ';
                if (!cec2.ok) warnDetail += 'Stack 2 - ' + cec2.msg.replace(/^\[!?\]?\s*/, '');
                document.getElementById('cecWarning').innerHTML = cecShieldHtml(false, warnDetail.trim());
            }
        } else if (isParallel && parallelResult) {
            // CEC check each parallel system independently
            var cecA = checkCec(state.invSku, parallelResult.systemA.kwh, parallelResult.systemA.modules, state.phase);
            var cecB = checkCec(state.invSku, parallelResult.systemB.kwh, parallelResult.systemB.modules, state.phase);
            var parBothOk = cecA.ok && cecB.ok;
            document.getElementById('cecApproved').style.display = parBothOk ? 'flex' : 'none';
            document.getElementById('cecApproved').innerHTML = parBothOk ? cecShieldHtml(true, 'Sys A: ' + parallelResult.systemA.modules + ' modules (' + fmtKwh(parallelResult.systemA.kwh) + ' kWh)  /  Sys B: ' + parallelResult.systemB.modules + ' modules (' + fmtKwh(parallelResult.systemB.kwh) + ' kWh)') : '';
            document.getElementById('cecWarning').style.display = !parBothOk ? 'flex' : 'none';
            if (!parBothOk) {
                var parWarnDetail = '';
                if (!cecA.ok) parWarnDetail += 'System A - ' + cecA.msg.replace(/^\[!?\]?\s*/, '') + ' ';
                if (!cecB.ok) parWarnDetail += 'System B - ' + cecB.msg.replace(/^\[!?\]?\s*/, '');
                document.getElementById('cecWarning').innerHTML = cecShieldHtml(false, parWarnDetail.trim());
            }
        } else if (state.invSku && state.invSku !== 'none') {
            const cec = checkCec(state.invSku, actualKwh, bat.totalModules, state.phase);
            if (actualKwh > 0 || bat.totalModules > 0) {
                var cecDetail = cec.msg.replace(/^\[OK\]\s*CEC approved:\s*/, '').replace(/^\[!?\]?\s*/, '');
                document.getElementById('cecApproved').style.display = cec.ok ? 'flex' : 'none';
                document.getElementById('cecApproved').innerHTML = cec.ok ? cecShieldHtml(true, cecDetail) : '';
                document.getElementById('cecWarning').style.display = !cec.ok ? 'flex' : 'none';
                document.getElementById('cecWarning').innerHTML = !cec.ok ? cecShieldHtml(false, cecDetail) : '';
            } else { document.getElementById('cecWarning').style.display = 'none'; document.getElementById('cecApproved').style.display = 'none'; }
        } else {
            document.getElementById('cecWarning').style.display = 'none'; document.getElementById('cecApproved').style.display = 'none';
        }

        // --- COST CALCULATIONS ---
        // Solar-only: no battery/inverter costs
        // Battery-only: no PV/roof costs
        let costPanels, costRoofKit, costRoofSurcharge, installPv;
        let costInverter, costBattery, costGateway, costMount, installBat;

        if (solarOnly) {
            // Solar-only mode: PV costs + inverter (SolaX X1-HYBRID)
            costPanels = state.panelCount * state.panelCost;
            const roof = CONFIG.installation?.roof_types?.[state.roofType] || { surcharge: 0 };
            costRoofSurcharge = roof.surcharge;
            const mountingResult = getMountingKitItems(state.panelCount, state.roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
            costRoofKit = mountingResult.total;
            installPv = state.sysKw * state.installPvPerKw;

            // Include inverter cost for PV-only (SolaX X1-HYBRID)
            costInverter = state.invPrice || 0;
            costBattery = 0;
            costGateway = 0;
            costMount = 0;
            installBat = 0;
        } else if (batteryOnly) {
            // Battery-only mode: no PV costs; inverter/BMS/sensor optional
            costPanels = 0;
            costRoofKit = 0;
            costRoofSurcharge = 0;
            installPv = 0;
            costInverter = state.invPrice;

            // Battery costs — deduct BMS if excluded via toggle
            var bmsCostDeduct = includeBms() ? 0 : (bt.bms_cost || 0);
            if (isDualStack && dualStackResult) {
                costBattery = dualStackResult.totalBatteryCost - bmsCostDeduct;
                costGateway = dualStackResult.gwPrice;
                costMount = dualStackResult.mountCost;
                installBat = dualStackResult.labourCost;
                const gw = document.getElementById('gatewaySelect');
                const userGwPrice = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                if (userGwPrice > costGateway) costGateway = userGwPrice;
            } else if (isParallel && parallelResult) {
                costBattery = parallelResult.totalBatteryCost - bmsCostDeduct;
                costInverter = state.invPrice;
                const gw = document.getElementById('gatewaySelect');
                costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                costMount = 0;
                installBat = (state.desiredBatteryKwh > 0) ? 2 * state.installBatPerStack : 0;
            } else {
                costBattery = bat.equipmentCost - bmsCostDeduct;
                costInverter = state.invPrice;
                const gw = document.getElementById('gatewaySelect');
                costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                const mfgMount = getMfg().battery_mounting || {};
                costMount = (bat.totalModules > 0 && mfgMount.show !== false) ? (mfgMount[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0) : 0;
                installBat = (bat.totalModules > 0) ? state.installBatPerStack : 0;
            }
        } else {
            // Hybrid mode: both PV and battery costs
            costPanels = state.panelCount * state.panelCost;
            const roof = CONFIG.installation?.roof_types?.[state.roofType] || { surcharge: 0 };
            costRoofSurcharge = roof.surcharge;
            const mountingResult = getMountingKitItems(state.panelCount, state.roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
            costRoofKit = mountingResult.total;
            installPv = state.sysKw * state.installPvPerKw;

            if (isDualStack && dualStackResult) {
                costInverter = dualStackResult.totalEcCost;
                costBattery = dualStackResult.totalBatteryCost;
                costGateway = dualStackResult.gwPrice;
                costMount = dualStackResult.mountCost;
                installBat = (state.desiredBatteryKwh > 0) ? dualStackResult.labourCost : 0;
                const gw = document.getElementById('gatewaySelect');
                const userGwPrice = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                if (userGwPrice > costGateway) costGateway = userGwPrice;
            } else if (isParallel && parallelResult) {
                costInverter = state.invPrice;
                costBattery = parallelResult.totalBatteryCost;
                const gw = document.getElementById('gatewaySelect');
                costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                costMount = 0;
                installBat = (state.desiredBatteryKwh > 0) ? 2 * state.installBatPerStack : 0;
            } else {
                costInverter = state.invPrice;
                costBattery = bat.equipmentCost;
                const gw = document.getElementById('gatewaySelect');
                costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                const mfgMount = getMfg().battery_mounting || {};
                costMount = (bat.totalModules > 0 && mfgMount.show !== false) ? (mfgMount[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0) : 0;
                installBat = (bat.totalModules > 0) ? state.installBatPerStack : 0;
            }
        }

        let costAcc = getAccessoryCost();
        let costCustom = 0;
        for (let i = 1; i <= customAddonCount; i++) { const ce = document.getElementById('customCost-' + i), ne = document.getElementById('customName-' + i); if (ce && ne && ne.value.trim()) costCustom += parseFloat(ce.value) || 0; }
        costAcc += costCustom;

        const totalPv = costPanels + costRoofKit + costRoofSurcharge;
        const totalBattery = costInverter + costBattery + costGateway + costMount;

        // Rate card integration: replace flat installPv + installBat when contractor is selected
        let totalInstall;
        if (currentContractorId && currentRateCardItems.length > 0) {
            var ctx = buildQuoteContext();
            rateCardResult = calculateInstallationCosts(ctx, currentContractorRecord, currentRateCardItems, installationAddons);
            totalInstall = rateCardResult.total + costAcc; // rate card replaces installPv + installBat
            updateInstallationCostsDisplay();
            updateBackupCircuitsVisibility();
        } else {
            rateCardResult = null;
            totalInstall = installPv + installBat + costAcc;
        }

        const totalCog = totalPv + totalBattery + totalInstall;
        state.totalCog = totalCog;

        const zoneResult = lookupZone(document.getElementById('installPostcode').value);
        const zoneRating = zoneResult ? zoneResult.rating : 0;
        // PV rebate only if we have panels
        const pvStcCount = !batteryOnly ? (zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0) : 0;
        const pvReb = pvStcCount * state.stcPrice;
        // Battery rebate only if we have batteries
        const usableKwh = solarOnly ? 0 : ((isDualStack && dualStackResult) ? dualStackResult.totalUsableKwh : (isParallel && parallelResult) ? parallelResult.totalUsableKwh : bat.usableKwh);
        const batReb = solarOnly ? 0 : calcBatteryRebate(usableKwh, state.batteryRebatePerKwh);
        state.pvStcRebate = pvReb;
        state.batteryStcRebate = batReb;
        const gpAmt = totalCog * (state.gpMargin / 100);
        const priceBeforeCommission = totalCog + gpAmt;
        const commRate = state.salesCommission / 100;
        const baseIncGst = priceBeforeCommission * GST;
        const commAmt = (baseIncGst - pvReb - batReb) * commRate / (1 - commRate * GST) / GST; // commission as % of customer price inc GST, stored ex GST
        const priceBeforeRebates = priceBeforeCommission + commAmt;
        const finalPrice = priceBeforeRebates - pvReb - batReb;
        const discountAmt = parseFloat(document.getElementById('discountAmount')?.value) || 0;
        const customerPriceNum = Math.round(priceBeforeRebates * GST - pvReb - batReb - discountAmt);
        var customerPriceVal = '$' + customerPriceNum.toLocaleString('en-AU');

        document.getElementById('priceBeforeRebates').textContent = fmtIncGst(priceBeforeRebates);
        document.getElementById('gstAmount').textContent = '$' + Math.round(priceBeforeRebates * GST / 11).toLocaleString('en-AU');
        var totalReb = pvReb + batReb;
        document.getElementById('totalStcRebate').textContent = totalReb > 0 ? '-' + fmtExGst(totalReb) : '-$0';
        var rebateHtml = '';
        if (pvReb > 0) {
            var pvLabel = pvStcCount > 0 ? 'Solar STC Rebate (' + pvStcCount + ' STCs)' : 'Solar STC Rebate';
            rebateHtml += '<div class="summary-row summary-sub"><span>' + pvLabel + '</span><span>-' + fmtExGst(pvReb) + '</span></div>';
        }
        if (batReb > 0) {
            rebateHtml += '<div class="summary-row summary-sub"><span>Battery STC Rebate</span><span>-' + fmtExGst(batReb) + '</span></div>';
        }
        if (!rebateHtml) rebateHtml = '<div class="summary-row summary-sub" style="color:var(--text-quaternary);">No rebates</div>';
        document.getElementById('summaryRebateRows').innerHTML = rebateHtml;
        var priceEl = document.getElementById('customerPriceDisplay');
        var prevPrice = priceEl.textContent;
        priceEl.textContent = customerPriceVal;
        // Animate price change
        if (prevPrice !== customerPriceVal && prevPrice !== '$0') {
            priceEl.classList.remove('price-updated');
            void priceEl.offsetWidth; // force reflow
            priceEl.classList.add('price-updated');
        }
        // Update mobile price bar
        var mobilePrice = document.getElementById('mobilePriceDisplay');
        if (mobilePrice) mobilePrice.textContent = customerPriceVal;
        // Update system summary line
        updateSystemSummaryLine();

        // May 2026 urgency comparison — only show before the transition date
        var urgBanner = document.getElementById('urgencyBanner');
        if (urgBanner) {
            var hasPvOrBat = (pvReb > 0 || batReb > 0);
            if (hasPvOrBat && !isPostMay2026()) {
                // Compare current price vs post-May price (4yr deeming + tiered battery)
                var pvStcCountMay = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * 4) : 0;
                var pvRebMay = pvStcCountMay * state.stcPrice;
                var batRebMay = calcBatteryRebateFuture(usableKwh, state.stcPrice);
                var commAmtMay = (baseIncGst - pvRebMay - batRebMay) * commRate / (1 - commRate * GST) / GST;
                var priceBeforeRebatesMay = priceBeforeCommission + commAmtMay;
                var futurePriceNum = Math.round(priceBeforeRebatesMay * GST - pvRebMay - batRebMay - discountAmt);
                var increaseNum = futurePriceNum - customerPriceNum;
                if (increaseNum > 0) {
                    urgBanner.style.display = 'flex';
                    document.getElementById('urgencyIncrease').textContent = '+$' + increaseNum.toLocaleString('en-AU');
                    document.getElementById('urgencyFuturePrice').textContent = '$' + futurePriceNum.toLocaleString('en-AU');
                } else {
                    urgBanner.style.display = 'none';
                }
            } else {
                urgBanner.style.display = 'none';
            }
        }

        // Update right panel component summary
        updateSummaryComponents(isDualStack, isParallel, bat, costRoofKit, costRoofSurcharge, installPv, installBat, costAcc);

    } catch (err) { console.error('[!] Quote calculation error:', err); }
}

// ====================
// RIGHT PANEL COMPONENT SUMMARY
// ====================

function summaryRow(label, qty) {
    return '<div class="summary-row"><span>' + esc(label) + '</span><span>x ' + qty + '</span></div>';
}

function summarySubRow(label, qty) {
    return '<div class="summary-row summary-sub"><span>' + esc(label) + '</span><span>x ' + qty + '</span></div>';
}

function updateSummaryComponents(isDualStack, isParallel, bat, costRoofKit, costRoofSurcharge, installPv, installBat, costAcc) {
    var pvHtml = '';
    var batHtml = '';
    var addonHtml = '';
    var bt = getBatteryType();
    var modules = getBatteryModules();

    var solarOnly = isSolarOnly();
    var batteryOnly = isBatteryOnly();

    // --- PV Equipment ---
    if (!batteryOnly && state.panelCount > 0) {
        var panelDesc = state.panelManufacturer + ' ' + state.panelModel + ' ' + state.panelWattage + 'W';
        if (state.panelColour) panelDesc += ' ' + state.panelColour;
        pvHtml += summaryRow(panelDesc, state.panelCount);
        if (costRoofKit > 0) pvHtml += summaryRow('Roof Mounting Kit', 1);
        if (costRoofSurcharge > 0) {
            var roof = CONFIG.installation?.roof_types?.[state.roofType] || {};
            pvHtml += summaryRow((roof.label || state.roofType) + ' Roof Surcharge', 1);
        }
    }
    if (!pvHtml) {
        if (batteryOnly) {
            pvHtml = '<div class="summary-row" style="color:var(--text-quaternary);">Battery-only system</div>';
        } else {
            pvHtml = '<div class="summary-row" style="color:var(--text-quaternary);">No panels selected</div>';
        }
    }

    // Add inverter to PV section for solar-only
    if (solarOnly && state.invPrice > 0) {
        pvHtml += summaryRow(state.invSku + ' (' + state.invKw + 'kW)', 1);
    }

    // --- Battery & Inverter ---
    if (solarOnly) {
        batHtml = '<div class="summary-row" style="color:var(--text-quaternary);">Solar-only system</div>';
    } else if (isDualStack && dualStackResult) {
        var ds = dualStackResult;
        var phaseLabel = state.phase === 'single_phase' ? 'SP' : 'TP';
        // Stack 1
        batHtml += summaryRow(ds.stack1.ec.sku + ' (' + ds.stack1.ec.kw + 'kW ' + phaseLabel + ')', 1);
        modules.forEach(function(b) {
            var q = ds.stack1.batteryQtys[b.kwh] || 0;
            if (q > 0) batHtml += summaryRow((b.label || b.kwh + 'kWh') + ' Battery', q);
        });
        // Stack 2
        batHtml += summaryRow(ds.stack2.ec.sku + ' (' + ds.stack2.ec.kw + 'kW ' + phaseLabel + ')', 1);
        modules.forEach(function(b) {
            var q = ds.stack2.batteryQtys[b.kwh] || 0;
            if (q > 0) batHtml += summaryRow((b.label || b.kwh + 'kWh') + ' Battery', q);
        });
        // Gateway (mandatory for dual-stack)
        if (ds.gateway) batHtml += summaryRow(ds.gateway.sku, 1);
        // Mount x2
        var mfgMount = getMfg().battery_mounting || {};
        if (mfgMount.show !== false) {
            batHtml += summaryRow((state.mountingType === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', 2);
        }
    } else if (isParallel && parallelResult) {
        // Inverter (single -- parallel doesn't need 2nd inverter)
        if (state.invSku && state.invSku !== 'none') {
            batHtml += summaryRow(state.invSku + ' (' + state.invKw + 'kW)', 1);
        }
        var mod = modules[0];
        // System A
        if (parallelResult.systemA.pkg) {
            batHtml += summaryRow(parallelResult.systemA.pkg.sku + ' (' + fmtKwh(parallelResult.systemA.kwh) + 'kWh)', 1);
            batHtml += summarySubRow((mod.label || mod.kwh + 'kWh') + ' Module', parallelResult.systemA.modules);
            if (includeBms()) { var bmsNameA = getBmsName(bt); batHtml += summarySubRow(bmsNameA, 1); }
            if (parallelResult.systemA.needsSeriesBox) batHtml += summarySubRow('Series Box', 1);
        } else {
            batHtml += summaryRow('System A: ' + parallelResult.systemA.modules + 'x ' + mod.kwh + 'kWh', 1);
            batHtml += summarySubRow((mod.label || mod.kwh + 'kWh') + ' Module', parallelResult.systemA.modules);
            if (includeBms()) { var bmsNameA2 = getBmsName(bt); batHtml += summarySubRow(bmsNameA2, 1); }
            if (parallelResult.systemA.needsSeriesBox) batHtml += summarySubRow('Series Box', 1);
        }
        // System B
        if (parallelResult.systemB.pkg) {
            batHtml += summaryRow(parallelResult.systemB.pkg.sku + ' (' + fmtKwh(parallelResult.systemB.kwh) + 'kWh)', 1);
            batHtml += summarySubRow((mod.label || mod.kwh + 'kWh') + ' Module', parallelResult.systemB.modules);
            if (includeBms()) { var bmsNameB = getBmsName(bt); batHtml += summarySubRow(bmsNameB, 1); }
            if (parallelResult.systemB.needsSeriesBox) batHtml += summarySubRow('Series Box', 1);
        } else {
            batHtml += summaryRow('System B: ' + parallelResult.systemB.modules + 'x ' + mod.kwh + 'kWh', 1);
            batHtml += summarySubRow((mod.label || mod.kwh + 'kWh') + ' Module', parallelResult.systemB.modules);
            if (includeBms()) { var bmsNameB2 = getBmsName(bt); batHtml += summarySubRow(bmsNameB2, 1); }
            if (parallelResult.systemB.needsSeriesBox) batHtml += summarySubRow('Series Box', 1);
        }
        // Parallel Box
        batHtml += summaryRow('BMS Parallel Box II G1', 1);
    } else {
        // Single stack
        if (state.invSku && state.invSku !== 'none') {
            batHtml += summaryRow(state.invSku + ' (' + state.invKw + 'kW)', 1);
        }
        // Battery modules
        if (bt.use_package_pricing && bat.totalModules > 0) {
            var pkg = bt.packages?.find(function(p) { return p.modules === bat.totalModules; });
            if (pkg) {
                batHtml += summaryRow(pkg.sku + ' (' + fmtKwh(pkg.kwh) + 'kWh)', 1);
                // Break down components
                modules.forEach(function(b) {
                    var q = batteryQtys[b.kwh] || 0;
                    if (q > 0) batHtml += summarySubRow((b.label || b.kwh + 'kWh') + ' Module', q);
                });
                batHtml += summarySubRow(getBmsName(bt), 1);
                if (bat.totalModules >= (bt.series_box_threshold || 999)) {
                    batHtml += summarySubRow('Series Box', 1);
                }
            } else {
                modules.forEach(function(b) {
                    var q = batteryQtys[b.kwh] || 0;
                    if (q > 0) batHtml += summaryRow((b.label || b.kwh + 'kWh') + ' Battery Module', q);
                });
            }
        } else {
            modules.forEach(function(b) {
                var q = batteryQtys[b.kwh] || 0;
                if (q > 0) batHtml += summaryRow((b.label || b.kwh + 'kWh') + ' Battery Module', q);
            });
            if (bat.totalModules > 0 && bt.bms_cost >= 0 && bt.bms_code) {
                batHtml += summaryRow(bt.bms_code, 1);
            }
            if (bat.totalModules >= (bt.series_box_threshold || 999)) {
                batHtml += summaryRow('Series Box', 1);
            }
        }
        // Gateway
        var gwSel = document.getElementById('gatewaySelect');
        var gwOpt = gwSel.options[gwSel.selectedIndex];
        if (gwOpt && gwOpt.value !== 'none') {
            batHtml += summaryRow(gwOpt.value, 1);
        }
        // Mounting
        var mfgMount2 = getMfg().battery_mounting || {};
        if (bat.totalModules > 0 && mfgMount2.show !== false) {
            batHtml += summaryRow((state.mountingType === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', 1);
        }
    }
    // Power Sensor (Sigenergy auto-included when batteries present)
    if (currentManufacturer === 'sigenergy' && bat.totalModules > 0) {
        var psModel = state.phase === 'single_phase' ? 'Sigen Sensor SP-CT100' : 'Sigen Sensor TP-CT100';
        batHtml += summaryRow(psModel, 1);
    }
    if (!batHtml) batHtml = '<div class="summary-row" style="color:var(--text-quaternary);">No battery configured</div>';

    // --- Add-ons ---
    selectedAccessories.forEach(function(acc) {
        if (acc.type === 'ev_charger') {
            if (acc.evDesc || acc.evModel) {
                addonHtml += summaryRow('EV: ' + (acc.evDesc || acc.evModel), 1);
            } else {
                addonHtml += summaryRow('EV Charger', 1);
            }
        } else {
            addonHtml += summaryRow(acc.label, 1);
        }
    });
    // Custom add-ons
    for (var i = 1; i <= customAddonCount; i++) {
        var ne = document.getElementById('customName-' + i);
        if (ne && ne.value.trim()) {
            addonHtml += summaryRow(ne.value.trim(), 1);
        }
    }
    if (!addonHtml) addonHtml = '<div class="summary-row" style="color:var(--text-quaternary);">None</div>';

    // --- Render ---
    document.getElementById('summaryPvRows').innerHTML = pvHtml;
    document.getElementById('summaryBatteryRows').innerHTML = batHtml;
    document.getElementById('summaryAddonRows').innerHTML = addonHtml;

    // --- Installation (Rate Card) — hidden from summary, still calculated ---
    var installCard = document.getElementById('summaryInstallCard');
    if (installCard) installCard.style.display = 'none';
}

// ====================
// BILL OF MATERIALS
// ====================

function buildBOM() {
    syncStateFromDOM();
    const bat = getBatterySummary(), bt = getBatteryType(), modules = getBatteryModules();
    const roofType = state.roofType, roof = CONFIG.installation?.roof_types?.[roofType] || { label: roofType, surcharge: 0 };
    const invLabel = getInverterLabel();
    let bom = [];

    var solarOnly = isSolarOnly();
    var batteryOnly = isBatteryOnly();

    // === PV EQUIPMENT (skip for battery-only) ===
    if (!batteryOnly && state.panelCount > 0) {
        let pvItems = [];
        pvItems.push({ desc: state.panelManufacturer + ' ' + state.panelModel + ' ' + state.panelWattage + 'W ' + state.panelColour, sku: state.panelModel, qty: state.panelCount, unit: state.panelCost, total: state.panelCount * state.panelCost, supplier_code: state.panelSupplierCode });
        getMountingKitItems(state.panelCount, roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm).items.forEach(item => pvItems.push(item));
        if (roof.surcharge > 0) pvItems.push({ desc: roof.label + ' Roof Surcharge', sku: '', qty: 1, unit: roof.surcharge, total: roof.surcharge, supplier_code: 'BDS:ROOF-SURCHARGE' });
        
        // For solar-only, add inverter to PV section
        if (solarOnly && state.invPrice > 0) {
            pvItems.push({ desc: state.invSku + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)', sku: state.invSku, qty: 1, unit: state.invPrice, total: state.invPrice, supplier_code: state.invSupplierCode });
        }
        
        bom.push({ category: 'PV Equipment & Mounting', items: pvItems });
    }

    // === BATTERY & INVERTER (skip for solar-only) ===
    if (!solarOnly && state.desiredBatteryKwh > 0) {
        let batItems = [];
        const isDualBom = dualStackResult && currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 48;
        const isParallelBom = parallelResult && currentManufacturer === 'solax' && parallelResult.isParallel;

        if (isDualBom) {
            // Dual-stack BOM: 2x ECs, 2x battery groups, 2x mounts, mandatory gateway
            const ds = dualStackResult;
            const phaseLabel = state.phase === 'single_phase' ? 'Single' : 'Three';
            const ec1Key = getCecKey(ds.stack1.ec.sku), ec2Key = getCecKey(ds.stack2.ec.sku);

            // Stack 1 EC
            batItems.push({ desc: 'Stack 1: ' + ds.stack1.ec.sku + ' (' + ds.stack1.ec.kw + 'kW ' + phaseLabel + ' Phase, ' + ds.stack1.panels + ' panels)', sku: ds.stack1.ec.sku, qty: 1, unit: ds.stack1.ec.price, total: ds.stack1.ec.price, supplier_code: ds.stack1.ec.supplier_code || '' });
            // Stack 1 batteries
            modules.forEach(b => { const q = ds.stack1.batteryQtys[b.kwh] || 0; var ep = getEffectivePrice(b); if (q > 0) batItems.push({ desc: 'Stack 1: ' + (b.label || b.kwh + 'kWh') + ' Battery', sku: '', qty: q, unit: ep, total: q * ep, supplier_code: b.supplier_code || '' }); });

            // Stack 2 EC
            batItems.push({ desc: 'Stack 2: ' + ds.stack2.ec.sku + ' (' + ds.stack2.ec.kw + 'kW ' + phaseLabel + ' Phase, ' + ds.stack2.panels + ' panels)', sku: ds.stack2.ec.sku, qty: 1, unit: ds.stack2.ec.price, total: ds.stack2.ec.price, supplier_code: ds.stack2.ec.supplier_code || '' });
            // Stack 2 batteries
            modules.forEach(b => { const q = ds.stack2.batteryQtys[b.kwh] || 0; var ep = getEffectivePrice(b); if (q > 0) batItems.push({ desc: 'Stack 2: ' + (b.label || b.kwh + 'kWh') + ' Battery', sku: '', qty: q, unit: ep, total: q * ep, supplier_code: b.supplier_code || '' }); });

            // Gateway (mandatory for dual-stack)
            if (ds.gateway) batItems.push({ desc: 'Gateway: ' + ds.gateway.sku, sku: ds.gateway.sku, qty: 1, unit: ds.gwPrice, total: ds.gwPrice, supplier_code: ds.gateway.supplier_code || '' });

            // 2x mount kits
            const mfgMount2 = getMfg().battery_mounting || {};
            const mt = state.mountingType, mp = mfgMount2[mt === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0;
            const mc = mfgMount2[mt === 'wall' ? 'mount_wall_code' : 'mount_ground_code'] || '';
            if (mp > 0) batItems.push({ desc: (mt === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', sku: '', qty: 2, unit: mp, total: 2 * mp, supplier_code: mc });

            // Power Sensor
            if (includeSensor()) {
            var psAcc = (getMfg().accessories || []).find(function(a) { return a.id === 'power_sensor'; });
            if (psAcc) { var psBp = state.phase === 'single_phase' ? psAcc.price_single : psAcc.price_three; var psPrice = psAcc.discount_pct ? getEffectivePrice({ price: psBp, discount_pct: psAcc.discount_pct, discount_from: psAcc.discount_from, discount_to: psAcc.discount_to }) : psBp; var psCode = state.phase === 'single_phase' ? (psAcc.supplier_code_single || '') : (psAcc.supplier_code_three || ''); batItems.push({ desc: psAcc.label, sku: '', qty: 1, unit: psPrice, total: psPrice, supplier_code: psCode }); }
            }

        } else if (isParallelBom) {
        // SolaX Parallel BOM: 1x inverter, 2x battery systems, parallel box
        var pr = parallelResult;
        var modP = modules[0];

        // Inverter
        if (state.invSku && state.invSku !== 'none') batItems.push({ desc: state.invSku + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)', sku: state.invSku, qty: 1, unit: state.invPrice, total: state.invPrice, supplier_code: state.invSupplierCode });

        // System A
        if (pr.systemA.pkg) {
            batItems.push({ desc: 'System A: ' + pr.systemA.pkg.sku + ' (' + fmtKwh(pr.systemA.kwh) + 'kWh)', sku: pr.systemA.pkg.sku, qty: 1, unit: 0, total: 0, supplier_code: '', isGroup: true });
            var epA = getEffectivePrice(modP);
            batItems.push({ desc: (modP.label || modP.kwh + 'kWh') + ' Battery Module', sku: '', qty: pr.systemA.modules, unit: epA, total: pr.systemA.modules * epA, supplier_code: modP.supplier_code || '', indent: true });
            if (includeBms()) { var bmsDescA = getBmsDesc(bt); batItems.push({ desc: bmsDescA, sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '', indent: true }); }
            if (pr.systemA.needsSeriesBox) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '', indent: true });
        } else {
            batItems.push({ desc: 'System A: ' + pr.systemA.modules + 'x ' + modP.kwh + 'kWh (' + fmtKwh(pr.systemA.kwh) + 'kWh)', sku: '', qty: 1, unit: 0, total: 0, supplier_code: '', isGroup: true });
            var epA2 = getEffectivePrice(modP);
            batItems.push({ desc: (modP.label || modP.kwh + 'kWh') + ' Battery Module', sku: '', qty: pr.systemA.modules, unit: epA2, total: pr.systemA.modules * epA2, supplier_code: modP.supplier_code || '', indent: true });
            if (includeBms()) { var bmsDescA2 = getBmsDesc(bt); batItems.push({ desc: bmsDescA2, sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '', indent: true }); }
            if (pr.systemA.needsSeriesBox) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '', indent: true });
        }

        // System B
        if (pr.systemB.pkg) {
            batItems.push({ desc: 'System B: ' + pr.systemB.pkg.sku + ' (' + fmtKwh(pr.systemB.kwh) + 'kWh)', sku: pr.systemB.pkg.sku, qty: 1, unit: 0, total: 0, supplier_code: '', isGroup: true });
            var epB = getEffectivePrice(modP);
            batItems.push({ desc: (modP.label || modP.kwh + 'kWh') + ' Battery Module', sku: '', qty: pr.systemB.modules, unit: epB, total: pr.systemB.modules * epB, supplier_code: modP.supplier_code || '', indent: true });
            if (includeBms()) { var bmsDescB = getBmsDesc(bt); batItems.push({ desc: bmsDescB, sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '', indent: true }); }
            if (pr.systemB.needsSeriesBox) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '', indent: true });
        } else {
            batItems.push({ desc: 'System B: ' + pr.systemB.modules + 'x ' + modP.kwh + 'kWh (' + fmtKwh(pr.systemB.kwh) + 'kWh)', sku: '', qty: 1, unit: 0, total: 0, supplier_code: '', isGroup: true });
            var epB2 = getEffectivePrice(modP);
            batItems.push({ desc: (modP.label || modP.kwh + 'kWh') + ' Battery Module', sku: '', qty: pr.systemB.modules, unit: epB2, total: pr.systemB.modules * epB2, supplier_code: modP.supplier_code || '', indent: true });
            if (includeBms()) { var bmsDescB2 = getBmsDesc(bt); batItems.push({ desc: bmsDescB2, sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '', indent: true }); }
            if (pr.systemB.needsSeriesBox) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '', indent: true });
        }

        // BMS Parallel Box
        batItems.push({ desc: 'BMS Parallel Box II G1', sku: '', qty: 1, unit: pr.parallelBoxPrice, total: pr.parallelBoxPrice, supplier_code: pr.parallelBoxCode });

        // Gateway / EPS Box (optional, from dropdown)
        if (document.getElementById('gatewaySelect').value !== 'none') {
            var gwP = document.getElementById('gatewaySelect'), gwOptP = gwP.options[gwP.selectedIndex];
            var gwPriceP = parseFloat(gwOptP?.dataset.price) || 0;
            if (gwPriceP > 0) batItems.push({ desc: 'EPS Box: ' + (gwOptP?.textContent || ''), sku: gwOptP?.value || '', qty: 1, unit: gwPriceP, total: gwPriceP, supplier_code: gwOptP?.dataset.supplierCode || '' });
        }

    } else {
        // Single-stack BOM
        if (state.invSku && state.invSku !== 'none') batItems.push({ desc: state.invSku + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)', sku: state.invSku, qty: 1, unit: state.invPrice, total: state.invPrice, supplier_code: state.invSupplierCode });

        if (bt.use_package_pricing && bat.totalModules > 0) {
            const pkg = bt.packages?.find(p => p.modules === bat.totalModules);
            // Package header row (no unit/total -- children carry the costs)
            if (pkg) {
                batItems.push({ desc: pkg.sku + ' (' + fmtKwh(pkg.kwh) + 'kWh)', sku: pkg.sku, qty: 1, unit: 0, total: 0, supplier_code: '', isGroup: true });
            }
            // Individual components as indented children
            modules.forEach(b => { const q = batteryQtys[b.kwh] || 0; var ep = getEffectivePrice(b); if (q > 0) batItems.push({ desc: (b.label || b.kwh + 'kWh') + ' Battery Module', sku: '', qty: q, unit: ep, total: q * ep, supplier_code: b.supplier_code || '', indent: true }); });
            if (includeBms() && bt.bms_cost >= 0 && bt.bms_code) {
                batItems.push({ desc: getBmsDesc(bt), sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '', indent: true });
            }
            if (bat.totalModules >= (bt.series_box_threshold || 999)) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '', indent: true });
        } else {
            modules.forEach(b => { const q = batteryQtys[b.kwh] || 0; var ep = getEffectivePrice(b); if (q > 0) batItems.push({ desc: (b.label || b.kwh + 'kWh') + ' Battery Module', sku: '', qty: q, unit: ep, total: q * ep, supplier_code: b.supplier_code || '' }); });
            if (includeBms() && bat.totalModules > 0 && bt.bms_cost > 0) batItems.push({ desc: 'Battery BMS', sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '' });
            if (bat.totalModules >= (bt.series_box_threshold || 999)) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '' });
        }

        if (currentManufacturer === 'sigenergy' && bat.totalModules > 0) {
            // Gateway mandatory for Sigenergy -- use selected gateway from dropdown
            const gw = document.getElementById('gatewaySelect'), gwOpt = gw.options[gw.selectedIndex];
            const gwPrice = parseFloat(gwOpt?.dataset.price) || 0;
            const gwCode = gwOpt?.dataset.supplierCode || '';
            if (gwPrice > 0) batItems.push({ desc: 'Gateway: ' + (gwOpt?.textContent || ''), sku: gwOpt?.value || '', qty: 1, unit: gwPrice, total: gwPrice, supplier_code: gwCode });
        } else if (document.getElementById('gatewaySelect').value !== 'none') {
            const gw = document.getElementById('gatewaySelect'), gwOpt = gw.options[gw.selectedIndex];
            const gwPrice = parseFloat(gwOpt?.dataset.price) || 0;
            if (gwPrice > 0) batItems.push({ desc: (currentManufacturer === 'sigenergy' ? 'Gateway' : 'EPS Box') + ': ' + (gwOpt?.textContent || ''), sku: gwOpt?.value || '', qty: 1, unit: gwPrice, total: gwPrice, supplier_code: gwOpt?.dataset.supplierCode || '' });
        }
        const mfgMount = getMfg().battery_mounting || {};
        if (bat.totalModules > 0 && mfgMount.show !== false) {
            const mt = state.mountingType, mp = mfgMount[mt === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0;
            const mc = mfgMount[mt === 'wall' ? 'mount_wall_code' : 'mount_ground_code'] || '';
            if (mp > 0) batItems.push({ desc: (mt === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', sku: '', qty: 1, unit: mp, total: mp, supplier_code: mc });
        }

        // Power Sensor
        if (includeSensor()) {
        var psAcc2 = (getMfg().accessories || []).find(function(a) { return a.id === 'power_sensor'; });
        if (psAcc2) { var psBp2 = state.phase === 'single_phase' ? psAcc2.price_single : psAcc2.price_three; var psPrice2 = psAcc2.discount_pct ? getEffectivePrice({ price: psBp2, discount_pct: psAcc2.discount_pct, discount_from: psAcc2.discount_from, discount_to: psAcc2.discount_to }) : psBp2; var psCode2 = state.phase === 'single_phase' ? (psAcc2.supplier_code_single || '') : (psAcc2.supplier_code_three || ''); batItems.push({ desc: psAcc2.label, sku: '', qty: 1, unit: psPrice2, total: psPrice2, supplier_code: psCode2 }); }
        }
        }
        bom.push({ category: 'Battery Components', items: batItems });
    }

    // === ACCESSORIES & ADD-ONS ===
    let accItems = getAccessoryBomItems();
    for (let i = 1; i <= customAddonCount; i++) { const ne = document.getElementById('customName-' + i), ce = document.getElementById('customCost-' + i); if (ne && ce && ne.value.trim()) { const p = parseFloat(ce.value) || 0; accItems.push({ desc: ne.value.trim(), sku: 'Custom', qty: 1, unit: p, total: p, supplier_code: 'BDS:CUSTOM' }); } }
    if (accItems.length > 0) bom.push({ category: 'Accessories', items: accItems });

    // === INSTALLATION ===
    if (rateCardResult && currentContractorId) {
        // Rate card BOM: group items by category
        var catLabels = { pv: 'PV Installation', electrical: 'Electrical', battery: 'Battery Installation', access: 'Access', travel: 'Travel' };
        var catItems = {};
        rateCardResult.items.forEach(function(item) {
            var cat = item.category || 'other';
            if (!catItems[cat]) catItems[cat] = [];
            catItems[cat].push({ desc: item.label, sku: 'Labour', qty: 1, unit: item.cost, total: item.cost, supplier_code: 'BDS:RC-' + cat.toUpperCase() });
        });
        ['pv', 'electrical', 'battery', 'access', 'travel'].forEach(function(cat) {
            if (catItems[cat] && catItems[cat].length > 0) {
                bom.push({ category: 'Installation - ' + (catLabels[cat] || cat) + ' (' + (currentContractorRecord?.business_name || 'Contractor') + ')', items: catItems[cat] });
            }
        });
    } else {
        // Flat-rate BOM (no contractor)
        let installItems = [];
        var isDualBom = dualStackResult && currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 48;
        var isParallelBom = parallelResult && currentManufacturer === 'solax' && parallelResult.isParallel;

        // PV installation (skip for battery-only)
        if (!batteryOnly && state.panelCount > 0) {
            installItems.push({ desc: 'PV Installation (' + state.sysKw.toFixed(2) + 'kW)', sku: 'Labour', qty: 1, unit: state.sysKw * state.installPvPerKw, total: state.sysKw * state.installPvPerKw, supplier_code: 'BDS:LABOUR-PV' });
        }

        // Battery installation (skip for solar-only)
        if (!solarOnly && state.desiredBatteryKwh > 0) {
            if (isDualBom) {
                installItems.push({ desc: 'Battery Installation (2 stacks)', sku: 'Labour', qty: 2, unit: state.installBatPerStack, total: 2 * state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
            } else if (isParallelBom) {
                installItems.push({ desc: 'Battery Installation (2 systems)', sku: 'Labour', qty: 2, unit: state.installBatPerStack, total: 2 * state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
            } else if (bat.totalModules > 0) {
                installItems.push({ desc: 'Battery Installation', sku: 'Labour', qty: 1, unit: state.installBatPerStack, total: state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
            }
        }

        if (installItems.length > 0) {
            bom.push({ category: 'Installation (Labour)', items: installItems });
        }
    }
    return bom;
}

function showBOM() {
    const bom = buildBOM();
    const name = document.getElementById('customerName').value || 'Customer';
    const addr = document.getElementById('installAddress').value || '', suburb = document.getElementById('installSuburb')?.value || '';
    const st = document.getElementById('installState')?.value || '', pc = document.getElementById('installPostcode').value || '';
    const phone = document.getElementById('customerPhone')?.value || '', email = document.getElementById('customerEmail')?.value || '';
    const date = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
    let addrLine = [addr, suburb, st, pc].filter(Boolean).join(', ');
    let custHtml = '<div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">';
    custHtml += '<div><strong style="color:var(--gray-900); font-size:15px;">' + esc(name) + '</strong>';
    if (addrLine) custHtml += '<br><span style="color:var(--gray-500);">' + esc(addrLine) + '</span>';
    let contactParts = [];
    if (phone) contactParts.push(esc(phone));
    if (email) contactParts.push(esc(email));
    if (contactParts.length > 0) custHtml += '<br><span style="color:var(--gray-500);">' + contactParts.join(' &nbsp;|&nbsp; ') + '</span>';
    custHtml += '</div>';
    custHtml += '<div style="text-align:right; white-space:nowrap;"><span style="color:var(--gray-900);">' + esc(date) + '</span></div>';
    custHtml += '</div>';
    document.getElementById('bomCustomerHeader').innerHTML = custHtml;

    let html = '', grandTotal = 0;
    bom.forEach((group, gi) => {
        const groupTotal = group.items.reduce((s, item) => s + item.total, 0); grandTotal += groupTotal;
        html += '<div style="background:var(--white); border:1px solid var(--gray-200); border-radius:var(--radius-sm, 12px); margin-bottom:12px; overflow:hidden; box-shadow:var(--shadow-sm);">';
        html += '<div onclick="toggleBomGroup(' + gi + ')" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; cursor:pointer; user-select:none;">';
        html += '<div style="display:flex; align-items:center; gap:10px;"><span id="bomChevron' + gi + '" style="color:var(--blue); font-size:12px; transition:transform 0.2s; transform:rotate(90deg);">&#9654;</span>';
        html += '<span style="color:var(--blue); font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px;">' + esc(group.category) + '</span>';
        html += '<span style="color:var(--gray-400); font-size:12px;">(' + group.items.length + ' item' + (group.items.length !== 1 ? 's' : '') + ')</span></div>';
        html += '</div>';
        html += '<div id="bomGroup' + gi + '" style="display:block; border-top:1px solid var(--gray-200);"><table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<thead><tr style="color:var(--gray-400); text-transform:uppercase; font-size:11px; letter-spacing:0.5px;"><th style="text-align:left; padding:10px 20px; border-bottom:1px solid var(--gray-200);">Description</th><th style="text-align:center; padding:10px 12px; border-bottom:1px solid var(--gray-200); width:60px;">Qty</th></tr></thead><tbody>';
        group.items.forEach((item, ii) => {
            const bg = ii % 2 === 0 ? 'var(--gray-50)' : 'var(--white)';
            if (item.isGroup) {
                html += '<tr style="background:' + bg + '; color:var(--gray-900);"><td style="padding:9px 20px; font-weight:600;">' + esc(item.desc) + (item.sku && item.sku !== 'Custom' && item.sku !== 'Labour' ? ' <span style="color:var(--gray-400); font-size:11px;">(' + esc(item.sku) + ')</span>' : '') + '</td>';
                html += '<td style="text-align:center; padding:9px 12px;">' + item.qty + '</td></tr>';
            } else {
                var pad = item.indent ? '9px 20px 9px 40px' : '9px 20px';
                var clr = item.indent ? 'var(--gray-500)' : 'var(--gray-700)';
                html += '<tr style="background:' + bg + '; color:' + clr + ';"><td style="padding:' + pad + ';">' + (item.indent ? '- ' : '') + esc(item.desc) + (item.sku && item.sku !== 'Custom' && item.sku !== 'Labour' ? ' <span style="color:var(--gray-400); font-size:11px;">(' + esc(item.sku) + ')</span>' : '') + '</td>';
                html += '<td style="text-align:center; padding:9px 12px;">' + item.qty + '</td></tr>';
            }
        });
        html += '</tbody></table></div></div>';
    });
    document.getElementById('bomContent').innerHTML = html;

    // Full system price in header (before rebates, inc GST)
    var bomPriceEl = document.getElementById('bomPrice');
    if (bomPriceEl) bomPriceEl.textContent = document.getElementById('priceBeforeRebates').textContent;

    // STC rebates + discount only
    const zoneResult = lookupZone(document.getElementById('installPostcode').value);
    const zoneRating = zoneResult ? zoneResult.rating : 0;
    const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
    const pvReb = pvStcCount * state.stcPrice, batSummary = getBatterySummary(), batUsable = (parallelResult && parallelResult.isParallel) ? parallelResult.totalUsableKwh : (dualStackResult && dualStackResult.isDualStack) ? dualStackResult.totalUsableKwh : batSummary.usableKwh, batReb = calcBatteryRebate(batUsable, state.batteryRebatePerKwh);
    let totHtml = '<table style="width:100%; font-size:14px; border-collapse:collapse;">';
    const totRow = (l, v, s) => '<tr style="' + (s || '') + '"><td style="padding:8px 0; color:var(--gray-500);">' + l + '</td><td style="padding:8px 0; text-align:right; color:var(--gray-900); font-weight:500;">' + v + '</td></tr>';
    if (pvReb > 0) totHtml += totRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtExGst(pvReb), 'color:var(--green);');
    if (batReb > 0) totHtml += totRow('Battery STC Rebate', '-' + fmtExGst(batReb), 'color:var(--green);');
    var bomDiscount = parseFloat(document.getElementById('discountAmount')?.value) || 0;
    if (bomDiscount > 0) totHtml += totRow('Discount', '-$' + Math.round(bomDiscount).toLocaleString('en-AU'), 'color:var(--green);');
    var custPrice = document.getElementById('customerPriceDisplay').textContent;
    totHtml += totRow('Customer Price (inc GST)', custPrice, 'border-top:2px solid var(--blue); font-weight:700; font-size:16px; color:var(--blue);');
    totHtml += '</table>';
    document.getElementById('bomTotals').innerHTML = totHtml;
    document.getElementById('bomOverlay').style.display = 'block'; document.body.style.overflow = 'hidden';
}

function closeBOM() { document.getElementById('bomOverlay').style.display = 'none'; document.body.style.overflow = ''; }
function toggleBomGroup(gi) { const el = document.getElementById('bomGroup' + gi), ch = document.getElementById('bomChevron' + gi); if (el.style.display === 'none') { el.style.display = 'block'; ch.style.transform = 'rotate(90deg)'; } else { el.style.display = 'none'; ch.style.transform = 'rotate(0deg)'; } }

// ====================
// SUPABASE QUOTE SAVE / SEARCH / LOAD
// ====================

function collectQuoteData() {
    syncStateFromDOM();
    const bat = getBatterySummary();
    return {
        customer: {
            name: document.getElementById('customerName').value || '',
            phone: document.getElementById('customerPhone').value || '',
            email: document.getElementById('customerEmail').value || '',
            address: document.getElementById('installAddress').value || '',
            suburb: document.getElementById('installSuburb').value || '',
            state: document.getElementById('installState').value || '',
            postcode: document.getElementById('installPostcode').value || ''
        },
        system: {
            systemType: currentSystemType,
            manufacturer: currentManufacturer,
            batteryTypeIdx: currentBatteryTypeIdx,
            phase: state.phase,
            panelMode: state.panelMode,
            panelCount: state.panelCount,
            panelSelectIdx: document.getElementById('panelSelect').selectedIndex,
            panelValue: document.getElementById('panelSelect').value,
            desiredBatteryKwh: state.desiredBatteryKwh,
            inverterSelectIdx: document.getElementById('inverterSelect').selectedIndex,
            inverterValue: document.getElementById('inverterSelect').value,
            userChangedInverter: userChangedInverter,
            gatewaySelectIdx: document.getElementById('gatewaySelect').selectedIndex,
            gatewayValue: document.getElementById('gatewaySelect').value,
            selectedAccessories: selectedAccessories.map(function(a) {
                var copy = { id: a.id, label: a.label, price: a.price, type: a.type, supplier_code: a.supplier_code || '' };
                if (a.type === 'ev_charger') { copy.evModel = a.evModel; copy.evDesc = a.evDesc || ''; copy.evSupplierCode = a.evSupplierCode || ''; }
                return copy;
            })
        },
        mounting: {
            roofType: state.roofType,
            orientation: state.orientation,
            numRows: state.numRows,
            numArrays: state.numArrays,
            tiltAngle: state.tiltAngle,
            kliplockProfile: state.kliplockProfile,
            mountingType: state.mountingType
        },
        pricing: {
            installPvPerKw: state.installPvPerKw,
            installBatPerStack: state.installBatPerStack,
            stcPrice: state.stcPrice,
            deemingPeriod: state.deemingPeriod,
            batteryRebatePerKwh: state.batteryRebatePerKwh,
            gpMargin: state.gpMargin,
            salesCommission: state.salesCommission
        },
        custom_addons: getCustomAddons(),
        installation: {
            contractorId: currentContractorId || null,
            addons: JSON.parse(JSON.stringify(installationAddons)),
            items: rateCardResult?.items || [],
            total: rateCardResult?.total || 0,
            storey: parseInt(document.getElementById('storeyCount')?.value) || 1,
            backupCircuitCount: parseInt(document.getElementById('backupCircuitCount')?.value) || 0,
            travelDistanceKm: parseInt(document.getElementById('travelDistanceKm')?.value) || 0
        },
        totals: {
            customerPrice: document.getElementById('customerPriceDisplay').textContent,
            totalCog: fmtExGst(state.totalCog || 0),
            sysKw: state.sysKw,
            batteryKwh: bat.totalKwh,
            discount: parseFloat(document.getElementById('discountAmount')?.value) || 0,
            pvStcRebate: state.pvStcRebate || 0,
            batteryStcRebate: state.batteryStcRebate || 0,
            productDiscounts: collectActiveDiscounts()
        },
        rep_id: currentRepId || null
    };
}

function collectActiveDiscounts() {
    var discounts = [];
    // Panel
    var panelSel = document.getElementById('panelSelect');
    var panelOpt = panelSel.options[panelSel.selectedIndex];
    if (panelOpt && parseFloat(panelOpt.dataset.discountPct) > 0) {
        var origP = parseFloat(panelOpt.dataset.originalPrice) || 0;
        var effP = parseFloat(panelOpt.dataset.price) || origP;
        if (effP < origP) discounts.push({ table: 'panels', sku: panelOpt.dataset.manufacturer + ' ' + panelOpt.dataset.model, original_price: origP, discount_pct: parseFloat(panelOpt.dataset.discountPct), effective_price: effP });
    }
    // Inverter
    var invSel = document.getElementById('inverterSelect');
    var invOpt = invSel.options[invSel.selectedIndex];
    if (invOpt && parseFloat(invOpt.dataset.discountPct) > 0) {
        var origI = parseFloat(invOpt.dataset.originalPrice) || 0;
        var effI = parseFloat(invOpt.dataset.price) || origI;
        if (effI < origI) discounts.push({ table: 'inverters', sku: invOpt.value, original_price: origI, discount_pct: parseFloat(invOpt.dataset.discountPct), effective_price: effI });
    }
    // Gateway
    var gwSel = document.getElementById('gatewaySelect');
    var gwOpt = gwSel.options[gwSel.selectedIndex];
    if (gwOpt && gwOpt.value !== 'none' && parseFloat(gwOpt.dataset.discountPct) > 0) {
        var origG = parseFloat(gwOpt.dataset.originalPrice) || 0;
        var effG = parseFloat(gwOpt.dataset.price) || origG;
        if (effG < origG) discounts.push({ table: 'gateways', sku: gwOpt.value, original_price: origG, discount_pct: parseFloat(gwOpt.dataset.discountPct), effective_price: effG });
    }
    // Battery modules
    var modules = getBatteryModules();
    modules.forEach(function(b) {
        if (b.discount_pct && b.discount_from && b.discount_to && (batteryQtys[b.kwh] || 0) > 0) {
            var ep = getEffectivePrice(b);
            if (ep < b.price) discounts.push({ table: 'battery_modules', sku: b.label || b.kwh + 'kWh', original_price: b.price, discount_pct: b.discount_pct, effective_price: ep });
        }
    });
    // Accessories (including EV chargers)
    selectedAccessories.forEach(function(acc) {
        if (acc.discount_pct && acc.discount_pct > 0 && acc.originalPrice && acc.price < acc.originalPrice) {
            discounts.push({ table: acc.id.startsWith('ev_') ? 'ev_chargers' : 'accessories', sku: acc.label, original_price: acc.originalPrice, discount_pct: acc.discount_pct, effective_price: acc.price });
        }
    });
    return discounts;
}

function getCustomAddons() {
    const items = [];
    for (let i = 1; i <= customAddonCount; i++) {
        const ne = document.getElementById('customName-' + i), ce = document.getElementById('customCost-' + i);
        if (ne && ce && ne.value.trim()) items.push({ name: ne.value.trim(), cost: parseFloat(ce.value) || 0 });
    }
    return items;
}

async function saveQuote() {
    if (!supabaseClient) { alert('Database not connected. Check your internet connection.'); return; }

    // -- Mandatory field validation --
    var missing = [];
    var firstEl = null;
    var checks = [
        { id: 'customerName', label: 'Customer Name' },
        { id: 'customerPhone', label: 'Phone' },
        { id: 'customerEmail', label: 'Email' },
        { id: 'installAddress', label: 'Street Address' },
        { id: 'installSuburb', label: 'Suburb' },
        { id: 'installState', label: 'State' },
        { id: 'installPostcode', label: 'Postcode' }
    ];
    for (var i = 0; i < checks.length; i++) {
        var el = document.getElementById(checks[i].id);
        if (!el || !el.value.trim()) {
            missing.push(checks[i].label);
            if (!firstEl && el) firstEl = el;
        }
    }

    if (!currentRepId) {
        missing.push('Sales Rep');
        if (!firstEl) firstEl = document.getElementById('repSelect');
    }

    // Validation based on system type
    var hasPanels = state.sysKw && state.sysKw > 0;
    var hasBattery = state.desiredBatteryKwh && state.desiredBatteryKwh > 0;

    if (currentSystemType === 'pv_only') {
        if (!hasPanels) {
            missing.push('Panel system (kW must be > 0 for PV Only)');
        }
    } else if (currentSystemType === 'battery_only') {
        if (!hasBattery) {
            missing.push('Battery capacity (kWh must be > 0 for Battery Only)');
        }
    } else {
        // Hybrid: need both
        if (!hasPanels) {
            missing.push('Panel system (kW must be > 0)');
        }
        if (!hasBattery) {
            missing.push('Battery capacity (kWh must be > 0)');
        }
    }

    // Inverter required for battery systems and PV-only SolaX
    var invSel = document.getElementById('inverterSelect');
    if ((hasBattery || currentSystemType === 'pv_only') && (!invSel || invSel.options.length === 0)) {
        missing.push('Inverter selection');
    }

    if (missing.length > 0) {
        alert('Please complete the following before saving:\n\n- ' + missing.join('\n- '));
        if (firstEl) firstEl.focus();
        return;
    }

    const name = document.getElementById('customerName').value.trim();
    const data = collectQuoteData();

    try {
        if (currentQuoteId) {
            const { error } = await supabaseClient.from('quotes')
                .update(data).eq('id', currentQuoteId);
            if (error) throw error;
            console.log('[OK] Quote updated:', currentQuoteId);
        } else {
            const { data: row, error } = await supabaseClient.from('quotes')
                .insert(data).select('id').single();
            if (error) throw error;
            currentQuoteId = row.id;
            console.log('[OK] Quote saved:', currentQuoteId);
        }

        alert('Quote saved successfully.' + (currentQuoteId ? '\nID: ' + currentQuoteId : ''));
    } catch (err) {
        console.error('[!] Save failed:', err);
        alert('Failed to save quote: ' + (err.message || err.details || 'Unknown error'));
    }
}

function toggleSearch() {
    var overlay = document.getElementById('searchOverlay');
    var btns = document.getElementById('toolbarActions');
    var isOpen = overlay.classList.contains('open');
    overlay.classList.toggle('open');
    btns.classList.toggle('hidden');
    if (!isOpen) {
        document.getElementById('quoteSearchInput').focus();
    }
}

function closeSearch() {
    var overlay = document.getElementById('searchOverlay');
    var btns = document.getElementById('toolbarActions');
    if (overlay && overlay.classList.contains('open')) {
        overlay.classList.remove('open');
        btns.classList.remove('hidden');
    }
}

// Close search on Escape, trigger search on Enter, close on click outside
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { closeSearch(); }
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'quoteSearchInput') {
        searchQuotes();
    }
});

document.addEventListener('click', function(e) {
    var overlay = document.getElementById('searchOverlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    var toolbar = document.getElementById('mainToolbar');
    if (!toolbar.contains(e.target)) { closeSearch(); }
});

async function searchQuotes() {
    if (!supabaseClient) { alert('Database not connected.'); return; }
    const term = document.getElementById('quoteSearchInput').value.trim().toLowerCase();
    if (!term) { alert('Enter a name, address, or phone number to search.'); return; }

    const resultsEl = document.getElementById('quoteSearchResults');
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="color:var(--gray-500);padding:8px;">Searching...</div>';

    try {
        let builder = supabaseClient.from('quotes')
            .select('id, customer, totals, updated_at, reps(name)')
            .order('updated_at', { ascending: false })
            .limit(20);

        const isNumeric = /^\d+$/.test(term);
        if (isNumeric) {
            if (term.length === 4) {
                builder = builder.eq('search_postcode', term);
            } else {
                builder = builder.ilike('search_phone', '%' + term.replace(/\s/g, '') + '%');
            }
        } else {
            builder = builder.or('search_name.ilike.%' + term + '%,search_suburb.ilike.%' + term + '%');
        }

        const { data: results, error } = await builder;
        if (error) throw error;

        if (!results || results.length === 0) {
            resultsEl.innerHTML = '<div style="color:var(--gray-500);padding:8px;">No quotes found for "' + esc(term) + '"</div>';
            return;
        }

        let html = '';
        results.forEach(r => {
            const c = r.customer || {};
            const date = r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-AU') : '';
            const sysInfo = (r.totals?.sysKw ? r.totals.sysKw.toFixed(1) + 'kW' : '') + (r.totals?.batteryKwh ? ' / ' + fmtKwh(r.totals.batteryKwh) + 'kWh' : '');
            html += '<div onclick="loadQuote(\'' + r.id + '\')" style="padding:10px 16px;background:var(--white);border:1px solid var(--gray-200);border-radius:var(--radius-sm, 12px);margin-bottom:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;box-shadow:var(--shadow-sm);" onmouseover="this.style.borderColor=\'var(--blue)\'" onmouseout="this.style.borderColor=\'var(--gray-200)\'">';
            html += '<div><span style="color:var(--gray-900);font-weight:500;">' + esc(c.name || 'Unknown') + '</span>';
            if (c.suburb) html += '<span style="color:var(--gray-500);font-size:12px;margin-left:8px;">' + esc(c.suburb) + '</span>';
            if (c.phone) html += '<span style="color:var(--gray-500);font-size:12px;margin-left:8px;">' + esc(c.phone) + '</span>';
            const repName = r.reps?.name;
            if (repName) html += '<span style="color:#a78bfa;font-size:11px;margin-left:8px;">' + esc(repName) + '</span>';
            html += '</div>';
            html += '<div style="text-align:right;"><span style="color:var(--blue);font-size:13px;font-weight:600;">' + esc(r.totals?.customerPrice || '') + '</span>';
            if (sysInfo) html += '<span style="color:var(--gray-500);font-size:11px;margin-left:8px;">' + esc(sysInfo) + '</span>';
            if (date) html += '<span style="color:var(--gray-500);font-size:11px;margin-left:8px;">' + date + '</span>';
            html += '</div></div>';
        });
        resultsEl.innerHTML = html;
    } catch (err) {
        console.error('[!] Search failed:', err);
        resultsEl.innerHTML = '<div style="color:#ef4444;padding:8px;">Search failed: ' + esc(err.message || err.details || 'Unknown error') + '</div>';
    }
}

async function loadQuote(quoteId) {
    if (!supabaseClient) return;
    try {
        const { data, error } = await supabaseClient.from('quotes')
            .select('*').eq('id', quoteId).single();
        if (error || !data) { alert('Quote not found.'); return; }
        currentQuoteId = quoteId;

        // Restore rep
        if (data.rep_id) {
            currentRepId = data.rep_id;
            document.getElementById('repSelect').value = data.rep_id;
        }

        // Restore system type first
        if (data.system?.systemType) {
            currentSystemType = data.system.systemType;
            document.getElementById('systemTypeSelect').value = currentSystemType;
            document.querySelectorAll('.sys-tab').forEach(function(t) { t.classList.toggle('active', t.dataset.value === currentSystemType); });
            updateManufacturerOptions();
        }

        // Restore manufacturer
        if (data.system?.manufacturer) {
            currentManufacturer = data.system.manufacturer;
            document.getElementById('manufacturerSelect').value = currentManufacturer;
            syncSegmentedFromSelect('manufacturerSelect');
            currentBatteryTypeIdx = data.system.batteryTypeIdx || 0;
            populateBatteryTypes(); populateInverters(); populateGateways(); buildAccessoriesUI(); updateBatteryMountVisibility(); updateHeaderSubtitle(); updateInverterSectionLabel();
        }

        // Restore customer info
        const c = data.customer || {};
        document.getElementById('customerName').value = c.name || '';
        document.getElementById('customerPhone').value = c.phone || '';
        document.getElementById('customerEmail').value = c.email || '';
        document.getElementById('installAddress').value = c.address || '';
        document.getElementById('installSuburb').value = c.suburb || '';
        document.getElementById('installState').value = c.state || '';
        document.getElementById('installPostcode').value = c.postcode || '';
        updateZoneDisplay();

        // Restore system config
        const s = data.system || {};
        document.getElementById('phaseType').value = s.phase || 'single_phase';
        state.phase = s.phase || 'single_phase';
        syncSegmentedFromSelect('phaseType');
        populateInverters(); populateGateways();

        if (s.panelValue) { document.getElementById('panelSelect').value = s.panelValue; }
        else if (s.panelSelectIdx != null) document.getElementById('panelSelect').selectedIndex = s.panelSelectIdx;
        document.getElementById('panelCount').value = s.panelCount || CONFIG.default_panel_count;
        syncStepperDisplay(); updateStepperPanelLabel(); syncBatteryStepperDisplay(); updateStepperBatteryLabel();

        document.getElementById('desiredBatteryKwh').value = s.desiredBatteryKwh || 0;
       
        userChangedInverter = s.userChangedInverter || false;
        if (s.inverterValue) { document.getElementById('inverterSelect').value = s.inverterValue; }
        else if (s.inverterSelectIdx != null) document.getElementById('inverterSelect').selectedIndex = s.inverterSelectIdx;

        if (s.gatewayValue) { document.getElementById('gatewaySelect').value = s.gatewayValue; }
        else if (s.gatewaySelectIdx != null) document.getElementById('gatewaySelect').selectedIndex = s.gatewaySelectIdx;
        else if (s.addGateway && document.getElementById('gatewaySelect').options.length > 1) document.getElementById('gatewaySelect').selectedIndex = 1;

        // Restore accessories
        var loadedAccs = (s.selectedAccessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
        selectedAccessories = loadedAccs;
        renderSelectedAccessories();

        // Restore mounting
        const m = data.mounting || {};
        document.getElementById('roofType').value = m.roofType || 'metal';
        document.getElementById('panelOrientation').value = m.orientation || 'portrait';
        document.getElementById('numRows').value = m.numRows || 1;
        document.getElementById('numArrays').value = m.numArrays || 1;
        document.getElementById('tiltAngle').value = m.tiltAngle || '10_15';
        var klpSel = document.getElementById('kliplockProfile');
        if (klpSel) klpSel.value = m.kliplockProfile || 'kliplock_606';
        document.getElementById('mountingType').value = m.mountingType || 'ground';
        syncSegmentedFromSelect('mountingType');
        updateRoofInfo();
        // Restore pricing
        const p = data.pricing || {};
        document.getElementById('installPerKwPv').value = p.installPvPerKw ?? CONFIG.installation.install_pv_per_kw;
        document.getElementById('installPerStack').value = p.installBatPerStack ?? CONFIG.installation.install_battery_per_stack;
        document.getElementById('stcPrice').value = p.stcPrice ?? CONFIG.rebates.stc_price;
        document.getElementById('stcDeemingPeriod').value = p.deemingPeriod ?? CONFIG.rebates.stc_deeming_period;
        document.getElementById('batteryRebatePerKwh').value = p.batteryRebatePerKwh ?? CONFIG.rebates.battery_rebate_per_kwh;
        document.getElementById('gpMargin').value = p.gpMargin ?? CONFIG.gp_margin;
        document.getElementById('salesCommission').value = p.salesCommission ?? CONFIG.sales_commission;

        // Restore installation / contractor
        const inst = data.installation || {};
        if (inst.storey) { var se = document.getElementById('storeyCount'); if (se) { se.value = inst.storey; syncSegmentedFromSelect('storeyCount'); } }
        if (inst.backupCircuitCount) { var bc = document.getElementById('backupCircuitCount'); if (bc) bc.value = inst.backupCircuitCount; }
        if (inst.travelDistanceKm) { var td = document.getElementById('travelDistanceKm'); if (td) td.value = inst.travelDistanceKm; }
        if (inst.addons) installationAddons = JSON.parse(JSON.stringify(inst.addons));
        else installationAddons = { standardItems: {}, checkboxItems: {}, addonItems: {} };
        if (inst.contractorId) {
            currentContractorId = inst.contractorId;
            var ctrSel = document.getElementById('contractorSelect');
            if (ctrSel) ctrSel.value = inst.contractorId;
            await loadRateCard(inst.contractorId, { skipCalc: true });
        } else {
            currentContractorId = null;
            currentRateCardItems = [];
            currentContractorRecord = null;
            rateCardResult = null;
            updateInstallCostsVisibility();
        }

        // Restore custom add-ons (new key: custom_addons; fallback to old customAddons)
        const ca = data.custom_addons || data.customAddons || [];
        customAddonCount = 0;
        document.getElementById('customAddons').innerHTML = '';
        ca.forEach(item => { addCustomAddon(); document.getElementById('customName-' + customAddonCount).value = item.name; document.getElementById('customCost-' + customAddonCount).value = item.cost; });

        // Restore discount
        var discEl = document.getElementById('discountAmount');
        if (discEl) discEl.value = (data.totals?.discount) || 0;

        // Hide search results
        document.getElementById('quoteSearchResults').style.display = 'none';
        document.getElementById('quoteSearchInput').value = '';

        calculateQuote();

        // Check for expired product discounts
        checkExpiredDiscounts(data.totals?.productDiscounts || []);

        console.log('[OK] Quote loaded:', quoteId);
    } catch (err) {
        console.error('[!] Load failed:', err);
        alert('Failed to load quote: ' + (err.message || err.details || 'Unknown error'));
    }
}

function checkExpiredDiscounts(savedDiscounts) {
    // Remove any existing banner
    var old = document.getElementById('discountExpiredBanner');
    if (old) old.remove();
    if (!savedDiscounts || savedDiscounts.length === 0) return;

    var currentDiscounts = collectActiveDiscounts();
    var changed = false;
    savedDiscounts.forEach(function(sd) {
        var match = currentDiscounts.find(function(cd) { return cd.table === sd.table && cd.sku === sd.sku; });
        if (!match || Math.abs(match.effective_price - sd.effective_price) > 0.01) {
            changed = true;
        }
    });
    if (!changed) return;

    var banner = document.createElement('div');
    banner.id = 'discountExpiredBanner';
    banner.style.cssText = 'background:rgba(234,179,8,0.15);border:1px solid rgba(234,179,8,0.4);color:#eab308;padding:10px 14px;border-radius:8px;margin:0 0 12px 0;font-size:13px;display:flex;align-items:center;gap:8px;';
    banner.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>' +
        '<span>This quote was saved with promotional discounts that have since changed. Prices have been recalculated at current rates.</span>' +
        '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#eab308;cursor:pointer;font-size:16px;margin-left:auto;">&times;</button>';
    var target = document.getElementById('quoteSummary') || document.querySelector('.summary-card');
    if (target) target.parentNode.insertBefore(banner, target);
}

function clearQuote() {
    currentQuoteId = null;
    var discBanner = document.getElementById('discountExpiredBanner'); if (discBanner) discBanner.remove();
    // Keep rep selection (sticky) — don't reset repSelect
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerEmail').value = '';
    document.getElementById('installAddress').value = '';
    document.getElementById('installSuburb').value = '';
    document.getElementById('installState').value = '';
    document.getElementById('installPostcode').value = '';
    document.getElementById('desiredBatteryKwh').value = CONFIG.default_battery_kwh;
    document.getElementById('panelCount').value = CONFIG.default_panel_count;
    syncStepperDisplay(); updateStepperPanelLabel(); syncBatteryStepperDisplay(); updateStepperBatteryLabel();
    document.getElementById('gatewaySelect').selectedIndex = 0;
    selectedAccessories = []; renderSelectedAccessories();
    customAddonCount = 0; document.getElementById('customAddons').innerHTML = '';
    var discEl = document.getElementById('discountAmount'); if (discEl) discEl.value = 0;
    userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; parallelResult = null;
    batteryQtys = {};
    // Reset installation addons but keep contractor selection (sticky like rep)
    installationAddons = { standardItems: {}, checkboxItems: {}, addonItems: {} };
    rateCardResult = null;
    var storeyEl = document.getElementById('storeyCount'); if (storeyEl) storeyEl.value = '1';
    document.getElementById('phaseType').value = 'single_phase';
    document.getElementById('mountingType').value = 'ground';
    syncSegmentedFromSelect('storeyCount'); syncSegmentedFromSelect('phaseType'); syncSegmentedFromSelect('mountingType');
    var bcEl = document.getElementById('backupCircuitCount'); if (bcEl) bcEl.value = '0';
    var tdEl = document.getElementById('travelDistanceKm'); if (tdEl) tdEl.value = '0';
    // Re-init standard items as checked
    if (currentRateCardItems.length > 0) {
        currentRateCardItems.forEach(function(item) {
            if (item.input_type === 'standard') installationAddons.standardItems[item.id] = true;
        });
        renderInstallationCostsUI();
    }
    document.getElementById('installPerKwPv').value = CONFIG.installation.install_pv_per_kw;
    document.getElementById('installPerStack').value = CONFIG.installation.install_battery_per_stack;
    document.getElementById('stcPrice').value = CONFIG.rebates.stc_price;
    document.getElementById('stcDeemingPeriod').value = CONFIG.rebates.stc_deeming_period;
    document.getElementById('batteryRebatePerKwh').value = CONFIG.rebates.battery_rebate_per_kwh;
    document.getElementById('gpMargin').value = CONFIG.gp_margin;
    document.getElementById('salesCommission').value = CONFIG.sales_commission;
    document.getElementById('quoteSearchResults').style.display = 'none';
    document.getElementById('quoteSearchInput').value = '';
    updateZoneDisplay(); calculateQuote();
}


// Enter key triggers search
function generateQuote() {
    const pc = document.getElementById('installPostcode').value;
    if (!pc || !lookupZone(pc)) { alert('Please enter a valid postcode before generating a quote.'); document.getElementById('installPostcode').focus(); return; }

    if (!window.jspdf) { alert('PDF library failed to load. Please check your internet connection and refresh the page.'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();   // 210
    const pageH = doc.internal.pageSize.getHeight();   // 297
    const margin = 15;
    const contentW = pageW - margin * 2;
    let y = margin;

    // --- Gather data ---
    syncStateFromDOM();
    const bom = buildBOM();
    const bat = getBatterySummary();
    const invLabel = getInverterLabel();
    const name = document.getElementById('customerName').value || 'Customer';
    const phone = document.getElementById('customerPhone').value || '';
    const email = document.getElementById('customerEmail').value || '';
    const addr = document.getElementById('installAddress').value || '';
    const suburb = document.getElementById('installSuburb').value || '';
    const st = document.getElementById('installState').value || '';
    const addrLine = [addr, suburb, st, pc].filter(Boolean).join(', ');
    const date = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

    // Pricing (same logic as calculateQuote / showBOM)
    const grandTotal = bom.reduce((s, g) => s + g.items.reduce((s2, i) => s2 + i.total, 0), 0);
    const gp = state.gpMargin, gpAmt = grandTotal * (gp / 100);
    const priceBeforeComm = grandTotal + gpAmt;
    const zoneResult = lookupZone(pc);
    const zoneRating = zoneResult ? zoneResult.rating : 0;
    const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
    const pvReb = pvStcCount * state.stcPrice;
    const isDualStack = dualStackResult && currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 48;
    const isParallelPdf = parallelResult && parallelResult.isParallel;
    const batUsablePdf = isDualStack ? dualStackResult.totalUsableKwh : isParallelPdf ? parallelResult.totalUsableKwh : bat.usableKwh;
    const batReb = calcBatteryRebate(batUsablePdf, state.batteryRebatePerKwh);
    const commRate = state.salesCommission / 100;
    const baseIncGst = priceBeforeComm * GST;
    const commAmt = (baseIncGst - pvReb - batReb) * commRate / (1 - commRate * GST) / GST;
    const priceBeforeRebates = priceBeforeComm + commAmt;
    const finalPrice = priceBeforeRebates - pvReb - batReb;

    // Markup multiplier (to convert COG line items to sell price)
    const markup = priceBeforeRebates / grandTotal;

    // Helpers
    const fmtPdf = v => '$' + Math.round(v).toLocaleString('en-AU');
    const fmtPdfInc = v => '$' + Math.round(v * GST).toLocaleString('en-AU');

    // Colors
    const magenta = [224, 0, 240];
    const darkBg = [20, 20, 20];
    const midGrey = [42, 42, 42];
    const lightText = [240, 240, 240];
    const mutedText = [156, 163, 175];

    // --- PAGE BACKGROUND ---
    const drawPageBg = () => {
        doc.setFillColor(...darkBg);
        doc.rect(0, 0, pageW, pageH, 'F');
    };
    drawPageBg();

    // --- HEADER ---
    doc.setFontSize(22);
    doc.setTextColor(...magenta);
    doc.setFont('helvetica', 'bold');
    doc.text('BLACK DIAMOND SOLAR', margin, y + 7);
    doc.setFontSize(9);
    doc.setTextColor(...mutedText);
    doc.setFont('helvetica', 'normal');
    doc.text('blackdiamondsolar.co', margin, y + 13);

    // Date & quote ref (right side)
    doc.setFontSize(10);
    doc.setTextColor(...lightText);
    doc.text(date, pageW - margin, y + 7, { align: 'right' });
    doc.setFontSize(8);
    doc.setTextColor(...mutedText);
    const quoteRef = 'BDS-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    doc.text('Ref: ' + quoteRef, pageW - margin, y + 12, { align: 'right' });

    y += 20;

    // Magenta divider
    doc.setDrawColor(...magenta);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 8;

    // --- CUSTOMER DETAILS ---
    doc.setFontSize(11);
    doc.setTextColor(...lightText);
    doc.setFont('helvetica', 'bold');
    doc.text(name, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...mutedText);
    if (addrLine) { y += 5; doc.text(addrLine, margin, y); }
    if (phone) { y += 4.5; doc.text(phone, margin, y); }
    if (email) { y += 4.5; doc.text(email, margin, y); }
    y += 8;

    // --- SYSTEM SUMMARY BOX ---
    const boxH = 20;
    doc.setFillColor(26, 26, 46);
    doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'F');
    doc.setDrawColor(...magenta);
    doc.setLineWidth(0.3);
    doc.roundedRect(margin, y, contentW, boxH, 2, 2, 'S');

    const totalKwh = isDualStack ? dualStackResult.totalKwh : isParallelPdf ? parallelResult.totalKwh : bat.totalKwh;
    const totalUsableKwh = isDualStack ? dualStackResult.totalUsableKwh : isParallelPdf ? parallelResult.totalUsableKwh : bat.usableKwh;
    const invSku = isDualStack ? (dualStackResult.stack1.ec.sku + ' + ' + dualStackResult.stack2.ec.sku) : state.invSku;

    const summaryItems = [
        { label: 'System Size', value: state.sysKw.toFixed(2) + ' kW' },
        { label: 'Panels', value: state.panelCount + ' x ' + state.panelWattage + 'W' },
        { label: 'Battery', value: totalKwh > 0 ? fmtKwh(totalKwh) + ' kWh' : 'None' },
        { label: invLabel, value: invSku }
    ];
    const colW = contentW / summaryItems.length;
    summaryItems.forEach((item, i) => {
        const cx = margin + colW * i + colW / 2;
        doc.setFontSize(7);
        doc.setTextColor(...mutedText);
        doc.text(item.label, cx, y + 7, { align: 'center' });
        doc.setFontSize(9);
        doc.setTextColor(...lightText);
        doc.setFont('helvetica', 'bold');
        // Truncate long inverter names
        let val = item.value;
        if (val.length > 28) val = val.substring(0, 26) + '...';
        doc.text(val, cx, y + 13, { align: 'center' });
        doc.setFont('helvetica', 'normal');
    });
    y += boxH + 8;

    // --- PRICING TABLE ---
    // Build customer-facing rows from BOM groups
    // Each BOM group becomes a section; items show desc + qty + sell price (inc GST)
    const tableRows = [];
    bom.forEach(group => {
        // Group header row
        tableRows.push({ isGroupHeader: true, category: group.category });
        group.items.forEach(item => {
            // Strip supplier codes and "Stack 1:" / "Stack 2:" prefixes kept as-is for clarity
            let desc = item.desc;
            // Remove (Labour) and (Custom) sku labels
            const sellUnit = item.unit * markup * GST;
            const sellTotal = item.total * markup * GST;
            tableRows.push({
                desc: desc,
                qty: item.qty,
                unit: fmtPdf(Math.round(sellUnit)),
                total: fmtPdf(Math.round(sellTotal))
            });
        });
    });

    // Use autoTable
    doc.autoTable({
        startY: y,
        margin: { left: margin, right: margin },
        theme: 'plain',
        styles: {
            fillColor: darkBg,
            textColor: [209, 213, 219],
            fontSize: 8,
            cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
            lineWidth: 0,
            font: 'helvetica'
        },
        headStyles: {
            fillColor: [30, 30, 30],
            textColor: mutedText,
            fontSize: 7,
            fontStyle: 'bold',
            cellPadding: { top: 3, bottom: 3, left: 4, right: 4 }
        },
        head: [['Description', 'Qty', 'Unit (inc GST)', 'Total (inc GST)']],
        columnStyles: {
            0: { cellWidth: contentW - 60 },
            1: { cellWidth: 14, halign: 'center' },
            2: { cellWidth: 23, halign: 'right' },
            3: { cellWidth: 23, halign: 'right' }
        },
        body: tableRows.map(row => {
            if (row.isGroupHeader) {
                return [{ content: row.category, colSpan: 4, styles: { fontStyle: 'bold', textColor: magenta, fontSize: 8, fillColor: [20, 20, 30], cellPadding: { top: 4, bottom: 2, left: 4, right: 4 } } }];
            }
            return [row.desc, row.qty, row.unit, row.total];
        }),
        didDrawPage: (data) => {
            // Redraw background on new pages
            if (data.pageNumber > 1) {
                // Background already drawn via willDrawPage
            }
        },
        willDrawPage: () => {
            drawPageBg();
        }
    });

    y = doc.lastAutoTable.finalY + 6;

    // --- Check if we need a new page for totals ---
    if (y + 55 > pageH - margin) {
        doc.addPage();
        drawPageBg();
        y = margin;
    }

    // --- TOTALS SECTION ---
    const totalsX = pageW - margin - 70;
    const totalsW = 70;
    const labelX = totalsX;
    const valueX = pageW - margin;

    const drawTotalRow = (label, value, opts = {}) => {
        if (opts.divider) {
            doc.setDrawColor(...(opts.dividerColor || midGrey));
            doc.setLineWidth(opts.dividerWidth || 0.3);
            doc.line(totalsX, y - 1, pageW - margin, y - 1);
            y += 1;
        }
        doc.setFontSize(opts.fontSize || 9);
        doc.setTextColor(...(opts.labelColor || mutedText));
        doc.setFont('helvetica', opts.fontStyle || 'normal');
        doc.text(label, labelX, y);
        doc.setTextColor(...(opts.valueColor || lightText));
        doc.text(value, valueX, y, { align: 'right' });
        y += opts.spacing || 5;
    };

    drawTotalRow('Price Before Rebates', fmtPdfInc(priceBeforeRebates), { divider: true });
    if (pvReb > 0) drawTotalRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtPdf(pvReb), { valueColor: [52, 211, 153] });
    if (batReb > 0) drawTotalRow('Battery STC Rebate', '-' + fmtPdf(batReb), { valueColor: [52, 211, 153] });
    var pdfDiscount = parseFloat(document.getElementById('discountAmount')?.value) || 0;
    if (pdfDiscount > 0) drawTotalRow('Discount', '-$' + Math.round(pdfDiscount).toLocaleString('en-AU'), { valueColor: [52, 211, 153] });

    y += 2;
    var customerPrice = '$' + Math.round(priceBeforeRebates * GST - pvReb - batReb - pdfDiscount).toLocaleString('en-AU');
    drawTotalRow('Customer Price (inc GST)', customerPrice, {
        divider: true, dividerColor: magenta, dividerWidth: 0.8,
        fontSize: 12, fontStyle: 'bold', labelColor: magenta, valueColor: magenta, spacing: 8
    });

    // --- FOOTER SECTION ---
    y += 6;
    if (y + 30 > pageH - margin) {
        doc.addPage();
        drawPageBg();
        y = margin;
    }

    doc.setDrawColor(...midGrey);
    doc.setLineWidth(0.2);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFontSize(8);
    doc.setTextColor(...mutedText);
    doc.setFont('helvetica', 'bold');
    doc.text('Terms & Conditions', margin, y);
    doc.setFont('helvetica', 'normal');
    y += 4;

    const terms = [
        'This quote is valid for 14 days from the date above.',
        'All prices include GST. STC rebates are applied as a point-of-sale discount.',
        'Installation timeline subject to site inspection and council approvals.',
        'Warranty: Panels 25 years, Inverter/Battery per manufacturer terms.',
        'Payment terms: 50% deposit, balance prior to installation.'
    ];
    terms.forEach(t => {
        doc.setFontSize(7);
        doc.text('*  ' + t, margin, y);
        y += 3.5;
    });

    y += 4;
    doc.setFontSize(8);
    doc.setTextColor(...magenta);
    doc.setFont('helvetica', 'bold');
    doc.text('Black Diamond Solar', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...mutedText);
    doc.text('  |  blackdiamondsolar.co', margin + doc.getTextWidth('Black Diamond Solar'), y);

    // --- SAVE ---
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 30);
    doc.save('BDS_Quote_' + safeName + '_' + date.replace(/ /g, '-') + '.pdf');
}

// ====================
// SYSTEM SUMMARY LINE
// ====================

function updateSystemSummaryLine() {
    var el = document.getElementById('systemSummaryLine');
    if (!el) return;
    var parts = [];
    var batteryOnly = isBatteryOnly();
    var solarOnly = isSolarOnly();
    if (!batteryOnly && state.sysKw > 0) {
        parts.push(state.sysKw.toFixed(1) + 'kW Solar');
    }
    var batKwh = parseFloat(document.getElementById('desiredBatteryKwh')?.value) || 0;
    if (!solarOnly && batKwh > 0) {
        parts.push(batKwh + 'kWh Battery');
    }
    el.textContent = parts.length > 0 ? parts.join(' + ') : '';
}

// ====================
// SMOOTH COLLAPSIBLE SECTIONS
// ====================

(function initSmoothCollapsibles() {
    document.addEventListener('DOMContentLoaded', function() {
        // Override the inline onclick toggle with smooth animation
        document.querySelectorAll('.section-title.collapsible').forEach(function(title) {
            var content = title.nextElementSibling;
            if (!content || !content.classList.contains('collapsible-content')) return;
            // Remove inline onclick
            title.removeAttribute('onclick');
            // Set initial state (collapsed)
            content.style.maxHeight = '0px';
            content.style.opacity = '0';
            content.style.display = 'block';
            content.style.overflow = 'hidden';
            title.addEventListener('click', function() {
                var isOpen = title.classList.contains('open');
                title.classList.toggle('open');
                if (isOpen) {
                    // Collapse
                    content.style.maxHeight = content.scrollHeight + 'px';
                    void content.offsetHeight;
                    content.style.transition = 'max-height 0.35s ease, opacity 0.2s ease';
                    content.style.maxHeight = '0px';
                    content.style.opacity = '0';
                } else {
                    // Expand
                    content.style.transition = 'max-height 0.4s ease, opacity 0.3s ease 0.05s';
                    content.style.maxHeight = content.scrollHeight + 'px';
                    content.style.opacity = '1';
                    // After transition, allow content to resize naturally
                    var onEnd = function() {
                        if (title.classList.contains('open')) {
                            content.style.maxHeight = 'none';
                        }
                        content.removeEventListener('transitionend', onEnd);
                    };
                    content.addEventListener('transitionend', onEnd);
                }
            });
        });
        // Handle Installation Costs section which starts open
        document.querySelectorAll('.section-title.collapsible.open').forEach(function(title) {
            var content = title.nextElementSibling;
            if (content && content.classList.contains('collapsible-content')) {
                content.style.maxHeight = 'none';
                content.style.opacity = '1';
                content.style.display = 'block';
            }
        });
    });
})();

// ====================
// EMBEDDED FALLBACK CONFIG
// ====================

const DEFAULT_CONFIG = {
    "panels": [
        { "manufacturer": "Longi", "model": "X10", "wattage": 475, "price": 121.13, "colour": "Black", "width_mm": 1134, "height_mm": 1800, "supplier_code": "RAY:LONGI-X10-475" },
        { "manufacturer": "Longi", "model": "Hi-MO 7", "wattage": 450, "price": 200, "colour": "Black", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-450" },
        { "manufacturer": "Longi", "model": "Hi-MO 7", "wattage": 440, "price": 190, "colour": "Silver", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-440" }
    ],
    "manufacturers": {
        "sigenergy": {
            "label": "Sigenergy", "default_battery_type_idx": 0, "default_inverter_kw": 10, "inverter_label": "Inverter/Energy Controller", "pv_oversizing": { "single_phase": 2.0, "three_phase": 1.6 },
            "inverters": { "single_phase": [{ "sku": "SigenStor EC 5.0 SP", "kw": 5, "price": 1343, "max_pv_kw": 10, "supplier_code": "SIG:EC-5.0-SP" },{ "sku": "SigenStor EC 6.0 SP", "kw": 6, "price": 1452, "max_pv_kw": 12, "supplier_code": "SIG:EC-6.0-SP" },{ "sku": "SigenStor EC 8.0 SP", "kw": 8, "price": 2482, "max_pv_kw": 16, "supplier_code": "SIG:EC-8.0-SP" },{ "sku": "SigenStor EC 10.0 SP", "kw": 10, "price": 2675, "max_pv_kw": 20, "supplier_code": "SIG:EC-10.0-SP" },{ "sku": "SigenStor EC 12.0 SP", "kw": 12, "price": 2869, "max_pv_kw": 24, "supplier_code": "SIG:EC-12.0-SP" }], "three_phase": [{ "sku": "SigenStor EC 5.0 TP", "kw": 5, "price": 2300, "max_pv_kw": 8, "supplier_code": "SIG:EC-5.0-TP" },{ "sku": "SigenStor EC 10.0 TP", "kw": 10, "price": 2663, "max_pv_kw": 16, "supplier_code": "SIG:EC-10.0-TP" },{ "sku": "SigenStor EC 15.0 TP", "kw": 15, "price": 3511, "max_pv_kw": 24, "supplier_code": "SIG:EC-15.0-TP" },{ "sku": "SigenStor EC 20.0 TP", "kw": 20, "price": 4007, "max_pv_kw": 32, "supplier_code": "SIG:EC-20.0-TP" },{ "sku": "SigenStor EC 25.0 TP", "kw": 25, "price": 4600, "max_pv_kw": 40, "supplier_code": "SIG:EC-25.0-TP" },{ "sku": "SigenStor EC 30.0 TP", "kw": 30, "price": 5060, "max_pv_kw": 48, "supplier_code": "SIG:EC-30.0-TP" }] },
            "battery_types": [{ "id": "sig_default", "label": "SigenStor (8kWh)", "modules": [{ "kwh": 5, "usable_kwh": 5.2, "price": 2905, "label": "5 kWh", "supplier_code": "SIG:BAT-5.0", "enabled": false },{ "kwh": 8, "usable_kwh": 7.8, "price": 3632, "label": "8 kWh", "supplier_code": "SIG:BAT-8.0" }], "can_mix": true, "bms_cost": 0, "bms_code": "", "series_box_cost": 0, "series_box_code": "", "series_box_threshold": 999, "rules": { "max_modules": 6, "max_kwh": 48, "min_modules_single": 0, "min_modules_three": 0, "max_modules_single": 6, "max_modules_three": 6 } }],
            "gateways": { "single_phase": [{ "sku": "Sigen Gateway Home SP AU (Pro)", "price": 695, "desc": "Pro back entry ($695)", "supplier_code": "SIG:GW-HOME-SP-PRO" },{ "sku": "Sigen Gateway Home SP", "price": 645, "desc": "Standard Single Phase ($645)", "supplier_code": "SIG:GW-HOME-SP" },{ "sku": "Sigen CUST Gateway SP-63", "price": 2200, "desc": "Custom 63A up to 24kW ($2,200)", "supplier_code": "SIG:GW-CUST-SP-63" },{ "sku": "Sigen CUST Gateway SP-63-Hybrid", "price": 3000, "desc": "Custom 63A Hybrid ($3,000)", "supplier_code": "SIG:GW-CUST-SP-63-HYB" },{ "sku": "Sigen CUST Gateway SP-125", "price": 3200, "desc": "Custom 125A up to 24kW ($3,200)", "supplier_code": "SIG:GW-CUST-SP-125" }], "three_phase": [{ "sku": "Sigen Gateway Home TP AU (Pro)", "price": 859, "desc": "Simple 2-inverter ($859)", "supplier_code": "SIG:GW-HOME-TP-PRO" },{ "sku": "Sigen Gateway Home TP", "price": 1575, "desc": "Standard Three Phase ($1,575)", "supplier_code": "SIG:GW-HOME-TP" },{ "sku": "Sigen Gateway C60 AU", "price": 1769, "desc": "C&I 60kW ($1,769)", "supplier_code": "SIG:GW-C60" }] },
            "ev_chargers": { "dc_12_5": { "price": 2277, "desc": "DC 12kW 5m", "supplier_code": "SIG:EVDC-12-5S2" } },
            "accessories": [{ "id": "power_sensor", "label": "Power Sensor", "price_single": 101, "price_three": 202, "phase_dependent": true, "default_checked": true, "supplier_code_single": "SIG:SENSOR-SP-CT100", "supplier_code_three": "SIG:SENSOR-TP-CT100" }],
            "battery_mounting": { "mount_wall": 202, "mount_wall_code": "SIG:MOUNT-WALL", "mount_ground": 202, "mount_ground_code": "SIG:MOUNT-GROUND", "show": true },
            "cec_approved": { "type": "inverter_battery_combo", "single_phase": { "EC 5.0 SP": [0,5,8,10,13,16,21,24,29,32], "EC 6.0 SP": [0,5,8,10,13,16,21,24,29,32], "EC 8.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 10.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 12.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48] }, "three_phase": { "EC 5.0 TP": [0,5,8,10,13,16], "EC 10.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 15.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 20.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 25.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 30.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48] } }
        },
        "solax": {
            "label": "SolaX", "default_battery_type_idx": 1, "default_inverter_kw": 10, "inverter_label": "Inverter/Energy Controller", "pv_oversizing": { "single_phase": 2.0, "three_phase": 2.0 },
            "inverters": { "single_phase": [{ "sku": "X1-HYBRID-5.0D", "kw": 5, "price": 1416, "max_pv_kw": 10, "solar_only": true, "supplier_code": "SOLAX:X1-HYBRID-5.0D" },{ "sku": "X1-HYBRID-6.0D", "kw": 6, "price": 1440, "max_pv_kw": 12, "solar_only": true, "supplier_code": "SOLAX:X1-HYBRID-6.0D" },{ "sku": "X1-HYBRID-7.5D", "kw": 7.5, "price": 1500, "max_pv_kw": 15, "solar_only": true, "supplier_code": "SOLAX:X1-HYBRID-7.5D" },{ "sku": "X1-VAST-5K", "kw": 5, "price": 1738, "max_pv_kw": 10, "supplier_code": "SOLAX:X1-VAST-5K" },{ "sku": "X1-VAST-8K", "kw": 8, "price": 2258, "max_pv_kw": 16, "supplier_code": "SOLAX:X1-VAST-8K" },{ "sku": "X1-VAST-10K", "kw": 10, "price": 2500, "max_pv_kw": 20, "supplier_code": "SOLAX:X1-VAST-10K" }], "three_phase": [{ "sku": "X3-HYBRID-5.0D", "kw": 5, "price": 1810, "max_pv_kw": 10, "supplier_code": "SOLAX:X3-HYB-5D" },{ "sku": "X3-HYBRID-8.0D", "kw": 8, "price": 2100, "max_pv_kw": 16, "supplier_code": "SOLAX:X3-HYB-8D" },{ "sku": "X3-HYBRID-10.0D", "kw": 10, "price": 2450, "max_pv_kw": 20, "supplier_code": "SOLAX:X3-HYB-10D" },{ "sku": "X3-HYBRID-15.0D", "kw": 15, "price": 2688, "max_pv_kw": 30, "supplier_code": "SOLAX:X3-HYB-15D" },{ "sku": "X3-ULT-15KP", "kw": 15, "price": 3655, "max_pv_kw": 30, "supplier_code": "SOLAX:X3-ULT-15KP" },{ "sku": "X3-ULT-20KP", "kw": 20, "price": 3910, "max_pv_kw": 40, "supplier_code": "SOLAX:X3-ULT-20KP" },{ "sku": "X3-ULT-25K", "kw": 25, "price": 4751, "max_pv_kw": 50, "supplier_code": "SOLAX:X3-ULT-25K" },{ "sku": "X3-ULT-30K", "kw": 30, "price": 4900, "max_pv_kw": 60, "supplier_code": "SOLAX:X3-ULT-30K" }] },
            "battery_types": [{ "id": "tp_hs36", "label": "T-BAT TP-HS36 (3.6 kWh modules)", "use_package_pricing": true, "modules": [{ "kwh": 3.6, "usable_kwh": 3.25, "price": 1140, "label": "3.6 kWh", "supplier_code": "SOLAX-BAT-TP-HS36" }], "packages": [{ "modules": 2, "kwh": 7.2, "price": 3130, "sku": "SOLAX-T-BAT-HS7.2", "includes": "2x TP-HS36 + BMS" },{ "modules": 3, "kwh": 10.8, "price": 4270, "sku": "SOLAX-T-BAT-HS10.8", "includes": "3x TP-HS36 + BMS" },{ "modules": 4, "kwh": 14.4, "price": 5410, "sku": "SOLAX-T-BAT-HS14.4", "includes": "4x TP-HS36 + BMS" },{ "modules": 5, "kwh": 18.0, "price": 6550, "sku": "SOLAX-T-BAT-HS18.0", "includes": "5x TP-HS36 + BMS" },{ "modules": 6, "kwh": 21.6, "price": 7690, "sku": "SOLAX-T-BAT-HS21.6", "includes": "6x TP-HS36 + BMS" },{ "modules": 7, "kwh": 25.2, "price": 8830, "sku": "SOLAX-T-BAT-HS25.2", "includes": "7x TP-HS36 + BMS" },{ "modules": 8, "kwh": 28.8, "price": 9970, "sku": "SOLAX-T-BAT-HS28.8", "includes": "8x TP-HS36 + BMS" },{ "modules": 9, "kwh": 32.4, "price": 11110, "sku": "SOLAX-T-BAT-HS32.4", "includes": "9x TP-HS36 + BMS + Series Box" },{ "modules": 10, "kwh": 36.0, "price": 12800, "sku": "SOLAX-T-BAT-HS36", "includes": "10x TP-HS36 + BMS + Series Box" },{ "modules": 11, "kwh": 39.6, "price": 13940, "sku": "SOLAX-T-BAT-HS39.6", "includes": "11x TP-HS36 + BMS + Series Box" },{ "modules": 12, "kwh": 43.2, "price": 15080, "sku": "SOLAX-T-BAT-HS43.2", "includes": "12x TP-HS36 + BMS + Series Box" },{ "modules": 13, "kwh": 46.8, "price": 16220, "sku": "SOLAX-T-BAT-HS46.8", "includes": "13x TP-HS36 + BMS + Series Box" }], "can_mix": false, "bms_cost": 850, "bms_code": "SOLAX-TBMS-MCS0800", "series_box_cost": 550, "series_box_code": "SOLAX-HS36-SERIES-BOX", "series_box_threshold": 9, "rules": { "max_modules": 13, "max_kwh": 46.8, "min_modules_single": 2, "min_modules_three": 3, "max_modules_single": 8, "max_modules_three": 13 } },{ "id": "tb_hs51", "label": "T-BAT TB-HS51 (5.1 kWh modules)", "use_package_pricing": false, "modules": [{ "kwh": 5.1, "usable_kwh": 5.1, "price": 1850, "label": "5.1 kWh", "supplier_code": "SOLAX-BAT-TB-HS510" }], "can_mix": false, "bms_cost": 1100, "bms_code": "SOLAX-TBMS-S51-80", "series_box_cost": 740, "series_box_code": "SOLAX-BAT-TB-HS510-SERIES-BOX", "series_box_threshold": 9, "rules": { "max_modules": 13, "max_kwh": 66.3, "min_modules_single": 2, "min_modules_three": 3, "max_modules_single": 8, "max_modules_three": 13 } }],
            "gateways": { "single_phase": [{ "sku": "SolaX EPS Box SP", "price": 250, "desc": "EPS Box - Single Phase Backup", "supplier_code": "SOLAX-EPS-1P" }], "three_phase": [{ "sku": "SolaX EPS Box TP", "price": 358, "desc": "EPS Box - Three Phase Backup", "supplier_code": "SOLAX-EPS-3P" }] },
            "ev_chargers": { "hac_4p_cable": { "price": 500, "desc": "Hyper EV 4.6kW 1P", "supplier_code": "SOLAX:X1-HAC-4P", "phase": "single_phase" }, "hac_7p_cable": { "price": 565, "desc": "Hyper EV 7kW 1P", "supplier_code": "SOLAX:X1-HAC-7P", "phase": "single_phase" }, "hac_11p_cable": { "price": 600, "desc": "Hyper EV 11kW 3P", "supplier_code": "SOLAX:X3-HAC-11P", "phase": "three_phase" }, "hac_22p_cable": { "price": 680, "desc": "Hyper EV 22kW 3P", "supplier_code": "SOLAX:X3-HAC-22P", "phase": "three_phase" } },
            "accessories": [],
            "battery_mounting": { "show": false },
            "cec_approved": { "type": "battery_system", "tp_hs36": { "min": 2, "max": 13, "usable_per_module": 3.25, "entries": [{ "modules": 2, "model": "T-BAT HS7.2", "nominal_kwh": 7.3, "usable_kwh": 6.5 },{ "modules": 3, "model": "T-BAT HS10.8", "nominal_kwh": 11.0, "usable_kwh": 9.9 },{ "modules": 4, "model": "T-BAT HS14.4", "nominal_kwh": 14.75, "usable_kwh": 13.3 },{ "modules": 5, "model": "T-BAT HS18.0", "nominal_kwh": 18.4, "usable_kwh": 16.5 },{ "modules": 6, "model": "T-BAT HS21.6", "nominal_kwh": 22.1, "usable_kwh": 19.8 },{ "modules": 7, "model": "T-BAT HS25.2", "nominal_kwh": 25.8, "usable_kwh": 23.2 },{ "modules": 8, "model": "T-BAT HS28.8", "nominal_kwh": 29.4, "usable_kwh": 26.4 },{ "modules": 9, "model": "T-BAT HS32.4", "nominal_kwh": 33.1, "usable_kwh": 29.7 },{ "modules": 10, "model": "T-BAT HS36.0", "nominal_kwh": 36.8, "usable_kwh": 33.1 },{ "modules": 11, "model": "T-BAT HS39.6", "nominal_kwh": 40.5, "usable_kwh": 36.4 },{ "modules": 12, "model": "T-BAT HS43.2", "nominal_kwh": 44.2, "usable_kwh": 39.7 },{ "modules": 13, "model": "T-BAT HS46.8", "nominal_kwh": 47.9, "usable_kwh": 43.1 }] }, "tb_hs51": { "min": 2, "max": 13, "usable_per_module": 5.1, "entries": [{ "modules": 2, "model": "T-HS10.2", "nominal_kwh": 10.2, "usable_kwh": 10.2 },{ "modules": 3, "model": "T-HS15.3", "nominal_kwh": 15.3, "usable_kwh": 15.3 },{ "modules": 4, "model": "T-HS20.4", "nominal_kwh": 20.4, "usable_kwh": 20.4 },{ "modules": 5, "model": "T-HS25.6", "nominal_kwh": 25.6, "usable_kwh": 25.6 },{ "modules": 6, "model": "T-HS30.7", "nominal_kwh": 30.7, "usable_kwh": 30.7 },{ "modules": 7, "model": "T-HS35.8", "nominal_kwh": 35.8, "usable_kwh": 35.8 },{ "modules": 8, "model": "T-HS40.9", "nominal_kwh": 40.9, "usable_kwh": 40.9 },{ "modules": 9, "model": "T-HS46.0", "nominal_kwh": 46.0, "usable_kwh": 46.0 },{ "modules": 10, "model": "T-HS51.2", "nominal_kwh": 51.2, "usable_kwh": 51.2 },{ "modules": 11, "model": "T-HS56.3", "nominal_kwh": 56.3, "usable_kwh": 56.3 },{ "modules": 12, "model": "T-HS61.4", "nominal_kwh": 61.4, "usable_kwh": 61.4 },{ "modules": 13, "model": "T-HS66.5", "nominal_kwh": 66.5, "usable_kwh": 66.5 }] } }
        }
    },
    "installation": { "install_pv_per_kw": 300, "install_battery_per_stack": 1600, "roof_types": { "metal": {"label":"Metal","surcharge":0}, "tile": {"label":"Tile","surcharge":100}, "concrete": {"label":"Concrete/Terracotta","surcharge":200}, "kliplock": {"label":"Klip Lock","surcharge":0}, "terracotta": {"label":"Terracotta","surcharge":0}, "flat": {"label":"Flat","surcharge":300} } },
    "rebates": { "stc_price": 37, "stc_deeming_period": 5, "battery_rebate_per_kwh": 311, "stc_zones": [[0,9999,3,1.382]] },
    "gp_margin": 37.5,
    "sales_commission": 8.75,
    "default_panel_count": 21,
    "default_battery_kwh": 30,
    "mounting_kits": { "kits": { "tin_2kw": {"label":"Tin Roof 2kW Pack","panels_covered":4,"price":46.50,"supplier_code":"RAY:KIT-TIN-2KW"}, "tin_1_5kw": {"label":"Tin Roof 1.5kW Pack","panels_covered":3,"price":34.90,"supplier_code":"RAY:KIT-TIN-1.5KW"}, "tile_2kw": {"label":"Tile Roof 2kW Pack","panels_covered":4,"price":93.00,"supplier_code":"RAY:KIT-TILE-2KW"}, "tile_1_5kw": {"label":"Tile Roof 1.5kW Pack","panels_covered":3,"price":69.50,"supplier_code":"RAY:KIT-TILE-1.5KW"} }, "tilt_angles": { "10_15": {"label":"10-15 deg","price":11.99,"supplier_code":"RAY:TILT-10/15"} }, "split_array_surcharge": { "parts": [{"desc":"End Clamp","qty":4,"price":1.10,"supplier_code":"RAY:END"}], "labour_surcharge": 100 }, "rails": { "portrait_per_row": 2, "landscape_per_row": 3, "price": 25.50, "length_mm": 4800, "clamp_gap_mm": 25, "splicer_price": 1.60, "supplier_code": "RAY:R-4800-BLK", "splicer_code": "RAY:R-SP" }, "landscape_extras": { "tin_attachment_price": 1.60, "tin_attachment_code": "RAY:TH-L", "tile_attachment_price": 4.90, "tile_attachment_code": "RAY:RH-1#", "attachments_per_row": 4 }, "kliplock": { "clamps_per_panel": 2, "profiles": { "kliplock_406": {"label":"Klip-Lok 406","price":0,"supplier_code":""}, "kliplock_700": {"label":"Klip-Lok 700","price":0,"supplier_code":""}, "kliplock_606": {"label":"Universal 406/700","price":0,"supplier_code":""}, "kliplock_105": {"label":"Klip-Lok 105","price":0,"supplier_code":""} }, "default_profile": "kliplock_606", "mid_clamp": {"label":"Mid Clamp 30/35mm","price":0,"supplier_code":""}, "end_clamp": {"label":"End Clamp 30/35mm","price":0,"supplier_code":""}, "earthing_clip": {"label":"Earthing Clip","price":0,"per_panel":1,"supplier_code":""}, "earthing_lug": {"label":"Earthing Lug","price":0,"per_array":2,"supplier_code":""} } }
};
