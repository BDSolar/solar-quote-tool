// ====================
// Black Diamond Solar - Quote Builder
// Multi-Manufacturer Edition
// ====================

let CONFIG = {};
let customAddonCount = 0, userChangedInverter = false;
let batteryQtys = {};
let currentManufacturer = 'sigenergy';
let currentBatteryTypeIdx = 0;
let selectedAccessories = [];
let currentQuoteId = null;
let dualStackResult = null; // holds dual-stack optimizer output when active
let dualStackEcOverride = { stack1: null, stack2: null }; // user EC upgrade overrides per stack

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
    batteryQtys = {};
    document.getElementById('installPerKwPv').value = CONFIG.installation?.install_pv_per_kw ?? 300;
    document.getElementById('installPerStack').value = CONFIG.installation?.install_battery_per_stack ?? 1600;
    document.getElementById('stcPrice').value = CONFIG.rebates?.stc_price ?? 40;
    document.getElementById('stcDeemingPeriod').value = CONFIG.rebates?.stc_deeming_period ?? 5;
    document.getElementById('batteryRebatePerKwh').value = CONFIG.rebates?.battery_rebate_per_kwh ?? 311;
    document.getElementById('gpMargin').value = CONFIG.gp_margin ?? 30;
    populateManufacturers(); populatePanels(); populateBatteryTypes(); buildBatteryUI(); populateInverters(); populateGateways(); buildAccessoriesUI(); updateBatteryMountVisibility(); bindEvents(); updateRoofInfo(); updateMountingKitInfo(); updateZoneDisplay(); updateHeaderSubtitle(); updateInverterSectionLabel(); updatePowerSensorModel(); calculateQuote();
}

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
    currentBatteryTypeIdx = 0; userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null };
    selectedAccessories = selectedAccessories.filter(function(a) { return a.type === 'addon'; });
    batteryQtys = {}; populateBatteryTypes(); buildBatteryUI(); populateInverters(); populateGateways(); buildAccessoriesUI(); updateBatteryMountVisibility(); updateHeaderSubtitle(); updateInverterSectionLabel();
    document.getElementById('desiredBatteryKwh').value = 0;
    document.getElementById('desiredBatteryKwh').max = 96;
    calculateQuote();
}

function updateHeaderSubtitle() { const el = document.getElementById('headerSubtitle'); if (el) el.textContent = (getMfg().label || 'Solar') + ' Residential Quote Builder'; }
function updateInverterSectionLabel() { const lbl = document.getElementById('inverterDropdownLabel'); if (lbl) lbl.textContent = getInverterLabel(); }

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
    userChangedInverter = false; batteryQtys = {}; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null };    document.getElementById('desiredBatteryKwh').value = 0;
    document.getElementById('desiredBatteryKwh').max = 96;
    calculateQuote();
}

// ====================
// BATTERY UI
// ====================

function buildBatteryUI() {
    // No-op: battery adjustment UI removed; system auto-selects optimal config
}

// ====================
// ACCESSORIES UI
// ====================

