// ====================
// Black Diamond Solar - Quote Builder
// ====================

let CONFIG = {};
let customAddonCount = 0, manualBatteryMode = false, userChangedInverter = false;
let batteryQtys = {};

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
// STATE OBJECT
// ====================

const state = {
    phase: 'single_phase',
    panelMode: 'panels',
    panelCount: 20,
    panelWattage: 450,
    panelCost: 200,
    panelBrand: '',
    panelModel: '',
    panelColour: '',
    panelWidthMm: 1134,
    panelHeightMm: 1800,
    panelSupplierCode: '',
    sysKw: 0,
    desiredBatteryKwh: 0,
    actualBatteryKwh: 0,
    invSku: '',
    invPrice: 0,
    invKw: 0,
    invMaxPv: 0,
    invSupplierCode: '',
    gpMargin: 30,
    stcPrice: 40,
    deemingPeriod: 5,
    batteryRebatePerKwh: 311,
    installPvPerKw: 300,
    installBatPerStack: 1600,
    roofType: 'metal',
    orientation: 'portrait',
    numRows: 1,
    numArrays: 1,
    tiltAngle: '10_15',
    mountingType: 'wall'
};

function syncStateFromDOM() {
    state.phase = document.getElementById('phaseType').value;
    state.panelMode = document.getElementById('panelInputMode').value;
    state.roofType = document.getElementById('roofType').value;
    state.orientation = document.getElementById('panelOrientation').value;
    state.numRows = parseInt(document.getElementById('numRows').value) || 1;
    state.numArrays = parseInt(document.getElementById('numArrays').value) || 1;
    state.tiltAngle = document.getElementById('tiltAngle').value;
    state.mountingType = document.getElementById('mountingType').value;
    state.gpMargin = parseFloat(document.getElementById('gpMargin').value) || 0;
    state.stcPrice = parseFloat(document.getElementById('stcPrice').value) || 0;
    state.deemingPeriod = parseFloat(document.getElementById('stcDeemingPeriod').value) || 0;
    state.batteryRebatePerKwh = parseFloat(document.getElementById('batteryRebatePerKwh').value) || 0;
    state.installPvPerKw = parseFloat(document.getElementById('installPerKwPv').value) || 0;
    state.installBatPerStack = parseFloat(document.getElementById('installPerStack').value) || 0;
    state.desiredBatteryKwh = parseFloat(document.getElementById('desiredBatteryKwh').value) || 0;

    // Panel from dropdown
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

    // Panel count / system size
    if (state.panelMode === 'panels') {
        state.panelCount = parseInt(document.getElementById('panelCount').value) || 0;
        state.sysKw = (state.panelCount * state.panelWattage) / 1000;
        document.getElementById('systemSizeInput').value = state.sysKw.toFixed(2);
    } else {
        state.sysKw = parseFloat(document.getElementById('systemSizeInput').value) || 0;
        state.panelCount = Math.ceil((state.sysKw * 1000) / state.panelWattage);
        document.getElementById('panelCount').value = state.panelCount;
    }

    // Inverter from dropdown
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
    let totalKwh = 0, totalModules = 0, usableKwh = 0, equipmentCost = 0;
    CONFIG.batteries.forEach(bat => {
        const q = batteryQtys[bat.kwh] || 0;
        totalKwh += q * bat.kwh;
        totalModules += q;
        usableKwh += q * (bat.usable_kwh || bat.kwh);
        equipmentCost += q * bat.price;
    });
    return { totalKwh, totalModules, usableKwh, equipmentCost };
}

function getMountingKitItems(panelCount, roofType, orientation, numRows, numArrays, tiltAngle, panelWidthMm, panelHeightMm) {
    const mk = CONFIG.mounting_kits;
    if (!mk || panelCount === 0) return { total: 0, items: [] };

    let items = [], total = 0;

    // Step 1: Base kit calculation
    const kitFamily = (roofType === 'metal' || roofType === 'flat') ? 'tin' : 'tile';
    const kit2kw = mk.kits[kitFamily + '_2kw'];
    const kit1_5kw = mk.kits[kitFamily + '_1_5kw'];
    const qty2kw = Math.floor(panelCount / kit2kw.panels_covered);
    const remainder = panelCount % kit2kw.panels_covered;
    const qty1_5kw = (remainder >= 1) ? 1 : 0;
    if (qty2kw > 0) {
        const c = qty2kw * kit2kw.price;
        items.push({ desc: kit2kw.label, sku: '', qty: qty2kw, unit: kit2kw.price, total: c, supplier_code: kit2kw.supplier_code || '' });
        total += c;
    }
    if (qty1_5kw > 0) {
        items.push({ desc: kit1_5kw.label, sku: '', qty: 1, unit: kit1_5kw.price, total: kit1_5kw.price, supplier_code: kit1_5kw.supplier_code || '' });
        total += kit1_5kw.price;
    }

    // Step 2: Rails
    const railLinesPerRow = (orientation === 'landscape') ? mk.rails.landscape_per_row : mk.rails.portrait_per_row;
    const panelSpanMm = (orientation === 'landscape') ? panelHeightMm : panelWidthMm;
    const clampGap = mk.rails.clamp_gap_mm || 25;
    const railLengthMm = mk.rails.length_mm || 4800;
    const panelsPerRow = Math.ceil(panelCount / numRows);
    const totalSpanMm = panelsPerRow * (panelSpanMm + clampGap);
    const physicalRailsPerLine = Math.ceil(totalSpanMm / railLengthMm);
    const totalRails = physicalRailsPerLine * railLinesPerRow * numRows;
    const railCost = totalRails * mk.rails.price;
    items.push({ desc: 'Black Rail 4800mm', sku: '', qty: totalRails, unit: mk.rails.price, total: railCost, supplier_code: mk.rails.supplier_code || '',
        detail: panelsPerRow + ' panels/row, ' + physicalRailsPerLine + ' rails/line x ' + railLinesPerRow + ' lines x ' + numRows + ' rows' });
    total += railCost;

    // Step 2b: Splicers
    const splicersPerLine = Math.max(0, physicalRailsPerLine - 1);
    const totalSplicers = splicersPerLine * railLinesPerRow * numRows;
    if (totalSplicers > 0) {
        const splicerCost = totalSplicers * mk.rails.splicer_price;
        items.push({ desc: 'Rail Splicer', sku: '', qty: totalSplicers, unit: mk.rails.splicer_price, total: splicerCost, supplier_code: mk.rails.splicer_code || '' });
        total += splicerCost;
    }

    // Step 3: Flat roof tilt arms
    if (roofType === 'flat') {
        const tilt = mk.tilt_angles[tiltAngle];
        if (tilt) {
            const c = panelCount * tilt.price;
            items.push({ desc: 'Tilt Arm ' + tilt.label, sku: '', qty: panelCount, unit: tilt.price, total: c, supplier_code: tilt.supplier_code || '' });
            total += c;
        }
    }

    // Step 4: Split array surcharges
    if (numArrays > 1) {
        const extra = numArrays - 1;
        const parts = mk.split_array_surcharge.parts || [];
        let partsCost = 0;
        parts.forEach(p => {
            const qty = p.qty * extra;
            const cost = qty * p.price;
            items.push({ desc: p.desc + ' (extra array)', sku: '', qty: qty, unit: p.price, total: cost, supplier_code: p.supplier_code || '' });
            partsCost += cost;
        });
        const labourCost = extra * mk.split_array_surcharge.labour_surcharge;
        items.push({ desc: 'Extra Array Labour', sku: 'Labour', qty: extra, unit: mk.split_array_surcharge.labour_surcharge, total: labourCost, supplier_code: 'BDS:LABOUR' });
        total += partsCost + labourCost;
    }

    // Step 5: Landscape orientation extras
    if (orientation === 'landscape' && numRows > 0) {
        const le = mk.landscape_extras;
        const attachPrice = (roofType === 'metal' || roofType === 'flat') ? le.tin_attachment_price : le.tile_attachment_price;
        const attachCode = (roofType === 'metal' || roofType === 'flat') ? (le.tin_attachment_code || '') : (le.tile_attachment_code || '');
        const totalAttach = numRows * le.attachments_per_row;
        const c = totalAttach * attachPrice;
        items.push({ desc: 'Landscape Attachments', sku: '', qty: totalAttach, unit: attachPrice, total: c, supplier_code: attachCode });
        total += c;
    }

    return { total: Math.round(total * 100) / 100, items: items };
}

