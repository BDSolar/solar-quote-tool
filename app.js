// ====================
// Black Diamond Solar - Quote Builder
// Multi-Manufacturer Edition
// ====================

let CONFIG = {};
let customAddonCount = 0, manualBatteryMode = false, userChangedInverter = false;
let batteryQtys = {};
let currentManufacturer = 'sigenergy';
let currentBatteryTypeIdx = 0;
let selectedAccessories = [];
let selectedAddons = [];
let currentQuoteId = null;
let dualStackResult = null; // holds dual-stack optimizer output when active
let dualStackManual = null; // { stack1Kwh, stack2Kwh } when user manually adjusts stacks
let dualStackEcOverride = null; // { stack1Sku, stack2Sku } when user manually picks ECs

// ====================
// FIREBASE INIT
// ====================

const firebaseConfig = {
    apiKey: "AIzaSyASi1ahdUdwJhtmJLHevTvmHKu-P__mTyE",
    authDomain: "bds-quotes.firebaseapp.com",
    projectId: "bds-quotes",
    storageBucket: "bds-quotes.firebasestorage.app",
    messagingSenderId: "719766770849",
    appId: "1:719766770849:web:dcc683dc22662d2da84ce0"
};

let db = null;
try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    console.log('[OK] Firebase connected');
} catch (err) {
    console.warn('[!] Firebase init failed:', err.message);
}

// ====================
// GLOBAL UTILITIES
// ====================

const GST = 1.1;
const fmtIncGst = v => '$' + Math.round(v * GST).toLocaleString('en-AU');
const fmtExGst = v => '$' + Math.round(v).toLocaleString('en-AU');
const fmtExGstDecimal = v => '$' + v.toFixed(2);

function esc(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// ====================
// MANUFACTURER HELPERS
// ====================

function getMfg() { return CONFIG.manufacturers?.[currentManufacturer] || {}; }
function getBatteryType() { const m = getMfg(); return m.battery_types?.[currentBatteryTypeIdx] || m.battery_types?.[0] || {}; }
function getBatteryModules() { return (getBatteryType().modules || []).filter(m => m.enabled !== false); }
function getInverters() { return getMfg().inverters?.[state.phase] || []; }
function getInverterLabel() { return getMfg().inverter_label || 'Inverter'; }
function getPvOversizing() { return (getMfg().pv_oversizing || {})[state.phase] || 2.0; }

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
    phase: 'single_phase', panelMode: 'panels', panelCount: 28, panelWattage: 450, panelCost: 200,
    panelBrand: '', panelModel: '', panelColour: '', panelWidthMm: 1134, panelHeightMm: 1800, panelSupplierCode: '',
    sysKw: 0, desiredBatteryKwh: 13, actualBatteryKwh: 0,
    invSku: '', invPrice: 0, invKw: 0, invMaxPv: 0, invSupplierCode: '',
    gpMargin: 30, salesCommission: 7, stcPrice: 40, deemingPeriod: 5, batteryRebatePerKwh: 311,
    installPvPerKw: 300, installBatPerStack: 1600,
    roofType: 'metal', orientation: 'portrait', numRows: 1, numArrays: 1, tiltAngle: '10_15', mountingType: 'ground'
};