function getAllDropdownItems() {
    var items = [];
    // Manufacturer-specific accessories (excluding power sensor)
    var accs = (getMfg().accessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
    accs.forEach(function(acc) {
        var price = acc.phase_dependent ? (state.phase === 'single_phase' ? acc.price_single : acc.price_three) : acc.price;
        items.push({ id: acc.id, label: acc.label, price: price, type: 'accessory', source: acc });
    });
    // EV Charger (if manufacturer has chargers)
    var evChargers = getMfg().ev_chargers || {};
    if (Object.keys(evChargers).length > 0) {
        items.push({ id: 'ev_charger', label: 'EV Charger', price: 0, type: 'ev_charger' });
    }
    // Universal add-ons
    var hwt = CONFIG.addons?.hot_water_timer ?? 350;
    items.push({ id: 'hot_water_timer', label: 'Hot Water Timer', price: hwt, type: 'addon', supplier_code: CONFIG.addons?.hot_water_timer_code || 'BDS:HWT-001' });
    var mbp = CONFIG.addons?.meter_board_partial ?? 800;
    var mbf = CONFIG.addons?.meter_board_full ?? 1200;
    var mbr = CONFIG.addons?.meter_board_relocation ?? 1800;
    items.push({ id: 'meter_board_partial', label: 'Meter Board - Partial', price: mbp, type: 'addon', supplier_code: CONFIG.addons?.meter_board_partial_code || 'BDS:MB-PART' });
    items.push({ id: 'meter_board_full', label: 'Meter Board - Full', price: mbf, type: 'addon', supplier_code: CONFIG.addons?.meter_board_full_code || 'BDS:MB-FULL' });
    items.push({ id: 'meter_board_relocation', label: 'Meter Board - Full + Relocation', price: mbr, type: 'addon', supplier_code: CONFIG.addons?.meter_board_relocation_code || 'BDS:MB-RELOC' });
    return items;
}

function buildAccessoriesUI() {
    var container = document.getElementById('accessoriesContainer'); container.innerHTML = '';
    var items = getAllDropdownItems();
    // Dropdown row
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;margin-bottom:10px;';
    var sel = document.createElement('select'); sel.id = 'accessoryDropdown'; sel.style.flex = '1';
    sel.innerHTML = '<option value="">-- Select item --</option>';
    items.forEach(function(item, idx) {
        var o = document.createElement('option'); o.value = idx;
        o.textContent = item.label;
        sel.appendChild(o);
    });
    var btn = document.createElement('button'); btn.className = 'add-custom-btn'; btn.style.marginTop = '0'; btn.textContent = '+ Add';
    btn.addEventListener('click', function() {
        var idx = parseInt(sel.value); if (isNaN(idx)) return;
        var item = items[idx];
        if (selectedAccessories.find(function(a) { return a.id === item.id; })) return;
        // Meter board tiers are mutually exclusive
        if (item.id.startsWith('meter_board_')) {
            selectedAccessories = selectedAccessories.filter(function(a) { return !a.id.startsWith('meter_board_'); });
        }
        var entry = { id: item.id, label: item.label, price: item.price, type: item.type, supplier_code: item.supplier_code || '' };
        if (item.source) entry.source = item.source;
        if (item.type === 'ev_charger') entry.evModel = null;
        selectedAccessories.push(entry);
        renderSelectedAccessories();
        sel.value = '';
        calculateQuote();
    });
    row.appendChild(sel); row.appendChild(btn); container.appendChild(row);
    // List container
    var list = document.createElement('div'); list.id = 'accessoryList'; container.appendChild(list);
    // Auto-add defaults on first build
    if (selectedAccessories.length === 0) {
        var accs = (getMfg().accessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
        accs.filter(function(a) { return a.default_checked; }).forEach(function(a) {
            var price = a.phase_dependent ? (state.phase === 'single_phase' ? a.price_single : a.price_three) : a.price;
            selectedAccessories.push({ id: a.id, label: a.label, price: price, type: 'accessory', source: a, supplier_code: a.supplier_code || '' });
        });
    }
    renderSelectedAccessories();
}

function buildEvChargerSubDropdown(entry, wrapper, priceSpan) {
    var evChargers = getMfg().ev_chargers || {};
    var subDiv = document.createElement('div'); subDiv.style.cssText = 'margin:4px 0 8px 0;';
    var subSel = document.createElement('select'); subSel.className = 'ev-charger-sub';
    subSel.innerHTML = '<option value="none"> - Select model - </option>';
    var groups = { dc: [], ac_cable: [], ac_socket: [] };
    Object.entries(evChargers).forEach(function(pair) {
        var key = pair[0], val = pair[1];
        if (key.startsWith('dc_')) groups.dc.push({ key: key, desc: val.desc, price: val.price, supplier_code: val.supplier_code || '' });
        else if (key.includes('_cable')) groups.ac_cable.push({ key: key, desc: val.desc, price: val.price, supplier_code: val.supplier_code || '' });
        else if (key.includes('_socket')) groups.ac_socket.push({ key: key, desc: val.desc, price: val.price, supplier_code: val.supplier_code || '' });
    });
    var addGroup = function(label, items) {
        if (!items.length) return;
        var sep = document.createElement('option'); sep.disabled = true; sep.textContent = '--- ' + label + ' ---'; sep.style.cssText = 'font-weight:bold;color:#9ca3af;'; subSel.appendChild(sep);
        items.forEach(function(item) {
            var o = document.createElement('option'); o.value = item.key;
            o.textContent = '  ' + item.desc;
            subSel.appendChild(o);
        });
    };
    addGroup('DC (connects to ' + getInverterLabel() + ')', groups.dc);
    addGroup('AC with Cable', groups.ac_cable);
    addGroup('AC Socket Only', groups.ac_socket);
    // Restore saved selection
    if (entry.evModel) subSel.value = entry.evModel;
    subSel.addEventListener('change', function() {
        var key = subSel.value;
        if (key === 'none') { entry.evModel = null; entry.price = 0; entry.evDesc = ''; entry.evSupplierCode = ''; }
        else { var ev = evChargers[key]; entry.evModel = key; entry.price = ev.price; entry.evDesc = ev.desc; entry.evSupplierCode = ev.supplier_code || ''; }
        if (priceSpan) {
            priceSpan.textContent = entry.price > 0 ? '$' + entry.price.toLocaleString() : 'Select below';
            priceSpan.style.color = entry.price > 0 ? '' : '#9ca3af';
            priceSpan.style.fontStyle = entry.price > 0 ? '' : 'italic';
        }
        calculateQuote();
    });
    subDiv.appendChild(subSel);
    wrapper.appendChild(subDiv);
}

function renderSelectedAccessories() {
    var list = document.getElementById('accessoryList'); if (!list) return; list.innerHTML = '';
    selectedAccessories.forEach(function(acc, i) {
        var price = 0;
        if (acc.type === 'accessory' && acc.source && acc.source.phase_dependent) {
            price = state.phase === 'single_phase' ? acc.source.price_single : acc.source.price_three;
            acc.price = price;
        } else {
            price = acc.price;
        }
        var wrapper = document.createElement('div'); wrapper.style.cssText = 'margin-bottom:6px;';
        var div = document.createElement('div'); div.className = 'addon-item';
        div.innerHTML = '<label style="flex:1;cursor:default;font-size:13px;color:#d1d5db;">' + esc(acc.label) + '</label><button style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;margin-left:8px;padding:0 4px;" title="Remove">&times;</button>';
        div.querySelector('button').addEventListener('click', (function(idx) { return function() { selectedAccessories.splice(idx, 1); renderSelectedAccessories(); calculateQuote(); }; })(i));
        wrapper.appendChild(div);
        // EV charger sub-dropdown
        if (acc.type === 'ev_charger') buildEvChargerSubDropdown(acc, wrapper, div.querySelector('.addon-price'));
        list.appendChild(wrapper);
    });
}

function updateAccessoryPrices() { renderSelectedAccessories(); buildAccessoriesUI(); updatePowerSensorModel(); }

function updatePowerSensorModel() {
    var el = document.getElementById('powerSensorModel');
    if (!el) return;
    el.textContent = state.phase === 'single_phase' ? 'Sigen Sensor SP-CT100' : 'Sigen Sensor TP-CT100';
}

function getAccessoryCost() {
    var t = 0;
    selectedAccessories.forEach(function(acc) { t += acc.price || 0; });
    t += getPowerSensorCost();
    return t;
}

function getPowerSensorCost() {
    var acc = (getMfg().accessories || []).find(function(a) { return a.id === 'power_sensor'; });
    if (!acc) return 0;
    return state.phase === 'single_phase' ? acc.price_single : acc.price_three;
}

function getAccessoryBomItems() {
    var items = [];
    selectedAccessories.forEach(function(acc) {
        if (acc.type === 'ev_charger') {
            if (acc.evModel && acc.price > 0) {
                items.push({ desc: 'EV Charger: ' + (acc.evDesc || acc.evModel), sku: acc.evModel, qty: 1, unit: acc.price, total: acc.price, supplier_code: acc.evSupplierCode || '' });
            }
        } else if (acc.type === 'accessory' && acc.source) {
            var price = acc.source.phase_dependent ? (state.phase === 'single_phase' ? acc.source.price_single : acc.source.price_three) : acc.source.price;
            var code = acc.source.phase_dependent ? (state.phase === 'single_phase' ? (acc.source.supplier_code_single || '') : (acc.source.supplier_code_three || '')) : (acc.source.supplier_code || '');
            items.push({ desc: acc.label, sku: '', qty: 1, unit: price, total: price, supplier_code: code });
        } else {
            items.push({ desc: acc.label, sku: '', qty: 1, unit: acc.price, total: acc.price, supplier_code: acc.supplier_code || '' });
        }
    });
    var psAcc = (getMfg().accessories || []).find(function(a) { return a.id === 'power_sensor'; });
    if (psAcc) {
        var psPrice = state.phase === 'single_phase' ? psAcc.price_single : psAcc.price_three;
        var psCode = state.phase === 'single_phase' ? (psAcc.supplier_code_single || '') : (psAcc.supplier_code_three || '');
        items.push({ desc: psAcc.label, sku: '', qty: 1, unit: psPrice, total: psPrice, supplier_code: psCode });
    }
    return items;
}

function updateBatteryMountVisibility() { var el = document.getElementById('batteryMountGroup'); if (el) el.style.display = (getMfg().battery_mounting?.show !== false) ? 'grid' : 'none'; }

// ====================
// ZONE LOOKUP
// ====================

function lookupZone(postcode) { const pc = parseInt(postcode); if (isNaN(pc) || pc < 0 || pc > 9999) return null; for (const z of (CONFIG.rebates?.stc_zones || [])) { if (pc >= z[0] && pc <= z[1]) return { zone: z[2], rating: z[3] }; } return null; }
function updateZoneDisplay() { const pc = document.getElementById('installPostcode').value, info = document.getElementById('stcZoneInfo'), result = lookupZone(pc); if (!pc) { info.textContent = 'Enter postcode'; info.style.color = '#6b7280'; return; } if (!result) { info.textContent = 'Invalid postcode'; info.style.color = '#ef4444'; return; } info.textContent = 'Zone ' + result.zone + ' -  Rating ' + result.rating; info.style.color = '#34d399'; }

// ====================
// EVENT BINDING
// ====================

function bindEvents() {
    const dedicatedIds = ['inverterSelect','phaseType','desiredBatteryKwh','manufacturerSelect','batteryTypeSelect','roofType','panelOrientation','numRows','numArrays','tiltAngle','gatewaySelect','installPostcode'];
    document.querySelectorAll('input, select').forEach(el => { if (!dedicatedIds.includes(el.id)) { el.addEventListener('input', calculateQuote); el.addEventListener('change', calculateQuote); } });
    document.getElementById('installPostcode').addEventListener('input', function() { this.value = this.value.replace(/\D/g, '').slice(0, 4); updateZoneDisplay(); calculateQuote(); });
    document.getElementById('manufacturerSelect').addEventListener('change', switchManufacturer);
    document.getElementById('batteryTypeSelect').addEventListener('change', switchBatteryType);
    document.getElementById('phaseType').addEventListener('change', () => { syncStateFromDOM(); userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; populateInverters(); populateGateways(); updateAccessoryPrices(); calculateQuote(); });
    document.getElementById('panelSelect').addEventListener('change', calculateQuote);
    document.getElementById('desiredBatteryKwh').addEventListener('input', () => { const el = document.getElementById('desiredBatteryKwh'); if (parseFloat(el.value) > 96) el.value = 96; userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null }; calculateQuote(); });
    document.getElementById('inverterSelect').addEventListener('change', () => { userChangedInverter = true; calculateQuote(); });
    document.getElementById('roofType').addEventListener('change', updateRoofInfo);
    document.getElementById('panelOrientation').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numRows').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numArrays').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('tiltAngle').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('gatewaySelect').addEventListener('change', calculateQuote);
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
        o.textContent = p.brand + ' ' + p.model + ' ' + p.wattage + 'W ' + p.colour;
        o.dataset.wattage = p.wattage; o.dataset.price = p.price; o.dataset.brand = p.brand; o.dataset.model = p.model;
        o.dataset.colour = p.colour; o.dataset.widthMm = p.width_mm || 1134; o.dataset.heightMm = p.height_mm || 1800; o.dataset.supplierCode = p.supplier_code || '';
        sel.appendChild(o);
    });
}