// ====================
// EMBEDDED FALLBACK CONFIG
// Used when config.json cannot be loaded (e.g. running locally)
// ====================
const DEFAULT_CONFIG = {
    "panels": [
        { "brand": "Longi", "model": "X10", "wattage": 475, "price": 121.13, "colour": "Black", "width_mm": 1134, "height_mm": 1800, "supplier_code": "RAY:LONGI-X10-475" },
        { "brand": "Longi", "model": "Hi-MO 7", "wattage": 450, "price": 200, "colour": "Black", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-450" },
        { "brand": "Longi", "model": "Hi-MO 7", "wattage": 440, "price": 190, "colour": "Silver", "width_mm": 1134, "height_mm": 1722, "supplier_code": "RAY:LONGI-HIMO7-440" }
    ],
    "energy_controllers": {
        "single_phase": [
            { "sku": "SigenStor EC 5.0 SP", "kw": 5, "price": 1343, "max_pv_kw": 10, "supplier_code": "SIG:EC-5.0-SP" },
            { "sku": "SigenStor EC 6.0 SP", "kw": 6, "price": 1452, "max_pv_kw": 12, "supplier_code": "SIG:EC-6.0-SP" },
            { "sku": "SigenStor EC 8.0 SP", "kw": 8, "price": 2482, "max_pv_kw": 16, "supplier_code": "SIG:EC-8.0-SP" },
            { "sku": "SigenStor EC 10.0 SP", "kw": 10, "price": 2675, "max_pv_kw": 20, "supplier_code": "SIG:EC-10.0-SP" },
            { "sku": "SigenStor EC 12.0 SP", "kw": 12, "price": 2869, "max_pv_kw": 24, "supplier_code": "SIG:EC-12.0-SP" }
        ],
        "three_phase": [
            { "sku": "SigenStor EC 5.0 TP", "kw": 5, "price": 2300, "max_pv_kw": 8, "supplier_code": "SIG:EC-5.0-TP" },
            { "sku": "SigenStor EC 10.0 TP", "kw": 10, "price": 2663, "max_pv_kw": 16, "supplier_code": "SIG:EC-10.0-TP" },
            { "sku": "SigenStor EC 15.0 TP", "kw": 15, "price": 3511, "max_pv_kw": 24, "supplier_code": "SIG:EC-15.0-TP" },
            { "sku": "SigenStor EC 20.0 TP", "kw": 20, "price": 4007, "max_pv_kw": 32, "supplier_code": "SIG:EC-20.0-TP" },
            { "sku": "SigenStor EC 25.0 TP", "kw": 25, "price": 4600, "max_pv_kw": 40, "supplier_code": "SIG:EC-25.0-TP" },
            { "sku": "SigenStor EC 30.0 TP", "kw": 30, "price": 5060, "max_pv_kw": 48, "supplier_code": "SIG:EC-30.0-TP" }
        ]
    },
    "batteries": [
        { "kwh": 5, "usable_kwh": 5.2, "price": 2905, "label": "5 kWh", "supplier_code": "SIG:BAT-5.0" },
        { "kwh": 8, "usable_kwh": 7.8, "price": 3632, "label": "8 kWh", "supplier_code": "SIG:BAT-8.0" }
    ],
    "battery_rules": { "max_modules": 6, "max_kwh": 48 },
    "gateways": {
        "single_phase": [
            { "sku": "Sigen Gateway Home SP", "price": 645, "desc": "Standard Single Phase ($645)", "supplier_code": "SIG:GW-HOME-SP" },
            { "sku": "Sigen Gateway Home SP AU (Pro)", "price": 695, "desc": "Pro back entry ($695)", "supplier_code": "SIG:GW-HOME-SP-PRO" },
            { "sku": "Sigen CUST Gateway SP-63", "price": 2200, "desc": "Custom 63A up to 24kW ($2,200)", "supplier_code": "SIG:GW-CUST-SP-63" },
            { "sku": "Sigen CUST Gateway SP-63-Hybrid", "price": 3000, "desc": "Custom 63A Hybrid ($3,000)", "supplier_code": "SIG:GW-CUST-SP-63-HYB" },
            { "sku": "Sigen CUST Gateway SP-125", "price": 3200, "desc": "Custom 125A up to 24kW ($3,200)", "supplier_code": "SIG:GW-CUST-SP-125" }
        ],
        "three_phase": [
            { "sku": "Sigen Gateway Home TP AU (Pro)", "price": 859, "desc": "Simple 2-inverter ($859)", "supplier_code": "SIG:GW-HOME-TP-PRO" },
            { "sku": "Sigen Gateway Home TP", "price": 1575, "desc": "Standard Three Phase ($1,575)", "supplier_code": "SIG:GW-HOME-TP" },
            { "sku": "Sigen Gateway C60 AU", "price": 1769, "desc": "C&I 60kW ($1,769)", "supplier_code": "SIG:GW-C60" }
        ]
    },
    "ev_chargers": {
        "dc_12_5": { "price": 2277, "desc": "DC 12kW 5m", "supplier_code": "SIG:EVDC-12-5S2" },
        "dc_25_5": { "price": 3105, "desc": "DC 25kW 5m", "supplier_code": "SIG:EVDC-25-5S2" },
        "dc_12_7.5": { "price": 2484, "desc": "DC 12kW 7.5m", "supplier_code": "SIG:EVDC-12-7.5S2" },
        "dc_25_7.5": { "price": 3312, "desc": "DC 25kW 7.5m", "supplier_code": "SIG:EVDC-25-7.5S2" },
        "dc_12_10": { "price": 2588, "desc": "DC 12kW 10m", "supplier_code": "SIG:EVDC-12-10S2" },
        "dc_25_10": { "price": 3416, "desc": "DC 25kW 10m", "supplier_code": "SIG:EVDC-25-10S2" },
        "ac_7_cable": { "price": 907, "desc": "AC 7kW w/cable", "supplier_code": "SIG:EVAC-7-4G-T2-WH" },
        "ac_11_cable": { "price": 981, "desc": "AC 11kW w/cable", "supplier_code": "SIG:EVAC-11-4G-T2-WH" },
        "ac_22_cable": { "price": 1089, "desc": "AC 22kW w/cable", "supplier_code": "SIG:EVAC-22-4G-T2-WH" },
        "ac_7_socket": { "price": 782, "desc": "AC 7kW socket", "supplier_code": "SIG:EVAC-7-4G-T2SH-WH" },
        "ac_11_socket": { "price": 863, "desc": "AC 11kW socket", "supplier_code": "SIG:EVAC-11-4G-T2SH-WH" },
        "ac_22_socket": { "price": 932, "desc": "AC 22kW socket", "supplier_code": "SIG:EVAC-22-4G-T2SH-WH" }
    },
    "accessories": { "sensor_sp": 101, "sensor_sp_code": "SIG:SENSOR-SP-CT100", "sensor_tp": 202, "sensor_tp_code": "SIG:SENSOR-TP-CT100", "comm_4g": 177, "comm_4g_code": "SIG:4G-COMMMOD", "sub1g": 127, "sub1g_code": "SIG:SUB1G-KIT-AU", "mount_wall": 202, "mount_wall_code": "SIG:MOUNT-WALL", "mount_ground": 202, "mount_ground_code": "SIG:MOUNT-GROUND" },
    "cec_approved": {
        "single_phase": {
            "EC 5.0 SP": [0,5,8,10,13,16,21,24,29,32], "EC 6.0 SP": [0,5,8,10,13,16,21,24,29,32],
            "EC 8.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 10.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48],
            "EC 12.0 SP": [0,5,8,10,13,16,21,24,29,32,37,40,48]
        },
        "three_phase": {
            "EC 5.0 TP": [0,5,8,10,13,16], "EC 10.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48],
            "EC 15.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 20.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48],
            "EC 25.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48], "EC 30.0 TP": [0,5,8,10,13,16,21,24,29,32,37,40,48]
        }
    },
    "installation": { "install_pv_per_kw": 300, "install_battery_per_stack": 1600, "roof_types": { "metal": {"label":"Metal","surcharge":0,"kit_cost_per_panel":0}, "tile": {"label":"Tile","surcharge":100,"kit_cost_per_panel":0}, "concrete": {"label":"Concrete/Terracotta","surcharge":200,"kit_cost_per_panel":0}, "flat": {"label":"Flat","surcharge":300,"kit_cost_per_panel":0} } },
    "rebates": { "stc_price": 40, "stc_deeming_period": 5, "battery_rebate_per_kwh": 311, "stc_zones": [[0,799,3,1.382],[800,853,2,1.536],[854,854,3,1.382],[855,861,2,1.536],[862,862,3,1.382],[863,869,2,1.536],[870,879,1,1.622],[880,885,3,1.382],[886,1000,2,1.536],[1001,2355,3,1.382],[2356,2357,2,1.536],[2358,2384,3,1.382],[2385,2389,2,1.536],[2390,2395,3,1.382],[2396,2397,2,1.536],[2398,2399,3,1.382],[2400,2400,2,1.536],[2401,2404,3,1.382],[2405,2407,2,1.536],[2408,2544,3,1.382],[2545,2554,4,1.185],[2555,2627,3,1.382],[2628,2628,4,1.185],[2629,2629,3,1.382],[2630,2639,4,1.185],[2640,2816,3,1.382],[2817,2817,2,1.536],[2818,2820,3,1.382],[2821,2829,2,1.536],[2830,2830,3,1.382],[2831,2841,2,1.536],[2842,2872,3,1.382],[2873,2873,2,1.536],[2874,2877,3,1.382],[2878,2889,2,1.536],[2890,2999,3,1.382],[3000,3035,4,1.185],[3036,3038,3,1.382],[3039,3044,4,1.185],[3045,3045,3,1.382],[3046,3046,4,1.185],[3047,3049,3,1.382],[3050,3058,4,1.185],[3059,3059,3,1.382],[3060,3060,4,1.185],[3061,3064,3,1.382],[3065,3074,4,1.185],[3075,3076,3,1.382],[3077,3098,4,1.185],[3099,3099,3,1.382],[3100,3292,4,1.185],[3293,3302,3,1.382],[3303,3308,4,1.185],[3309,3319,3,1.382],[3320,3333,4,1.185],[3334,3337,3,1.382],[3338,3339,4,1.185],[3340,3758,3,1.382],[3759,3760,4,1.185],[3761,3764,3,1.382],[3765,3999,4,1.185],[4000,4416,3,1.382],[4417,4417,2,1.536],[4418,4427,3,1.382],[4428,4473,2,1.536],[4474,4476,1,1.622],[4477,4478,2,1.536],[4479,4485,1,1.622],[4486,4491,2,1.536],[4492,4492,1,1.622],[4493,4493,2,1.536],[4494,4494,3,1.382],[4495,4497,2,1.536],[4498,4719,3,1.382],[4720,4722,2,1.536],[4723,4723,3,1.382],[4724,4734,2,1.536],[4735,4736,1,1.622],[4737,4822,3,1.382],[4823,4823,2,1.536],[4824,4824,3,1.382],[4825,4827,2,1.536],[4828,4828,3,1.382],[4829,4829,1,1.622],[4830,5431,3,1.382],[5432,5450,2,1.536],[5451,5654,3,1.382],[5655,5669,2,1.536],[5670,5679,3,1.382],[5680,5699,2,1.536],[5700,5709,3,1.382],[5710,5722,2,1.536],[5723,5724,1,1.622],[5725,5730,2,1.536],[5731,5731,1,1.622],[5732,5732,2,1.536],[5733,5799,1,1.622],[5800,6043,3,1.382],[6044,6044,2,1.536],[6045,6256,3,1.382],[6257,6270,4,1.185],[6271,6316,3,1.382],[6317,6349,4,1.185],[6350,6353,3,1.382],[6354,6356,4,1.185],[6357,6394,3,1.382],[6395,6400,4,1.185],[6401,6430,3,1.382],[6431,6431,2,1.536],[6432,6433,3,1.382],[6434,6440,2,1.536],[6441,6441,1,1.622],[6442,6444,3,1.382],[6445,6459,4,1.185],[6460,6467,3,1.382],[6468,6469,2,1.536],[6470,6471,3,1.382],[6472,6472,2,1.536],[6473,6506,3,1.382],[6507,6508,2,1.536],[6509,6509,3,1.382],[6510,6536,2,1.536],[6537,6537,1,1.622],[6538,6555,2,1.536],[6556,6573,3,1.382],[6574,6602,2,1.536],[6603,6607,3,1.382],[6608,6641,2,1.536],[6642,6724,1,1.622],[6725,6750,2,1.536],[6751,6764,1,1.622],[6765,6765,2,1.536],[6766,6797,1,1.622],[6798,6799,2,1.536],[6800,6999,3,1.382],[7000,8999,4,1.185],[9000,9999,3,1.382]] },
    "addons": { "hot_water_timer": 350, "hot_water_timer_code": "BDS:HWT-001", "meter_board": 800, "meter_board_code": "BDS:MB-001" },
    "gp_margin": 30,
    "mounting_kits": {
        "kits": { "tin_2kw": {"label":"Tin Roof 2kW Pack","panels_covered":4,"price":46.50,"roof_types":["metal","flat"],"supplier_code":"RAY:KIT-TIN-2KW"}, "tin_1_5kw": {"label":"Tin Roof 1.5kW Pack","panels_covered":3,"price":34.90,"roof_types":["metal","flat"],"supplier_code":"RAY:KIT-TIN-1.5KW"}, "tile_2kw": {"label":"Tile Roof 2kW Pack","panels_covered":4,"price":93.00,"roof_types":["tile","concrete"],"supplier_code":"RAY:KIT-TILE-2KW"}, "tile_1_5kw": {"label":"Tile Roof 1.5kW Pack","panels_covered":3,"price":69.50,"roof_types":["tile","concrete"],"supplier_code":"RAY:KIT-TILE-1.5KW"} },
        "tilt_angles": { "10_15": {"label":"10-15 deg","price":11.99,"supplier_code":"RAY:TILT-10/15"}, "15_30": {"label":"15-30 deg","price":13.99,"supplier_code":"RAY:TILT-15/30"}, "30_60": {"label":"30-60 deg","price":14.99,"supplier_code":"RAY:TILT-30/60"} },
        "split_array_surcharge": { "parts": [{"desc":"End Clamp 30/35mm","qty":4,"price":1.10,"supplier_code":"RAY:END-30/35"},{"desc":"Earthing Lug (GLG)","qty":2,"price":0.85,"supplier_code":"RAY:GLG"},{"desc":"Earthing Clip (GC)","qty":2,"price":0.20,"supplier_code":"RAY:GC"}], "labour_surcharge": 100.00 },
        "rails": { "portrait_per_row": 2, "landscape_per_row": 3, "price": 25.50, "length_mm": 4800, "clamp_gap_mm": 25, "splicer_price": 1.60, "supplier_code": "RAY:R-4800-BLK", "splicer_code": "RAY:R-SP" },
        "landscape_extras": { "tin_attachment_price": 1.60, "tin_attachment_code": "RAY:TH-L", "tile_attachment_price": 4.90, "tile_attachment_code": "RAY:RH-1#", "attachments_per_row": 4 }
    }
};

// ====================
// CONFIG LOADING
// ====================

document.addEventListener('DOMContentLoaded', () => { loadConfig(); });

function validateConfig(cfg) {
    const required = ['panels', 'energy_controllers', 'batteries', 'battery_rules', 'gateways', 'cec_approved', 'installation', 'rebates'];
    const missing = required.filter(k => !cfg[k]);
    if (missing.length) throw new Error('Config missing: ' + missing.join(', '));
    if (!cfg.energy_controllers.single_phase || !cfg.energy_controllers.three_phase)
        throw new Error('Config missing phase arrays');
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
    // Initialize battery quantities
    CONFIG.batteries.forEach(b => { batteryQtys[b.kwh] = 0; });
    // Apply installation/rebate/addon/GP from config
    document.getElementById('installPerKwPv').value = CONFIG.installation?.install_pv_per_kw ?? 300;
    document.getElementById('installPerStack').value = CONFIG.installation?.install_battery_per_stack ?? 1600;
    document.getElementById('stcPrice').value = CONFIG.rebates?.stc_price ?? 40;
    document.getElementById('stcDeemingPeriod').value = CONFIG.rebates?.stc_deeming_period ?? 5;
    document.getElementById('batteryRebatePerKwh').value = CONFIG.rebates?.battery_rebate_per_kwh ?? 311;
    document.getElementById('gpMargin').value = CONFIG.gp_margin ?? 30;
    document.getElementById('hotWaterPrice').textContent = '$' + (CONFIG.addons?.hot_water_timer ?? 350);
    document.getElementById('meterBoardPrice').textContent = '$' + (CONFIG.addons?.meter_board ?? 800);
    // Build all UI from config
    populatePanels(); buildBatteryUI(); populateInverters(); populateGateways(); populateEvChargers(); updateSensorPrice(); bindEvents(); updateRoofInfo(); updateMountingKitInfo(); updateZoneDisplay(); calculateQuote();
}

// ====================
// BATTERY UI
// ====================

function buildBatteryUI() {
    const container = document.getElementById('batteryAdjusterRows');
    container.innerHTML = '';
    document.getElementById('maxModulesLabel').textContent = CONFIG.battery_rules.max_modules;
    document.getElementById('maxKwhLabel').textContent = CONFIG.battery_rules.max_kwh;
    const sorted = [...CONFIG.batteries].sort((a, b) => b.kwh - a.kwh);
    sorted.forEach(bat => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;';
        row.innerHTML = '<span>' + bat.label + ' ($' + bat.price.toLocaleString() + ' ea)</span>'
            + '<div style="display:flex;align-items:center;gap:8px;">'
            + '<button class="battery-adj-btn" onclick="adjustBattery(' + bat.kwh + ',-1)">-</button>'
            + '<span id="qty_' + bat.kwh + 'kwh" style="font-weight:700;min-width:24px;text-align:center;">0</span>'
            + '<button class="battery-adj-btn" onclick="adjustBattery(' + bat.kwh + ',1)">+</button>'
            + '</div>';
        container.appendChild(row);
    });
}