function syncStateFromDOM() {
    state.phase = document.getElementById('phaseType').value;
    state.panelMode = 'panels';
    state.roofType = document.getElementById('roofType').value;
    state.orientation = document.getElementById('panelOrientation').value;
    state.numRows = parseInt(document.getElementById('numRows').value) || 1;
    state.numArrays = parseInt(document.getElementById('numArrays').value) || 1;
    state.tiltAngle = document.getElementById('tiltAngle').value;
    state.mountingType = document.getElementById('mountingType').value;
    state.gpMargin = parseFloat(document.getElementById('gpMargin').value) || 0;
    state.salesCommission = parseFloat(document.getElementById('salesCommission').value) || 0;
    state.stcPrice = parseFloat(document.getElementById('stcPrice').value) || 0;
    state.deemingPeriod = parseFloat(document.getElementById('stcDeemingPeriod').value) || 0;
    state.batteryRebatePerKwh = parseFloat(document.getElementById('batteryRebatePerKwh').value) || 0;
    state.installPvPerKw = parseFloat(document.getElementById('installPerKwPv').value) || 0;
    state.installBatPerStack = parseFloat(document.getElementById('installPerStack').value) || 0;
    state.desiredBatteryKwh = Math.min(parseFloat(document.getElementById('desiredBatteryKwh').value) || 0, 96);
    const panelSel = document.getElementById('panelSelect');
    const panelOpt = panelSel.options[panelSel.selectedIndex];
    if (panelOpt) {
        state.panelWattage = parseFloat(panelOpt.dataset.wattage) || 450;
        state.panelCost = parseFloat(panelOpt.dataset.price) || 200;
        state.panelBrand = panelOpt.dataset.brand || '';
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
// SHARED HELPERS
// ====================

function getBatterySummary() {
    const bt = getBatteryType();
    const modules = getBatteryModules();
    let totalKwh = 0, totalModules = 0, usableKwh = 0, equipmentCost = 0;
    if (bt.use_package_pricing && bt.packages && modules.length === 1) {
        const mod = modules[0];
        const qty = batteryQtys[mod.kwh] || 0;
        totalModules = qty; totalKwh = qty * mod.kwh; usableKwh = qty * (mod.usable_kwh || mod.kwh);
        const pkg = bt.packages.find(p => p.modules === qty);
        if (pkg) { equipmentCost = pkg.price; }
        else if (qty > 0) { equipmentCost = qty * mod.price + (bt.bms_cost || 0); if (qty >= (bt.series_box_threshold || 999)) equipmentCost += (bt.series_box_cost || 0); }
    } else {
        modules.forEach(bat => {
            const q = batteryQtys[bat.kwh] || 0;
            totalKwh += q * bat.kwh; totalModules += q; usableKwh += q * (bat.usable_kwh || bat.kwh); equipmentCost += q * bat.price;
        });
        if (totalModules > 0 && bt.bms_cost > 0) equipmentCost += bt.bms_cost;
        if (totalModules >= (bt.series_box_threshold || 999)) equipmentCost += (bt.series_box_cost || 0);
    }
    return { totalKwh, totalModules, usableKwh, equipmentCost };
}

function getMountingKitItems(panelCount, roofType, orientation, numRows, numArrays, tiltAngle, panelWidthMm, panelHeightMm) {
    const mk = CONFIG.mounting_kits;
    if (!mk || panelCount === 0) return { total: 0, items: [] };
    let items = [], total = 0;
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

document.addEventListener('DOMContentLoaded', () => { loadConfig(); });

function validateConfig(cfg) {
    if (!cfg.panels) throw new Error('Config missing: panels');
    if (!cfg.manufacturers) throw new Error('Config missing: manufacturers');
    if (!cfg.installation) throw new Error('Config missing: installation');
    if (!cfg.rebates) throw new Error('Config missing: rebates');
    return true;
}

async function loadConfig() {
    try {
        const r = await fetch('config.json?v=' + Date.now());
        if (!r.ok) throw new Error('HTTP ' + r.status);
        CONFIG = await r.json();
        validateConfig(CONFIG);
        console.log('[OK] Config loaded from config.json');
    } catch (err) {
        console.warn('[!] Could not load config.json (' + err.message + '), using embedded fallback');
        CONFIG = DEFAULT_CONFIG;
    }
    currentManufacturer = 'sigenergy'; currentBatteryTypeIdx = 0;
    resetBatteryQtys();
    document.getElementById('installPerKwPv').value = CONFIG.installation?.install_pv_per_kw ?? 300;
    document.getElementById('installPerStack').value = CONFIG.installation?.install_battery_per_stack ?? 1600;
    document.getElementById('stcPrice').value = CONFIG.rebates?.stc_price ?? 40;
    document.getElementById('stcDeemingPeriod').value = CONFIG.rebates?.stc_deeming_period ?? 5;
    document.getElementById('batteryRebatePerKwh').value = CONFIG.rebates?.battery_rebate_per_kwh ?? 311;
    document.getElementById('gpMargin').value = CONFIG.gp_margin ?? 30;
    populateManufacturers(); populatePanels(); populateBatteryTypes(); buildBatteryUI(); populateInverters(); populateGateways(); populateEvChargers(); buildAccessoriesUI(); buildAddonsUI(); updateBatteryMountVisibility(); bindEvents(); updateRoofInfo(); updateMountingKitInfo(); updateZoneDisplay(); updateHeaderSubtitle(); updateInverterSectionLabel(); calculateQuote();
}

function resetBatteryQtys() { batteryQtys = {}; getBatteryModules().forEach(b => { batteryQtys[b.kwh] = 0; }); }

// ====================
// MANUFACTURER SWITCHING
// ====================

function populateManufacturers() {
    const sel = document.getElementById('manufacturerSelect'); sel.innerHTML = '';
    Object.entries(CONFIG.manufacturers || {}).forEach(([key, mfg]) => { const o = document.createElement('option'); o.value = key; o.textContent = mfg.label || key; sel.appendChild(o); });
    sel.value = currentManufacturer;
}

function switchManufacturer() {
    currentManufacturer = document.getElementById('manufacturerSelect').value;
    currentBatteryTypeIdx = 0; manualBatteryMode = false; userChangedInverter = false; dualStackManual = null; dualStackEcOverride = null;
    selectedAccessories = []; selectedAddons = [];
    resetBatteryQtys(); populateBatteryTypes(); buildBatteryUI(); populateInverters(); populateGateways(); populateEvChargers(); buildAccessoriesUI(); buildAddonsUI(); updateBatteryMountVisibility(); updateHeaderSubtitle(); updateInverterSectionLabel();
    document.getElementById('desiredBatteryKwh').value = 0;
    document.getElementById('desiredBatteryKwh').max = 96;
    calculateQuote();
}

function updateHeaderSubtitle() { const el = document.getElementById('headerSubtitle'); if (el) el.textContent = (getMfg().label || 'Solar') + ' Residential Quote Builder'; }
function updateInverterSectionLabel() { const el = document.getElementById('inverterSectionTitle'); if (el) el.textContent = getInverterLabel() + ' (Inverter)'; }

// ====================
// BATTERY TYPE SWITCHING
// ====================

function populateBatteryTypes() {
    const types = getMfg().battery_types || [], sel = document.getElementById('batteryTypeSelect'), group = document.getElementById('batteryTypeGroup');
    if (types.length <= 1) { group.style.display = 'none'; currentBatteryTypeIdx = 0; }
    else { group.style.display = 'block'; sel.innerHTML = ''; types.forEach((bt, idx) => { const o = document.createElement('option'); o.value = idx; o.textContent = bt.label; sel.appendChild(o); }); sel.value = currentBatteryTypeIdx; }
}

function switchBatteryType() {
    currentBatteryTypeIdx = parseInt(document.getElementById('batteryTypeSelect').value) || 0;
    manualBatteryMode = false; userChangedInverter = false; resetBatteryQtys(); buildBatteryUI();
    document.getElementById('desiredBatteryKwh').value = 0;
    document.getElementById('desiredBatteryKwh').max = 96;
    calculateQuote();
}

// ====================
// BATTERY UI
// ====================

function buildBatteryUI() {
    const container = document.getElementById('batteryAdjusterRows'); container.innerHTML = '';
    const rules = getBatteryRules(), bt = getBatteryType(), modules = getBatteryModules();
    document.getElementById('maxModulesLabel').textContent = rules.max_modules;
    document.getElementById('maxKwhLabel').textContent = rules.max_kwh;
    document.getElementById('maxPhaseLabel').textContent = state.phase === 'single_phase' ? 'single' : 'three';
    const minInfo = document.getElementById('minModulesInfo');
    if (minInfo) { if (rules.min_modules > 0) { minInfo.textContent = 'Min ' + rules.min_modules + ' modules'; minInfo.style.display = 'inline'; } else { minInfo.style.display = 'none'; } }
    const sorted = [...modules].sort((a, b) => b.kwh - a.kwh);
    sorted.forEach(bat => {
        const row = document.createElement('div'); row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
        const priceLabel = bt.use_package_pricing ? bat.label : bat.label + ' ($' + bat.price.toLocaleString() + ' ea)';
        const kwhKey = bat.kwh.toString().replace('.','_');
        row.innerHTML = '<span>' + priceLabel + '</span><div style="display:flex;align-items:center;gap:8px;"><button class="battery-adj-btn" onclick="adjustBattery(' + bat.kwh + ',-1)">-</button><span id="qty_' + kwhKey + 'kwh" style="font-weight:700;min-width:24px;text-align:center;">0</span><button class="battery-adj-btn" onclick="adjustBattery(' + bat.kwh + ',1)">+</button></div>';
        container.appendChild(row);
    });
}

// ====================
// ACCESSORIES UI
// ====================

function buildAccessoriesUI() {
    const accs = getMfg().accessories || [], container = document.getElementById('accessoriesContainer'); container.innerHTML = '';
    // Build dropdown
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    const sel = document.createElement('select'); sel.id = 'accessoryDropdown'; sel.style.flex = '1';
    sel.innerHTML = '<option value="">-- Select accessory --</option>';
    accs.forEach((acc, idx) => {
        const price = acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price;
        const o = document.createElement('option'); o.value = idx; o.textContent = acc.label + ' ($' + price + ')'; sel.appendChild(o);
    });
    const btn = document.createElement('button'); btn.className = 'add-custom-btn'; btn.style.marginTop = '0'; btn.textContent = '+ Add';
    btn.addEventListener('click', () => {
        const idx = parseInt(sel.value); if (isNaN(idx)) return;
        const acc = accs[idx];
        if (selectedAccessories.find(a => a.id === acc.id)) return; // prevent duplicates
        selectedAccessories.push({ ...acc });
        renderSelectedAccessories();
        sel.value = '';
        calculateQuote();
    });
    row.appendChild(sel); row.appendChild(btn); container.appendChild(row);
    // List container
    const list = document.createElement('div'); list.id = 'accessoryList'; container.appendChild(list);
    // Auto-add defaults on first build (only if selectedAccessories is empty after manufacturer switch)
    if (selectedAccessories.length === 0) {
        accs.filter(a => a.default_checked).forEach(a => selectedAccessories.push({ ...a }));
    }
    renderSelectedAccessories();
    const evSec = document.getElementById('evChargerSection');
    if (evSec) { const hasEv = getMfg().ev_chargers && Object.keys(getMfg().ev_chargers).length > 0; evSec.style.display = hasEv ? 'block' : 'none'; }
}

function renderSelectedAccessories() {
    const list = document.getElementById('accessoryList'); if (!list) return; list.innerHTML = '';
    selectedAccessories.forEach((acc, i) => {
        const price = acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price;
        const div = document.createElement('div'); div.className = 'addon-item';
        div.innerHTML = '<label style="flex:1;cursor:default;font-size:13px;color:#d1d5db;">' + esc(acc.label) + '</label><span class="addon-price">$' + price + '</span><button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;margin-left:8px;padding:0 4px;" title="Remove">&times;</button>';
        div.querySelector('button').addEventListener('click', () => { selectedAccessories.splice(i, 1); renderSelectedAccessories(); calculateQuote(); });
        list.appendChild(div);
    });
}

function updateAccessoryPrices() { renderSelectedAccessories(); buildAccessoriesUI(); }

function getAccessoryCost() { let t = 0; selectedAccessories.forEach(acc => { t += acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price; }); return t; }

function getAccessoryBomItems() {
    let items = [];
    selectedAccessories.forEach(acc => {
        const price = acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price;
        const code = acc.phase_dependent ? (state.phase === 'single_phase' ? (acc.supplier_code_single || '') : (acc.supplier_code_three || '')) : (acc.supplier_code || '');
        items.push({ desc: acc.label, sku: '', qty: 1, unit: price, total: price, supplier_code: code });
    });
    return items;
}

function updateBatteryMountVisibility() { const el = document.getElementById('batteryMountGroup'); if (el) el.style.display = (getMfg().battery_mounting?.show !== false) ? 'grid' : 'none'; }

function getAddonOptions() {
    const opts = [];
    const hwt = CONFIG.addons?.hot_water_timer ?? 350;
    opts.push({ id: 'hot_water_timer', label: 'Hot Water Timer', price: hwt, supplier_code: CONFIG.addons?.hot_water_timer_code || 'BDS:HWT-001' });
    const mbp = CONFIG.addons?.meter_board_partial ?? 800;
    const mbf = CONFIG.addons?.meter_board_full ?? 1200;
    const mbr = CONFIG.addons?.meter_board_relocation ?? 1800;
    opts.push({ id: 'meter_board_partial', label: 'Meter Board - Partial', price: mbp, supplier_code: CONFIG.addons?.meter_board_partial_code || 'BDS:MB-PART' });
    opts.push({ id: 'meter_board_full', label: 'Meter Board - Full', price: mbf, supplier_code: CONFIG.addons?.meter_board_full_code || 'BDS:MB-FULL' });
    opts.push({ id: 'meter_board_relocation', label: 'Meter Board - Full + Relocation', price: mbr, supplier_code: CONFIG.addons?.meter_board_relocation_code || 'BDS:MB-RELOC' });
    return opts;
}

function buildAddonsUI() {
    const container = document.getElementById('addonsContainer'); if (!container) return; container.innerHTML = '';
    const opts = getAddonOptions();
    const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    const sel = document.createElement('select'); sel.id = 'addonDropdown'; sel.style.flex = '1';
    sel.innerHTML = '<option value="">-- Select add-on --</option>';
    opts.forEach((o, idx) => { const opt = document.createElement('option'); opt.value = idx; opt.textContent = o.label + ' ($' + o.price + ')'; sel.appendChild(opt); });
    const btn = document.createElement('button'); btn.className = 'add-custom-btn'; btn.style.marginTop = '0'; btn.textContent = '+ Add';
    btn.addEventListener('click', () => {
        const idx = parseInt(sel.value); if (isNaN(idx)) return;
        const addon = opts[idx];
        if (selectedAddons.find(a => a.id === addon.id)) return;
        // Meter board tiers are mutually exclusive
        if (addon.id.startsWith('meter_board_')) {
            selectedAddons = selectedAddons.filter(a => !a.id.startsWith('meter_board_'));
        }
        selectedAddons.push({ ...addon });
        renderSelectedAddons();
        sel.value = '';
        calculateQuote();
    });
    row.appendChild(sel); row.appendChild(btn); container.appendChild(row);
    const list = document.createElement('div'); list.id = 'addonList'; container.appendChild(list);
    renderSelectedAddons();
}

function renderSelectedAddons() {
    const list = document.getElementById('addonList'); if (!list) return; list.innerHTML = '';
    selectedAddons.forEach((addon, i) => {
        const div = document.createElement('div'); div.className = 'addon-item';
        div.innerHTML = '<label style="flex:1;cursor:default;font-size:13px;color:#d1d5db;">' + esc(addon.label) + '</label><span class="addon-price">$' + addon.price + '</span><button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;margin-left:8px;padding:0 4px;" title="Remove">&times;</button>';
        div.querySelector('button').addEventListener('click', () => { selectedAddons.splice(i, 1); renderSelectedAddons(); calculateQuote(); });
        list.appendChild(div);
    });
}

// ====================
// ZONE LOOKUP
// ====================

function lookupZone(postcode) { const pc = parseInt(postcode); if (isNaN(pc) || pc < 0 || pc > 9999) return null; for (const z of (CONFIG.rebates?.stc_zones || [])) { if (pc >= z[0] && pc <= z[1]) return { zone: z[2], rating: z[3] }; } return null; }
function updateZoneDisplay() { const pc = document.getElementById('installPostcode').value, info = document.getElementById('stcZoneInfo'), result = lookupZone(pc); if (!pc) { info.textContent = 'Enter postcode'; info.style.color = '#6b7280'; return; } if (!result) { info.textContent = 'Invalid postcode'; info.style.color = '#ef4444'; return; } info.textContent = 'Zone ' + result.zone + ' -  Rating ' + result.rating; info.style.color = '#34d399'; }

// ====================
// EVENT BINDING
// ====================

function bindEvents() {
    const dedicatedIds = ['inverterSelect','phaseType','desiredBatteryKwh','manufacturerSelect','batteryTypeSelect','roofType','panelOrientation','numRows','numArrays','tiltAngle','addGateway','addEvCharger','installPostcode'];
    document.querySelectorAll('input, select').forEach(el => { if (!dedicatedIds.includes(el.id)) { el.addEventListener('input', calculateQuote); el.addEventListener('change', calculateQuote); } });
    document.getElementById('installPostcode').addEventListener('input', function() { this.value = this.value.replace(/\D/g, '').slice(0, 4); updateZoneDisplay(); calculateQuote(); });
    document.getElementById('manufacturerSelect').addEventListener('change', switchManufacturer);
    document.getElementById('batteryTypeSelect').addEventListener('change', switchBatteryType);
    document.getElementById('phaseType').addEventListener('change', () => { syncStateFromDOM(); userChangedInverter = false; dualStackManual = null; dualStackEcOverride = null; populateInverters(); populateGateways(); updateAccessoryPrices(); calculateQuote(); });
    document.getElementById('panelSelect').addEventListener('change', calculateQuote);
    document.getElementById('desiredBatteryKwh').addEventListener('input', () => { const el = document.getElementById('desiredBatteryKwh'); if (parseFloat(el.value) > 96) el.value = 96; manualBatteryMode = false; userChangedInverter = false; dualStackManual = null; dualStackEcOverride = null; calculateQuote(); });
    document.getElementById('inverterSelect').addEventListener('change', () => { userChangedInverter = true; calculateQuote(); });
    document.getElementById('roofType').addEventListener('change', updateRoofInfo);
    document.getElementById('panelOrientation').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numRows').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numArrays').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('tiltAngle').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('addGateway').addEventListener('change', () => { document.getElementById('gatewayOptions').style.display = document.getElementById('addGateway').checked ? 'block' : 'none'; calculateQuote(); });
    document.getElementById('addEvCharger').addEventListener('change', () => { document.getElementById('evChargerOptions').style.display = document.getElementById('addEvCharger').checked ? 'block' : 'none'; calculateQuote(); });
    document.querySelectorAll('input[type="number"]').forEach(el => {
        el.addEventListener('click', function(e) { const rect = this.getBoundingClientRect(); if (e.clientX > rect.right - 30) { const mid = rect.top + rect.height / 2; if (e.clientY < mid) this.stepUp(); else this.stepDown(); this.dispatchEvent(new Event('input', { bubbles: true })); } });
        el.addEventListener('mousemove', function(e) { const rect = this.getBoundingClientRect(); this.style.cursor = (e.clientX > rect.right - 30) ? 'pointer' : 'text'; });
    });
}

// ====================
// POPULATE DROPDOWNS
// ====================

function populatePanels() {
    const sel = document.getElementById('panelSelect'); sel.innerHTML = '';
    CONFIG.panels.forEach((p, idx) => {
        const o = document.createElement('option'); o.value = idx;
        o.textContent = p.brand + ' ' + p.model + ' ' + p.wattage + 'W ' + p.colour + ' ($' + p.price + ')';
        o.dataset.wattage = p.wattage; o.dataset.price = p.price; o.dataset.brand = p.brand; o.dataset.model = p.model;
        o.dataset.colour = p.colour; o.dataset.widthMm = p.width_mm || 1134; o.dataset.heightMm = p.height_mm || 1800; o.dataset.supplierCode = p.supplier_code || '';
        sel.appendChild(o);
    });
}

function populateInverters() {
    const sel = document.getElementById('inverterSelect'); sel.innerHTML = '';
    getInverters().forEach(m => {
        const o = document.createElement('option'); o.value = m.sku;
        o.textContent = m.sku + ' -  ' + m.kw + 'kW ($' + m.price.toLocaleString() + ') -  Max PV: ' + m.max_pv_kw + 'kW';
        o.dataset.kw = m.kw; o.dataset.price = m.price; o.dataset.maxPv = m.max_pv_kw; o.dataset.supplierCode = m.supplier_code || '';
        sel.appendChild(o);
    });
    updateInverterSectionLabel();
}

function populateGateways() {
    const gateways = getMfg().gateways?.[state.phase] || [], sel = document.getElementById('gatewaySelect'); sel.innerHTML = '';
    gateways.forEach(m => { const o = document.createElement('option'); o.value = m.sku; o.textContent = m.desc; o.dataset.price = m.price; o.dataset.supplierCode = m.supplier_code || ''; sel.appendChild(o); });
    const lbl = document.getElementById('gatewaySectionTitle');
    if (lbl) lbl.textContent = currentManufacturer === 'sigenergy' ? 'Gateway (Backup Power)' : 'EPS Box (Backup Power)';
}

function populateEvChargers() {
    const evChargers = getMfg().ev_chargers || {}, sel = document.getElementById('evChargerType');
    sel.innerHTML = '<option value="none"> -  Select - </option>';
    const groups = { dc: [], ac_cable: [], ac_socket: [] };
    Object.entries(evChargers).forEach(([key, val]) => { if (key.startsWith('dc_')) groups.dc.push({ key, ...val }); else if (key.includes('_cable')) groups.ac_cable.push({ key, ...val }); else if (key.includes('_socket')) groups.ac_socket.push({ key, ...val }); });
    const addGroup = (label, items) => { if (!items.length) return; const grp = document.createElement('optgroup'); grp.label = label; items.forEach(item => { const o = document.createElement('option'); o.value = item.key; o.textContent = item.desc + ' ($' + item.price.toLocaleString() + ')'; grp.appendChild(o); }); sel.appendChild(grp); };
    addGroup('DC (connects to ' + getInverterLabel() + ')', groups.dc);
    addGroup('AC with Cable', groups.ac_cable);
    addGroup('AC Socket Only', groups.ac_socket);
}



// ====================
// BATTERY MANAGEMENT
// ====================

function adjustBattery(kwh, delta) {
    const newQty = Math.max(0, (batteryQtys[kwh] || 0) + delta);
    const modules = getBatteryModules(), rules = getBatteryRules();
    if (modules.length === 1) {
        if (newQty > rules.max_modules) { document.getElementById('batteryCapWarning').style.display = 'inline'; return; }
        batteryQtys[kwh] = newQty;
    } else {
        const testQtys = Object.assign({}, batteryQtys, {[kwh]: newQty});
        let totalMod = 0, totalKwh = 0;
        modules.forEach(m => { totalMod += (testQtys[m.kwh] || 0); totalKwh += (testQtys[m.kwh] || 0) * m.kwh; });
        if (totalMod > rules.max_modules || totalKwh > rules.max_kwh) { document.getElementById('batteryCapWarning').style.display = 'inline'; return; }
        batteryQtys[kwh] = newQty;
    }
    document.getElementById('batteryCapWarning').style.display = 'none';
    manualBatteryMode = true; userChangedInverter = false;
    updateBatteryUI();
    document.getElementById('desiredBatteryKwh').value = getBatterySummary().totalKwh;
    calculateQuote();
}

function updateBatteryUI() {
    const bat = getBatterySummary(), modules = getBatteryModules(), bt = getBatteryType();
    modules.forEach(b => { const el = document.getElementById('qty_' + b.kwh.toString().replace('.','_') + 'kwh'); if (el) el.textContent = batteryQtys[b.kwh] || 0; });
    document.getElementById('batteryTotalDisplay').textContent = Math.round(bat.totalKwh * 10) / 10;
    document.getElementById('batteryModuleCount').textContent = bat.totalModules;
    const sorted = [...modules].sort((a, b) => b.kwh - a.kwh);
    let parts = []; sorted.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) parts.push(q + 'x ' + b.kwh + 'kWh'); });
    let txt = parts.length ? parts.join(' + ') + ' = ' + (Math.round(bat.totalKwh * 10) / 10) + ' kWh' : 'No batteries selected';
    if (bt.use_package_pricing && bat.totalModules > 0) { const pkg = bt.packages?.find(p => p.modules === bat.totalModules); if (pkg) txt += ' <span style="color:#34d399;">(Pkg: ' + pkg.sku + ' $' + pkg.price.toLocaleString() + ')</span>'; }
    if (bat.totalModules > 0 && bt.bms_cost > 0) { txt += ' <span style="color:#d8b4fe;">+ BMS</span>'; if (bat.totalModules >= (bt.series_box_threshold || 999)) txt += ' <span style="color:#d8b4fe;">+ Series Box</span>'; }
    document.getElementById('batteryBreakdown').innerHTML = txt;
}