function populateInverters() {
    const sel = document.getElementById('inverterSelect'); sel.innerHTML = '';
    getInverters().forEach(m => {
        const o = document.createElement('option'); o.value = m.sku;
        o.textContent = m.sku + ' -  ' + m.kw + 'kW -  Max PV: ' + m.max_pv_kw + 'kW';
        o.dataset.kw = m.kw; o.dataset.price = m.price; o.dataset.maxPv = m.max_pv_kw; o.dataset.supplierCode = m.supplier_code || '';
        sel.appendChild(o);
    });
    updateInverterSectionLabel();
}

function populateGateways() {
    const gateways = getMfg().gateways?.[state.phase] || [], sel = document.getElementById('gatewaySelect'); sel.innerHTML = '';
    const none = document.createElement('option'); none.value = 'none'; none.textContent = 'None'; none.dataset.price = '0'; sel.appendChild(none);
    gateways.forEach(m => { const o = document.createElement('option'); o.value = m.sku; o.textContent = m.desc; o.dataset.price = m.price; o.dataset.supplierCode = m.supplier_code || ''; sel.appendChild(o); });
}





// ====================
// BATTERY MANAGEMENT
// ====================

function updateBatteryUI() {
    const bat = getBatterySummary(), modules = getBatteryModules(), bt = getBatteryType();
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

// Render dual-stack breakdown (display only, no manual adjustment)
function renderDualStackBreakdown() {
    if (!dualStackResult) return;
    var modules = getBatteryModules();
    var s1parts = [], s2parts = [];
    modules.forEach(function(b) { var q = dualStackResult.stack1.batteryQtys[b.kwh] || 0; if (q > 0) s1parts.push(q + 'x ' + b.kwh + 'kWh'); });
    modules.forEach(function(b) { var q = dualStackResult.stack2.batteryQtys[b.kwh] || 0; if (q > 0) s2parts.push(q + 'x ' + b.kwh + 'kWh'); });
    var ecKey1 = getCecKey(dualStackResult.stack1.ec.sku);
    var ecKey2 = getCecKey(dualStackResult.stack2.ec.sku);

    var html = '<span style="color:#e000f0;font-weight:600;">DUAL-STACK</span>';

    html += '<div style="display:flex;gap:8px;margin-top:8px;">';

    // Stack 1
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">Stack 1 - Energy Controller</label>';
    html += '<select id="dualEcSelect1" onchange="changeDualStackEc(1)" style="width:100%;padding:7px 12px;border:1px solid var(--separator-hover);border-radius:8px;font-size:14px;font-family:inherit;font-weight:400;background:var(--bg-input);color:var(--text-primary);height:36px;letter-spacing:-0.01em;margin-bottom:6px;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 stroke=%27%236e6e73%27 stroke-width=%271.5%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer;">';
    html += getDualEcOptions(1);
    html += '</select>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + dualStackResult.stack1.panels + ' panels</div>';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + s1parts.join(' + ') + ' = ' + dualStackResult.stack1.kwh + ' kWh</div>';
    html += '</div></div>';

    // Stack 2
    html += '<div style="flex:1;">';
    html += '<label style="display:block;font-size:12px;font-weight:500;color:var(--text-secondary);margin-bottom:5px;">Stack 2 - Energy Controller</label>';
    html += '<select id="dualEcSelect2" onchange="changeDualStackEc(2)" style="width:100%;padding:7px 12px;border:1px solid var(--separator-hover);border-radius:8px;font-size:14px;font-family:inherit;font-weight:400;background:var(--bg-input);color:var(--text-primary);height:36px;letter-spacing:-0.01em;margin-bottom:6px;appearance:none;-webkit-appearance:none;background-image:url(&quot;data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27 viewBox=%270 0 10 6%27%3E%3Cpath d=%27M1 1l4 4 4-4%27 stroke=%27%236e6e73%27 stroke-width=%271.5%27 fill=%27none%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27/%3E%3C/svg%3E&quot;);background-repeat:no-repeat;background-position:right 12px center;padding-right:30px;cursor:pointer;">';
    html += getDualEcOptions(2);
    html += '</select>';
    html += '<div style="padding:8px 12px;background:var(--bg-input);border-radius:8px;border:1px solid var(--separator);">';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + dualStackResult.stack2.panels + ' panels</div>';
    html += '<div style="color:var(--text-secondary);font-size:14px;">' + s2parts.join(' + ') + ' = ' + dualStackResult.stack2.kwh + ' kWh</div>';
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
        if (m.max_pv_kw < pvKw) continue;
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
        if (combos[key].includes(totalKwh)) return { ok: true, msg: '[OK] CEC approved: ' + key + ' + ' + totalKwh + 'kWh' };
        const nearest = combos[key].filter(k => k >= totalKwh).sort((a,b) => a-b)[0] || combos[key][combos[key].length - 1];
        return { ok: false, msg: '[!] ' + totalKwh + 'kWh not CEC approved with ' + key + '. Nearest: ' + nearest + 'kWh' };
    }
    if (cec.type === 'battery_system') {
        const bt = getBatteryType(), cecData = cec[bt.id];
        if (!cecData) return { ok: false, msg: 'No CEC data for ' + bt.id };
        const entry = cecData.entries?.find(e => e.modules === totalModules);
        if (entry) return { ok: true, msg: '[OK] CEC approved: ' + entry.model + ' -> ' + entry.nominal_kwh + ' kWh' };
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

        // Gateway UI: mandatory for Sigenergy with batteries -- auto-select cheapest
        const sigGwMandatory = currentManufacturer === 'sigenergy' && state.desiredBatteryKwh > 0;
        const gwSel = document.getElementById('gatewaySelect');
        if (sigGwMandatory) {
            // If currently set to None, auto-select cheapest (index 1 = first real gateway)
            if (gwSel.value === 'none' && gwSel.options.length > 1) gwSel.selectedIndex = 1;
            // Hide the None option so user can't deselect
            if (gwSel.options[0] && gwSel.options[0].value === 'none') gwSel.options[0].disabled = true;
        } else {
            if (gwSel.options[0] && gwSel.options[0].value === 'none') gwSel.options[0].disabled = false;
        }
        const desired = state.desiredBatteryKwh;
        let actualKwh = 0;
        const isDualStack = currentManufacturer === 'sigenergy' && desired > 48;

        if (isDualStack) {
            // Dual-stack path - always auto-optimize
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
            // Single-stack path - always auto-optimize
            dualStackResult = null;
            if (desired > 0) {
                const opt = optimizeBattery(desired);
                batteryQtys = opt.qtys; actualKwh = opt.total;
                updateBatteryUI();
                if (actualKwh > desired) document.getElementById('batteryBreakdown').innerHTML += ' <span style="color:#34d399;">(+' + (Math.round((actualKwh - desired) * 10) / 10) + 'kWh, cheaper)</span>';
            }
        }
        state.actualBatteryKwh = actualKwh;
        document.getElementById('batteryConfigPanel').style.display = desired > 0 ? 'block' : 'none';

        // Min modules check
        const rules = getBatteryRules();
        const bat = getBatterySummary();
        const minWarn = document.getElementById('minModulesWarning');
        if (minWarn) {
            if (bat.totalModules > 0 && bat.totalModules < rules.min_modules) {
                minWarn.style.display = 'flex'; minWarn.innerHTML = warnShieldHtml('Minimum Modules', 'Minimum ' + rules.min_modules + ' modules required for ' + (state.phase === 'single_phase' ? 'single' : 'three') + ' phase.');
            } else { minWarn.style.display = 'none'; }
        }

        // Phase capacity warning - check if desired kWh exceeds system max
        const phaseCapWarn = document.getElementById('phaseCapWarning');
        if (phaseCapWarn) {
            const isSigen = currentManufacturer === 'sigenergy';
            if (isSigen && desired > 96) {
                phaseCapWarn.style.display = 'flex';
                phaseCapWarn.innerHTML = warnShieldHtml('System Maximum', desired + ' kWh exceeds Sigenergy system max (96 kWh = 2 stacks x 48 kWh).');
            } else if (!isSigen && state.phase === 'single_phase' && desired > 0) {
                // Non-Sigenergy: check single-phase max (no dual-stack)
                const bt = getBatteryType();
                const spRules = bt.rules || {};
                const spMaxMod = spRules.max_modules_single || spRules.max_modules || 6;
                const modules = getBatteryModules();
                const largestMod = modules.reduce((mx, m) => Math.max(mx, m.kwh), 0);
                const spMaxKwh = spMaxMod * largestMod;
                if (desired > spMaxKwh) {
                    phaseCapWarn.style.display = 'flex';
                    phaseCapWarn.innerHTML = warnShieldHtml('Phase Capacity', desired + ' kWh requires three phase with ' + bt.label + ' (single phase max: ' + spMaxKwh + ' kWh).');
                } else { phaseCapWarn.style.display = 'none'; }
            } else { phaseCapWarn.style.display = 'none'; }
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

        const osRatio = getPvOversizing();
        document.getElementById('inverterInfo').style.display = 'none';
        if (!isDualStack && state.sysKw > state.invMaxPv) {
            document.getElementById('inverterWarning').style.display = 'flex';
            document.getElementById('inverterWarning').innerHTML = warnShieldHtml('PV Oversizing', 'PV (' + state.sysKw.toFixed(1) + 'kW) exceeds max (' + state.invMaxPv + 'kW). Select larger ' + getInverterLabel().toLowerCase() + '.');
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
            document.getElementById('cecApproved').innerHTML = bothOk ? cecShieldHtml(true, 'Stack 1: ' + ec1Key + ' + ' + dualStackResult.stack1.kwh + ' kWh  /  Stack 2: ' + ec2Key + ' + ' + dualStackResult.stack2.kwh + ' kWh') : '';
            document.getElementById('cecWarning').style.display = !bothOk ? 'flex' : 'none';
            if (!bothOk) {
                var warnDetail = '';
                if (!cec1.ok) warnDetail += 'Stack 1 - ' + cec1.msg.replace(/^\[!?\]?\s*/, '') + ' ';
                if (!cec2.ok) warnDetail += 'Stack 2 - ' + cec2.msg.replace(/^\[!?\]?\s*/, '');
                document.getElementById('cecWarning').innerHTML = cecShieldHtml(false, warnDetail.trim());
            }
        } else {
            const cec = checkCec(state.invSku, actualKwh, bat.totalModules, state.phase);
            if (actualKwh > 0 || bat.totalModules > 0) {
                var cecDetail = cec.msg.replace(/^\[OK\]\s*CEC approved:\s*/, '').replace(/^\[!?\]?\s*/, '');
                document.getElementById('cecApproved').style.display = cec.ok ? 'flex' : 'none';
                document.getElementById('cecApproved').innerHTML = cec.ok ? cecShieldHtml(true, cecDetail) : '';
                document.getElementById('cecWarning').style.display = !cec.ok ? 'flex' : 'none';
                document.getElementById('cecWarning').innerHTML = !cec.ok ? cecShieldHtml(false, cecDetail) : '';
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
            // If user picked a more expensive gateway, use that instead
            const gw = document.getElementById('gatewaySelect');
            const userGwPrice = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
            if (userGwPrice > costGateway) costGateway = userGwPrice;
        } else {
            costInverter = state.invPrice;
            costBattery = bat.equipmentCost;
            const gw = document.getElementById('gatewaySelect');
            costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0;
            const mfgMount = getMfg().battery_mounting || {};
            costMount = (bat.totalModules > 0 && mfgMount.show !== false) ? (mfgMount[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 0) : 0;
            installBat = (bat.totalModules > 0) ? state.installBatPerStack : 0;
        }

        let costAcc = getAccessoryCost();

        const installPv = state.sysKw * state.installPvPerKw;
        const roof = CONFIG.installation?.roof_types?.[state.roofType] || { surcharge: 0 };
        const costRoofSurcharge = roof.surcharge;
        const mountingResult = getMountingKitItems(state.panelCount, state.roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
        const costRoofKit = mountingResult.total;
        let costCustom = 0;
        for (let i = 1; i <= customAddonCount; i++) { const ce = document.getElementById('customCost-' + i), ne = document.getElementById('customName-' + i); if (ce && ne && ne.value.trim()) costCustom += parseFloat(ce.value) || 0; }
        costAcc += costCustom;

        const totalPv = costPanels + costRoofKit + costRoofSurcharge;
        const totalBattery = costInverter + costBattery + costGateway + costMount;
        const totalInstall = installPv + installBat + costAcc;
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
        document.getElementById('costAccessories').textContent = fmtIncGst(costAcc);
        document.getElementById('totalInstall').textContent = fmtIncGst(totalInstall);
        document.getElementById('totalCog').textContent = fmtIncGst(totalCog); document.getElementById('gpLabel').textContent = 'GP (' + state.gpMargin + '%)'; document.getElementById('gpAmount').textContent = fmtIncGst(gpAmt);
        document.getElementById('commLabel').textContent = 'Commission (' + state.salesCommission + '%)'; document.getElementById('commAmount').textContent = fmtIncGst(commAmt);
        document.getElementById('priceBeforeRebates').textContent = fmtIncGst(priceBeforeRebates);
        document.getElementById('pvRebateLabel').textContent = pvStcCount > 0 ? 'PV STC Rebate (' + pvStcCount + ' STCs)' : 'PV STC Rebate';
        document.getElementById('stcPvRebate').textContent = '-' + fmtExGst(pvReb);
        document.getElementById('stcBatteryRebate').textContent = '-' + fmtExGst(batReb);
        document.getElementById('finalPrice').textContent = '$' + Math.round(priceBeforeRebates * GST - pvReb - batReb).toLocaleString('en-AU');

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
    }
    bom.push({ category: 'Battery & ' + invLabel, items: batItems });

    // === ACCESSORIES & ADD-ONS ===
    let accItems = getAccessoryBomItems();
    for (let i = 1; i <= customAddonCount; i++) { const ne = document.getElementById('customName-' + i), ce = document.getElementById('customCost-' + i); if (ne && ce && ne.value.trim()) { const p = parseFloat(ce.value) || 0; accItems.push({ desc: ne.value.trim(), sku: 'Custom', qty: 1, unit: p, total: p, supplier_code: 'BDS:CUSTOM' }); } }
    if (accItems.length > 0) bom.push({ category: 'Accessories & Add-Ons', items: accItems });

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
    totHtml += '<td style="padding:12px 0; text-align:right; color:#e000f0; font-weight:700; font-size:18px;">$' + Math.round(beforeRebates * GST - pvReb - batReb).toLocaleString('en-AU') + '</td></tr></table>';
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
            inverterSelectIdx: document.getElementById('inverterSelect').selectedIndex,
            userChangedInverter: userChangedInverter,
            gatewaySelectIdx: document.getElementById('gatewaySelect').selectedIndex,
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
        populateInverters(); populateGateways();

        if (s.panelSelectIdx != null) document.getElementById('panelSelect').selectedIndex = s.panelSelectIdx;
        document.getElementById('panelCount').value = s.panelCount || 28;

        document.getElementById('desiredBatteryKwh').value = s.desiredBatteryKwh || 0;
        buildBatteryUI();

        userChangedInverter = s.userChangedInverter || false;
        if (s.inverterSelectIdx != null) document.getElementById('inverterSelect').selectedIndex = s.inverterSelectIdx;

        if (s.gatewaySelectIdx != null) document.getElementById('gatewaySelect').selectedIndex = s.gatewaySelectIdx;
        else if (s.addGateway && document.getElementById('gatewaySelect').options.length > 1) document.getElementById('gatewaySelect').selectedIndex = 1;

        // Restore accessories (unified - backward compatible with old saves)
        var loadedAccs = (s.selectedAccessories || []).filter(function(a) { return a.id !== 'power_sensor'; });
        // Merge old selectedAddons into accessories if present (backward compat)
        if (s.selectedAddons && s.selectedAddons.length > 0) {
            s.selectedAddons.forEach(function(a) { loadedAccs.push({ id: a.id, label: a.label, price: a.price, type: 'addon', supplier_code: a.supplier_code || '' }); });
        }
        // Backward compat: old EV charger checkbox
        if (s.addEvCharger) {
            loadedAccs.push({ id: 'ev_charger', label: 'EV Charger', price: 0, type: 'ev_charger', evModel: null });
        }
        selectedAccessories = loadedAccs;
        renderSelectedAccessories();

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
    document.getElementById('gatewaySelect').selectedIndex = 0;
    selectedAccessories = []; renderSelectedAccessories();
    customAddonCount = 0; document.getElementById('customAddons').innerHTML = '';
    userChangedInverter = false; dualStackResult = null; dualStackEcOverride = { stack1: null, stack2: null };
    batteryQtys = {};
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
    if (pvReb > 0) drawTotalRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtPdf(pvReb), { valueColor: [52, 211, 153] });
    if (batReb > 0) drawTotalRow('Battery STC Rebate', '-' + fmtPdf(batReb), { valueColor: [52, 211, 153] });

    y += 2;
    var customerPrice = '$' + Math.round(priceBeforeRebates * GST - pvReb - batReb).toLocaleString('en-AU');
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
            "gateways": { "single_phase": [{ "sku": "Sigen Gateway Home SP AU (Pro)", "price": 695, "desc": "Pro back entry ($695)", "supplier_code": "SIG:GW-HOME-SP-PRO" },{ "sku": "Sigen Gateway Home SP", "price": 645, "desc": "Standard Single Phase ($645)", "supplier_code": "SIG:GW-HOME-SP" },{ "sku": "Sigen CUST Gateway SP-63", "price": 2200, "desc": "Custom 63A up to 24kW ($2,200)", "supplier_code": "SIG:GW-CUST-SP-63" },{ "sku": "Sigen CUST Gateway SP-63-Hybrid", "price": 3000, "desc": "Custom 63A Hybrid ($3,000)", "supplier_code": "SIG:GW-CUST-SP-63-HYB" },{ "sku": "Sigen CUST Gateway SP-125", "price": 3200, "desc": "Custom 125A up to 24kW ($3,200)", "supplier_code": "SIG:GW-CUST-SP-125" }], "three_phase": [{ "sku": "Sigen Gateway Home TP AU (Pro)", "price": 859, "desc": "Simple 2-inverter ($859)", "supplier_code": "SIG:GW-HOME-TP-PRO" },{ "sku": "Sigen Gateway Home TP", "price": 1575, "desc": "Standard Three Phase ($1,575)", "supplier_code": "SIG:GW-HOME-TP" },{ "sku": "Sigen Gateway C60 AU", "price": 1769, "desc": "C&I 60kW ($1,769)", "supplier_code": "SIG:GW-C60" }] },
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