// ====================
// ZONE LOOKUP
// ====================

function lookupZone(postcode) {
    const pc = parseInt(postcode);
    if (isNaN(pc) || pc < 0 || pc > 9999) return null;
    const zones = CONFIG.rebates?.stc_zones || [];
    for (const z of zones) {
        if (pc >= z[0] && pc <= z[1]) return { zone: z[2], rating: z[3] };
    }
    return null;
}

function updateZoneDisplay() {
    const pc = document.getElementById('installPostcode').value;
    const info = document.getElementById('stcZoneInfo');
    const result = lookupZone(pc);
    if (!pc) { info.textContent = 'Enter postcode'; info.style.color = '#6b7280'; return; }
    if (!result) { info.textContent = 'Invalid postcode'; info.style.color = '#ef4444'; return; }
    info.textContent = 'Zone ' + result.zone + '  -  Rating ' + result.rating;
    info.style.color = '#34d399';
}

// ====================
// EVENT BINDING
// ====================

function bindEvents() {
    document.querySelectorAll('input, select').forEach(el => { el.addEventListener('input', calculateQuote); el.addEventListener('change', calculateQuote); });
    document.getElementById('installPostcode').addEventListener('input', function() {
        this.value = this.value.replace(/\D/g, '').slice(0, 4);
        updateZoneDisplay();
        calculateQuote();
    });
    document.getElementById('phaseType').addEventListener('change', () => { userChangedInverter = false; populateInverters(); populateGateways(); updateSensorPrice(); calculateQuote(); });
    document.getElementById('panelSelect').addEventListener('change', calculateQuote);
    document.getElementById('panelInputMode').addEventListener('change', togglePanelMode);
    document.getElementById('desiredBatteryKwh').addEventListener('input', () => { manualBatteryMode = false; userChangedInverter = false; });
    document.getElementById('inverterSelect').addEventListener('change', () => { userChangedInverter = true; calculateQuote(); });
    document.getElementById('roofType').addEventListener('change', updateRoofInfo);
    document.getElementById('panelOrientation').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numRows').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('numArrays').addEventListener('input', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('tiltAngle').addEventListener('change', () => { updateMountingKitInfo(); calculateQuote(); });
    document.getElementById('addGateway').addEventListener('change', () => { document.getElementById('gatewayOptions').style.display = document.getElementById('addGateway').checked ? 'block' : 'none'; calculateQuote(); });
    document.getElementById('addEvCharger').addEventListener('change', () => { document.getElementById('evChargerOptions').style.display = document.getElementById('addEvCharger').checked ? 'block' : 'none'; calculateQuote(); });
    // Custom spinner: click right arrow area to step up/down
    document.querySelectorAll('input[type="number"]').forEach(el => {
        el.addEventListener('click', function(e) {
            const rect = this.getBoundingClientRect();
            if (e.clientX > rect.right - 30) {
                const step = parseFloat(this.step) || 1;
                const mid = rect.top + rect.height / 2;
                if (e.clientY < mid) { this.stepUp(); } else { this.stepDown(); }
                this.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
        el.addEventListener('mousemove', function(e) {
            const rect = this.getBoundingClientRect();
            this.style.cursor = (e.clientX > rect.right - 30) ? 'pointer' : 'text';
        });
    });
}

// ====================
// POPULATE DROPDOWNS
// ====================

function populatePanels() {
    const sel = document.getElementById('panelSelect');
    sel.innerHTML = '';
    CONFIG.panels.forEach((p, idx) => {
        const o = document.createElement('option');
        o.value = idx;
        o.textContent = p.brand + ' ' + p.model + ' ' + p.wattage + 'W ' + p.colour + ' ($' + p.price + ')';
        o.dataset.wattage = p.wattage;
        o.dataset.price = p.price;
        o.dataset.brand = p.brand;
        o.dataset.model = p.model;
        o.dataset.colour = p.colour;
        o.dataset.widthMm = p.width_mm || 1134;
        o.dataset.heightMm = p.height_mm || 1800;
        o.dataset.supplierCode = p.supplier_code || '';
        sel.appendChild(o);
    });
}

function populateInverters() {
    const phase = document.getElementById('phaseType').value, sel = document.getElementById('inverterSelect');
    sel.innerHTML = '';
    CONFIG.energy_controllers[phase].forEach(m => {
        const o = document.createElement('option'); o.value = m.sku;
        o.textContent = m.sku + '  -  ' + m.kw + 'kW ($' + m.price.toLocaleString() + ')  -  Max PV: ' + m.max_pv_kw + 'kW';
        o.dataset.kw = m.kw; o.dataset.price = m.price; o.dataset.maxPv = m.max_pv_kw; o.dataset.supplierCode = m.supplier_code || ''; sel.appendChild(o);
    });
}

function populateGateways() {
    const phase = document.getElementById('phaseType').value, sel = document.getElementById('gatewaySelect');
    sel.innerHTML = '';
    CONFIG.gateways[phase].forEach(m => { const o = document.createElement('option'); o.value = m.sku; o.textContent = m.desc; o.dataset.price = m.price; o.dataset.supplierCode = m.supplier_code || ''; sel.appendChild(o); });
}

function updateSensorPrice() {
    const p = document.getElementById('phaseType').value === 'single_phase' ? (CONFIG.accessories?.sensor_sp ?? 101) : (CONFIG.accessories?.sensor_tp ?? 202);
    document.getElementById('powerSensorPrice').textContent = '$' + p;
}

function populateEvChargers() {
    const sel = document.getElementById('evChargerType');
    sel.innerHTML = '<option value="none"> -  Select  - </option>';
    const groups = { dc: [], ac_cable: [], ac_socket: [] };
    Object.entries(CONFIG.ev_chargers).forEach(([key, val]) => {
        if (key.startsWith('dc_')) groups.dc.push({ key, ...val });
        else if (key.includes('_cable')) groups.ac_cable.push({ key, ...val });
        else if (key.includes('_socket')) groups.ac_socket.push({ key, ...val });
    });
    const addGroup = (label, items) => {
        if (items.length === 0) return;
        const grp = document.createElement('optgroup');
        grp.label = label;
        items.forEach(item => {
            const o = document.createElement('option');
            o.value = item.key;
            o.textContent = item.desc + ' ($' + item.price.toLocaleString() + ')';
            grp.appendChild(o);
        });
        sel.appendChild(grp);
    };
    addGroup('DC (connects to Energy Controller)', groups.dc);
    addGroup('AC with Cable', groups.ac_cable);
    addGroup('AC Socket Only', groups.ac_socket);
}

// ====================
// PANEL MODE TOGGLE
// ====================

function togglePanelMode() {
    const m = document.getElementById('panelInputMode').value;
    document.getElementById('panelCountGroup').style.display = m === 'panels' ? 'block' : 'none';
    document.getElementById('systemSizeGroup').style.display = m === 'kw' ? 'block' : 'none';
    calculateQuote();
}

// ====================
// BATTERY MANAGEMENT
// ====================

function adjustBattery(kwh, delta) {
    const newQty = Math.max(0, (batteryQtys[kwh] || 0) + delta);
    const testQtys = Object.assign({}, batteryQtys, {[kwh]: newQty});
    const totalMod = Object.values(testQtys).reduce((s, v) => s + v, 0);
    const totalKwh = Object.entries(testQtys).reduce((s, [k, v]) => s + (parseFloat(k) * v), 0);
    const maxMod = CONFIG.battery_rules.max_modules;
    const maxKwh = CONFIG.battery_rules.max_kwh;
    if (totalMod > maxMod || totalKwh > maxKwh) {
        const w = document.getElementById('batteryCapWarning'); w.style.display = 'inline';
        setTimeout(() => w.style.display = 'none', 2000); return;
    }
    batteryQtys[kwh] = newQty;
    manualBatteryMode = true; userChangedInverter = false;
    updateBatteryUI();
    document.getElementById('desiredBatteryKwh').value = getBatterySummary().totalKwh;
    calculateQuote();
}

function updateBatteryUI() {
    const bat = getBatterySummary();
    // Update each row's quantity display
    CONFIG.batteries.forEach(b => {
        const el = document.getElementById('qty_' + b.kwh + 'kwh');
        if (el) el.textContent = batteryQtys[b.kwh] || 0;
    });
    document.getElementById('batteryTotalDisplay').textContent = bat.totalKwh;
    document.getElementById('batteryModuleCount').textContent = bat.totalModules;
    // Build breakdown text (sorted largest first)
    const sorted = [...CONFIG.batteries].sort((a, b) => b.kwh - a.kwh);
    let parts = [];
    sorted.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) parts.push(q + 'x ' + b.kwh + 'kWh'); });
    document.getElementById('batteryBreakdown').innerHTML = parts.length ? parts.join(' + ') + ' = ' + bat.totalKwh + ' kWh' : 'No batteries selected';
}