function optimizeBattery(desired) {
    const bt = getBatteryType(), modules = getBatteryModules(), rules = getBatteryRules();
    if (!modules.length) return { qtys: {}, total: 0, cost: 0 };
    if (desired <= 0 || desired > rules.max_kwh) { const r = {}; modules.forEach(b => r[b.kwh] = 0); return { qtys: r, total: 0, cost: 0 }; }
    const rebatePerKwh = state.batteryRebatePerKwh, gpMargin = state.gpMargin / 100;

    // Package pricing (SolaX TP-HS36)
    if (bt.use_package_pricing && bt.packages && modules.length === 1) {
        const mod = modules[0]; let bestPkg = null, bestCost = Infinity;
        bt.packages.forEach(pkg => {
            if (pkg.modules > rules.max_modules || pkg.kwh < desired) return;
            const usable = pkg.modules * (mod.usable_kwh || mod.kwh);
            const cc = (pkg.price * (1 + gpMargin)) - (usable * rebatePerKwh);
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
            const ec = q * mod.price + (bt.bms_cost || 0) + (q >= (bt.series_box_threshold || 999) ? (bt.series_box_cost || 0) : 0);
            const cc = (ec * (1 + gpMargin)) - (usable * rebatePerKwh);
            if (cc < bestCost) { bestQty = q; bestCost = cc; bestKwh = kwh; }
        }
        const r = {}; r[mod.kwh] = bestQty; return { qtys: r, total: bestKwh, cost: bestCost };
    }

    // Multi-module (Sigenergy)
    const maxMod = rules.max_modules, maxKwh = rules.max_kwh;
    const sorted = [...modules].sort((a, b) => (a.price / a.kwh) - (b.price / b.kwh));
    let bestCombo = null, bestCC = Infinity, bestTotal = Infinity;
    function cc(ec, usable) { return ec * (1 + gpMargin) - usable * rebatePerKwh; }
    function search(idx, qtys, tKwh, tUsable, tCost, tMod) {
        if (tKwh >= desired) { const c = cc(tCost, tUsable); if (c < bestCC || (c === bestCC && tKwh < bestTotal)) { bestCombo = Object.assign({}, qtys); bestCC = c; bestTotal = tKwh; } }
        if (idx >= sorted.length) return;
        const bat = sorted[idx], mq = Math.min(maxMod - tMod, Math.floor((maxKwh - tKwh) / bat.kwh) + 1);
        for (let q = 0; q <= mq; q++) {
            const nk = tKwh + q * bat.kwh, nu = tUsable + q * (bat.usable_kwh || bat.kwh), nm = tMod + q;
            if (nm > maxMod || nk > maxKwh + bat.kwh) break;
            qtys[bat.kwh] = q; search(idx + 1, qtys, nk, nu, tCost + q * bat.price, nm);
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
    const rebatePerKwh = state.batteryRebatePerKwh, gpMargin = state.gpMargin / 100;
    const mountPrice = mfg.battery_mounting?.[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 202;
    const gateways = mfg.gateways?.[phase] || [];
    const gwPrice = gateways.length ? Math.min(...gateways.map(g => g.price)) : 0;
    const gwObj = gateways.find(g => g.price === gwPrice) || gateways[0] || null;
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
        const sorted = [...modules].sort((a, b) => (a.price / a.kwh) - (b.price / b.kwh));
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
                srch(idx + 1, qtys, nk, nu, tCost + q * bat.price, nm);
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
            if (m.max_pv_kw < pvKw) continue;
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
            // Each EC must handle its panels within max_pv_kw
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
                const netCost = (equipCost * (1 + gpMargin)) - (totalUsable * rebatePerKwh);

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

// Build dual-stack result from specific stack kWh targets (for manual adjustment)
function buildDualStackFromTargets(s1kwhTarget, s2kwhTarget, ec1SkuOverride, ec2SkuOverride) {
    const mfg = getMfg(), phase = state.phase;
    const models = mfg.inverters?.[phase] || [];
    const cec = mfg.cec_approved;
    const combos = (cec?.type === 'inverter_battery_combo') ? cec[phase] : {};
    const modules = getBatteryModules();
    const mountPrice = mfg.battery_mounting?.[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 202;
    const gateways = mfg.gateways?.[phase] || [];
    const gwPrice = gateways.length ? Math.min(...gateways.map(g => g.price)) : 0;
    const gwObj = gateways.find(g => g.price === gwPrice) || gateways[0] || null;
    const labourPerStack = state.installBatPerStack;

    // All CEC-approved kWh values
    const allCecKwh = new Set();
    Object.values(combos).forEach(arr => arr.forEach(k => { if (k > 0) allCecKwh.add(k); }));
    const cecKwhList = [...allCecKwh].sort((a, b) => a - b);

    // bestStackBatteries - same as in optimizeDualStack
    function bestStackBatteries(targetKwh) {
        if (targetKwh <= 0) return null;
        const maxMod = 6, maxKwh = 48;
        const sorted = [...modules].sort((a, b) => (a.price / a.kwh) - (b.price / b.kwh));
        let best = null, bestCost = Infinity;
        function srch(idx, qtys, tKwh, tUsable, tCost, tMod) {
            if (tKwh >= targetKwh) {
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
                srch(idx + 1, qtys, nk, nu, tCost + q * bat.price, nm);
            }
            qtys[bat.kwh] = 0;
        }
        const initQ = {}; modules.forEach(b => initQ[b.kwh] = 0);
        srch(0, initQ, 0, 0, 0, 0);
        return best;
    }

    function bestEC(stackKwh, pvKw) {
        let cheapest = null;
        for (const m of models) {
            const k = getCecKey(m.sku);
            if (!combos[k] || !combos[k].includes(stackKwh)) continue;
            if (m.max_pv_kw < pvKw) continue;
            if (!cheapest || m.price < cheapest.price) cheapest = m;
        }
        return cheapest;
    }

    function findModelBySku(sku) {
        return models.find(m => m.sku === sku) || null;
    }

    const bat1 = bestStackBatteries(s1kwhTarget);
    const bat2 = bestStackBatteries(s2kwhTarget);
    if (!bat1 || !bat2) return null;

    const s1kwh = bat1.totalKwh, s2kwh = bat2.totalKwh;
    const totalModules1 = Object.values(bat1.qtys).reduce((s, v) => s + v, 0);
    const totalModules2 = Object.values(bat2.qtys).reduce((s, v) => s + v, 0);

    // Try all PV splits to find best EC combo
    const gpMargin = state.gpMargin / 100;
    const rebatePerKwh = state.batteryRebatePerKwh;
    let bestResult = null, bestNetCost = Infinity;

    for (let p1 = 0; p1 <= state.panelCount; p1++) {
        const p2 = state.panelCount - p1;
        const pv1kw = (p1 * state.panelWattage) / 1000;
        const pv2kw = (p2 * state.panelWattage) / 1000;

        // Use EC override if provided, otherwise auto-select best
        let ec1, ec2;
        if (ec1SkuOverride) {
            ec1 = findModelBySku(ec1SkuOverride);
            if (ec1) {
                const k = getCecKey(ec1.sku);
                if (!combos[k] || !combos[k].includes(s1kwh)) ec1 = null;
                else if (ec1.max_pv_kw < pv1kw) ec1 = null;
            }
        } else {
            ec1 = bestEC(s1kwh, pv1kw);
        }
        if (ec2SkuOverride) {
            ec2 = findModelBySku(ec2SkuOverride);
            if (ec2) {
                const k = getCecKey(ec2.sku);
                if (!combos[k] || !combos[k].includes(s2kwh)) ec2 = null;
                else if (ec2.max_pv_kw < pv2kw) ec2 = null;
            }
        } else {
            ec2 = bestEC(s2kwh, pv2kw);
        }

        if (!ec1 || !ec2) continue;
        const equipCost = ec1.price + ec2.price + bat1.equipCost + bat2.equipCost
            + (2 * mountPrice) + gwPrice + (2 * labourPerStack);
        const totalUsable = bat1.usableKwh + bat2.usableKwh;
        const netCost = (equipCost * (1 + gpMargin)) - (totalUsable * rebatePerKwh);
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
    return bestResult;
}

// Get smallest enabled battery module kWh
function getSmallestEnabledModuleKwh() {
    const modules = getBatteryModules();
    if (!modules.length) return 8;
    return Math.min(...modules.map(m => m.kwh));
}

// Get min CEC-approved kWh for a single stack
function getMinCecStackKwh() {
    const mfg = getMfg(), phase = state.phase;
    const cec = mfg.cec_approved;
    const combos = (cec?.type === 'inverter_battery_combo') ? cec[phase] : {};
    const allKwh = new Set();
    Object.values(combos).forEach(arr => arr.forEach(k => { if (k > 0) allKwh.add(k); }));
    return allKwh.size ? Math.min(...allKwh) : 5;
}

// Handle dual-stack manual +/- adjustment
function adjustDualStack(stackNum, direction) {
    if (!dualStackResult) return;
    const step = getSmallestEnabledModuleKwh();
    const minKwh = getMinCecStackKwh();
    const maxKwh = 48;

    const currentS1 = dualStackManual ? dualStackManual.stack1Kwh : dualStackResult.stack1.kwh;
    const currentS2 = dualStackManual ? dualStackManual.stack2Kwh : dualStackResult.stack2.kwh;

    let newS1 = currentS1, newS2 = currentS2;
    if (stackNum === 1) {
        newS1 = direction === '+' ? currentS1 + step : currentS1 - step;
    } else {
        newS2 = direction === '+' ? currentS2 + step : currentS2 - step;
    }

    // Validate
    const warnEl = document.getElementById('dualStackManualWarn');
    if (newS1 < minKwh || newS2 < minKwh) {
        if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = '[!] Minimum ' + minKwh + ' kWh per stack (smallest CEC-approved value)'; }
        return;
    }
    if (newS1 > maxKwh || newS2 > maxKwh) {
        if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = '[!] Maximum 48 kWh per stack (6 modules max)'; }
        return;
    }

    // Try to build the new config (preserve EC overrides if set)
    const ec1Over = dualStackEcOverride ? dualStackEcOverride.stack1Sku : undefined;
    const ec2Over = dualStackEcOverride ? dualStackEcOverride.stack2Sku : undefined;
    const result = buildDualStackFromTargets(newS1, newS2, ec1Over, ec2Over);
    if (!result) {
        // If failed with EC overrides, try without them
        const resultAuto = (ec1Over || ec2Over) ? buildDualStackFromTargets(newS1, newS2) : null;
        if (resultAuto) {
            dualStackEcOverride = null; // EC overrides incompatible with new battery config
            dualStackManual = { stack1Kwh: newS1, stack2Kwh: newS2 };
            calculateQuote();
            return;
        }
        if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = '[!] No valid configuration for Stack 1: ' + newS1 + ' kWh + Stack 2: ' + newS2 + ' kWh'; }
        return;
    }

    // Success - set manual override and recalculate everything
    dualStackManual = { stack1Kwh: newS1, stack2Kwh: newS2 };
    calculateQuote();
}

// Handle dual-stack EC dropdown change
function changeDualStackEc(stackNum) {
    if (!dualStackResult) return;
    const sel = document.getElementById('dualStackEc' + stackNum);
    if (!sel) return;
    const sku = sel.value;

    // Get current state
    const s1kwh = dualStackManual ? dualStackManual.stack1Kwh : dualStackResult.stack1.kwh;
    const s2kwh = dualStackManual ? dualStackManual.stack2Kwh : dualStackResult.stack2.kwh;
    const ec1Sku = stackNum === 1 ? sku : (dualStackEcOverride ? dualStackEcOverride.stack1Sku : null);
    const ec2Sku = stackNum === 2 ? sku : (dualStackEcOverride ? dualStackEcOverride.stack2Sku : null);

    const result = buildDualStackFromTargets(s1kwh, s2kwh, ec1Sku || undefined, ec2Sku || undefined);
    if (!result) {
        const warnEl = document.getElementById('dualStackManualWarn');
        if (warnEl) { warnEl.style.display = 'block'; warnEl.textContent = '[!] No valid PV split for selected Energy Controllers'; }
        return;
    }

    dualStackEcOverride = { stack1Sku: result.stack1.ec.sku, stack2Sku: result.stack2.ec.sku };
    if (dualStackManual) {
        dualStackManual = { stack1Kwh: s1kwh, stack2Kwh: s2kwh };
    }
    calculateQuote();
}

// Get valid EC options for a stack given its kWh and the other stack's PV allocation
function getValidEcsForStack(stackKwh) {
    const mfg = getMfg(), phase = state.phase;
    const models = mfg.inverters?.[phase] || [];
    const cec = mfg.cec_approved;
    const combos = (cec?.type === 'inverter_battery_combo') ? cec[phase] : {};
    const results = [];
    for (const m of models) {
        const k = getCecKey(m.sku);
        const cecValid = combos[k] && combos[k].includes(stackKwh);
        results.push({ sku: m.sku, kw: m.kw, cecKey: k, cecValid: cecValid, maxPvKw: m.max_pv_kw });
    }
    return results;
}

// Render dual-stack breakdown with EC dropdowns and +/- buttons
function renderDualStackBreakdown() {
    if (!dualStackResult) return;
    const modules = getBatteryModules();
    const s1parts = [], s2parts = [];
    modules.forEach(b => { const q = dualStackResult.stack1.batteryQtys[b.kwh] || 0; if (q > 0) s1parts.push(q + 'x ' + b.kwh + 'kWh'); });
    modules.forEach(b => { const q = dualStackResult.stack2.batteryQtys[b.kwh] || 0; if (q > 0) s2parts.push(q + 'x ' + b.kwh + 'kWh'); });

    const btnStyle = 'display:inline-block;width:28px;height:28px;line-height:26px;text-align:center;'
        + 'background:#1a1a2e;border:1px solid #e000f0;color:#e000f0;border-radius:4px;cursor:pointer;'
        + 'font-size:16px;font-weight:700;margin:0 3px;user-select:none;';
    const selStyle = 'background:#1a1a2e;color:#e0e0e0;border:1px solid #e000f0;border-radius:4px;padding:3px 6px;font-size:0.85em;cursor:pointer;';
    const isManual = dualStackManual || dualStackEcOverride;

    let html = '<span style="color:#e000f0;font-weight:600;">DUAL-STACK</span>';
    if (isManual) {
        html += ' <span style="color:#34d399;font-size:0.8em;">(manual)</span>';
    }
    html += '<div id="dualStackManualWarn" style="display:none;color:#ef4444;margin:4px 0;font-size:0.85em;"></div>';

    // Build EC dropdown options for each stack
    const ec1Options = getValidEcsForStack(dualStackResult.stack1.kwh);
    const ec2Options = getValidEcsForStack(dualStackResult.stack2.kwh);

    function buildEcSelect(id, options, currentSku, stackNum) {
        let s = '<select id="' + id + '" style="' + selStyle + '" onchange="changeDualStackEc(' + stackNum + ')">';
        for (const opt of options) {
            const selected = opt.sku === currentSku ? ' selected' : '';
            const disabled = !opt.cecValid ? ' disabled' : '';
            const style = !opt.cecValid ? ' style="color:#666;"' : '';
            s += '<option value="' + opt.sku + '"' + selected + disabled + style + '>' + opt.cecKey + ' (' + opt.kw + 'kW)' + (!opt.cecValid ? ' x' : '') + '</option>';
        }
        s += '</select>';
        return s;
    }

    // Stack 1
    html += '<div style="margin:8px 0 4px 0;padding:8px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a3e;">';
    html += '<div style="font-weight:600;color:#e0e0e0;margin-bottom:4px;">Stack 1</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
        + '<span style="color:#999;font-size:0.85em;">EC:</span> '
        + buildEcSelect('dualStackEc1', ec1Options, dualStackResult.stack1.ec.sku, 1)
        + '<span style="color:#999;font-size:0.8em;">(' + dualStackResult.stack1.panels + ' panels)</span>'
        + '</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;">'
        + '<span style="color:#ccc;font-size:0.85em;">' + s1parts.join(' + ') + ' = ' + dualStackResult.stack1.kwh + ' kWh</span>'
        + '<span style="' + btnStyle + '" onclick="adjustDualStack(1,\'-\')">-</span>'
        + '<span style="' + btnStyle + '" onclick="adjustDualStack(1,\'+\')">+</span>'
        + '</div>';
    html += '</div>';

    // Stack 2
    html += '<div style="margin:4px 0;padding:8px;background:#1a1a2e;border-radius:6px;border:1px solid #2a2a3e;">';
    html += '<div style="font-weight:600;color:#e0e0e0;margin-bottom:4px;">Stack 2</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">'
        + '<span style="color:#999;font-size:0.85em;">EC:</span> '
        + buildEcSelect('dualStackEc2', ec2Options, dualStackResult.stack2.ec.sku, 2)
        + '<span style="color:#999;font-size:0.8em;">(' + dualStackResult.stack2.panels + ' panels)</span>'
        + '</div>';
    html += '<div style="display:flex;align-items:center;gap:6px;">'
        + '<span style="color:#ccc;font-size:0.85em;">' + s2parts.join(' + ') + ' = ' + dualStackResult.stack2.kwh + ' kWh</span>'
        + '<span style="' + btnStyle + '" onclick="adjustDualStack(2,\'-\')">-</span>'
        + '<span style="' + btnStyle + '" onclick="adjustDualStack(2,\'+\')">+</span>'
        + '</div>';
    html += '</div>';

    if (isManual) {
        html += '<div style="margin-top:4px;"><span style="color:#e000f0;cursor:pointer;font-size:0.8em;text-decoration:underline;" onclick="dualStackManual=null;dualStackEcOverride=null;calculateQuote();">Reset to optimized</span></div>';
    }

    document.getElementById('batteryBreakdown').innerHTML = html;
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
        if (combos[key].includes(totalKwh)) return { ok: true, msg: '[OK] CEC approved: ' + key + ' + ' + totalKwh + 'kWh' };
        const nearest = combos[key].filter(k => k >= totalKwh).sort((a,b) => a-b)[0] || combos[key][combos[key].length - 1];
        return { ok: false, msg: '[!] ' + totalKwh + 'kWh not CEC approved with ' + key + '. Nearest: ' + nearest + 'kWh' };
    }
    if (cec.type === 'battery_system') {
        const bt = getBatteryType(), cecData = cec[bt.id];
        if (!cecData) return { ok: false, msg: 'No CEC data for ' + bt.id };
        const entry = cecData.entries?.find(e => e.modules === totalModules);
        if (entry) return { ok: true, msg: '[OK] CEC approved: ' + entry.model + ' \u2192 ' + entry.nominal_kwh + ' kWh' };
        return { ok: false, msg: '[!] ' + totalModules + ' modules not CEC approved. Valid: ' + cecData.min + '-' + cecData.max + ' modules' };
    }
    return { ok: false, msg: 'Unknown CEC type' };
}

function autoSelectInverter(sysKw, battKwh, battModules, phase) {
    const mfg = getMfg(), models = mfg.inverters?.[phase] || [], cec = mfg.cec_approved;
    if (cec?.type === 'inverter_battery_combo') {
        const combos = cec[phase];
        for (const m of models) { const k = getCecKey(m.sku); if (m.max_pv_kw >= sysKw && combos[k] && combos[k].includes(battKwh)) return m.sku; }
        for (const m of models) { const k = getCecKey(m.sku); if (combos[k] && combos[k].includes(battKwh)) return m.sku; }
        return models[models.length - 1]?.sku || '';
    }
    // SolaX: just find smallest inverter where PV fits
    for (const m of models) { if (m.max_pv_kw >= sysKw) return m.sku; }
    return models[models.length - 1]?.sku || '';
}

// ====================
// ROOF & MOUNTING
// ====================

function updateRoofInfo() { const rt = document.getElementById('roofType').value; const tg = document.getElementById('tiltAngleGroup'); if (tg) tg.style.display = rt === 'flat' ? 'block' : 'none'; updateMountingKitInfo(); calculateQuote(); }
function updateMountingKitInfo() { /* Detail only in BOM */ }

// ====================
// CUSTOM ADD-ONS
// ====================

function addCustomAddon() {
    customAddonCount++; const c = document.getElementById('customAddons'), d = document.createElement('div');
    d.className = 'custom-addon'; d.id = 'custom-' + customAddonCount;
    d.innerHTML = '<input type="text" placeholder="Item name" id="customName-' + customAddonCount + '"><input type="number" placeholder="Cost" id="customCost-' + customAddonCount + '" value="0" step="1"><button onclick="removeCustomAddon(' + customAddonCount + ')">x</button>';
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

        document.getElementById('panelKwDisplay').textContent = state.sysKw.toFixed(2) + ' kW';

        // Gateway UI: mandatory for Sigenergy with batteries
        const sigGwMandatory = currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 0;
        const gwCheckbox = document.getElementById('addGateway');
        const gwOptions = document.getElementById('gatewayOptions');
        const gwCheckLabel = gwCheckbox?.nextElementSibling;
        if (sigGwMandatory) {
            gwCheckbox.checked = true;
            gwCheckbox.disabled = true;
            if (gwCheckLabel) gwCheckLabel.textContent = 'Gateway included (required with battery)';
            gwOptions.style.display = 'block';
        } else {
            gwCheckbox.disabled = false;
            if (gwCheckLabel) gwCheckLabel.textContent = 'Add backup power protection';
            gwOptions.style.display = gwCheckbox.checked ? 'block' : 'none';
        }
        const desired = state.desiredBatteryKwh;
        let actualKwh = 0;
        const isDualStack = currentManufacturer === 'sigenergy' && desired > 48;

        if (isDualStack) {
            // Dual-stack path
            if (dualStackManual) {
                // Manual override - rebuild from user's chosen targets (with EC overrides if set)
                const ec1Over = dualStackEcOverride ? dualStackEcOverride.stack1Sku : undefined;
                const ec2Over = dualStackEcOverride ? dualStackEcOverride.stack2Sku : undefined;
                dualStackResult = buildDualStackFromTargets(dualStackManual.stack1Kwh, dualStackManual.stack2Kwh, ec1Over, ec2Over);
                // If EC override fails, try without it
                if (!dualStackResult && (ec1Over || ec2Over)) {
                    dualStackEcOverride = null;
                    dualStackResult = buildDualStackFromTargets(dualStackManual.stack1Kwh, dualStackManual.stack2Kwh);
                }
            } else if (dualStackEcOverride) {
                // EC override only (no manual battery adjustment) - use optimizer result's kWh but force ECs
                const autoResult = optimizeDualStack(desired);
                if (autoResult) {
                    dualStackResult = buildDualStackFromTargets(autoResult.stack1.kwh, autoResult.stack2.kwh, dualStackEcOverride.stack1Sku, dualStackEcOverride.stack2Sku);
                    if (!dualStackResult) { dualStackEcOverride = null; dualStackResult = autoResult; }
                } else {
                    dualStackResult = null;
                }
            } else {
                // Auto-optimize
                dualStackResult = optimizeDualStack(desired);
            }
            if (dualStackResult) {
                actualKwh = dualStackResult.totalKwh;
                // Set batteryQtys to combined for UI display
                const modules = getBatteryModules();
                batteryQtys = {};
                modules.forEach(b => {
                    batteryQtys[b.kwh] = (dualStackResult.stack1.batteryQtys[b.kwh] || 0) + (dualStackResult.stack2.batteryQtys[b.kwh] || 0);
                });
                updateBatteryUI();
                // Render breakdown with +/- buttons
                renderDualStackBreakdown();
            } else {
                actualKwh = 0;
                dualStackResult = null;
                dualStackManual = null;
                dualStackEcOverride = null;
                document.getElementById('batteryBreakdown').innerHTML = '<span style="color:#ef4444;">[!] No valid dual-stack combination found for ' + desired + ' kWh</span>';
            }
        } else {
            // Single-stack path (existing behaviour)
            dualStackResult = null;
            dualStackManual = null;
            dualStackEcOverride = null;
            if (!manualBatteryMode && desired > 0) {
                const opt = optimizeBattery(desired);
                batteryQtys = opt.qtys; actualKwh = opt.total;
                updateBatteryUI();
                if (actualKwh > desired) document.getElementById('batteryBreakdown').innerHTML += ' <span style="color:#34d399;">(+' + (Math.round((actualKwh - desired) * 10) / 10) + 'kWh, cheaper)</span>';
            } else if (manualBatteryMode) { actualKwh = getBatterySummary().totalKwh; }
        }
        state.actualBatteryKwh = actualKwh;
        document.getElementById('batteryConfigPanel').style.display = desired > 0 ? 'block' : 'none';

        // Min modules check
        const rules = getBatteryRules();
        const bat = getBatterySummary();
        const minWarn = document.getElementById('minModulesWarning');
        if (minWarn) {
            if (bat.totalModules > 0 && bat.totalModules < rules.min_modules) {
                minWarn.style.display = 'block'; minWarn.textContent = '[!] Minimum ' + rules.min_modules + ' modules required for ' + (state.phase === 'single_phase' ? 'single' : 'three') + ' phase.';
            } else { minWarn.style.display = 'none'; }
        }

        // Phase capacity warning - check if desired kWh exceeds system max
        const phaseCapWarn = document.getElementById('phaseCapWarning');
        if (phaseCapWarn) {
            const isSigen = currentManufacturer === 'sigenergy';
            if (isSigen && desired > 96) {
                phaseCapWarn.style.display = 'block';
                phaseCapWarn.textContent = '[!] ' + desired + ' kWh exceeds Sigenergy system max (96 kWh = 2 stacks x 48 kWh)';
            } else if (!isSigen && state.phase === 'single_phase' && desired > 0) {
                // Non-Sigenergy: check single-phase max (no dual-stack)
                const bt = getBatteryType();
                const spRules = bt.rules || {};
                const spMaxMod = spRules.max_modules_single || spRules.max_modules || 6;
                const modules = getBatteryModules();
                const largestMod = modules.reduce((mx, m) => Math.max(mx, m.kwh), 0);
                const spMaxKwh = spMaxMod * largestMod;
                if (desired > spMaxKwh) {
                    phaseCapWarn.style.display = 'block';
                    phaseCapWarn.textContent = '[!] ' + desired + ' kWh requires three phase with ' + bt.label + ' (single phase max: ' + spMaxKwh + ' kWh)';
                } else { phaseCapWarn.style.display = 'none'; }
            } else { phaseCapWarn.style.display = 'none'; }
        }

        if (!userChangedInverter) {
            if (isDualStack && dualStackResult) {
                // Set dropdown to stack 1 EC for display purposes
                const sel = document.getElementById('inverterSelect');
                for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === dualStackResult.stack1.ec.sku) { sel.selectedIndex = i; break; } }
                sel.disabled = true;
                syncStateFromDOM();
            } else {
                document.getElementById('inverterSelect').disabled = false;
                const rec = autoSelectInverter(state.sysKw, actualKwh, bat.totalModules, state.phase), sel = document.getElementById('inverterSelect');
                for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === rec) { sel.selectedIndex = i; break; } }
                syncStateFromDOM();
            }
        } else if (!isDualStack) {
            document.getElementById('inverterSelect').disabled = false;
        }

        const osRatio = getPvOversizing();
        document.getElementById('inverterInfo').style.display = 'block';
        if (isDualStack && dualStackResult) {
            const ec1Key = getCecKey(dualStackResult.stack1.ec.sku);
            const ec2Key = getCecKey(dualStackResult.stack2.ec.sku);
            document.getElementById('inverterInfo').innerHTML = '<span style="color:#e000f0;font-weight:600;">DUAL STACK</span><br>'
                + 'Stack 1: ' + ec1Key + ' - ' + dualStackResult.stack1.pvKw.toFixed(1) + 'kW PV (' + dualStackResult.stack1.panels + ' panels) - ' + dualStackResult.stack1.kwh + ' kWh<br>'
                + 'Stack 2: ' + ec2Key + ' - ' + dualStackResult.stack2.pvKw.toFixed(1) + 'kW PV (' + dualStackResult.stack2.panels + ' panels) - ' + dualStackResult.stack2.kwh + ' kWh';
            document.getElementById('inverterWarning').style.display = 'none';
        } else {
            document.getElementById('inverterInfo').innerHTML = 'Max PV: ' + state.invMaxPv + 'kW | ' + getInverterLabel() + ': ' + state.invKw + 'kW | Oversizing: ' + Math.round(osRatio * 100) + '%';
            if (state.sysKw > state.invMaxPv) { document.getElementById('inverterWarning').style.display = 'block'; document.getElementById('inverterWarning').innerHTML = '[!] PV (' + state.sysKw.toFixed(1) + 'kW) exceeds max (' + state.invMaxPv + 'kW). Select larger ' + getInverterLabel().toLowerCase() + '.'; }
            else { document.getElementById('inverterWarning').style.display = 'none'; }
        }

        if (isDualStack && dualStackResult) {
            // CEC check each stack independently
            const cec1 = checkCec(dualStackResult.stack1.ec.sku, dualStackResult.stack1.kwh, dualStackResult.stack1.modules, state.phase);
            const cec2 = checkCec(dualStackResult.stack2.ec.sku, dualStackResult.stack2.kwh, dualStackResult.stack2.modules, state.phase);
            const bothOk = cec1.ok && cec2.ok;
            const ec1Key = getCecKey(dualStackResult.stack1.ec.sku);
            const ec2Key = getCecKey(dualStackResult.stack2.ec.sku);
            document.getElementById('cecApproved').style.display = bothOk ? 'block' : 'none';
            document.getElementById('cecApproved').textContent = bothOk ? '[OK] CEC approved: Stack 1 (' + ec1Key + ' + ' + dualStackResult.stack1.kwh + 'kWh) & Stack 2 (' + ec2Key + ' + ' + dualStackResult.stack2.kwh + 'kWh)' : '';
            document.getElementById('cecWarning').style.display = !bothOk ? 'block' : 'none';
            if (!bothOk) {
                let msg = '[!] CEC issue: ';
                if (!cec1.ok) msg += 'Stack 1 - ' + cec1.msg + ' ';
                if (!cec2.ok) msg += 'Stack 2 - ' + cec2.msg;
                document.getElementById('cecWarning').textContent = msg;
            }
        } else {
            const cec = checkCec(state.invSku, actualKwh, bat.totalModules, state.phase);
            if (actualKwh > 0 || bat.totalModules > 0) {
                document.getElementById('cecApproved').style.display = cec.ok ? 'block' : 'none'; document.getElementById('cecApproved').textContent = cec.ok ? cec.msg : '';
                document.getElementById('cecWarning').style.display = !cec.ok ? 'block' : 'none'; document.getElementById('cecWarning').textContent = !cec.ok ? cec.msg : '';
            } else { document.getElementById('cecWarning').style.display = 'none'; document.getElementById('cecApproved').style.display = 'none'; }
        }

        // Grey out invalid inverters
        const invSel = document.getElementById('inverterSelect');
        const cecData = getMfg().cec_approved;
        for (let i = 0; i < invSel.options.length; i++) {
            const opt = invSel.options[i], sku = opt.value;
            let valid = true;
            if (cecData?.type === 'inverter_battery_combo' && actualKwh > 0) {
                const k = getCecKey(sku), combos = cecData[state.phase];
                valid = combos && combos[k] && combos[k].includes(actualKwh);
            }
            opt.disabled = !valid;
            opt.style.color = valid ? '' : '#555';
        }

        const costPanels = state.panelCount * state.panelCost;
        let costInverter, costBattery, costGateway, costMount, installBat;

        if (isDualStack && dualStackResult) {
            costInverter = dualStackResult.totalEcCost;
            costBattery = dualStackResult.totalBatteryCost;
            costGateway = dualStackResult.gwPrice; // mandatory gateway
            costMount = dualStackResult.mountCost;
            installBat = dualStackResult.labourCost;
            // If user also checked gateway and picked a more expensive one, use that instead
            if (document.getElementById('addGateway').checked) {
                const gw = document.getElementById('gatewaySelect');
                const userGwPrice = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                if (userGwPrice > costGateway) costGateway = userGwPrice;
            }
        } else {
            costInverter = state.invPrice;
            costBattery = bat.equipmentCost;
            costGateway = 0;
            if (currentManufacturer === 'sigenergy' && bat.totalModules > 0) {
                // Gateway mandatory for Sigenergy with batteries -- use cheapest or user-selected if higher
                const gateways = getMfg().gateways?.[state.phase] || [];
                const cheapest = gateways.length ? Math.min(...gateways.map(g => g.price)) : 0;
                costGateway = cheapest;
                const gw = document.getElementById('gatewaySelect');
                const userGwPrice = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
                if (userGwPrice > costGateway) costGateway = userGwPrice;
            } else if (document.getElementById('addGateway').checked) { const gw = document.getElementById('gatewaySelect'); costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0; }
            const mfgMount = getMfg().battery_mounting || {};
            costMount = (bat.totalModules > 0 && mfgMount.show !== false) ? (mfgMount[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0) : 0;
            installBat = (bat.totalModules > 0) ? state.installBatPerStack : 0;
        }

        let costAcc = getAccessoryCost();
        let costEv = 0;
        if (document.getElementById('addEvCharger').checked) { const t = document.getElementById('evChargerType').value; const evs = getMfg().ev_chargers || {}; if (t !== 'none' && evs[t]) costEv = evs[t].price; }

        const installPv = state.sysKw * state.installPvPerKw;
        const roof = CONFIG.installation?.roof_types?.[state.roofType] || { surcharge: 0 };
        const costRoofSurcharge = roof.surcharge;
        const mountingResult = getMountingKitItems(state.panelCount, state.roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
        const costRoofKit = mountingResult.total;
        let costAddons = 0;
        selectedAddons.forEach(a => { costAddons += a.price; });
        for (let i = 1; i <= customAddonCount; i++) { const ce = document.getElementById('customCost-' + i), ne = document.getElementById('customName-' + i); if (ce && ne && ne.value.trim()) costAddons += parseFloat(ce.value) || 0; }

        const totalPv = costPanels + costRoofKit + costRoofSurcharge;
        const totalBattery = costInverter + costBattery + costGateway + costMount;
        const totalInstall = installPv + installBat + costAcc + costEv + costAddons;
        const totalCog = totalPv + totalBattery + totalInstall;

        const zoneResult = lookupZone(document.getElementById('installPostcode').value);
        const zoneRating = zoneResult ? zoneResult.rating : 0;
        const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
        const pvReb = pvStcCount * state.stcPrice;
        const batReb = (isDualStack && dualStackResult) ? dualStackResult.totalUsableKwh * state.batteryRebatePerKwh : bat.usableKwh * state.batteryRebatePerKwh;
        const gpAmt = totalCog * (state.gpMargin / 100);
        const priceBeforeCommission = totalCog + gpAmt;
        const commAmt = priceBeforeCommission * GST * (state.salesCommission / 100) / GST; // 7% of inc GST value, stored ex GST
        const priceBeforeRebates = priceBeforeCommission + commAmt;
        const finalPrice = priceBeforeRebates - pvReb - batReb;

        document.getElementById('costPanels').textContent = fmtIncGst(costPanels); document.getElementById('costInverter').textContent = fmtIncGst(costInverter);
        document.getElementById('costRoofKit').textContent = fmtIncGst(costRoofKit); document.getElementById('totalPv').textContent = fmtIncGst(totalPv);
        document.getElementById('costBattery').textContent = fmtIncGst(costBattery); document.getElementById('costGateway').textContent = fmtIncGst(costGateway);
        document.getElementById('costMounting').textContent = fmtIncGst(costMount); document.getElementById('totalBattery').textContent = fmtIncGst(totalBattery);
        const extraMountEl = document.getElementById('extraMountCostInfo'); if (extraMountEl) extraMountEl.textContent = costMount > 0 ? fmtIncGst(costMount) : '$0';
        document.getElementById('costInstallPv').textContent = fmtIncGst(installPv); document.getElementById('costInstallBattery').textContent = fmtIncGst(installBat);
        document.getElementById('costRoofSurcharge').textContent = fmtIncGst(costRoofSurcharge);
        document.getElementById('costAccessories').textContent = fmtIncGst(costAcc); document.getElementById('costEvCharger').textContent = fmtIncGst(costEv);
        document.getElementById('costAddons').textContent = fmtIncGst(costAddons); document.getElementById('totalInstall').textContent = fmtIncGst(totalInstall);
        document.getElementById('totalCog').textContent = fmtIncGst(totalCog); document.getElementById('gpLabel').textContent = 'GP (' + state.gpMargin + '%)'; document.getElementById('gpAmount').textContent = fmtIncGst(gpAmt);
        document.getElementById('commLabel').textContent = 'Commission (' + state.salesCommission + '%)'; document.getElementById('commAmount').textContent = fmtIncGst(commAmt);
        document.getElementById('priceBeforeRebates').textContent = fmtIncGst(priceBeforeRebates);
        document.getElementById('pvRebateLabel').textContent = pvStcCount > 0 ? 'PV STC Rebate (' + pvStcCount + ' STCs)' : 'PV STC Rebate';
        document.getElementById('stcPvRebate').textContent = '-' + fmtIncGst(pvReb);
        document.getElementById('stcBatteryRebate').textContent = '-' + fmtIncGst(batReb);
        document.getElementById('finalPrice').textContent = fmtIncGst(finalPrice);

        // Update inverter label in summary
        const invLabel = getInverterLabel();
        document.getElementById('inverterCostLabel').textContent = invLabel;

    } catch (err) { console.error('[!] Quote calculation error:', err); }
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

    // === PV EQUIPMENT ===
    let pvItems = [];
    pvItems.push({ desc: state.panelBrand + ' ' + state.panelModel + ' ' + state.panelWattage + 'W ' + state.panelColour, sku: state.panelModel, qty: state.panelCount, unit: state.panelCost, total: state.panelCount * state.panelCost, supplier_code: state.panelSupplierCode });
    getMountingKitItems(state.panelCount, roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm).items.forEach(item => pvItems.push(item));
    if (roof.surcharge > 0) pvItems.push({ desc: roof.label + ' Roof Surcharge', sku: '', qty: 1, unit: roof.surcharge, total: roof.surcharge, supplier_code: 'BDS:ROOF-SURCHARGE' });
    bom.push({ category: 'PV Equipment & Mounting', items: pvItems });

    // === BATTERY & INVERTER ===
    let batItems = [];
    const isDualBom = dualStackResult && currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 48;

    if (isDualBom) {
        // Dual-stack BOM: 2x ECs, 2x battery groups, 2x mounts, mandatory gateway
        const ds = dualStackResult;
        const phaseLabel = state.phase === 'single_phase' ? 'Single' : 'Three';
        const ec1Key = getCecKey(ds.stack1.ec.sku), ec2Key = getCecKey(ds.stack2.ec.sku);

        // Stack 1 EC
        batItems.push({ desc: 'Stack 1: ' + ds.stack1.ec.sku + ' (' + ds.stack1.ec.kw + 'kW ' + phaseLabel + ' Phase, ' + ds.stack1.panels + ' panels)', sku: ds.stack1.ec.sku, qty: 1, unit: ds.stack1.ec.price, total: ds.stack1.ec.price, supplier_code: ds.stack1.ec.supplier_code || '' });
        // Stack 1 batteries
        modules.forEach(b => { const q = ds.stack1.batteryQtys[b.kwh] || 0; if (q > 0) batItems.push({ desc: 'Stack 1: ' + (b.label || b.kwh + 'kWh') + ' Battery', sku: '', qty: q, unit: b.price, total: q * b.price, supplier_code: b.supplier_code || '' }); });

        // Stack 2 EC
        batItems.push({ desc: 'Stack 2: ' + ds.stack2.ec.sku + ' (' + ds.stack2.ec.kw + 'kW ' + phaseLabel + ' Phase, ' + ds.stack2.panels + ' panels)', sku: ds.stack2.ec.sku, qty: 1, unit: ds.stack2.ec.price, total: ds.stack2.ec.price, supplier_code: ds.stack2.ec.supplier_code || '' });
        // Stack 2 batteries
        modules.forEach(b => { const q = ds.stack2.batteryQtys[b.kwh] || 0; if (q > 0) batItems.push({ desc: 'Stack 2: ' + (b.label || b.kwh + 'kWh') + ' Battery', sku: '', qty: q, unit: b.price, total: q * b.price, supplier_code: b.supplier_code || '' }); });

        // Gateway (mandatory for dual-stack)
        if (ds.gateway) batItems.push({ desc: 'Gateway: ' + ds.gateway.sku, sku: ds.gateway.sku, qty: 1, unit: ds.gwPrice, total: ds.gwPrice, supplier_code: ds.gateway.supplier_code || '' });

        // 2x mount kits
        const mfgMount2 = getMfg().battery_mounting || {};
        const mt = state.mountingType, mp = mfgMount2[mt === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0;
        const mc = mfgMount2[mt === 'wall' ? 'mount_wall_code' : 'mount_ground_code'] || '';
        if (mp > 0) batItems.push({ desc: (mt === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', sku: '', qty: 2, unit: mp, total: 2 * mp, supplier_code: mc });

    } else {
        // Single-stack BOM (existing logic)
        batItems.push({ desc: state.invSku + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)', sku: state.invSku, qty: 1, unit: state.invPrice, total: state.invPrice, supplier_code: state.invSupplierCode });

        if (bt.use_package_pricing && bat.totalModules > 0) {
            const pkg = bt.packages?.find(p => p.modules === bat.totalModules);
            if (pkg) { batItems.push({ desc: pkg.includes + ' (' + pkg.kwh + 'kWh)', sku: pkg.sku, qty: 1, unit: pkg.price, total: pkg.price, supplier_code: pkg.sku }); }
            else { modules.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) batItems.push({ desc: b.label + ' Battery Module', sku: '', qty: q, unit: b.price, total: q * b.price, supplier_code: b.supplier_code || '' }); }); }
        } else {
            modules.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) batItems.push({ desc: (b.label || b.kwh + 'kWh') + ' Battery Module', sku: '', qty: q, unit: b.price, total: q * b.price, supplier_code: b.supplier_code || '' }); });
            if (bat.totalModules > 0 && bt.bms_cost > 0) batItems.push({ desc: 'Battery BMS', sku: '', qty: 1, unit: bt.bms_cost, total: bt.bms_cost, supplier_code: bt.bms_code || '' });
            if (bat.totalModules >= (bt.series_box_threshold || 999)) batItems.push({ desc: 'Series Box', sku: '', qty: 1, unit: bt.series_box_cost, total: bt.series_box_cost, supplier_code: bt.series_box_code || '' });
        }

        if (currentManufacturer === 'sigenergy' && bat.totalModules > 0) {
            // Gateway mandatory for Sigenergy -- use cheapest or user-selected if higher
            const gateways = getMfg().gateways?.[state.phase] || [];
            const cheapestGw = gateways.length ? gateways.reduce((a, b) => a.price <= b.price ? a : b) : null;
            const gw = document.getElementById('gatewaySelect'), gwOpt = gw.options[gw.selectedIndex];
            const userGwPrice = parseFloat(gwOpt?.dataset.price) || 0;
            const useUser = userGwPrice > (cheapestGw?.price || 0);
            const gwDesc = useUser ? gwOpt?.textContent : cheapestGw?.desc;
            const gwSku = useUser ? (gwOpt?.value || '') : (cheapestGw?.sku || '');
            const gwPrice = useUser ? userGwPrice : (cheapestGw?.price || 0);
            const gwCode = useUser ? (gwOpt?.dataset.supplierCode || '') : (cheapestGw?.supplier_code || '');
            if (gwPrice > 0) batItems.push({ desc: 'Gateway: ' + (gwDesc || ''), sku: gwSku, qty: 1, unit: gwPrice, total: gwPrice, supplier_code: gwCode });
        } else if (document.getElementById('addGateway').checked) {
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
    }
    bom.push({ category: 'Battery & ' + invLabel, items: batItems });

    // === ACCESSORIES ===
    let accItems = getAccessoryBomItems();
    if (document.getElementById('addEvCharger').checked) {
        const t = document.getElementById('evChargerType').value; const evs = getMfg().ev_chargers || {};
        if (t !== 'none' && evs[t]) accItems.push({ desc: 'EV Charger: ' + evs[t].desc, sku: t, qty: 1, unit: evs[t].price, total: evs[t].price, supplier_code: evs[t].supplier_code || '' });
    }
    if (accItems.length > 0) bom.push({ category: 'Accessories', items: accItems });

    // === ADD-ONS ===
    let addonItems = [];
    selectedAddons.forEach(a => { addonItems.push({ desc: a.label, sku: '', qty: 1, unit: a.price, total: a.price, supplier_code: a.supplier_code || '' }); });
    for (let i = 1; i <= customAddonCount; i++) { const ne = document.getElementById('customName-' + i), ce = document.getElementById('customCost-' + i); if (ne && ce && ne.value.trim()) { const p = parseFloat(ce.value) || 0; addonItems.push({ desc: ne.value.trim(), sku: 'Custom', qty: 1, unit: p, total: p, supplier_code: 'BDS:CUSTOM' }); } }
    if (addonItems.length > 0) bom.push({ category: 'Add-ons', items: addonItems });

    // === INSTALLATION ===
    let installItems = [];
    installItems.push({ desc: 'PV Installation (' + state.sysKw.toFixed(2) + 'kW)', sku: 'Labour', qty: 1, unit: state.sysKw * state.installPvPerKw, total: state.sysKw * state.installPvPerKw, supplier_code: 'BDS:LABOUR-PV' });
    if (isDualBom) {
        installItems.push({ desc: 'Battery Installation (2 stacks)', sku: 'Labour', qty: 2, unit: state.installBatPerStack, total: 2 * state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
    } else if (bat.totalModules > 0) {
        installItems.push({ desc: 'Battery Installation', sku: 'Labour', qty: 1, unit: state.installBatPerStack, total: state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
    }
    bom.push({ category: 'Installation (Labour)', items: installItems });
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
    let custHtml = '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;"><div><strong style="color:#f0f0f0;">' + esc(name) + '</strong>';
    if (addrLine) custHtml += '<br>' + esc(addrLine);
    custHtml += '</div><div style="text-align:right;"><span style="color:#f0f0f0;">' + esc(date) + '</span>';
    if (phone) custHtml += '<br>' + esc(phone); if (email) custHtml += '<br>' + esc(email);
    custHtml += '</div></div>';
    document.getElementById('bomCustomerHeader').innerHTML = custHtml;

    let html = '', grandTotal = 0;
    bom.forEach((group, gi) => {
        const groupTotal = group.items.reduce((s, item) => s + item.total, 0); grandTotal += groupTotal;
        html += '<div style="background:#141414; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:12px; overflow:hidden;">';
        html += '<div onclick="toggleBomGroup(' + gi + ')" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; cursor:pointer; user-select:none;">';
        html += '<div style="display:flex; align-items:center; gap:10px;"><span id="bomChevron' + gi + '" style="color:#e000f0; font-size:12px; transition:transform 0.2s;">&#9654;</span>';
        html += '<span style="color:#e000f0; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:1px;">' + esc(group.category) + '</span>';
        html += '<span style="color:#6b7280; font-size:12px;">(' + group.items.length + ' item' + (group.items.length !== 1 ? 's' : '') + ')</span></div>';
        html += '<span style="color:#f0f0f0; font-weight:600;">' + fmtExGst(groupTotal) + '</span></div>';
        html += '<div id="bomGroup' + gi + '" style="display:none; border-top:1px solid #2a2a2a;"><table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<thead><tr style="color:#6b7280; text-transform:uppercase; font-size:11px; letter-spacing:0.5px;"><th style="text-align:left; padding:10px 20px; border-bottom:1px solid #222;">Description</th><th style="text-align:center; padding:10px 12px; border-bottom:1px solid #222; width:60px;">Qty</th><th style="text-align:right; padding:10px 12px; border-bottom:1px solid #222; width:100px;">Unit (ex GST)</th><th style="text-align:right; padding:10px 20px; border-bottom:1px solid #222; width:110px;">Total (ex GST)</th></tr></thead><tbody>';
        group.items.forEach((item, ii) => {
            const bg = ii % 2 === 0 ? '#1a1a1a' : '#141414';
            html += '<tr style="background:' + bg + '; color:#d1d5db;"><td style="padding:9px 20px;">' + esc(item.desc) + (item.sku && item.sku !== 'Custom' && item.sku !== 'Labour' ? ' <span style="color:#6b7280; font-size:11px;">(' + esc(item.sku) + ')</span>' : '') + '</td>';
            html += '<td style="text-align:center; padding:9px 12px;">' + item.qty + '</td><td style="text-align:right; padding:9px 12px;">' + fmtExGstDecimal(item.unit) + '</td><td style="text-align:right; padding:9px 20px; color:#f0f0f0; font-weight:500;">' + fmtExGstDecimal(item.total) + '</td></tr>';
        });
        html += '</tbody></table></div></div>';
    });
    document.getElementById('bomContent').innerHTML = html;

    const gp = state.gpMargin, gpAmt = grandTotal * (gp / 100);
    const comm = state.salesCommission, priceBeforeComm = grandTotal + gpAmt;
    const commAmt = priceBeforeComm * GST * (comm / 100) / GST;
    const beforeRebates = priceBeforeComm + commAmt;
    const zoneResult = lookupZone(document.getElementById('installPostcode').value);
    const zoneRating = zoneResult ? zoneResult.rating : 0;
    const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
    const pvReb = pvStcCount * state.stcPrice, batSummary = getBatterySummary(), batReb = batSummary.usableKwh * state.batteryRebatePerKwh;
    const finalPrice = beforeRebates - pvReb - batReb;
    let totHtml = '<table style="width:100%; font-size:14px; border-collapse:collapse;">';
    const totRow = (l, v, s) => '<tr style="' + (s || '') + '"><td style="padding:8px 0; color:#9ca3af;">' + l + '</td><td style="padding:8px 0; text-align:right; color:#f0f0f0; font-weight:500;">' + v + '</td></tr>';
    totHtml += totRow('Total COG (ex GST)', fmtExGst(grandTotal));
    totHtml += totRow('GP (' + gp + '%)', fmtExGst(gpAmt));
    totHtml += totRow('Commission (' + comm + '%)', fmtExGst(commAmt));
    totHtml += totRow('Price Before Rebates (ex GST)', fmtExGst(beforeRebates), 'border-top:1px solid #333;');
    if (pvReb > 0) totHtml += totRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtExGst(pvReb), 'color:#34d399;');
    if (batReb > 0) totHtml += totRow('Battery STC Rebate', '-' + fmtExGst(batReb), 'color:#34d399;');
    totHtml += '<tr style="border-top:2px solid #e000f0;"><td style="padding:12px 0; color:#e000f0; font-weight:700; font-size:16px;">Customer Price (inc GST)</td>';
    totHtml += '<td style="padding:12px 0; text-align:right; color:#e000f0; font-weight:700; font-size:18px;">' + fmtIncGst(finalPrice) + '</td></tr></table>';
    document.getElementById('bomTotals').innerHTML = totHtml;
    document.getElementById('bomOverlay').style.display = 'block'; document.body.style.overflow = 'hidden';
}

function closeBOM() { document.getElementById('bomOverlay').style.display = 'none'; document.body.style.overflow = ''; }
function toggleBomGroup(gi) { const el = document.getElementById('bomGroup' + gi), ch = document.getElementById('bomChevron' + gi); if (el.style.display === 'none') { el.style.display = 'block'; ch.style.transform = 'rotate(90deg)'; } else { el.style.display = 'none'; ch.style.transform = 'rotate(0deg)'; } }

// ====================
// FIREBASE QUOTE SAVE / SEARCH / LOAD
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
        // Searchable fields (lowercase for case-insensitive search)
        search_name: (document.getElementById('customerName').value || '').toLowerCase(),
        search_phone: (document.getElementById('customerPhone').value || '').replace(/\s/g, ''),
        search_email: (document.getElementById('customerEmail').value || '').toLowerCase(),
        search_address: (document.getElementById('installAddress').value || '').toLowerCase(),
        search_suburb: (document.getElementById('installSuburb').value || '').toLowerCase(),
        search_postcode: (document.getElementById('installPostcode').value || '').trim(),
        system: {
            manufacturer: currentManufacturer,
            batteryTypeIdx: currentBatteryTypeIdx,
            phase: state.phase,
            panelMode: state.panelMode,
            panelCount: state.panelCount,
            panelSelectIdx: document.getElementById('panelSelect').selectedIndex,
            desiredBatteryKwh: state.desiredBatteryKwh,
            batteryQtys: { ...batteryQtys },
            manualBatteryMode: manualBatteryMode,
            inverterSelectIdx: document.getElementById('inverterSelect').selectedIndex,
            userChangedInverter: userChangedInverter,
            addGateway: document.getElementById('addGateway').checked,
            gatewaySelectIdx: document.getElementById('gatewaySelect').selectedIndex,
            addEvCharger: document.getElementById('addEvCharger').checked,
            evChargerSelectIdx: document.getElementById('evChargerType').selectedIndex,
            selectedAccessories: selectedAccessories.map(a => ({ ...a })),
            selectedAddons: selectedAddons.map(a => ({ ...a })),
            dualStackManual: dualStackManual ? { ...dualStackManual } : null,
            dualStackEcOverride: dualStackEcOverride ? { ...dualStackEcOverride } : null
        },
        mounting: {
            roofType: state.roofType,
            orientation: state.orientation,
            numRows: state.numRows,
            numArrays: state.numArrays,
            tiltAngle: state.tiltAngle,
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
        customAddons: getCustomAddons(),
        totals: {
            finalPrice: document.getElementById('finalPrice').textContent,
            totalCog: document.getElementById('totalCog').textContent,
            sysKw: state.sysKw,
            actualBatteryKwh: bat.totalKwh
        }
    };
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
    if (!db) { alert('Firebase not connected. Check your internet connection.'); return; }
    const name = document.getElementById('customerName').value.trim();
    if (!name) { alert('Please enter a customer name before saving.'); document.getElementById('customerName').focus(); return; }

    const data = collectQuoteData();
    data.updated_at = firebase.firestore.FieldValue.serverTimestamp();

    try {
        if (currentQuoteId) {
            await db.collection('quotes').doc(currentQuoteId).update(data);
            console.log('[OK] Quote updated:', currentQuoteId);
        } else {
            data.created_at = firebase.firestore.FieldValue.serverTimestamp();
            const docRef = await db.collection('quotes').add(data);
            currentQuoteId = docRef.id;
            console.log('[OK] Quote saved:', currentQuoteId);
        }
        showActiveQuote(name, currentQuoteId);
        alert('Quote saved successfully.' + (currentQuoteId ? '\nID: ' + currentQuoteId : ''));
    } catch (err) {
        console.error('[!] Save failed:', err);
        alert('Failed to save quote: ' + err.message);
    }
}

async function searchQuotes() {
    if (!db) { alert('Firebase not connected.'); return; }
    const term = document.getElementById('quoteSearchInput').value.trim().toLowerCase();
    if (!term) { alert('Enter a name, address, or phone number to search.'); return; }

    const resultsEl = document.getElementById('quoteSearchResults');
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="color:#6b7280;padding:8px;">Searching...</div>';

    try {
        const results = [];
        // Search by name
        const nameSnap = await db.collection('quotes')
            .where('search_name', '>=', term).where('search_name', '<=', term + '\uf8ff')
            .orderBy('search_name').limit(20).get();
        nameSnap.forEach(doc => results.push({ id: doc.id, ...doc.data() }));

        // Search by suburb
        const suburbSnap = await db.collection('quotes')
            .where('search_suburb', '>=', term).where('search_suburb', '<=', term + '\uf8ff')
            .orderBy('search_suburb').limit(20).get();
        suburbSnap.forEach(doc => { if (!results.find(r => r.id === doc.id)) results.push({ id: doc.id, ...doc.data() }); });

        // Search by phone (strip spaces)
        const phoneTerm = term.replace(/\s/g, '');
        if (/^\d{3,}$/.test(phoneTerm)) {
            const phoneSnap = await db.collection('quotes')
                .where('search_phone', '>=', phoneTerm).where('search_phone', '<=', phoneTerm + '\uf8ff')
                .orderBy('search_phone').limit(20).get();
            phoneSnap.forEach(doc => { if (!results.find(r => r.id === doc.id)) results.push({ id: doc.id, ...doc.data() }); });
        }

        if (results.length === 0) {
            resultsEl.innerHTML = '<div style="color:#6b7280;padding:8px;">No quotes found for "' + esc(term) + '"</div>';
            return;
        }

        let html = '';
        results.forEach(r => {
            const c = r.customer || {};
            const date = r.updated_at ? new Date(r.updated_at.seconds * 1000).toLocaleDateString('en-AU') : '';
            const sysInfo = (r.totals?.sysKw ? r.totals.sysKw.toFixed(1) + 'kW' : '') + (r.totals?.actualBatteryKwh ? ' / ' + r.totals.actualBatteryKwh + 'kWh' : '');
            html += '<div onclick="loadQuote(\'' + r.id + '\')" style="padding:10px 16px;background:#141414;border:1px solid #2a2a2a;border-radius:6px;margin-bottom:6px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;" onmouseover="this.style.borderColor=\'#e000f0\'" onmouseout="this.style.borderColor=\'#2a2a2a\'">';
            html += '<div><span style="color:#f0f0f0;font-weight:500;">' + esc(c.name || 'Unknown') + '</span>';
            if (c.suburb) html += '<span style="color:#6b7280;font-size:12px;margin-left:8px;">' + esc(c.suburb) + '</span>';
            if (c.phone) html += '<span style="color:#6b7280;font-size:12px;margin-left:8px;">' + esc(c.phone) + '</span>';
            html += '</div>';
            html += '<div style="text-align:right;"><span style="color:#e000f0;font-size:13px;">' + esc(r.totals?.finalPrice || '') + '</span>';
            if (sysInfo) html += '<span style="color:#6b7280;font-size:11px;margin-left:8px;">' + esc(sysInfo) + '</span>';
            if (date) html += '<span style="color:#6b7280;font-size:11px;margin-left:8px;">' + date + '</span>';
            html += '</div></div>';
        });
        resultsEl.innerHTML = html;
    } catch (err) {
        console.error('[!] Search failed:', err);
        resultsEl.innerHTML = '<div style="color:#ef4444;padding:8px;">Search failed: ' + esc(err.message) + '</div>';
    }
}

async function loadQuote(quoteId) {
    if (!db) return;
    try {
        const doc = await db.collection('quotes').doc(quoteId).get();
        if (!doc.exists) { alert('Quote not found.'); return; }
        const data = doc.data();
        currentQuoteId = quoteId;

        // Restore manufacturer first
        if (data.system?.manufacturer) {
            currentManufacturer = data.system.manufacturer;
            document.getElementById('manufacturerSelect').value = currentManufacturer;
            currentBatteryTypeIdx = data.system.batteryTypeIdx || 0;
            populateBatteryTypes(); populateInverters(); populateGateways(); populateEvChargers(); buildAccessoriesUI(); buildAddonsUI(); updateBatteryMountVisibility(); updateHeaderSubtitle(); updateInverterSectionLabel();
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
        populateInverters(); populateGateways();

        if (s.panelSelectIdx != null) document.getElementById('panelSelect').selectedIndex = s.panelSelectIdx;
        document.getElementById('panelCount').value = s.panelCount || 28;

        document.getElementById('desiredBatteryKwh').value = s.desiredBatteryKwh || 0;
        if (s.batteryQtys) {
            batteryQtys = { ...s.batteryQtys };
            manualBatteryMode = s.manualBatteryMode || false;
        }
        buildBatteryUI();

        userChangedInverter = s.userChangedInverter || false;
        if (s.inverterSelectIdx != null) document.getElementById('inverterSelect').selectedIndex = s.inverterSelectIdx;

        document.getElementById('addGateway').checked = s.addGateway || false;
        document.getElementById('gatewayOptions').style.display = s.addGateway ? 'block' : 'none';
        if (s.gatewaySelectIdx != null) document.getElementById('gatewaySelect').selectedIndex = s.gatewaySelectIdx;

        document.getElementById('addEvCharger').checked = s.addEvCharger || false;
        document.getElementById('evChargerOptions').style.display = s.addEvCharger ? 'block' : 'none';
        if (s.evChargerSelectIdx != null) document.getElementById('evChargerType').selectedIndex = s.evChargerSelectIdx;

        selectedAccessories = (s.selectedAccessories || []).map(a => ({ ...a }));
        renderSelectedAccessories();
        selectedAddons = (s.selectedAddons || []).map(a => ({ ...a }));
        renderSelectedAddons();

        // Restore mounting
        const m = data.mounting || {};
        document.getElementById('roofType').value = m.roofType || 'metal';
        document.getElementById('panelOrientation').value = m.orientation || 'portrait';
        document.getElementById('numRows').value = m.numRows || 1;
        document.getElementById('numArrays').value = m.numArrays || 1;
        document.getElementById('tiltAngle').value = m.tiltAngle || '10_15';
        document.getElementById('mountingType').value = m.mountingType || 'ground';
        updateRoofInfo(); updateMountingKitInfo();

        // Restore pricing
        const p = data.pricing || {};
        document.getElementById('installPerKwPv').value = p.installPvPerKw ?? 300;
        document.getElementById('installPerStack').value = p.installBatPerStack ?? 1600;
        document.getElementById('stcPrice').value = p.stcPrice ?? 40;
        document.getElementById('stcDeemingPeriod').value = p.deemingPeriod ?? 5;
        document.getElementById('batteryRebatePerKwh').value = p.batteryRebatePerKwh ?? 311;
        document.getElementById('gpMargin').value = p.gpMargin ?? 30;
        document.getElementById('salesCommission').value = p.salesCommission ?? 7;

        // Restore custom add-ons
        const ca = data.customAddons || [];
        // Clear existing custom addons
        customAddonCount = 0;
        document.getElementById('customAddons').innerHTML = '';
        ca.forEach(item => { addCustomAddon(); document.getElementById('customName-' + customAddonCount).value = item.name; document.getElementById('customCost-' + customAddonCount).value = item.cost; });

        // Restore dual-stack overrides (before calculateQuote)
        dualStackManual = s.dualStackManual || null;
        dualStackEcOverride = s.dualStackEcOverride || null;

        // Hide search results
        document.getElementById('quoteSearchResults').style.display = 'none';
        document.getElementById('quoteSearchInput').value = '';

        showActiveQuote(c.name || 'Unknown', quoteId);
        calculateQuote();
        console.log('[OK] Quote loaded:', quoteId);
    } catch (err) {
        console.error('[!] Load failed:', err);
        alert('Failed to load quote: ' + err.message);
    }
}

function clearQuote() {
    currentQuoteId = null;
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerEmail').value = '';
    document.getElementById('installAddress').value = '';
    document.getElementById('installSuburb').value = '';
    document.getElementById('installState').value = '';
    document.getElementById('installPostcode').value = '';
    document.getElementById('desiredBatteryKwh').value = 13;
    document.getElementById('panelCount').value = 28;
    document.getElementById('addGateway').checked = false;
    document.getElementById('gatewayOptions').style.display = 'none';
    document.getElementById('addEvCharger').checked = false;
    document.getElementById('evChargerOptions').style.display = 'none';
    selectedAccessories = []; renderSelectedAccessories();
    selectedAddons = []; renderSelectedAddons();
    customAddonCount = 0; document.getElementById('customAddons').innerHTML = '';
    manualBatteryMode = false; userChangedInverter = false;
    resetBatteryQtys(); buildBatteryUI();
    document.getElementById('quoteSearchResults').style.display = 'none';
    document.getElementById('quoteSearchInput').value = '';
    document.getElementById('activeQuoteBar').style.display = 'none';
    updateZoneDisplay(); calculateQuote();
}

function showActiveQuote(name, id) {
    const bar = document.getElementById('activeQuoteBar');
    bar.style.display = 'flex';
    document.getElementById('activeQuoteInfo').textContent = 'Editing: ' + name;
    document.getElementById('activeQuoteId').textContent = 'ID: ' + id;
}

// Enter key triggers search
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('quoteSearchInput');
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchQuotes(); });
});

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
    const commAmt = priceBeforeComm * GST * (state.salesCommission / 100) / GST;
    const priceBeforeRebates = priceBeforeComm + commAmt;
    const zoneResult = lookupZone(pc);
    const zoneRating = zoneResult ? zoneResult.rating : 0;
    const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
    const pvReb = pvStcCount * state.stcPrice;
    const isDualStack = dualStackResult && currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 48;
    const batReb = isDualStack ? dualStackResult.totalUsableKwh * state.batteryRebatePerKwh : bat.usableKwh * state.batteryRebatePerKwh;
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

    const totalKwh = isDualStack ? dualStackResult.totalKwh : bat.totalKwh;
    const totalUsableKwh = isDualStack ? dualStackResult.totalUsableKwh : bat.usableKwh;
    const invSku = isDualStack ? (dualStackResult.stack1.ec.sku + ' + ' + dualStackResult.stack2.ec.sku) : state.invSku;

    const summaryItems = [
        { label: 'System Size', value: state.sysKw.toFixed(2) + ' kW' },
        { label: 'Panels', value: state.panelCount + ' x ' + state.panelWattage + 'W' },
        { label: 'Battery', value: totalKwh > 0 ? totalKwh + ' kWh' : 'None' },
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
    if (pvReb > 0) drawTotalRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtPdfInc(pvReb), { valueColor: [52, 211, 153] });
    if (batReb > 0) drawTotalRow('Battery STC Rebate', '-' + fmtPdfInc(batReb), { valueColor: [52, 211, 153] });

    y += 2;
    drawTotalRow('Customer Price (inc GST)', fmtPdfInc(finalPrice), {
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
// EMBEDDED FALLBACK CONFIG
// ====================

const DEFAULT_CONFIG = {
    "panels": [
        { "brand": "Longi", "model": "X10", "wattage": 475, "price": 121.13, "colour": "Black", "width_mm": 1134, "height_mm": 1800, "supplier_code": "RAY:LONGI-X10-475" },
        { "brand": "Longi", "model": "Hi-MO 7", "wattage": 450, "price": 200, "colour": "Black", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-450" },
        { "brand": "Longi", "model": "Hi-MO 7", "wattage": 440, "price": 190, "colour": "Silver", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-440" }
    ],
    "manufacturers": {
        "sigenergy": {
            "label": "Sigenergy", "inverter_label": "Energy Controller", "pv_oversizing": { "single_phase": 2.0, "three_phase": 1.6 },
            "inverters": { "single_phase": [{ "sku": "SigenStor EC 5.0 SP", "kw": 5, "price": 1343, "max_pv_kw": 10, "supplier_code": "SIG:EC-5.0-SP" },{ "sku": "SigenStor EC 6.0 SP", "kw": 6, "price": 1452, "max_pv_kw": 12, "supplier_code": "SIG:EC-6.0-SP" },{ "sku": "SigenStor EC 8.0 SP", "kw": 8, "price": 2482, "max_pv_kw": 16, "supplier_code": "SIG:EC-8.0-SP" },{ "sku": "SigenStor EC 10.0 SP", "kw": 10, "price": 2675, "max_pv_kw": 20, "supplier_code": "SIG:EC-10.0-SP" },{ "sku": "SigenStor EC 12.0 SP", "kw": 12, "price": 2869, "max_pv_kw": 24, "supplier_code": "SIG:EC-12.0-SP" }], "three_phase": [{ "sku": "SigenStor EC 5.0 TP", "kw": 5, "price": 2300, "max_pv_kw": 8, "supplier_code": "SIG:EC-5.0-TP" },{ "sku": "SigenStor EC 10.0 TP", "kw": 10, "price": 2663, "max_pv_kw": 16, "supplier_code": "SIG:EC-10.0-TP" },{ "sku": "SigenStor EC 15.0 TP", "kw": 15, "price": 3511, "max_pv_kw": 24, "supplier_code": "SIG:EC-15.0-TP" },{ "sku": "SigenStor EC 20.0 TP", "kw": 20, "price": 4007, "max_pv_kw": 32, "supplier_code": "SIG:EC-20.0-TP" },{ "sku": "SigenStor EC 25.0 TP", "kw": 25, "price": 4600, "max_pv_kw": 40, "supplier_code": "SIG:EC-25.0-TP" },{ "sku": "SigenStor EC 30.0 TP", "kw": 30, "price": 5060, "max_pv_kw": 48, "supplier_code": "SIG:EC-30.0-TP" }] },
            "battery_types": [{ "id": "sig_default", "label": "SigenStor (8kWh)", "modules": [{ "kwh": 5, "usable_kwh": 5.2, "price": 2905, "label": "5 kWh", "supplier_code": "SIG:BAT-5.0", "enabled": false },{ "kwh": 8, "usable_kwh": 7.8, "price": 3632, "label": "8 kWh", "supplier_code": "SIG:BAT-8.0" }], "can_mix": true, "bms_cost": 0, "bms_code": "", "series_box_cost": 0, "series_box_code": "", "series_box_threshold": 999, "rules": { "max_modules": 6, "max_kwh": 48, "min_modules_single": 0, "min_modules_three": 0, "max_modules_single": 6, "max_modules_three": 6 } }],
            "gateways": { "single_phase": [{ "sku": "Sigen Gateway Home SP", "price": 645, "desc": "Standard Single Phase ($645)", "supplier_code": "SIG:GW-HOME-SP" }], "three_phase": [{ "sku": "Sigen Gateway Home TP", "price": 1575, "desc": "Standard Three Phase ($1,575)", "supplier_code": "SIG:GW-HOME-TP" }] },
            "ev_chargers": { "dc_12_5": { "price": 2277, "desc": "DC 12kW 5m", "supplier_code": "SIG:EVDC-12-5S2" } },
            "accessories": [{ "id": "power_sensor", "label": "Power Sensor", "price_single": 101, "price_three": 202, "phase_dependent": true, "default_checked": true, "supplier_code_single": "SIG:SENSOR-SP-CT100", "supplier_code_three": "SIG:SENSOR-TP-CT100" }],
            "battery_mounting": { "mount_wall": 202, "mount_wall_code": "SIG:MOUNT-WALL", "mount_ground": 202, "mount_ground_code": "SIG:MOUNT-GROUND", "show": true },
            "cec_approved": { "type": "inverter_battery_combo", "single_phase": { "EC 5.0 SP": [0,5,8,10,13,16,21,24,29,32], "EC 6.0 SP": [0,5,8,10,13,16,21,24,29,32], "EC 8.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 10.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 12.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48] }, "three_phase": { "EC 5.0 TP": [0,5,8,10,13,16], "EC 10.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 15.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 20.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 25.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 30.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48] } }
        }
    },
    "installation": { "install_pv_per_kw": 300, "install_battery_per_stack": 1600, "roof_types": { "metal": {"label":"Metal","surcharge":0}, "tile": {"label":"Tile","surcharge":100}, "concrete": {"label":"Concrete/Terracotta","surcharge":200}, "flat": {"label":"Flat","surcharge":300} } },
    "rebates": { "stc_price": 40, "stc_deeming_period": 5, "battery_rebate_per_kwh": 311, "stc_zones": [[0,9999,3,1.382]] },
    "addons": { "hot_water_timer": 350, "hot_water_timer_code": "BDS:HWT-001", "meter_board_partial": 800, "meter_board_partial_code": "BDS:MB-PART", "meter_board_full": 1200, "meter_board_full_code": "BDS:MB-FULL", "meter_board_relocation": 1800, "meter_board_relocation_code": "BDS:MB-RELOC" },
    "gp_margin": 30,
    "mounting_kits": { "kits": { "tin_2kw": {"label":"Tin Roof 2kW Pack","panels_covered":4,"price":46.50,"supplier_code":"RAY:KIT-TIN-2KW"}, "tin_1_5kw": {"label":"Tin Roof 1.5kW Pack","panels_covered":3,"price":34.90,"supplier_code":"RAY:KIT-TIN-1.5KW"}, "tile_2kw": {"label":"Tile Roof 2kW Pack","panels_covered":4,"price":93.00,"supplier_code":"RAY:KIT-TILE-2KW"}, "tile_1_5kw": {"label":"Tile Roof 1.5kW Pack","panels_covered":3,"price":69.50,"supplier_code":"RAY:KIT-TILE-1.5KW"} }, "tilt_angles": { "10_15": {"label":"10-15 deg","price":11.99,"supplier_code":"RAY:TILT-10/15"} }, "split_array_surcharge": { "parts": [{"desc":"End Clamp","qty":4,"price":1.10,"supplier_code":"RAY:END"}], "labour_surcharge": 100 }, "rails": { "portrait_per_row": 2, "landscape_per_row": 3, "price": 25.50, "length_mm": 4800, "clamp_gap_mm": 25, "splicer_price": 1.60, "supplier_code": "RAY:R-4800-BLK", "splicer_code": "RAY:R-SP" }, "landscape_extras": { "tin_attachment_price": 1.60, "tin_attachment_code": "RAY:TH-L", "tile_attachment_price": 4.90, "tile_attachment_code": "RAY:RH-1#", "attachments_per_row": 4 } }
};