function optimizeBattery(desired) {
    if (!CONFIG.batteries) return { qtys: {}, total: 0, cost: 0 };
    const maxMod = CONFIG.battery_rules.max_modules;
    const maxKwh = CONFIG.battery_rules.max_kwh;
    if (desired <= 0 || desired > maxKwh) { const result = {}; CONFIG.batteries.forEach(b => result[b.kwh] = 0); return { qtys: result, total: 0, cost: 0 }; }

    const rebatePerKwh = state.batteryRebatePerKwh;
    const gpMargin = state.gpMargin / 100;

    const sorted = [...CONFIG.batteries].sort((a, b) => (a.price / a.kwh) - (b.price / b.kwh));
    let bestCombo = null, bestCustomerCost = Infinity, bestTotal = Infinity;

    function customerCost(equipCost, totalUsableKwh) {
        const withGP = equipCost * (1 + gpMargin);
        return withGP - (totalUsableKwh * rebatePerKwh);
    }

    function search(idx, qtys, totalKwh, totalUsableKwh, totalEquipCost, totalModules) {
        if (totalKwh >= desired) {
            const cc = customerCost(totalEquipCost, totalUsableKwh);
            if (cc < bestCustomerCost || (cc === bestCustomerCost && totalKwh < bestTotal)) {
                bestCombo = Object.assign({}, qtys);
                bestCustomerCost = cc;
                bestTotal = totalKwh;
            }
        }
        if (idx >= sorted.length) return;
        const bat = sorted[idx];
        const maxQty = Math.min(maxMod - totalModules, Math.floor((maxKwh - totalKwh) / bat.kwh) + 1);
        for (let q = 0; q <= maxQty; q++) {
            const newKwh = totalKwh + (q * bat.kwh);
            const newUsableKwh = totalUsableKwh + (q * (bat.usable_kwh || bat.kwh));
            const newMod = totalModules + q;
            if (newMod > maxMod || newKwh > maxKwh + bat.kwh) break;
            qtys[bat.kwh] = q;
            search(idx + 1, qtys, newKwh, newUsableKwh, totalEquipCost + (q * bat.price), newMod);
        }
        qtys[bat.kwh] = 0;
    }

    const initQtys = {};
    CONFIG.batteries.forEach(b => initQtys[b.kwh] = 0);
    search(0, initQtys, 0, 0, 0, 0);

    if (!bestCombo) { const fallback = {}; CONFIG.batteries.forEach(b => fallback[b.kwh] = 0); return { qtys: fallback, total: 0, cost: 0 }; }
    return { qtys: bestCombo, total: bestTotal, cost: bestCustomerCost };
}

// ====================
// CEC & INVERTER LOGIC
// ====================

function getCecKey(sku) { return sku.replace('SigenStor ', ''); }

function checkCec(sku, kwh, phase) {
    const key = getCecKey(sku), combos = CONFIG.cec_approved[phase];
    if (!combos || !combos[key]) return { ok: false, msg: 'No CEC data' };
    if (combos[key].includes(kwh)) return { ok: true, msg: '[OK] CEC approved: ' + key + ' + ' + kwh + 'kWh' };
    const nearest = combos[key].filter(k => k >= kwh).sort((a,b) => a-b)[0] || combos[key][combos[key].length - 1];
    return { ok: false, msg: '[!] ' + kwh + 'kWh not CEC approved with ' + key + '. Nearest: ' + nearest + 'kWh' };
}

function autoSelectInverter(sysKw, battKwh, phase) {
    const models = CONFIG.energy_controllers[phase], combos = CONFIG.cec_approved[phase];
    for (const m of models) { const k = getCecKey(m.sku); if (m.max_pv_kw >= sysKw && combos[k] && combos[k].includes(battKwh)) return m.sku; }
    for (const m of models) { const k = getCecKey(m.sku); if (combos[k] && combos[k].includes(battKwh)) return m.sku; }
    return models[models.length - 1].sku;
}

// ====================
// ROOF & MOUNTING
// ====================

function updateRoofInfo() {
    const roofType = document.getElementById('roofType').value;
    const tiltGroup = document.getElementById('tiltAngleGroup');
    if (tiltGroup) tiltGroup.style.display = (roofType === 'flat') ? 'block' : 'none';
    updateMountingKitInfo();
    calculateQuote();
}

function updateMountingKitInfo() {
    // Mounting kit details now only shown in BOM page
}

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
        if (!CONFIG.energy_controllers) return;

        syncStateFromDOM();

        document.getElementById('systemCalc').textContent = 'System: ' + state.sysKw.toFixed(2) + ' kW (' + state.panelCount + ' panels)';

        const desired = state.desiredBatteryKwh;
        let actualKwh = 0;
        if (!manualBatteryMode && desired > 0) {
            const opt = optimizeBattery(desired);
            batteryQtys = opt.qtys;
            actualKwh = opt.total;
            updateBatteryUI();
            if (actualKwh > desired) document.getElementById('batteryBreakdown').innerHTML += ' <span style="color:#34d399;">(+' + (actualKwh - desired) + 'kWh, cheaper)</span>';
        } else if (manualBatteryMode) { actualKwh = getBatterySummary().totalKwh; }
        state.actualBatteryKwh = actualKwh;
        document.getElementById('batteryConfigPanel').style.display = desired > 0 ? 'block' : 'none';

        if (!userChangedInverter) {
            const rec = autoSelectInverter(state.sysKw, actualKwh, state.phase), sel = document.getElementById('inverterSelect');
            for (let i = 0; i < sel.options.length; i++) { if (sel.options[i].value === rec) { sel.selectedIndex = i; break; } }
            syncStateFromDOM(); // Re-sync after inverter change
        }

        document.getElementById('inverterInfo').style.display = 'block';
        document.getElementById('inverterInfo').innerHTML = 'Max PV: ' + state.invMaxPv + 'kW | Inverter: ' + state.invKw + 'kW | Oversizing: ' + (state.phase === 'single_phase' ? '200%' : '160%');
        if (state.sysKw > state.invMaxPv) { document.getElementById('inverterWarning').style.display = 'block'; document.getElementById('inverterWarning').innerHTML = '[!] PV (' + state.sysKw.toFixed(1) + 'kW) exceeds max (' + state.invMaxPv + 'kW). Select larger inverter.'; }
        else { document.getElementById('inverterWarning').style.display = 'none'; }

        const cec = checkCec(state.invSku, actualKwh, state.phase);
        if (actualKwh > 0) {
            document.getElementById('cecApproved').style.display = cec.ok ? 'block' : 'none'; document.getElementById('cecApproved').textContent = cec.ok ? cec.msg : '';
            document.getElementById('cecWarning').style.display = !cec.ok ? 'block' : 'none'; document.getElementById('cecWarning').textContent = !cec.ok ? cec.msg : '';
        } else { document.getElementById('cecWarning').style.display = 'none'; document.getElementById('cecApproved').style.display = 'none'; }

        const bat = getBatterySummary();
        const costPanels = state.panelCount * state.panelCost;
        const costInverter = state.invPrice;
        const costBattery = bat.equipmentCost;
        let costGateway = 0;
        if (document.getElementById('addGateway').checked) { const gw = document.getElementById('gatewaySelect'); costGateway = parseFloat(gw.options[gw.selectedIndex]?.dataset.price) || 0; }
        let costAcc = 0;
        if (document.getElementById('addPowerSensor').checked) costAcc += state.phase === 'single_phase' ? (CONFIG.accessories?.sensor_sp ?? 101) : (CONFIG.accessories?.sensor_tp ?? 202);
        if (document.getElementById('add4GModule').checked) costAcc += CONFIG.accessories?.comm_4g ?? 177;
        if (document.getElementById('addSub1GKit').checked) costAcc += CONFIG.accessories?.sub1g ?? 127;
        let costEv = 0;
        if (document.getElementById('addEvCharger').checked) { const t = document.getElementById('evChargerType').value; if (t !== 'none' && CONFIG.ev_chargers[t]) costEv = CONFIG.ev_chargers[t].price; }

        const installPv = state.sysKw * state.installPvPerKw;
        const installBat = (bat.totalModules > 0) ? state.installBatPerStack : 0;
        const roof = CONFIG.installation?.roof_types?.[state.roofType] || { surcharge: 0 };
        const costRoofSurcharge = roof.surcharge;
        const mountingResult = getMountingKitItems(state.panelCount, state.roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
        const costRoofKit = mountingResult.total;
        const costMount = (bat.totalModules > 0) ? (CONFIG.accessories?.[state.mountingType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 202) : 0;
        let costAddons = 0;
        if (document.getElementById('addonHotWater').checked) costAddons += parseFloat(document.getElementById('hotWaterPrice').textContent.replace('$','')) || 0;
        if (document.getElementById('addonMeterBoard').checked) costAddons += parseFloat(document.getElementById('meterBoardPrice').textContent.replace('$','')) || 0;
        for (let i = 1; i <= customAddonCount; i++) { const ce = document.getElementById('customCost-' + i), ne = document.getElementById('customName-' + i); if (ce && ne && ne.value.trim()) costAddons += parseFloat(ce.value) || 0; }

        // Group totals
        const totalPv = costPanels + costRoofKit + costRoofSurcharge;
        const totalBattery = costInverter + costBattery + costGateway + costMount;
        const totalInstall = installPv + installBat + costAcc + costEv + costAddons;
        const totalCog = totalPv + totalBattery + totalInstall;

        const zoneResult = lookupZone(document.getElementById('installPostcode').value);
        const zoneRating = zoneResult ? zoneResult.rating : 0;
        const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
        const pvReb = pvStcCount * state.stcPrice;
        const batReb = bat.usableKwh * state.batteryRebatePerKwh;
        const gpAmt = totalCog * (state.gpMargin / 100);
        const priceBeforeRebates = totalCog + gpAmt;
        const finalPrice = priceBeforeRebates - pvReb - batReb;

        document.getElementById('costPanels').textContent = fmtIncGst(costPanels); document.getElementById('costInverter').textContent = fmtIncGst(costInverter);
        document.getElementById('costRoofKit').textContent = fmtIncGst(costRoofKit); document.getElementById('totalPv').textContent = fmtIncGst(totalPv);
        document.getElementById('costBattery').textContent = fmtIncGst(costBattery); document.getElementById('costGateway').textContent = fmtIncGst(costGateway);
        document.getElementById('costMounting').textContent = fmtIncGst(costMount); document.getElementById('totalBattery').textContent = fmtIncGst(totalBattery);
        document.getElementById('costInstallPv').textContent = fmtIncGst(installPv); document.getElementById('costInstallBattery').textContent = fmtIncGst(installBat);
        document.getElementById('costRoofSurcharge').textContent = fmtIncGst(costRoofSurcharge);
        document.getElementById('costAccessories').textContent = fmtIncGst(costAcc); document.getElementById('costEvCharger').textContent = fmtIncGst(costEv);
        document.getElementById('costAddons').textContent = fmtIncGst(costAddons); document.getElementById('totalInstall').textContent = fmtIncGst(totalInstall);
        document.getElementById('totalCog').textContent = fmtIncGst(totalCog); document.getElementById('gpLabel').textContent = 'GP (' + state.gpMargin + '%)'; document.getElementById('gpAmount').textContent = fmtIncGst(gpAmt);
        document.getElementById('priceBeforeRebates').textContent = fmtIncGst(priceBeforeRebates);
        document.getElementById('pvRebateLabel').textContent = pvStcCount > 0 ? 'PV STC Rebate (' + pvStcCount + ' STCs)' : 'PV STC Rebate';
        document.getElementById('stcPvRebate').textContent = '-' + fmtIncGst(pvReb);
        document.getElementById('stcBatteryRebate').textContent = '-' + fmtIncGst(batReb);
        document.getElementById('finalPrice').textContent = fmtIncGst(finalPrice);

        let batText = 'No Battery';
        if (actualKwh > 0) {
            const sorted = [...CONFIG.batteries].sort((a, b) => b.kwh - a.kwh);
            let p = []; sorted.forEach(b => { const q = batteryQtys[b.kwh] || 0; if (q > 0) p.push(q + 'x ' + b.kwh + 'kWh'); });
            batText = actualKwh + 'kWh Battery (' + p.join(' + ') + ')';
        }
        let specs = '<strong>' + state.sysKw.toFixed(2) + ' kW Solar System</strong><br>' + state.panelCount + ' x ' + esc(state.panelBrand) + ' ' + esc(state.panelModel) + ' ' + state.panelWattage + 'W ' + esc(state.panelColour) + '<br>' + esc(state.invSku) + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)<br>' + esc(batText);
        if (document.getElementById('addGateway').checked) { const gw = document.getElementById('gatewaySelect'); specs += '<br>Gateway: ' + esc(gw.options[gw.selectedIndex]?.textContent || ''); }
        if (document.getElementById('addEvCharger').checked && document.getElementById('evChargerType').value !== 'none') { specs += '<br>EV: ' + esc(CONFIG.ev_chargers[document.getElementById('evChargerType').value]?.desc || ''); }
        document.getElementById('systemSpecs').innerHTML = specs;

    } catch (err) {
        console.error('[!] Quote calculation error:', err);
    }
}

// ====================
// BILL OF MATERIALS
// ====================

function buildBOM() {
    syncStateFromDOM();

    const bat = getBatterySummary();
    const roofType = state.roofType;
    const roof = CONFIG.installation?.roof_types?.[roofType] || { label: roofType, surcharge: 0 };

    let bom = [];

    // === PV EQUIPMENT ===
    let pvItems = [];
    pvItems.push({ desc: state.panelBrand + ' ' + state.panelModel + ' ' + state.panelWattage + 'W ' + state.panelColour, sku: state.panelModel, qty: state.panelCount, unit: state.panelCost, total: state.panelCount * state.panelCost, supplier_code: state.panelSupplierCode });

    // Mounting kit items from shared function
    const mountingItems = getMountingKitItems(state.panelCount, roofType, state.orientation, state.numRows, state.numArrays, state.tiltAngle, state.panelWidthMm, state.panelHeightMm);
    mountingItems.items.forEach(item => { pvItems.push(item); });

    // Roof surcharge
    if (roof.surcharge > 0) pvItems.push({ desc: roof.label + ' Roof Surcharge', sku: '', qty: 1, unit: roof.surcharge, total: roof.surcharge, supplier_code: 'BDS:ROOF-SURCHARGE' });

    bom.push({ category: 'PV Equipment & Mounting', items: pvItems });

    // === BATTERY & ENERGY CONTROLLER ===
    let batItems = [];
    batItems.push({ desc: state.invSku + ' (' + state.invKw + 'kW ' + (state.phase === 'single_phase' ? 'Single' : 'Three') + ' Phase)', sku: state.invSku, qty: 1, unit: state.invPrice, total: state.invPrice, supplier_code: state.invSupplierCode });

    CONFIG.batteries.forEach(b => {
        const q = batteryQtys[b.kwh] || 0;
        if (q > 0) batItems.push({ desc: b.label || (b.kwh + 'kWh Battery Module'), sku: '', qty: q, unit: b.price, total: q * b.price, supplier_code: b.supplier_code || '' });
    });

    if (document.getElementById('addGateway').checked) {
        const gw = document.getElementById('gatewaySelect');
        const gwOpt = gw.options[gw.selectedIndex];
        const gwPrice = parseFloat(gwOpt?.dataset.price) || 0;
        if (gwPrice > 0) batItems.push({ desc: 'Gateway: ' + (gwOpt?.textContent || ''), sku: gwOpt?.value || '', qty: 1, unit: gwPrice, total: gwPrice, supplier_code: gwOpt?.dataset.supplierCode || '' });
    }

    // Mount kit only if batteries > 0
    if (bat.totalModules > 0) {
        const mountType = state.mountingType;
        const mountPrice = CONFIG.accessories?.[mountType === 'wall' ? 'mount_wall' : 'mount_ground'] ?? 202;
        const mountCode = CONFIG.accessories?.[mountType === 'wall' ? 'mount_wall_code' : 'mount_ground_code'] || '';
        batItems.push({ desc: (mountType === 'wall' ? 'Wall' : 'Ground') + ' Mount Kit', sku: '', qty: 1, unit: mountPrice, total: mountPrice, supplier_code: mountCode });
    }

    bom.push({ category: 'Battery & Energy Controller', items: batItems });

    // === ACCESSORIES ===
    let accItems = [];
    if (document.getElementById('addPowerSensor').checked) {
        const sp = state.phase === 'single_phase';
        const sPrice = sp ? (CONFIG.accessories?.sensor_sp ?? 101) : (CONFIG.accessories?.sensor_tp ?? 202);
        accItems.push({ desc: 'Power Sensor (' + (sp ? 'Single' : 'Three') + ' Phase)', sku: '', qty: 1, unit: sPrice, total: sPrice, supplier_code: sp ? (CONFIG.accessories?.sensor_sp_code || '') : (CONFIG.accessories?.sensor_tp_code || '') });
    }
    if (document.getElementById('add4GModule').checked) {
        const p = CONFIG.accessories?.comm_4g ?? 177;
        accItems.push({ desc: '4G Comms Module', sku: '', qty: 1, unit: p, total: p, supplier_code: CONFIG.accessories?.comm_4g_code || '' });
    }
    if (document.getElementById('addSub1GKit').checked) {
        const p = CONFIG.accessories?.sub1g ?? 127;
        accItems.push({ desc: 'Sub1G Sensor Kit', sku: '', qty: 1, unit: p, total: p, supplier_code: CONFIG.accessories?.sub1g_code || '' });
    }
    if (document.getElementById('addEvCharger').checked) {
        const t = document.getElementById('evChargerType').value;
        if (t !== 'none' && CONFIG.ev_chargers[t]) {
            const ev = CONFIG.ev_chargers[t];
            accItems.push({ desc: 'EV Charger: ' + ev.desc, sku: t, qty: 1, unit: ev.price, total: ev.price, supplier_code: ev.supplier_code || '' });
        }
    }
    if (accItems.length > 0) bom.push({ category: 'Accessories', items: accItems });

    // === ADD-ONS ===
    let addonItems = [];
    if (document.getElementById('addonHotWater').checked) {
        const p = CONFIG.addons?.hot_water_timer ?? 350;
        addonItems.push({ desc: 'Hot Water Timer', sku: '', qty: 1, unit: p, total: p, supplier_code: CONFIG.addons?.hot_water_timer_code || '' });
    }
    if (document.getElementById('addonMeterBoard').checked) {
        const p = CONFIG.addons?.meter_board ?? 800;
        addonItems.push({ desc: 'New Meter Board', sku: '', qty: 1, unit: p, total: p, supplier_code: CONFIG.addons?.meter_board_code || '' });
    }
    for (let i = 1; i <= customAddonCount; i++) {
        const ne = document.getElementById('customName-' + i), ce = document.getElementById('customCost-' + i);
        if (ne && ce && ne.value.trim()) {
            const p = parseFloat(ce.value) || 0;
            addonItems.push({ desc: ne.value.trim(), sku: 'Custom', qty: 1, unit: p, total: p, supplier_code: 'BDS:CUSTOM' });
        }
    }
    if (addonItems.length > 0) bom.push({ category: 'Add-ons', items: addonItems });

    // === INSTALLATION (Labour) ===
    let installItems = [];
    installItems.push({ desc: 'PV Installation (' + state.sysKw.toFixed(2) + 'kW)', sku: 'Labour', qty: 1, unit: state.sysKw * state.installPvPerKw, total: state.sysKw * state.installPvPerKw, supplier_code: 'BDS:LABOUR-PV' });
    if (bat.totalModules > 0) {
        installItems.push({ desc: 'Battery Installation', sku: 'Labour', qty: 1, unit: state.installBatPerStack, total: state.installBatPerStack, supplier_code: 'BDS:LABOUR-BAT' });
    }
    bom.push({ category: 'Installation (Labour)', items: installItems });

    return bom;
}

function showBOM() {
    const bom = buildBOM();

    // Customer header (XSS-safe)
    const name = document.getElementById('customerName').value || 'Customer';
    const addr = document.getElementById('installAddress').value || '';
    const suburb = document.getElementById('installSuburb')?.value || '';
    const st = document.getElementById('installState')?.value || '';
    const pc = document.getElementById('installPostcode').value || '';
    const phone = document.getElementById('customerPhone')?.value || '';
    const email = document.getElementById('customerEmail')?.value || '';
    const date = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
    let addrLine = [addr, suburb, st, pc].filter(Boolean).join(', ');
    let custHtml = '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px;">';
    custHtml += '<div><strong style="color:#f0f0f0;">' + esc(name) + '</strong>';
    if (addrLine) custHtml += '<br>' + esc(addrLine);
    custHtml += '</div>';
    custHtml += '<div style="text-align:right;"><span style="color:#f0f0f0;">' + esc(date) + '</span>';
    if (phone) custHtml += '<br>' + esc(phone);
    if (email) custHtml += '<br>' + esc(email);
    custHtml += '</div></div>';
    document.getElementById('bomCustomerHeader').innerHTML = custHtml;

    // Build BOM table
    let html = '';
    let grandTotal = 0;

    bom.forEach((group, gi) => {
        const groupTotal = group.items.reduce((s, item) => s + item.total, 0);
        grandTotal += groupTotal;

        html += '<div style="background:#141414; border:1px solid #2a2a2a; border-radius:8px; margin-bottom:12px; overflow:hidden;">';
        // Category header (clickable)
        html += '<div onclick="toggleBomGroup(' + gi + ')" style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; cursor:pointer; user-select:none;">';
        html += '<div style="display:flex; align-items:center; gap:10px;">';
        html += '<span id="bomChevron' + gi + '" style="color:#e000f0; font-size:12px; transition:transform 0.2s;">&#9654;</span>';
        html += '<span style="color:#e000f0; font-size:13px; font-weight:600; text-transform:uppercase; letter-spacing:1px;">' + esc(group.category) + '</span>';
        html += '<span style="color:#6b7280; font-size:12px;">(' + group.items.length + ' item' + (group.items.length !== 1 ? 's' : '') + ')</span>';
        html += '</div>';
        html += '<span style="color:#f0f0f0; font-weight:600;">' + fmtExGst(groupTotal) + '</span>';
        html += '</div>';

        // Detail table (hidden by default)
        html += '<div id="bomGroup' + gi + '" style="display:none; border-top:1px solid #2a2a2a;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:13px;">';
        html += '<thead><tr style="color:#6b7280; text-transform:uppercase; font-size:11px; letter-spacing:0.5px;">';
        html += '<th style="text-align:left; padding:10px 20px; border-bottom:1px solid #222;">Description</th>';
        html += '<th style="text-align:center; padding:10px 12px; border-bottom:1px solid #222; width:60px;">Qty</th>';
        html += '<th style="text-align:right; padding:10px 12px; border-bottom:1px solid #222; width:100px;">Unit (ex GST)</th>';
        html += '<th style="text-align:right; padding:10px 20px; border-bottom:1px solid #222; width:110px;">Total (ex GST)</th>';
        html += '</tr></thead><tbody>';

        group.items.forEach((item, ii) => {
            const bg = ii % 2 === 0 ? '#1a1a1a' : '#141414';
            html += '<tr style="background:' + bg + '; color:#d1d5db;">';
            html += '<td style="padding:9px 20px;">' + esc(item.desc) + (item.sku && item.sku !== 'Custom' && item.sku !== 'Labour' ? ' <span style="color:#6b7280; font-size:11px;">(' + esc(item.sku) + ')</span>' : '') + '</td>';
            html += '<td style="text-align:center; padding:9px 12px;">' + item.qty + '</td>';
            html += '<td style="text-align:right; padding:9px 12px;">' + fmtExGstDecimal(item.unit) + '</td>';
            html += '<td style="text-align:right; padding:9px 20px; color:#f0f0f0; font-weight:500;">' + fmtExGstDecimal(item.total) + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
    });

    document.getElementById('bomContent').innerHTML = html;

    // Totals footer
    const gp = state.gpMargin;
    const gpAmt = grandTotal * (gp / 100);
    const beforeRebates = grandTotal + gpAmt;

    const zoneResult = lookupZone(document.getElementById('installPostcode').value);
    const zoneRating = zoneResult ? zoneResult.rating : 0;
    const pvStcCount = zoneRating > 0 ? Math.floor(state.sysKw * zoneRating * state.deemingPeriod) : 0;
    const pvReb = pvStcCount * state.stcPrice;
    const batSummary = getBatterySummary();
    const batReb = batSummary.usableKwh * state.batteryRebatePerKwh;
    const finalPrice = beforeRebates - pvReb - batReb;

    let totHtml = '<table style="width:100%; font-size:14px; border-collapse:collapse;">';
    const totRow = (label, val, style) => '<tr style="' + (style || '') + '"><td style="padding:8px 0; color:#9ca3af;">' + label + '</td><td style="padding:8px 0; text-align:right; color:#f0f0f0; font-weight:500;">' + val + '</td></tr>';
    totHtml += totRow('Total COG (ex GST)', fmtExGst(grandTotal));
    totHtml += totRow('GP (' + gp + '%)', fmtExGst(gpAmt));
    totHtml += totRow('Price Before Rebates (ex GST)', fmtExGst(beforeRebates), 'border-top:1px solid #333;');
    if (pvReb > 0) totHtml += totRow('PV STC Rebate (' + pvStcCount + ' STCs)', '-' + fmtExGst(pvReb), 'color:#34d399;');
    if (batReb > 0) totHtml += totRow('Battery STC Rebate', '-' + fmtExGst(batReb), 'color:#34d399;');
    totHtml += '<tr style="border-top:2px solid #e000f0;"><td style="padding:12px 0; color:#e000f0; font-weight:700; font-size:16px;">Customer Price (inc GST)</td>';
    totHtml += '<td style="padding:12px 0; text-align:right; color:#e000f0; font-weight:700; font-size:18px;">' + fmtIncGst(finalPrice) + '</td></tr>';
    totHtml += '</table>';
    document.getElementById('bomTotals').innerHTML = totHtml;

    document.getElementById('bomOverlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeBOM() {
    document.getElementById('bomOverlay').style.display = 'none';
    document.body.style.overflow = '';
}

function toggleBomGroup(gi) {
    const el = document.getElementById('bomGroup' + gi);
    const chev = document.getElementById('bomChevron' + gi);
    if (el.style.display === 'none') {
        el.style.display = 'block';
        chev.style.transform = 'rotate(90deg)';
    } else {
        el.style.display = 'none';
        chev.style.transform = 'rotate(0deg)';
    }
}

function generateQuote() {
    const pc = document.getElementById('installPostcode').value;
    if (!pc || !lookupZone(pc)) { alert('Please enter a valid postcode before generating a quote.'); document.getElementById('installPostcode').focus(); return; }
    const name = document.getElementById('customerName').value || 'Customer';
    const addr = [document.getElementById('installAddress').value, document.getElementById('installSuburb')?.value, document.getElementById('installState')?.value, pc].filter(Boolean).join(', ');
    alert('Quote for ' + name + '\nAddress: ' + (addr || 'TBD') + '\nTotal: ' + document.getElementById('finalPrice').textContent + '\n\n(PDF generation coming soon)');
}
