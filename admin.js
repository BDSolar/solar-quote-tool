// ====================
// Black Diamond Solar - Contractor Admin
// ====================

// === SUPABASE INIT ===
const SUPABASE_URL = 'https://rjobiaevpjcwgmlhdevf.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqb2JpYWV2cGpjd2dtbGhkZXZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE1ODA4ODMsImV4cCI6MjA4NzE1Njg4M30.tPdtYhznf7-Zc4BNFazTNsKu5ecUtUVPNcRM3bnGO0s';
let sb = null;
try {
    sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('[OK] Supabase connected');
} catch (err) {
    console.warn('[!] Supabase init failed:', err);
}

// === AUTH ===
async function checkAuth() {
    if (!sb) return false;
    var { data } = await sb.auth.getSession();
    return !!(data && data.session);
}

async function handleLogin(e) {
    e.preventDefault();
    var email = document.getElementById('loginEmail').value.trim();
    var pw = document.getElementById('loginPassword').value;
    var errEl = document.getElementById('loginError');
    errEl.style.display = 'none';
    if (!sb) { errEl.textContent = 'Database not available'; errEl.style.display = 'block'; return; }
    var { error } = await sb.auth.signInWithPassword({ email: email, password: pw });
    if (error) {
        errEl.textContent = error.message || 'Login failed';
        errEl.style.display = 'block';
        return;
    }
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('adminContainer').style.display = '';
    loadContractors();
}

async function handleLogout() {
    if (!sb) return;
    await sb.auth.signOut();
    document.getElementById('adminContainer').style.display = 'none';
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('loginPassword').value = '';
    document.getElementById('loginError').style.display = 'none';
}

// === STATE ===
let contractors = [];
let selectedContractorId = null;
let selectedContractor = null;
let rateCardItems = [];
let activeTab = 'details';
let listFilter = 'active';
let listSearchQuery = '';
let confirmCallback = null;
let editingItemId = null; // null = new item

// === XSS HELPER ===
function esc(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
}

// === DEFAULT RATE CARD ITEMS ===
const DEFAULT_RATE_CARD_ITEMS = [
    { sort_order: 1,  category: 'pv',         label: 'PV Install - Base Rate',                 pricing_type: 'per_watt',    input_type: 'auto',     rate: 0.30,   threshold: 15,   threshold_type: 'under', conditions: null,                                                    applies_to: 'sysKw' },
    { sort_order: 2,  category: 'pv',         label: 'PV Install - Secondary Rate',            pricing_type: 'per_watt',    input_type: 'auto',     rate: 0.27,   threshold: 15,   threshold_type: 'over',  conditions: null,                                                    applies_to: 'sysKw' },
    { sort_order: 3,  category: 'pv',         label: 'Per split (if more than 2)',             pricing_type: 'flat',        input_type: 'auto',     rate: 80,     threshold: 2,    threshold_type: 'after', conditions: null,                                                    applies_to: 'arrays' },
    { sort_order: 4,  category: 'pv',         label: 'Klip Lock per panel',                    pricing_type: 'per_panel',   input_type: 'auto',     rate: 15,     threshold: null, threshold_type: null,    conditions: { roof_type: 'kliplock' },                               applies_to: 'panelCount' },
    { sort_order: 5,  category: 'pv',         label: 'Tile Roof',                              pricing_type: 'flat',        input_type: 'auto',     rate: 120,    threshold: null, threshold_type: null,    conditions: { roof_type: 'tile' },                                   applies_to: null },
    { sort_order: 6,  category: 'pv',         label: 'Double Storey',                          pricing_type: 'flat',        input_type: 'auto',     rate: 120,    threshold: null, threshold_type: null,    conditions: { storey: 2 },                                           applies_to: null },
    { sort_order: 7,  category: 'pv',         label: 'Terracotta per panel',                   pricing_type: 'per_panel',   input_type: 'auto',     rate: 20,     threshold: null, threshold_type: null,    conditions: { roof_type: 'terracotta' },                             applies_to: 'panelCount' },
    { sort_order: 8,  category: 'pv',         label: 'Optimiser per panel',                    pricing_type: 'per_panel',   input_type: 'addon',    rate: 10,     threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: 'optimiserCount' },
    { sort_order: 9,  category: 'electrical', label: 'Energy Meter (inc basic wifi)',           pricing_type: 'flat',        input_type: 'standard', rate: 200,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 10, category: 'electrical', label: 'DC run exceeding 20m',                   pricing_type: 'per_metre',   input_type: 'addon',    rate: 6,      threshold: 20,   threshold_type: 'after', conditions: null,                                                    applies_to: 'dcRunMetres' },
    { sort_order: 11, category: 'electrical', label: 'AC run exceeding 8m',                    pricing_type: 'per_metre',   input_type: 'addon',    rate: 20,     threshold: 8,    threshold_type: 'after', conditions: null,                                                    applies_to: 'acRunMetres' },
    { sort_order: 12, category: 'pv',         label: 'Tilt per panel',                         pricing_type: 'per_panel',   input_type: 'addon',    rate: 12.50,  threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: 'tiltPanelCount' },
    { sort_order: 13, category: 'pv',         label: 'System removal (per panel) inc disposal',pricing_type: 'per_panel',   input_type: 'addon',    rate: 42,     threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: 'removalPanelCount' },
    { sort_order: 14, category: 'electrical', label: '3 phase inverter',                       pricing_type: 'flat',        input_type: 'auto',     rate: 150,    threshold: null, threshold_type: null,    conditions: { phase: 'three_phase' },                                applies_to: null },
    { sort_order: 15, category: 'electrical', label: 'Hot water timer (supply + install)',      pricing_type: 'flat',        input_type: 'addon',    rate: 250,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 16, category: 'electrical', label: 'Neutral Link',                           pricing_type: 'flat',        input_type: 'checkbox', rate: 100,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 17, category: 'electrical', label: 'Fuse Link',                              pricing_type: 'flat',        input_type: 'checkbox', rate: 100,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 18, category: 'electrical', label: 'Main switch',                            pricing_type: 'flat',        input_type: 'addon',    rate: 100,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 19, category: 'electrical', label: 'Meter board upgrade',                    pricing_type: 'quoted',      input_type: 'addon',    rate: null,   threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 20, category: 'electrical', label: 'Meter board relocation',                 pricing_type: 'quoted',      input_type: 'addon',    rate: null,   threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 21, category: 'electrical', label: 'Partial board upgrade',                  pricing_type: 'quoted',      input_type: 'addon',    rate: null,   threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 22, category: 'battery',    label: 'Battery install with solar',             pricing_type: 'flat',        input_type: 'auto',     rate: 2000,   threshold: null, threshold_type: null,    conditions: { has_pv: true, has_battery: true },                     applies_to: null },
    { sort_order: 23, category: 'battery',    label: 'Battery install only',                   pricing_type: 'flat',        input_type: 'auto',     rate: 2500,   threshold: null, threshold_type: null,    conditions: { has_pv: false, has_battery: true },                    applies_to: null },
    { sort_order: 24, category: 'battery',    label: 'Battery install with solar (dual stack)', pricing_type: 'flat',       input_type: 'auto',     rate: 2000,   threshold: null, threshold_type: null,    conditions: { has_pv: true, has_battery: true, dual_stack: true },   applies_to: null },
    { sort_order: 25, category: 'battery',    label: 'Battery install only (dual stack)',      pricing_type: 'flat',        input_type: 'auto',     rate: 3000,   threshold: null, threshold_type: null,    conditions: { has_pv: false, has_battery: true, dual_stack: true },  applies_to: null },
    { sort_order: 26, category: 'battery',    label: 'Backup circuits inc RCBO - per circuit', pricing_type: 'per_circuit', input_type: 'auto',     rate: 200,    threshold: null, threshold_type: null,    conditions: { has_backup: true },                                    applies_to: 'backupCircuitCount' },
    { sort_order: 27, category: 'access',     label: 'Site inspection',                        pricing_type: 'flat',        input_type: 'addon',    rate: 250,    threshold: null, threshold_type: null,    conditions: null,                                                    applies_to: null },
    { sort_order: 28, category: 'travel',     label: 'Travel (per km after threshold)',         pricing_type: 'per_km',      input_type: 'addon',    rate: 1.30,   threshold: null, threshold_type: 'after', conditions: null,                                                    applies_to: 'travelKm' },
];

const CATEGORY_LABELS = { pv: 'PV', electrical: 'Electrical', battery: 'Battery', access: 'Access', travel: 'Travel' };
const CATEGORY_ORDER = ['pv', 'electrical', 'battery', 'access', 'travel'];
const CONDITION_KEYS = ['roof_type', 'phase', 'storey', 'has_pv', 'has_battery', 'dual_stack', 'has_backup'];
const BOOLEAN_CONDITION_KEYS = ['has_pv', 'has_battery', 'dual_stack', 'has_backup'];
const DROPDOWN_CONDITIONS = {
    roof_type: ['metal', 'tile', 'concrete', 'kliplock', 'terracotta', 'flat'],
    phase: ['single_phase', 'three_phase']
};

// ==============================
// TOAST SYSTEM
// ==============================
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        toast.style.transition = 'all 0.25s';
        setTimeout(() => toast.remove(), 250);
    }, 3000);
}

// ==============================
// CONFIRM MODAL
// ==============================
function showConfirmModal(title, message, confirmLabel, onConfirm, isDangerous = false) {
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    const btn = document.getElementById('confirmBtn');
    btn.textContent = confirmLabel;
    btn.className = 'btn-modal-confirm' + (isDangerous ? ' danger' : '');
    confirmCallback = onConfirm;
    openModal('confirmModal');
}

function executeConfirm() {
    closeModal('confirmModal');
    if (confirmCallback) {
        confirmCallback();
        confirmCallback = null;
    }
}

// ==============================
// MODAL HELPERS
// ==============================
function openModal(id) {
    document.getElementById(id).classList.add('open');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('open');
}

// Close modals on Escape
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    }
});

// Close modals on backdrop click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
    });
});

// ==============================
// COMPLIANCE WARNINGS
// ==============================
function getComplianceWarnings(contractor) {
    if (!contractor) return [];
    const warnings = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const soon = new Date(today);
    soon.setDate(soon.getDate() + 30);

    const fields = [
        { key: 'electrical_license_expiry', label: 'Electrical License' },
        { key: 'cec_accreditation_expiry', label: 'CEC Accreditation' },
        { key: 'public_liability_expiry', label: 'Public Liability' },
        { key: 'workers_comp_expiry', label: "Workers' Comp" },
    ];

    for (const f of fields) {
        const val = contractor[f.key];
        if (!val) continue;
        const d = new Date(val);
        if (d < today) {
            warnings.push({ label: f.label, level: 'expired', date: val });
        } else if (d <= soon) {
            warnings.push({ label: f.label, level: 'expiring', date: val });
        }
    }
    return warnings;
}

function getWorstComplianceLevel(contractor) {
    const warnings = getComplianceWarnings(contractor);
    if (warnings.some(w => w.level === 'expired')) return 'expired';
    if (warnings.some(w => w.level === 'expiring')) return 'expiring';
    return null;
}

// ==============================
// CONTRACTOR CRUD
// ==============================
async function loadContractors() {
    if (!sb) return;
    const { data, error } = await sb.from('contractors').select('*').order('business_name');
    if (error) { console.error('loadContractors:', error); return; }
    contractors = data || [];
    renderContractorList();
    renderMobileSelect();
}

async function loadContractor(id) {
    if (!sb || !id) return;
    const [cRes, rRes] = await Promise.all([
        sb.from('contractors').select('*').eq('id', id).single(),
        sb.from('rate_card_items').select('*').eq('contractor_id', id).order('sort_order'),
    ]);
    if (cRes.error) { console.error('loadContractor:', cRes.error); return; }
    selectedContractor = cRes.data;
    selectedContractorId = id;
    rateCardItems = rRes.data || [];
    renderDetail();
}

function selectContractor(id) {
    if (!id) return;
    selectedContractorId = id;
    // Highlight in list
    document.querySelectorAll('.contractor-list-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === id);
    });
    // Update mobile select
    const ms = document.getElementById('mobileContractorSelect');
    if (ms) ms.value = id;
    loadContractor(id);
}

function newContractor() {
    selectedContractorId = null;
    selectedContractor = null;
    rateCardItems = [];
    activeTab = 'details';
    renderDetail(true);
}

async function saveContractor() {
    const data = collectContractorForm();
    if (!data.business_name || !data.address) {
        showToast('Business name and address are required.', 'error');
        return;
    }

    if (selectedContractorId) {
        // UPDATE
        const { error } = await sb.from('contractors').update(data).eq('id', selectedContractorId);
        if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
        showToast('Contractor saved.');
        await loadContractors();
        await loadContractor(selectedContractorId);
    } else {
        // INSERT
        const { data: inserted, error } = await sb.from('contractors').insert(data).select().single();
        if (error) { showToast('Create failed: ' + error.message, 'error'); return; }
        showToast('Contractor created.');
        selectedContractorId = inserted.id;
        await loadContractors();
        selectContractor(inserted.id);
        // Prompt to seed defaults
        showConfirmModal(
            'Seed Rate Card?',
            'Would you like to populate the default 28 rate card items for this contractor?',
            'Yes, Seed Defaults',
            () => seedDefaultRateCard(inserted.id)
        );
    }
}

function collectContractorForm() {
    const val = id => {
        const el = document.getElementById(id);
        return el ? el.value.trim() : '';
    };
    const numVal = id => {
        const v = val(id);
        return v === '' ? null : Number(v);
    };
    const activeEl = document.getElementById('cActive');
    return {
        business_name: val('cBusinessName'),
        contact_name: val('cContactName') || null,
        phone: val('cPhone') || null,
        email: val('cEmail') || null,
        abn: val('cAbn') || null,
        address: val('cAddress'),
        electrical_license_number: val('cElecLicNo') || null,
        electrical_license_expiry: val('cElecLicExp') || null,
        cec_accreditation_number: val('cCecNo') || null,
        cec_accreditation_expiry: val('cCecExp') || null,
        public_liability_amount: numVal('cPlAmount'),
        public_liability_expiry: val('cPlExp') || null,
        workers_comp_policy_number: val('cWcNo') || null,
        workers_comp_expiry: val('cWcExp') || null,
        active: activeEl ? activeEl.checked : true,
        service_region_km: numVal('cServiceRegion'),
        travel_threshold_km: numVal('cTravelThreshold'),
        notes: val('cNotes') || null,
    };
}

async function deactivateContractor() {
    if (!selectedContractorId) return;
    showConfirmModal(
        'Deactivate Contractor',
        `Are you sure you want to deactivate "${selectedContractor?.business_name || ''}"? They will no longer appear in the quote tool.`,
        'Deactivate',
        async () => {
            const { error } = await sb.from('contractors').update({ active: false }).eq('id', selectedContractorId);
            if (error) { showToast('Failed: ' + error.message, 'error'); return; }
            showToast('Contractor deactivated.');
            await loadContractors();
            await loadContractor(selectedContractorId);
        },
        true
    );
}

// ==============================
// CLONE
// ==============================
function showCloneModal() {
    const sel = document.getElementById('cloneSource');
    sel.innerHTML = contractors.map(c =>
        `<option value="${c.id}" ${c.id === selectedContractorId ? 'selected' : ''}>${esc(c.business_name)}</option>`
    ).join('');
    document.getElementById('cloneBusinessName').value = '';
    document.getElementById('cloneAddress').value = '';
    openModal('cloneModal');
}

async function executeClone() {
    const sourceId = document.getElementById('cloneSource').value;
    const name = document.getElementById('cloneBusinessName').value.trim();
    const address = document.getElementById('cloneAddress').value.trim();
    if (!name || !address) {
        showToast('Business name and address are required.', 'error');
        return;
    }
    closeModal('cloneModal');

    // Get source contractor
    const { data: source, error: srcErr } = await sb.from('contractors').select('*').eq('id', sourceId).single();
    if (srcErr) { showToast('Failed to load source: ' + srcErr.message, 'error'); return; }

    // Create new contractor
    const newData = { ...source };
    delete newData.id;
    delete newData.created_at;
    newData.business_name = name;
    newData.address = address;
    const { data: created, error: insErr } = await sb.from('contractors').insert(newData).select().single();
    if (insErr) { showToast('Clone failed: ' + insErr.message, 'error'); return; }

    // Copy rate card items
    const { data: srcItems, error: itemsErr } = await sb.from('rate_card_items').select('*').eq('contractor_id', sourceId).order('sort_order');
    if (!itemsErr && srcItems && srcItems.length > 0) {
        const copies = srcItems.map(item => {
            const copy = { ...item };
            delete copy.id;
            delete copy.created_at;
            copy.contractor_id = created.id;
            return copy;
        });
        const { error: copyErr } = await sb.from('rate_card_items').insert(copies);
        if (copyErr) { showToast('Rate card copy failed: ' + copyErr.message, 'error'); }
    }

    showToast(`Cloned "${name}" with rate card.`);
    await loadContractors();
    selectContractor(created.id);
}

// ==============================
// RATE CARD CRUD
// ==============================
async function loadRateCardItems(contractorId) {
    if (!sb || !contractorId) return;
    const { data, error } = await sb.from('rate_card_items').select('*').eq('contractor_id', contractorId).order('sort_order');
    if (error) { console.error('loadRateCardItems:', error); return; }
    rateCardItems = data || [];
}

async function saveRateCardItem(item) {
    if (!sb) return;
    if (item.id) {
        const { id, created_at, ...updates } = item;
        const { error } = await sb.from('rate_card_items').update(updates).eq('id', id);
        if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
    } else {
        const { created_at, ...ins } = item;
        const { error } = await sb.from('rate_card_items').insert(ins);
        if (error) { showToast('Insert failed: ' + error.message, 'error'); return; }
    }
    showToast('Item saved.');
    await loadRateCardItems(selectedContractorId);
    renderRateCardTab();
}

async function deleteRateCardItem(id) {
    showConfirmModal(
        'Delete Item',
        'Are you sure you want to delete this rate card item?',
        'Delete',
        async () => {
            const { error } = await sb.from('rate_card_items').delete().eq('id', id);
            if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
            showToast('Item deleted.');
            await loadRateCardItems(selectedContractorId);
            renderRateCardTab();
        },
        true
    );
}

async function toggleItemActive(id, active) {
    const { error } = await sb.from('rate_card_items').update({ active }).eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    const item = rateCardItems.find(i => i.id === id);
    if (item) item.active = active;
    renderRateCardTab();
}

async function seedDefaultRateCard(contractorId) {
    const items = DEFAULT_RATE_CARD_ITEMS.map(item => ({
        ...item,
        contractor_id: contractorId,
    }));
    const { error } = await sb.from('rate_card_items').insert(items);
    if (error) { showToast('Seed failed: ' + error.message, 'error'); return; }
    showToast('28 default items seeded.');
    if (contractorId === selectedContractorId) {
        await loadRateCardItems(contractorId);
        renderRateCardTab();
    }
}

async function resetRateCard() {
    if (!selectedContractorId) return;
    showConfirmModal(
        'Reset Rate Card',
        'This will DELETE all current rate card items and replace them with the 28 defaults. This cannot be undone.',
        'Reset to Defaults',
        async () => {
            const { error: delErr } = await sb.from('rate_card_items').delete().eq('contractor_id', selectedContractorId);
            if (delErr) { showToast('Delete failed: ' + delErr.message, 'error'); return; }
            await seedDefaultRateCard(selectedContractorId);
        },
        true
    );
}

async function inlineUpdateItem(id, field, value) {
    const numValue = value === '' ? null : Number(value);
    const { error } = await sb.from('rate_card_items').update({ [field]: numValue }).eq('id', id);
    if (error) { showToast('Update failed: ' + error.message, 'error'); return; }
    const item = rateCardItems.find(i => i.id === id);
    if (item) item[field] = numValue;
}

async function moveItem(id, direction) {
    const item = rateCardItems.find(i => i.id === id);
    if (!item) return;
    const catItems = rateCardItems.filter(i => i.category === item.category).sort((a, b) => a.sort_order - b.sort_order);
    const idx = catItems.findIndex(i => i.id === id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= catItems.length) return;

    const other = catItems[swapIdx];
    const tmpOrder = item.sort_order;
    item.sort_order = other.sort_order;
    other.sort_order = tmpOrder;

    await Promise.all([
        sb.from('rate_card_items').update({ sort_order: item.sort_order }).eq('id', item.id),
        sb.from('rate_card_items').update({ sort_order: other.sort_order }).eq('id', other.id),
    ]);
    renderRateCardTab();
}

// ==============================
// RENDERING — CONTRACTOR LIST
// ==============================
function renderContractorList() {
    const list = document.getElementById('contractorList');
    const filtered = contractors.filter(c => {
        if (listFilter === 'active' && !c.active) return false;
        if (listSearchQuery) {
            const q = listSearchQuery.toLowerCase();
            return (c.business_name || '').toLowerCase().includes(q) ||
                   (c.contact_name || '').toLowerCase().includes(q) ||
                   (c.phone || '').toLowerCase().includes(q);
        }
        return true;
    });

    if (filtered.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-quaternary);font-size:13px;">No contractors found</div>';
        return;
    }

    list.innerHTML = filtered.map(c => {
        const compLevel = getWorstComplianceLevel(c);
        const compDot = compLevel ? `<span class="compliance-dot ${compLevel}"></span>` : '';
        return `<div class="contractor-list-item ${c.id === selectedContractorId ? 'selected' : ''}" data-id="${c.id}" onclick="selectContractor('${c.id}')">
            <div class="cli-name">
                <span class="status-badge ${c.active ? 'active' : 'inactive'}"></span>
                ${esc(c.business_name)}
                ${compDot}
            </div>
            <div class="cli-contact">${esc(c.contact_name || '')}${c.phone ? ' &middot; ' + esc(c.phone) : ''}</div>
        </div>`;
    }).join('');
}

function renderMobileSelect() {
    const sel = document.getElementById('mobileContractorSelect');
    const filtered = listFilter === 'active' ? contractors.filter(c => c.active) : contractors;
    sel.innerHTML = '<option value="">Select contractor...</option>' +
        filtered.map(c => `<option value="${c.id}" ${c.id === selectedContractorId ? 'selected' : ''}>${esc(c.business_name)}</option>`).join('');
}

function filterContractorList() {
    listSearchQuery = document.getElementById('listSearch').value;
    renderContractorList();
}

function setListFilter(filter) {
    listFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === filter));
    renderContractorList();
    renderMobileSelect();
}

// ==============================
// RENDERING — DETAIL PANEL
// ==============================
function renderDetail(isNew = false) {
    document.getElementById('detailEmpty').style.display = 'none';
    document.getElementById('detailContent').style.display = '';

    // Reset tab to active one
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === activeTab));

    if (activeTab === 'details') {
        renderDetailsTab(isNew);
    } else {
        renderRateCardTab();
    }
}

function switchTab(tab) {
    activeTab = tab;
    document.querySelectorAll('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    if (tab === 'details') {
        renderDetailsTab();
    } else {
        renderRateCardTab();
    }
}

function renderDetailsTab(isNew = false) {
    const c = isNew ? {} : (selectedContractor || {});
    const warnings = getComplianceWarnings(c);
    const warnMap = {};
    warnings.forEach(w => warnMap[w.label] = w);

    function expiryWarning(label) {
        const w = warnMap[label];
        if (!w) return '';
        if (w.level === 'expired') return `<div class="compliance-warning expired">Expired ${w.date}</div>`;
        return `<div class="compliance-warning expiring">Expires ${w.date} (within 30 days)</div>`;
    }

    const body = document.getElementById('detailBody');
    body.innerHTML = `
        <div class="detail-section-title">Contact &amp; Business</div>
        <div class="form-group"><label>Business Name *</label><input type="text" id="cBusinessName" value="${esc(c.business_name || '')}"></div>
        <div class="grid-2">
            <div class="form-group"><label>Contact Name</label><input type="text" id="cContactName" value="${esc(c.contact_name || '')}"></div>
            <div class="form-group"><label>Phone</label><input type="tel" id="cPhone" value="${esc(c.phone || '')}"></div>
        </div>
        <div class="grid-2">
            <div class="form-group"><label>Email</label><input type="email" id="cEmail" value="${esc(c.email || '')}"></div>
            <div class="form-group"><label>ABN</label><input type="text" id="cAbn" value="${esc(c.abn || '')}"></div>
        </div>
        <div class="form-group"><label>Address *</label><input type="text" id="cAddress" value="${esc(c.address || '')}"></div>

        <div class="detail-section-title">Licensing &amp; Compliance</div>
        <div class="grid-2">
            <div class="form-group"><label>Electrical License #</label><input type="text" id="cElecLicNo" value="${esc(c.electrical_license_number || '')}"></div>
            <div class="form-group"><label>License Expiry</label><input type="date" id="cElecLicExp" value="${c.electrical_license_expiry || ''}">${expiryWarning('Electrical License')}</div>
        </div>
        <div class="grid-2">
            <div class="form-group"><label>CEC Accreditation #</label><input type="text" id="cCecNo" value="${esc(c.cec_accreditation_number || '')}"></div>
            <div class="form-group"><label>CEC Expiry</label><input type="date" id="cCecExp" value="${c.cec_accreditation_expiry || ''}">${expiryWarning('CEC Accreditation')}</div>
        </div>
        <div class="grid-2">
            <div class="form-group"><label>Public Liability ($)</label><input type="number" id="cPlAmount" value="${c.public_liability_amount || ''}"></div>
            <div class="form-group"><label>PL Expiry</label><input type="date" id="cPlExp" value="${c.public_liability_expiry || ''}">${expiryWarning('Public Liability')}</div>
        </div>
        <div class="grid-2">
            <div class="form-group"><label>Workers' Comp Policy #</label><input type="text" id="cWcNo" value="${esc(c.workers_comp_policy_number || '')}"></div>
            <div class="form-group"><label>WC Expiry</label><input type="date" id="cWcExp" value="${c.workers_comp_expiry || ''}">${expiryWarning("Workers' Comp")}</div>
        </div>

        <div class="detail-section-title">Settings</div>
        <div class="form-group" style="display:flex;align-items:center;gap:10px;">
            <label style="margin:0;">Active</label>
            <label class="toggle-switch">
                <input type="checkbox" id="cActive" ${c.active !== false ? 'checked' : ''}>
                <span class="toggle-slider"></span>
            </label>
        </div>
        <div class="grid-2">
            <div class="form-group"><label>Service Region (km)</label><input type="number" id="cServiceRegion" value="${c.service_region_km || ''}"></div>
            <div class="form-group"><label>Travel Threshold (km)</label><input type="number" id="cTravelThreshold" value="${c.travel_threshold_km || ''}"></div>
        </div>
        <div class="form-group"><label>Notes</label><textarea id="cNotes" rows="3" style="width:100%;padding:8px 12px;border:1px solid var(--separator-hover);border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-primary);font-family:inherit;font-size:13px;resize:vertical;">${esc(c.notes || '')}</textarea></div>

        <div class="detail-actions">
            <button class="btn-save" onclick="saveContractor()">Save</button>
            ${selectedContractorId && c.active !== false ? '<button class="btn-danger" onclick="deactivateContractor()">Deactivate</button>' : ''}
        </div>
    `;
    attachPlacesAutocomplete('cAddress');
}

// ==============================
// RENDERING — RATE CARD TAB
// ==============================
function renderRateCardTab() {
    const body = document.getElementById('detailBody');
    if (!selectedContractorId) {
        body.innerHTML = '<div style="color:var(--text-quaternary);font-size:13px;">Save the contractor first to manage their rate card.</div>';
        return;
    }

    const grouped = {};
    CATEGORY_ORDER.forEach(cat => grouped[cat] = []);
    rateCardItems.forEach(item => {
        if (grouped[item.category]) grouped[item.category].push(item);
    });
    // Sort within each category
    Object.values(grouped).forEach(arr => arr.sort((a, b) => a.sort_order - b.sort_order));

    let html = `
        <div class="rc-admin-toolbar">
            <button class="btn-sm primary" onclick="openItemModal()">Add Item</button>
            <button class="btn-sm" onclick="resetRateCard()">Reset to Defaults</button>
        </div>
    `;

    for (const cat of CATEGORY_ORDER) {
        const items = grouped[cat];
        html += `<div class="rc-admin-category">
            <div class="rc-admin-cat-header open" onclick="this.classList.toggle('open');this.nextElementSibling.style.display=this.classList.contains('open')?'block':'none'">
                <span>${CATEGORY_LABELS[cat]} <span class="cat-count">(${items.length})</span></span>
                <span class="collapse-arrow"></span>
            </div>
            <div>`;

        for (const item of items) {
            const isInactive = !item.active;
            const catItems = items;
            const idx = catItems.indexOf(item);
            const canUp = idx > 0;
            const canDown = idx < catItems.length - 1;

            const thresholdInfo = item.threshold != null ? ` <span class="item-threshold">${item.threshold_type} ${item.threshold}</span>` : '';
            html += `<div class="rc-admin-item">
                <div class="item-label-wrap">
                    <span class="item-label ${isInactive ? 'inactive' : ''}" title="${esc(item.label)}">${esc(item.label)}</span>
                    <span class="item-meta">
                        <span class="type-badge pricing">${item.pricing_type.replace('_', '/')}</span>
                        <span class="type-badge input">${item.input_type}</span>
                        ${thresholdInfo}
                    </span>
                </div>
                <input type="number" value="${item.rate != null ? item.rate : ''}" step="0.01"
                    ${item.pricing_type === 'quoted' ? 'disabled placeholder="Quoted"' : ''}
                    onblur="inlineUpdateItem('${item.id}','rate',this.value)">
                <label class="toggle-switch">
                    <input type="checkbox" ${item.active ? 'checked' : ''} onchange="toggleItemActive('${item.id}',this.checked)">
                    <span class="toggle-slider"></span>
                </label>
                <span style="display:flex;gap:2px;">
                    <button class="btn-icon" onclick="moveItem('${item.id}','up')" ${!canUp ? 'disabled style="opacity:0.2"' : ''} title="Move up">&uarr;</button>
                    <button class="btn-icon" onclick="moveItem('${item.id}','down')" ${!canDown ? 'disabled style="opacity:0.2"' : ''} title="Move down">&darr;</button>
                    <button class="btn-icon" onclick="openItemModal('${item.id}')" title="Edit">&#9998;</button>
                    <button class="btn-icon danger" onclick="deleteRateCardItem('${item.id}')" title="Delete">&times;</button>
                </span>
            </div>`;
        }

        html += `</div></div>`;
    }

    body.innerHTML = html;
}

// ==============================
// ITEM EDIT MODAL
// ==============================
function openItemModal(itemId) {
    editingItemId = itemId || null;
    const item = itemId ? rateCardItems.find(i => i.id === itemId) : null;

    document.getElementById('itemModalTitle').textContent = item ? 'Edit Item' : 'Add Item';
    document.getElementById('itemCategory').value = item ? item.category : 'pv';
    document.getElementById('itemInputType').value = item ? item.input_type : 'auto';
    document.getElementById('itemLabel').value = item ? item.label : '';
    document.getElementById('itemPricingType').value = item ? item.pricing_type : 'flat';
    document.getElementById('itemRate').value = item && item.rate != null ? item.rate : '';
    document.getElementById('itemThreshold').value = item && item.threshold != null ? item.threshold : '';
    document.getElementById('itemThresholdType').value = item ? (item.threshold_type || '') : '';
    document.getElementById('itemAppliesTo').value = item ? (item.applies_to || '') : '';

    onPricingTypeChange();
    renderConditionsEditor(item ? item.conditions : null);
    openModal('itemEditModal');
}

function onPricingTypeChange() {
    const isQuoted = document.getElementById('itemPricingType').value === 'quoted';
    const rateInput = document.getElementById('itemRate');
    rateInput.disabled = isQuoted;
    if (isQuoted) rateInput.value = '';
}

function renderConditionsEditor(conditions) {
    const editor = document.getElementById('conditionsEditor');
    editor.innerHTML = '';
    if (conditions && typeof conditions === 'object') {
        Object.entries(conditions).forEach(([key, value]) => {
            addConditionRowHTML(editor, key, value);
        });
    }
}

function addConditionRow() {
    const editor = document.getElementById('conditionsEditor');
    addConditionRowHTML(editor, '', '');
}

function addConditionRowHTML(container, key, value) {
    const row = document.createElement('div');
    row.className = 'condition-row';

    const keySelect = document.createElement('select');
    keySelect.innerHTML = '<option value="">Select...</option>' +
        CONDITION_KEYS.map(k => `<option value="${k}" ${k === key ? 'selected' : ''}>${k}</option>`).join('');
    keySelect.onchange = function() { updateConditionValueInput(row, this.value); };

    row.appendChild(keySelect);

    // Value input
    const valueContainer = document.createElement('div');
    valueContainer.className = 'cond-value-container';
    row.appendChild(valueContainer);

    // Delete button
    const delBtn = document.createElement('button');
    delBtn.className = 'btn-icon danger';
    delBtn.innerHTML = '&times;';
    delBtn.onclick = () => row.remove();
    row.appendChild(delBtn);

    container.appendChild(row);

    // Set initial value input
    if (key) {
        updateConditionValueInput(row, key, value);
    } else {
        valueContainer.innerHTML = '<input type="text" placeholder="Value" style="height:32px;font-size:12px;">';
    }
}

function updateConditionValueInput(row, key, existingValue) {
    const container = row.querySelector('.cond-value-container');
    if (!container) return;

    if (BOOLEAN_CONDITION_KEYS.includes(key)) {
        const checked = existingValue === true || existingValue === 'true';
        container.innerHTML = `
            <select style="height:32px;font-size:12px;">
                <option value="true" ${checked ? 'selected' : ''}>true</option>
                <option value="false" ${!checked ? 'selected' : ''}>false</option>
            </select>`;
    } else if (DROPDOWN_CONDITIONS[key]) {
        const opts = DROPDOWN_CONDITIONS[key];
        container.innerHTML = `<select style="height:32px;font-size:12px;">
            ${opts.map(o => `<option value="${o}" ${o === existingValue ? 'selected' : ''}>${o}</option>`).join('')}
        </select>`;
    } else if (key === 'storey') {
        container.innerHTML = `<input type="number" value="${existingValue || ''}" min="1" max="5" style="height:32px;font-size:12px;">`;
    } else {
        container.innerHTML = `<input type="text" value="${existingValue != null ? existingValue : ''}" style="height:32px;font-size:12px;">`;
    }
}

function collectConditions() {
    const rows = document.querySelectorAll('#conditionsEditor .condition-row');
    if (rows.length === 0) return null;
    const conditions = {};
    rows.forEach(row => {
        const key = row.querySelector('select')?.value;
        if (!key) return;
        const valContainer = row.querySelector('.cond-value-container');
        const input = valContainer?.querySelector('input, select');
        if (!input) return;
        let val = input.value;
        // Convert booleans
        if (BOOLEAN_CONDITION_KEYS.includes(key)) {
            val = val === 'true';
        } else if (key === 'storey') {
            val = Number(val) || 1;
        }
        conditions[key] = val;
    });
    return Object.keys(conditions).length > 0 ? conditions : null;
}

async function saveItemFromModal() {
    const label = document.getElementById('itemLabel').value.trim();
    if (!label) { showToast('Label is required.', 'error'); return; }

    const rateVal = document.getElementById('itemRate').value;
    const thresholdVal = document.getElementById('itemThreshold').value;

    const item = {
        contractor_id: selectedContractorId,
        category: document.getElementById('itemCategory').value,
        label: label,
        pricing_type: document.getElementById('itemPricingType').value,
        input_type: document.getElementById('itemInputType').value,
        rate: rateVal === '' ? null : Number(rateVal),
        threshold: thresholdVal === '' ? null : Number(thresholdVal),
        threshold_type: document.getElementById('itemThresholdType').value || null,
        applies_to: document.getElementById('itemAppliesTo').value || null,
        conditions: collectConditions(),
    };

    if (editingItemId) {
        item.id = editingItemId;
    } else {
        // Assign next sort_order in category
        const catItems = rateCardItems.filter(i => i.category === item.category);
        const maxOrder = catItems.reduce((max, i) => Math.max(max, i.sort_order || 0), 0);
        item.sort_order = maxOrder + 1;
    }

    closeModal('itemEditModal');
    await saveRateCardItem(item);
}

// ==============================
// ADMIN MODE SWITCHING
// ==============================
let adminMode = 'contractors'; // 'contractors', 'pricing', or 'users'

function switchAdminMode(mode) {
    adminMode = mode;
    document.querySelectorAll('.mode-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.mode === mode); });
    var contractorView = document.querySelector('.admin-content');
    var mobileSelect = document.querySelector('.mobile-contractor-select');
    var pricingView = document.getElementById('pricingView');
    var usersView = document.getElementById('usersView');
    var quotesView = document.getElementById('quotesView');
    var contractorActions = document.getElementById('contractorToolbarActions');

    contractorView.style.display = 'none';
    if (mobileSelect) mobileSelect.style.display = 'none';
    pricingView.style.display = 'none';
    if (usersView) usersView.style.display = 'none';
    if (quotesView) quotesView.style.display = 'none';
    contractorActions.style.display = 'none';

    if (mode === 'pricing') {
        pricingView.style.display = '';
        loadPricingData();
    } else if (mode === 'users') {
        if (usersView) usersView.style.display = '';
        loadUsers();
        loadAdminReps();
    } else if (mode === 'quotes') {
        if (quotesView) quotesView.style.display = '';
        loadQuotes();
    } else {
        contractorView.style.display = '';
        if (mobileSelect) mobileSelect.style.display = '';
        contractorActions.style.display = '';
    }
}

// ==============================
// PRICING STATE
// ==============================
let allTables = { panels: [], inverters: [], battery_modules: [], gateways: [], ev_chargers: [], accessories: [], battery_mounting: [], mounting_kits: [], mounting_parts: [] };
let allBatteryPackages = [];
let allBmsParts = [];
let businessParamsRow = null;
let pricingCategoryFilter = 'all';
let pricingMfrFilter = 'all';
let pricingSection = 'products'; // 'products' or 'params'
let editingProductId = null;
let editingProductType = null;
let bulkChanges = []; // parsed bulk import changes

const TYPE_TO_TABLE = {
    panel: 'panels', inverter: 'inverters', battery_module: 'battery_modules',
    gateway: 'gateways', ev_charger: 'ev_chargers', accessory: 'accessories',
    mounting_kit: 'mounting_kits', mounting_part: 'mounting_parts',
    battery_mounting: 'battery_mounting'
};
const PRODUCT_TYPE_LABELS = {
    panel: 'Panels', inverter: 'Inverters', battery_module: 'Battery Modules',
    gateway: 'Gateways', ev_charger: 'EV Chargers', accessory: 'Accessories',
    mounting_kit: 'Mounting Kits', mounting_part: 'Mounting Parts',
    battery_mounting: 'Battery Mounting'
};
const PRODUCT_TYPE_ORDER = ['panel','inverter','battery_module','gateway','ev_charger','accessory','mounting_kit','mounting_part','battery_mounting'];

// ==============================
// PRICING DATA LOADING
// ==============================
async function loadPricingData() {
    if (!sb) return;
    try {
        var tableNames = ['panels','inverters','battery_modules','gateways','ev_chargers','accessories','battery_mounting','mounting_kits','mounting_parts'];
        var queries = tableNames.map(function(t) { return sb.from(t).select('*').order('sort_order'); });
        queries.push(sb.from('battery_packages').select('*').order('sort_order'));
        queries.push(sb.from('solax_bms_components').select('*'));
        queries.push(sb.from('business_params').select('*').limit(1).maybeSingle());
        var results = await Promise.all(queries);
        tableNames.forEach(function(t, i) { allTables[t] = results[i].data || []; });
        allBatteryPackages = results[tableNames.length].data || [];
        allBmsParts = results[tableNames.length + 1].data || [];
        businessParamsRow = results[tableNames.length + 2].data || null;
        renderPricingFilters();
        renderPricingContent();
    } catch (e) {
        console.error('loadPricingData:', e);
        showToast('Failed to load pricing data', 'error');
    }
}

// ==============================
// PRICING FILTERS
// ==============================
function renderPricingFilters() {
    var catSelect = document.getElementById('pricingCategorySelect');
    var mfrSelect = document.getElementById('pricingMfrSelect');

    var totalCount = Object.values(allTables).reduce(function(s, arr) { return s + arr.length; }, 0);

    // Category dropdown
    var cats = ['all'].concat(PRODUCT_TYPE_ORDER);
    catSelect.innerHTML = cats.map(function(c) {
        var label = c === 'all' ? 'All Products' : (PRODUCT_TYPE_LABELS[c] || c);
        var count = c === 'all' ? totalCount : (allTables[TYPE_TO_TABLE[c]] || []).length;
        return '<option value="' + c + '"' + (pricingCategoryFilter === c ? ' selected' : '') + '>' + label + ' (' + count + ')</option>';
    }).join('');

    // Manufacturer dropdown — dynamically built from all products
    var mfrSet = new Set();
    Object.values(allTables).forEach(function(arr) {
        arr.forEach(function(p) { if (p.manufacturer) mfrSet.add(p.manufacturer); });
    });
    var mfrList = Array.from(mfrSet).sort();
    var hasNoMfr = Object.values(allTables).some(function(arr) { return arr.some(function(p) { return !p.manufacturer; }); });
    var mfrOptions = '<option value="all"' + (pricingMfrFilter === 'all' ? ' selected' : '') + '>All Manufacturers</option>';
    mfrList.forEach(function(m) {
        var label = m.charAt(0).toUpperCase() + m.slice(1);
        mfrOptions += '<option value="' + m + '"' + (pricingMfrFilter === m ? ' selected' : '') + '>' + label + '</option>';
    });
    if (hasNoMfr) mfrOptions += '<option value="shared"' + (pricingMfrFilter === 'shared' ? ' selected' : '') + '>Shared</option>';
    mfrSelect.innerHTML = mfrOptions;
}

function setPricingCategory(cat) {
    pricingCategoryFilter = cat;
    pricingSection = 'products';
    renderPricingFilters();
    renderPricingContent();
}

function setPricingMfr(mfr) {
    pricingMfrFilter = mfr;
    renderPricingFilters();
    renderPricingContent();
}

function switchPricingSection(section) {
    pricingSection = section;
    renderPricingContent();
}

// ==============================
// PRICING CONTENT RENDERING
// ==============================

// Discount helpers for table rows
var DISCOUNT_TABLES = ['panels','inverters','battery_modules','gateways','ev_chargers','accessories'];
function isDiscountActive(p) {
    if (!p.discount_pct || !p.discount_from || !p.discount_to) return false;
    var now = new Date(), from = new Date(p.discount_from), to = new Date(p.discount_to);
    to.setHours(23,59,59);
    return now >= from && now <= to;
}
function fmtDiscountPrice(p, field) {
    field = field || 'price';
    var orig = p[field];
    if (orig == null) return '';
    if (!isDiscountActive(p)) return orig;
    var eff = (orig * (1 - p.discount_pct / 100)).toFixed(2);
    return '<span style="text-decoration:line-through;opacity:.5;">' + orig + '</span> <span style="color:var(--green);font-weight:600;">' + eff + '</span>';
}
function discountBadge(p) {
    if (!isDiscountActive(p)) return '';
    return ' <span style="background:var(--green);color:#000;padding:1px 5px;border-radius:3px;font-size:10px;font-weight:600;">-' + p.discount_pct + '%</span>';
}
function priceCell(p, t, field) {
    field = field || 'price';
    var val = p[field] != null ? p[field] : '';
    var dimStyle = (p[field] == null && field !== 'price') ? ' style="opacity:0.3"' : '';
    var inp = '<input type="number" value="' + val + '" step="0.01"' + dimStyle + ' onblur="inlineUpdateProduct(\'' + p.id + '\',\'' + t + '\',\'' + field + '\',this.value)">';
    if (!isDiscountActive(p) || p[field] == null) return inp;
    var eff = (p[field] * (1 - p.discount_pct / 100)).toFixed(2);
    return '<div style="display:flex;align-items:center;gap:6px;">' + inp + '<span style="color:var(--green);font-size:11px;font-weight:600;white-space:nowrap;">$' + eff + '</span></div>';
}

// Table-specific column definitions
var TABLE_COLUMNS = {
    panel:            { headers: ['SKU','Mfr','Model','Wattage','Colour','Price','Supplier Code','Active',''],
                        row: function(p,t) { return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td>' + esc(p.manufacturer||'') + '</td><td>' + esc(p.model||'') + '</td><td>' + (p.wattage||'') + 'W</td><td>' + esc(p.colour||'') + '</td><td>' + priceCell(p,t) + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    inverter:         { headers: ['SKU','Mfr','Phase','kW','Max PV','Solar Only','Price','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;color:var(--text-tertiary);">' + fmtPhase(p.phase) + '</td><td>' + (p.kw||'') + '</td><td>' + (p.max_pv_kw||'') + '</td><td>' + (p.solar_only?'Yes':'\u2014') + '</td><td>' + priceCell(p,t) + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    battery_module:   { headers: ['SKU','Mfr','Type','kWh','Usable','Enabled','Price','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;">' + esc(p.battery_type_id||'') + '</td><td>' + (p.kwh||'') + '</td><td>' + (p.usable_kwh||'') + '</td><td>' + (p.enabled===false?'No':'Yes') + '</td><td>' + priceCell(p,t) + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    gateway:          { headers: ['SKU','Mfr','Phase','Description','Price','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;color:var(--text-tertiary);">' + fmtPhase(p.phase) + '</td><td style="font-size:11px;color:var(--text-tertiary);">' + esc(p.description||'') + '</td><td>' + priceCell(p,t) + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    ev_charger:       { headers: ['SKU','Mfr','Phase','Description','Price','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;color:var(--text-tertiary);">' + fmtPhase(p.phase) + '</td><td style="font-size:11px;color:var(--text-tertiary);">' + esc(p.description||'') + '</td><td>' + priceCell(p,t) + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    accessory:        { headers: ['SKU','Mfr','Accessory ID','Price','Price Alt','Phase Dep.','Default','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '" title="' + esc(p.description||'') + '">' + esc(p.sku) + discountBadge(p) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;">' + esc(p.accessory_id||'') + '</td><td>' + priceCell(p,t,'price') + '</td><td>' + priceCell(p,t,'price_alt') + '</td><td>' + (p.phase_dependent?'Yes':'\u2014') + '</td><td>' + (p.default_checked?'Yes':'\u2014') + '</td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    mounting_kit:     { headers: ['SKU','Kit Family','Panels','Roof Types','Price','Supplier Code','Active',''],
                        row: function(p,t) { var rt = Array.isArray(p.roof_types) ? p.roof_types.join(', ') : ''; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + '</td><td style="font-size:11px;">' + esc(p.kit_family||'') + '</td><td>' + (p.panels_covered||'') + '</td><td style="font-size:11px;">' + esc(rt) + '</td><td><input type="number" value="' + (p.price!=null?p.price:'') + '" step="0.01" onblur="inlineUpdateProduct(\'' + p.id + '\',\'' + t + '\',\'price\',this.value)"></td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    mounting_part:    { headers: ['SKU','Part Type','Tilt Key','Qty','Price','Supplier Code','Active',''],
                        row: function(p,t) { return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + '</td><td style="font-size:11px;">' + esc(p.part_type||'') + '</td><td style="font-size:11px;">' + esc(p.tilt_key||'\u2014') + '</td><td>' + (p.qty!=null?p.qty:'\u2014') + '</td><td><input type="number" value="' + (p.price!=null?p.price:'') + '" step="0.01" onblur="inlineUpdateProduct(\'' + p.id + '\',\'' + t + '\',\'price\',this.value)"></td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } },
    battery_mounting: { headers: ['SKU','Mfr','Mount Key','Price','Supplier Code','Active',''],
                        row: function(p,t) { var mfrC = p.manufacturer==='sigenergy'?'sig':'solax'; var mfrL = p.manufacturer==='sigenergy'?'SIG':'SOLAX'; return '<td class="' + (!p.active?' inactive':'') + '">' + esc(p.sku) + '</td><td><span class="mfr-badge ' + mfrC + '">' + mfrL + '</span></td><td style="font-size:11px;">' + esc(p.mount_key||'') + '</td><td><input type="number" value="' + (p.price!=null?p.price:'') + '" step="0.01" onblur="inlineUpdateProduct(\'' + p.id + '\',\'' + t + '\',\'price\',this.value)"></td><td style="font-size:11px;color:var(--text-tertiary);font-family:monospace;">' + esc(p.supplier_code||'') + '</td>'; } }
};

function fmtPhase(ph) {
    if (!ph) return '\u2014';
    return ph.replace('_phase','P').replace('single','1').replace('three','3');
}

function renderPricingContent() {
    var tableWrap = document.getElementById('productTableWrap');
    var paramsWrap = document.getElementById('businessParamsWrap');

    if (pricingSection === 'params') {
        tableWrap.style.display = 'none';
        paramsWrap.style.display = '';
        renderBusinessParams();
        return;
    }

    tableWrap.style.display = '';
    paramsWrap.style.display = 'none';

    var html = '';
    PRODUCT_TYPE_ORDER.forEach(function(type) {
        if (pricingCategoryFilter !== 'all' && pricingCategoryFilter !== type) return;
        var tableName = TYPE_TO_TABLE[type];
        var items = (allTables[tableName] || []).slice();

        // Manufacturer filter
        if (pricingMfrFilter !== 'all') {
            if (pricingMfrFilter === 'shared') {
                items = items.filter(function(p) { return !p.manufacturer; });
            } else {
                items = items.filter(function(p) { return p.manufacturer === pricingMfrFilter; });
            }
        }

        if (items.length === 0) return;
        items.sort(function(a, b) { return (a.sort_order || 0) - (b.sort_order || 0); });

        var cols = TABLE_COLUMNS[type];
        html += '<div style="margin-bottom:24px;">';
        html += '<div class="rc-admin-cat-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.style.display=this.classList.contains(\'open\')?\'block\':\'none\'">';
        html += '<span>' + (PRODUCT_TYPE_LABELS[type] || type) + ' <span class="cat-count">(' + items.length + ')</span></span>';
        html += '<span class="collapse-arrow"></span></div>';
        html += '<div><table class="product-table"><thead><tr>';
        cols.headers.forEach(function(h) { html += '<th>' + h + '</th>'; });
        html += '</tr></thead><tbody>';

        items.forEach(function(p) {
            html += '<tr>';
            html += cols.row(p, tableName);
            html += '<td><label class="toggle-switch"><input type="checkbox" ' + (p.active ? 'checked' : '') + ' onchange="toggleProduct(\'' + p.id + '\',\'' + tableName + '\',this.checked)"><span class="toggle-slider"></span></label></td>';
            html += '<td><span style="display:flex;gap:2px;">';
            html += '<button class="btn-icon" onclick="openProductModal(\'' + p.id + '\',\'' + type + '\')" title="Edit">&#9998;</button>';
            html += '<button class="btn-icon danger" onclick="deleteProduct(\'' + p.id + '\',\'' + type + '\')" title="Delete">&times;</button>';
            html += '</span></td>';
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
    });

    // Battery packages section
    if ((pricingCategoryFilter === 'all' || pricingCategoryFilter === 'battery_module') && (pricingMfrFilter === 'all' || pricingMfrFilter === 'solax')) {
        var pkgs = allBatteryPackages.sort(function(a, b) { return a.sort_order - b.sort_order; });
        if (pkgs.length > 0) {
            html += '<div style="margin-bottom:24px;">';
            html += '<div class="rc-admin-cat-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.style.display=this.classList.contains(\'open\')?\'block\':\'none\'">';
            html += '<span>Battery Packages (SolaX) <span class="cat-count">(' + pkgs.length + ')</span></span>';
            html += '<span class="collapse-arrow"></span></div>';
            html += '<div><table class="product-table"><thead><tr>';
            html += '<th>SKU</th><th>Modules</th><th>kWh</th><th>Price</th><th>Includes</th><th></th>';
            html += '</tr></thead><tbody>';
            pkgs.forEach(function(p) {
                html += '<tr>';
                html += '<td>' + esc(p.sku) + '</td>';
                html += '<td>' + p.modules + '</td>';
                html += '<td>' + p.kwh + '</td>';
                html += '<td><input type="number" value="' + p.price + '" step="1" onblur="inlineUpdatePackage(\'' + p.id + '\',\'price\',this.value)"></td>';
                html += '<td style="font-size:11px;color:var(--text-tertiary);">' + esc(p.includes || '') + '</td>';
                html += '<td></td></tr>';
            });
            html += '</tbody></table></div></div>';
        }
    }

    // SolaX BMS & series box costs section
    if ((pricingCategoryFilter === 'all' || pricingCategoryFilter === 'battery_module') && allBmsParts.length > 0) {
        html += '<div style="margin-bottom:24px;">';
        html += '<div class="rc-admin-cat-header open" onclick="this.classList.toggle(\'open\');this.nextElementSibling.style.display=this.classList.contains(\'open\')?\'block\':\'none\'">';
        html += '<span>SolaX BMS &amp; Series Box <span class="cat-count">(' + allBmsParts.length + ')</span></span>';
        html += '<span class="collapse-arrow"></span></div>';
        html += '<div><table class="product-table"><thead><tr>';
        html += '<th>Type</th><th>BMS Cost</th><th>BMS Code</th><th>Series Box Cost</th><th>Series Box Code</th><th></th>';
        html += '</tr></thead><tbody>';
        allBmsParts.forEach(function(bt) {
            html += '<tr>';
            html += '<td>' + esc(bt.label) + '</td>';
            html += '<td><input type="number" value="' + (bt.bms_cost || 0) + '" step="1" onblur="inlineUpdateBmsPart(\'' + bt.id + '\',\'bms_cost\',this.value)"></td>';
            html += '<td style="font-size:11px;font-family:monospace;color:var(--text-tertiary);">' + esc(bt.bms_code || '') + '</td>';
            html += '<td><input type="number" value="' + (bt.series_box_cost || 0) + '" step="1" onblur="inlineUpdateBmsPart(\'' + bt.id + '\',\'series_box_cost\',this.value)"></td>';
            html += '<td style="font-size:11px;font-family:monospace;color:var(--text-tertiary);">' + esc(bt.series_box_code || '') + '</td>';
            html += '<td></td></tr>';
        });
        html += '</tbody></table></div></div>';
    }

    if (!html) html = '<div style="color:var(--text-quaternary);font-size:13px;padding:40px;text-align:center;">No products match the current filters.</div>';
    tableWrap.innerHTML = html;
}

// ==============================
// INLINE PRODUCT UPDATES
// ==============================
async function inlineUpdateProduct(id, tableName, field, value) {
    var numValue = value === '' ? null : Number(value);
    var update = {};
    update[field] = numValue;
    var result = await sb.from(tableName).update(update).eq('id', id);
    if (result.error) { showToast('Update failed: ' + result.error.message, 'error'); return; }
    var p = (allTables[tableName] || []).find(function(x) { return x.id === id; });
    if (p) p[field] = numValue;
}

async function toggleProduct(id, tableName, active) {
    var result = await sb.from(tableName).update({ active: active }).eq('id', id);
    if (result.error) { showToast('Update failed: ' + result.error.message, 'error'); return; }
    var p = (allTables[tableName] || []).find(function(x) { return x.id === id; });
    if (p) p.active = active;
    renderPricingContent();
}

async function deleteProduct(id, type) {
    var tableName = TYPE_TO_TABLE[type];
    showConfirmModal('Delete Product', 'Are you sure you want to permanently delete this product?', 'Delete', async function() {
        var result = await sb.from(tableName).delete().eq('id', id);
        if (result.error) { showToast('Delete failed: ' + result.error.message, 'error'); return; }
        allTables[tableName] = (allTables[tableName] || []).filter(function(p) { return p.id !== id; });
        showToast('Product deleted.');
        renderPricingFilters();
        renderPricingContent();
    }, true);
}

async function inlineUpdatePackage(id, field, value) {
    var numValue = value === '' ? null : Number(value);
    var update = {};
    update[field] = numValue;
    var result = await sb.from('battery_packages').update(update).eq('id', id);
    if (result.error) { showToast('Update failed: ' + result.error.message, 'error'); return; }
    var p = allBatteryPackages.find(function(x) { return x.id === id; });
    if (p) p[field] = numValue;
}

async function inlineUpdateBmsPart(id, field, value) {
    var numValue = value === '' ? null : Number(value);
    var update = {};
    update[field] = numValue;
    var result = await sb.from('solax_bms_components').update(update).eq('id', id);
    if (result.error) { showToast('Update failed: ' + result.error.message, 'error'); return; }
    var bt = allBmsParts.find(function(x) { return x.id === id; });
    if (bt) bt[field] = numValue;
}

// ==============================
// PRODUCT MODAL
// ==============================
function openProductModal(productId, type) {
    editingProductId = productId || null;
    editingProductType = type || null;
    var tableName = type ? TYPE_TO_TABLE[type] : null;
    var p = (productId && tableName) ? (allTables[tableName] || []).find(function(x) { return x.id === productId; }) : null;

    document.getElementById('productModalTitle').textContent = p ? 'Edit Product' : 'Add Product';
    var typeSelect = document.getElementById('prodType');
    typeSelect.value = type || 'panel';
    typeSelect.disabled = !!p; // Can't change type when editing

    // Common fields
    document.getElementById('prodSku').value = p ? (p.sku || '') : '';
    document.getElementById('prodSupplierCode').value = p ? (p.supplier_code || '') : '';
    document.getElementById('prodSortOrder').value = p ? (p.sort_order || 0) : 0;
    document.getElementById('prodActive').checked = p ? p.active : true;

    // Render type-specific fields
    renderTypeFields(type || 'panel', p);

    openModal('productEditModal');
}

function mfrSelect(p) {
    var val = (p && p.manufacturer) || 'sigenergy';
    return '<select id="tf_manufacturer">' +
        '<option value="sigenergy"' + (val === 'sigenergy' ? ' selected' : '') + '>Sigenergy</option>' +
        '<option value="solax"' + (val === 'solax' ? ' selected' : '') + '>SolaX</option>' +
        '</select>';
}

function renderTypeFields(type, p) {
    var container = document.getElementById('prodTypeFields');
    var html = '';

    if (type === 'panel') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label><input type="text" id="tf_manufacturer" value="' + esc(p && p.manufacturer || '') + '"></div>';
        html += '<div class="form-group"><label>Model</label><input type="text" id="tf_model" value="' + esc(p && p.model || '') + '"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Wattage (W)</label><input type="number" id="tf_wattage" value="' + (p && p.wattage != null ? p.wattage : '') + '"></div>';
        html += '<div class="form-group"><label>Colour</label><input type="text" id="tf_colour" value="' + esc(p && p.colour || '') + '"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Width (mm)</label><input type="number" id="tf_width_mm" value="' + (p && p.width_mm != null ? p.width_mm : '') + '"></div>';
        html += '<div class="form-group"><label>Height (mm)</label><input type="number" id="tf_height_mm" value="' + (p && p.height_mm != null ? p.height_mm : '') + '"></div></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
    } else if (type === 'inverter') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Phase</label><select id="tf_phase"><option value="single_phase"' + (p && p.phase === 'single_phase' ? ' selected' : '') + '>Single Phase</option><option value="three_phase"' + (p && p.phase === 'three_phase' ? ' selected' : '') + '>Three Phase</option></select></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>kW</label><input type="number" id="tf_kw" step="0.1" value="' + (p && p.kw != null ? p.kw : '') + '"></div>';
        html += '<div class="form-group"><label>Max PV kW</label><input type="number" id="tf_max_pv_kw" step="0.1" value="' + (p && p.max_pv_kw != null ? p.max_pv_kw : '') + '"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
        html += '<div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:24px;"><label style="margin:0;">Solar Only</label><label class="toggle-switch"><input type="checkbox" id="tf_solar_only" ' + (p && p.solar_only ? 'checked' : '') + '><span class="toggle-slider"></span></label></div></div>';
    } else if (type === 'battery_module') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Battery Type ID</label><input type="text" id="tf_battery_type_id" value="' + esc(p && p.battery_type_id || '') + '" placeholder="e.g. sig_default, tp_hs36"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>kWh</label><input type="number" id="tf_kwh" step="0.1" value="' + (p && p.kwh != null ? p.kwh : '') + '"></div>';
        html += '<div class="form-group"><label>Usable kWh</label><input type="number" id="tf_usable_kwh" step="0.1" value="' + (p && p.usable_kwh != null ? p.usable_kwh : '') + '"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
        html += '<div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:24px;"><label style="margin:0;">Enabled</label><label class="toggle-switch"><input type="checkbox" id="tf_enabled" ' + (p ? (p.enabled !== false ? 'checked' : '') : 'checked') + '><span class="toggle-slider"></span></label></div></div>';
    } else if (type === 'gateway') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Phase</label><select id="tf_phase"><option value="single_phase"' + (p && p.phase === 'single_phase' ? ' selected' : '') + '>Single Phase</option><option value="three_phase"' + (p && p.phase === 'three_phase' ? ' selected' : '') + '>Three Phase</option></select></div></div>';
        html += '<div class="form-group"><label>Description</label><input type="text" id="tf_description" value="' + esc(p && p.description || '') + '"></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
    } else if (type === 'ev_charger') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Phase</label><select id="tf_phase"><option value="">None</option><option value="single_phase"' + (p && p.phase === 'single_phase' ? ' selected' : '') + '>Single Phase</option><option value="three_phase"' + (p && p.phase === 'three_phase' ? ' selected' : '') + '>Three Phase</option></select></div></div>';
        html += '<div class="form-group"><label>Description</label><input type="text" id="tf_description" value="' + esc(p && p.description || '') + '"></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
    } else if (type === 'accessory') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Accessory ID</label><input type="text" id="tf_accessory_id" value="' + esc(p && p.accessory_id || '') + '" placeholder="e.g. power_sensor"></div></div>';
        html += '<div class="form-group"><label>Description</label><input type="text" id="tf_description" value="' + esc(p && p.description || '') + '"></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
        html += '<div class="form-group"><label>Price Alt ($)</label><input type="number" id="tf_price_alt" step="0.01" value="' + (p && p.price_alt != null ? p.price_alt : '') + '" placeholder="e.g. 3-phase price"></div></div>';
        html += '<div class="grid-2"><div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:4px;"><label style="margin:0;">Phase Dependent</label><label class="toggle-switch"><input type="checkbox" id="tf_phase_dependent" ' + (p && p.phase_dependent ? 'checked' : '') + '><span class="toggle-slider"></span></label></div>';
        html += '<div class="form-group" style="display:flex;align-items:center;gap:10px;padding-top:4px;"><label style="margin:0;">Default Checked</label><label class="toggle-switch"><input type="checkbox" id="tf_default_checked" ' + (p && p.default_checked ? 'checked' : '') + '><span class="toggle-slider"></span></label></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Supplier Code (1P)</label><input type="text" id="tf_supplier_code_single" value="' + esc(p && p.supplier_code_single || '') + '"></div>';
        html += '<div class="form-group"><label>Supplier Code (3P)</label><input type="text" id="tf_supplier_code_three" value="' + esc(p && p.supplier_code_three || '') + '"></div></div>';
        html += '<div class="form-group"><label>Note</label><input type="text" id="tf_note" value="' + esc(p && p.note || '') + '"></div>';
    } else if (type === 'battery_mounting') {
        html += '<div class="grid-2"><div class="form-group"><label>Mfr</label>' + mfrSelect(p) + '</div>';
        html += '<div class="form-group"><label>Mount Key</label><input type="text" id="tf_mount_key" value="' + esc(p && p.mount_key || '') + '" placeholder="e.g. mount_wall"></div></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
    } else if (type === 'mounting_kit') {
        html += '<div class="grid-2"><div class="form-group"><label>Kit Family</label><input type="text" id="tf_kit_family" value="' + esc(p && p.kit_family || '') + '" placeholder="e.g. tin_2kw"></div>';
        html += '<div class="form-group"><label>Panels Covered</label><input type="number" id="tf_panels_covered" value="' + (p && p.panels_covered != null ? p.panels_covered : '') + '"></div></div>';
        html += '<div class="form-group"><label>Roof Types (comma-separated)</label><input type="text" id="tf_roof_types" value="' + (p && Array.isArray(p.roof_types) ? p.roof_types.join(', ') : '') + '" placeholder="e.g. metal, flat"></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div>';
    } else if (type === 'mounting_part') {
        html += '<div class="grid-2"><div class="form-group"><label>Part Type</label><input type="text" id="tf_part_type" value="' + esc(p && p.part_type || '') + '" placeholder="e.g. tilt_angle, rail"></div>';
        html += '<div class="form-group"><label>Tilt Key</label><input type="text" id="tf_tilt_key" value="' + esc(p && p.tilt_key || '') + '" placeholder="e.g. 10_15"></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>Qty</label><input type="number" id="tf_qty" value="' + (p && p.qty != null ? p.qty : '') + '"></div>';
        html += '<div class="form-group"><label>Price ($)</label><input type="number" id="tf_price" step="0.01" value="' + (p && p.price != null ? p.price : '') + '"></div></div>';
    }

    // Discount section for applicable types
    if (DISCOUNT_TABLES.indexOf(TYPE_TO_TABLE[type]) !== -1) {
        html += '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--separator);">';
        html += '<div style="font-size:12px;font-weight:600;color:var(--green);margin-bottom:8px;">Promotional Discount</div>';
        html += '<div class="grid-2"><div class="form-group"><label>Discount %</label><input type="number" id="tf_discount_pct" min="0" max="100" step="0.01" value="' + (p && p.discount_pct ? p.discount_pct : '0') + '"></div>';
        html += '<div></div></div>';
        html += '<div class="grid-2"><div class="form-group"><label>From</label><input type="date" id="tf_discount_from" value="' + (p && p.discount_from || '') + '"></div>';
        html += '<div class="form-group"><label>To</label><input type="date" id="tf_discount_to" value="' + (p && p.discount_to || '') + '"></div></div>';
        html += '</div>';
    }

    container.innerHTML = html;
}

function buildTypeData(type) {
    var val = function(id) { var el = document.getElementById(id); return el ? el.value : ''; };
    var num = function(id) { var v = val(id); return v === '' ? null : Number(v); };
    var chk = function(id) { var el = document.getElementById(id); return el ? el.checked : false; };

    var data = {
        sku: document.getElementById('prodSku').value.trim(),
        supplier_code: document.getElementById('prodSupplierCode').value.trim() || null,
        sort_order: Number(document.getElementById('prodSortOrder').value) || 0,
        active: document.getElementById('prodActive').checked
    };

    if (type === 'panel') {
        Object.assign(data, { manufacturer: val('tf_manufacturer') || null, model: val('tf_model') || null, wattage: num('tf_wattage'), colour: val('tf_colour') || null, width_mm: num('tf_width_mm'), height_mm: num('tf_height_mm'), price: num('tf_price') });
    } else if (type === 'inverter') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), phase: val('tf_phase'), kw: num('tf_kw'), max_pv_kw: num('tf_max_pv_kw'), solar_only: chk('tf_solar_only'), price: num('tf_price') });
    } else if (type === 'battery_module') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), battery_type_id: val('tf_battery_type_id') || null, kwh: num('tf_kwh'), usable_kwh: num('tf_usable_kwh'), enabled: chk('tf_enabled'), price: num('tf_price') });
    } else if (type === 'gateway') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), phase: val('tf_phase'), description: val('tf_description') || null, price: num('tf_price') });
    } else if (type === 'ev_charger') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), phase: val('tf_phase') || null, description: val('tf_description') || null, price: num('tf_price') });
    } else if (type === 'accessory') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), accessory_id: val('tf_accessory_id') || null, description: val('tf_description') || null, price: num('tf_price'), price_alt: num('tf_price_alt'), phase_dependent: chk('tf_phase_dependent'), default_checked: chk('tf_default_checked'), supplier_code_single: val('tf_supplier_code_single') || null, supplier_code_three: val('tf_supplier_code_three') || null, note: val('tf_note') || null });
    } else if (type === 'battery_mounting') {
        Object.assign(data, { manufacturer: val('tf_manufacturer'), mount_key: val('tf_mount_key') || null, price: num('tf_price') });
    } else if (type === 'mounting_kit') {
        var rtStr = val('tf_roof_types');
        var rtArr = rtStr ? rtStr.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
        Object.assign(data, { kit_family: val('tf_kit_family') || null, panels_covered: num('tf_panels_covered'), roof_types: rtArr, price: num('tf_price') });
    } else if (type === 'mounting_part') {
        Object.assign(data, { part_type: val('tf_part_type') || null, tilt_key: val('tf_tilt_key') || null, qty: num('tf_qty'), price: num('tf_price') });
    }

    // Discount fields for applicable types
    if (DISCOUNT_TABLES.indexOf(TYPE_TO_TABLE[type]) !== -1) {
        data.discount_pct = num('tf_discount_pct') || 0;
        data.discount_from = val('tf_discount_from') || null;
        data.discount_to = val('tf_discount_to') || null;
    }

    return data;
}

async function saveProduct() {
    var sku = document.getElementById('prodSku').value.trim();
    if (!sku) { showToast('SKU is required.', 'error'); return; }

    var type = document.getElementById('prodType').value;
    var tableName = TYPE_TO_TABLE[type];
    var data = buildTypeData(type);

    closeModal('productEditModal');

    if (editingProductId) {
        var result = await sb.from(tableName).update(data).eq('id', editingProductId);
        if (result.error) { showToast('Save failed: ' + result.error.message, 'error'); return; }
        showToast('Product updated.');
    } else {
        var result2 = await sb.from(tableName).insert(data);
        if (result2.error) { showToast('Create failed: ' + result2.error.message, 'error'); return; }
        showToast('Product created.');
    }

    await loadPricingData();
}

// ==============================
// BUSINESS PARAMS
// ==============================
function renderBusinessParams() {
    var wrap = document.getElementById('businessParamsWrap');
    if (!businessParamsRow) {
        wrap.innerHTML = '<div style="color:var(--text-quaternary);font-size:13px;">No business parameters found. Run the SQL migration first.</div>';
        return;
    }
    var bp = businessParamsRow;
    var surcharges = bp.roof_surcharges || {};

    wrap.innerHTML = '<div class="detail-section-title" style="margin-top:0;">Business Parameters</div>' +
        '<div class="params-grid">' +
        '<div class="form-group"><label>GP Margin (%)</label><input type="number" id="bpGpMargin" value="' + bp.gp_margin + '" step="0.01"></div>' +
        '<div class="form-group"><label>Sales Commission (%)</label><input type="number" id="bpCommission" value="' + bp.sales_commission + '" step="0.01"></div>' +
        '<div class="form-group"><label>STC Price ($)</label><input type="number" id="bpStcPrice" value="' + bp.stc_price + '" step="0.01"></div>' +
        '<div class="form-group"><label>STC Deeming Period (yrs)</label><input type="number" id="bpStcDeeming" value="' + bp.stc_deeming_period + '"></div>' +
        '<div class="form-group"><label>Battery Rebate ($/kWh)</label><input type="number" id="bpBatRebate" value="' + bp.battery_rebate_per_kwh + '" step="0.01"></div>' +
        '<div class="form-group"><label>Install PV ($/kW)</label><input type="number" id="bpInstallPv" value="' + bp.install_pv_per_kw + '" step="0.01"></div>' +
        '<div class="form-group"><label>Install Battery ($/stack)</label><input type="number" id="bpInstallBat" value="' + bp.install_battery_per_stack + '" step="0.01"></div>' +
        '<div class="form-group"><label>Default Panel Count</label><input type="number" id="bpDefPanels" value="' + bp.default_panel_count + '"></div>' +
        '<div class="form-group"><label>Default Battery kWh</label><input type="number" id="bpDefBattery" value="' + bp.default_battery_kwh + '"></div>' +
        '<div class="form-group"><label>Split Array Labour ($)</label><input type="number" id="bpSplitLabour" value="' + bp.split_array_labour + '" step="0.01"></div>' +
        '<div class="form-group"><label>Fixed Overhead ($)</label><input type="number" id="bpFixedOverhead" value="' + (bp.fixed_overhead || 0) + '" step="1"></div>' +
        '<div class="form-group"><label>Zero Bill Base Premium ($)</label><input type="number" id="bpZeroBillBase" value="' + (bp.zero_bill_base || 0) + '" step="1"></div>' +
        '<div class="form-group"><label>Zero Bill Premium (%)</label><input type="number" id="bpZeroBillPct" value="' + (bp.zero_bill_pct || 0) + '" step="0.01"></div>' +
        '</div>' +
        '<div class="detail-section-title">Roof Surcharges</div>' +
        '<div class="params-grid">' +
        '<div class="form-group"><label>Metal ($)</label><input type="number" id="bpRsMetal" value="' + (surcharges.metal || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Tile ($)</label><input type="number" id="bpRsTile" value="' + (surcharges.tile || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Concrete ($)</label><input type="number" id="bpRsConcrete" value="' + (surcharges.concrete || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Klip Lock ($)</label><input type="number" id="bpRsKliplock" value="' + (surcharges.kliplock || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Terracotta ($)</label><input type="number" id="bpRsTerracotta" value="' + (surcharges.terracotta || 0) + '" step="0.01"></div>' +
        '<div class="form-group"><label>Flat ($)</label><input type="number" id="bpRsFlat" value="' + (surcharges.flat || 0) + '" step="0.01"></div>' +
        '</div>' +
        '<div class="detail-actions"><button class="btn-save" onclick="saveBusinessParams()">Save Parameters</button>' +
        '<button class="btn-sm" onclick="switchPricingSection(\'products\')" style="margin-left:8px;">Back to Products</button></div>';
}

async function saveBusinessParams() {
    if (!businessParamsRow) return;
    var val = function(id) { return Number(document.getElementById(id).value) || 0; };

    var data = {
        gp_margin: val('bpGpMargin'),
        sales_commission: val('bpCommission'),
        stc_price: val('bpStcPrice'),
        stc_deeming_period: val('bpStcDeeming'),
        battery_rebate_per_kwh: val('bpBatRebate'),
        install_pv_per_kw: val('bpInstallPv'),
        install_battery_per_stack: val('bpInstallBat'),
        default_panel_count: val('bpDefPanels'),
        default_battery_kwh: val('bpDefBattery'),
        split_array_labour: val('bpSplitLabour'),
        fixed_overhead: val('bpFixedOverhead'),
        zero_bill_base: val('bpZeroBillBase'),
        zero_bill_pct: val('bpZeroBillPct'),
        roof_surcharges: {
            metal: val('bpRsMetal'),
            tile: val('bpRsTile'),
            concrete: val('bpRsConcrete'),
            kliplock: val('bpRsKliplock'),
            terracotta: val('bpRsTerracotta'),
            flat: val('bpRsFlat')
        }
    };

    var result = await sb.from('business_params').update(data).eq('id', businessParamsRow.id);
    if (result.error) { showToast('Save failed: ' + result.error.message, 'error'); return; }

    Object.assign(businessParamsRow, data);
    showToast('Business parameters saved.');
}

// ==============================
// BULK PRICE IMPORT
// ==============================
function openBulkImportModal() {
    document.getElementById('bulkCsvInput').value = '';
    document.getElementById('bulkPreview').innerHTML = '';
    document.getElementById('bulkApplyBtn').disabled = true;
    bulkChanges = [];
    openModal('bulkImportModal');
}

function buildSupplierCodeLookup() {
    var lookup = {};
    Object.keys(allTables).forEach(function(tableName) {
        (allTables[tableName] || []).forEach(function(p) {
            if (p.supplier_code) lookup[p.supplier_code] = { id: p.id, table: tableName, price: p.price };
        });
    });
    return lookup;
}

function previewBulkImport() {
    var csv = document.getElementById('bulkCsvInput').value.trim();
    if (!csv) { showToast('Paste CSV data first.', 'error'); return; }

    var lookup = buildSupplierCodeLookup();
    var lines = csv.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
    bulkChanges = [];
    var html = '<table class="bulk-preview-table"><thead><tr><th>Supplier Code</th><th>Current</th><th>New</th><th>Status</th></tr></thead><tbody>';

    lines.forEach(function(line) {
        var parts = line.split(',').map(function(s) { return s.trim(); });
        if (parts.length < 2) return;
        var code = parts[0], newPrice = Number(parts[1]);
        if (isNaN(newPrice)) return;

        var match = lookup[code];
        if (match) {
            var oldPrice = Number(match.price) || 0;
            var changed = oldPrice !== newPrice;
            bulkChanges.push({ id: match.id, table: match.table, supplier_code: code, old_price: oldPrice, new_price: newPrice });
            html += '<tr><td>' + esc(code) + '</td><td>$' + oldPrice.toFixed(2) + '</td><td class="price-change">$' + newPrice.toFixed(2) + '</td><td>' + (changed ? 'Update' : 'No change') + '</td></tr>';
        } else {
            html += '<tr><td>' + esc(code) + '</td><td>\u2014</td><td>$' + newPrice.toFixed(2) + '</td><td class="not-found">Not found</td></tr>';
        }
    });

    html += '</tbody></table>';
    var matched = bulkChanges.filter(function(c) { return c.old_price !== c.new_price; }).length;
    html += '<p style="margin-top:8px;font-size:12px;color:var(--text-secondary);">' + bulkChanges.length + ' matched, ' + matched + ' to update</p>';

    document.getElementById('bulkPreview').innerHTML = html;
    document.getElementById('bulkApplyBtn').disabled = matched === 0;
}

async function applyBulkImport() {
    var toUpdate = bulkChanges.filter(function(c) { return c.old_price !== c.new_price; });
    if (toUpdate.length === 0) return;

    var errors = 0;
    for (var i = 0; i < toUpdate.length; i++) {
        var c = toUpdate[i];
        var result = await sb.from(c.table).update({ price: c.new_price }).eq('id', c.id);
        if (result.error) errors++;
    }

    closeModal('bulkImportModal');
    if (errors > 0) {
        showToast(errors + ' of ' + toUpdate.length + ' updates failed.', 'error');
    } else {
        showToast(toUpdate.length + ' prices updated.');
    }
    await loadPricingData();
}

// ==============================
// USER MANAGEMENT
// ==============================
let adminUsers = [];

async function callUserAdmin(action, params = {}) {
    if (!sb) throw new Error('Database not available');
    var { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Not authenticated');
    var resp = await fetch(SUPABASE_URL + '/functions/v1/admin-users', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + session.access_token,
            'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ action: action, ...params }),
    });
    var result = await resp.json();
    if (!resp.ok) throw new Error(result.error || result.message || 'Request failed');
    return result;
}

async function loadUsers() {
    try {
        var result = await callUserAdmin('list');
        adminUsers = result.users || [];
        renderUsersView();
    } catch (e) {
        console.error('loadUsers:', e);
        showToast('Failed to load users: ' + e.message, 'error');
    }
}

function renderUsersView() {
    var wrap = document.getElementById('usersContent');
    if (adminUsers.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;color:var(--text-quaternary);padding:40px;font-size:14px;">No users found</div>';
        return;
    }
    var rows = adminUsers.map(function(u) {
        var created = u.created_at ? new Date(u.created_at).toLocaleDateString() : '—';
        var lastSign = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : 'Never';
        return '<tr>' +
            '<td>' + esc(u.email) + '</td>' +
            '<td>' + created + '</td>' +
            '<td>' + lastSign + '</td>' +
            '<td><button type="button" class="btn-icon danger" onclick="deleteUser(\'' + u.id + '\', \'' + esc(u.email).replace(/'/g, "\\'") + '\')" title="Delete user">&times;</button></td>' +
            '</tr>';
    }).join('');
    wrap.innerHTML =
        '<table class="product-table">' +
        '<thead><tr><th>Email</th><th>Created</th><th>Last Sign In</th><th style="width:40px;"></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>';
}

async function createUser() {
    var email = document.getElementById('newUserEmail').value.trim();
    var password = document.getElementById('newUserPassword').value;
    var errEl = document.getElementById('addUserError');
    errEl.style.display = 'none';

    if (!email || !password) {
        errEl.textContent = 'Email and password are required.';
        errEl.style.display = 'block';
        return;
    }
    if (password.length < 6) {
        errEl.textContent = 'Password must be at least 6 characters.';
        errEl.style.display = 'block';
        return;
    }

    try {
        await callUserAdmin('create', { email: email, password: password });
        closeModal('addUserModal');
        document.getElementById('newUserEmail').value = '';
        document.getElementById('newUserPassword').value = '';
        showToast('User created: ' + email);
        await loadUsers();
    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
    }
}

async function deleteUser(userId, email) {
    // Prevent self-deletion client-side with clear feedback
    var { data: { session } } = await sb.auth.getSession();
    if (session && session.user && session.user.id === userId) {
        showToast('You cannot delete your own account.', 'error');
        return;
    }
    showConfirmModal(
        'Delete User',
        'Are you sure you want to delete "' + email + '"? They will no longer be able to log in.',
        'Delete',
        async function() {
            try {
                await callUserAdmin('delete', { userId: userId });
                showToast('User deleted: ' + email);
                await loadUsers();
            } catch (e) {
                showToast('Delete failed: ' + e.message, 'error');
            }
        },
        true
    );
}

// ==============================
// SALES REPS MANAGEMENT
// ==============================
let adminReps = [];

async function loadAdminReps() {
    try {
        var { data, error } = await sb.from('reps').select('*').order('name');
        if (error) throw error;
        adminReps = data || [];
        renderRepsView();
    } catch (e) {
        console.error('loadAdminReps:', e);
        showToast('Failed to load reps: ' + e.message, 'error');
    }
}

function renderRepsView() {
    var wrap = document.getElementById('repsContent');
    if (!wrap) return;
    if (adminReps.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;color:var(--text-quaternary);padding:40px;font-size:14px;">No sales reps found</div>';
        return;
    }
    var rows = adminReps.map(function(r) {
        var status = r.active ? '<span style="color:var(--green);font-weight:600;">Active</span>' : '<span style="color:var(--text-quaternary);">Inactive</span>';
        return '<tr>' +
            '<td>' + esc(r.name) + '</td>' +
            '<td>' + esc(r.phone || '') + '</td>' +
            '<td>' + esc(r.email || '') + '</td>' +
            '<td>' + status + '</td>' +
            '<td style="white-space:nowrap;">' +
                '<button type="button" class="btn-icon" onclick="openRepModal(\'' + r.id + '\')" title="Edit">&#9998;</button>' +
                '<button type="button" class="btn-icon" onclick="toggleRepActive(\'' + r.id + '\', ' + (r.active ? 'false' : 'true') + ')" title="' + (r.active ? 'Deactivate' : 'Activate') + '">' + (r.active ? '&#10005;' : '&#10003;') + '</button>' +
            '</td>' +
            '</tr>';
    }).join('');
    wrap.innerHTML =
        '<table class="product-table">' +
        '<thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Status</th><th style="width:70px;"></th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>';
}

function openRepModal(repId) {
    var errEl = document.getElementById('repEditError');
    errEl.style.display = 'none';
    if (repId) {
        var rep = adminReps.find(function(r) { return r.id === repId; });
        if (!rep) return;
        document.getElementById('repModalTitle').textContent = 'Edit Sales Rep';
        document.getElementById('repEditId').value = rep.id;
        document.getElementById('repEditName').value = rep.name || '';
        document.getElementById('repEditPhone').value = rep.phone || '';
        document.getElementById('repEditEmail').value = rep.email || '';
    } else {
        document.getElementById('repModalTitle').textContent = 'Add Sales Rep';
        document.getElementById('repEditId').value = '';
        document.getElementById('repEditName').value = '';
        document.getElementById('repEditPhone').value = '';
        document.getElementById('repEditEmail').value = '';
    }
    openModal('repEditModal');
}

async function saveRep() {
    var id = document.getElementById('repEditId').value;
    var name = document.getElementById('repEditName').value.trim();
    var phone = document.getElementById('repEditPhone').value.trim();
    var email = document.getElementById('repEditEmail').value.trim();
    var errEl = document.getElementById('repEditError');
    errEl.style.display = 'none';

    if (!name) {
        errEl.textContent = 'Name is required.';
        errEl.style.display = 'block';
        return;
    }

    try {
        if (id) {
            var { error } = await sb.from('reps').update({ name: name, phone: phone, email: email }).eq('id', id);
            if (error) throw error;
            showToast('Rep updated: ' + name);
        } else {
            var { error } = await sb.from('reps').insert({ name: name, phone: phone, email: email, active: true });
            if (error) throw error;
            showToast('Rep created: ' + name);
        }
        closeModal('repEditModal');
        await loadAdminReps();
    } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
    }
}

async function toggleRepActive(repId, active) {
    try {
        var { error } = await sb.from('reps').update({ active: active }).eq('id', repId);
        if (error) throw error;
        showToast(active ? 'Rep activated' : 'Rep deactivated');
        await loadAdminReps();
    } catch (e) {
        showToast('Failed: ' + e.message, 'error');
    }
}

// ==============================
// QUOTES VIEW
// ==============================
let adminQuotes = [];

function parseDollar(v) {
    if (typeof v === 'number') return v;
    return parseFloat((v || '').toString().replace(/[$,]/g, '')) || 0;
}

function fmtDollar(n) {
    if (n == null || isNaN(n)) return '—';
    return '$' + Math.round(n).toLocaleString();
}

async function loadQuotes() {
    var wrap = document.getElementById('quotesContent');
    wrap.innerHTML = '<div style="text-align:center;color:var(--text-quaternary);padding:40px;font-size:14px;">Loading quotes…</div>';
    try {
        var [quotesRes, bpRes] = await Promise.all([
            sb.from('quotes').select('*, reps(name)').order('created_at', { ascending: false }),
            businessParamsRow ? Promise.resolve({ data: businessParamsRow }) : sb.from('business_params').select('*').limit(1).maybeSingle()
        ]);
        if (quotesRes.error) throw quotesRes.error;
        adminQuotes = quotesRes.data || [];
        if (bpRes.data) businessParamsRow = bpRes.data;
        renderQuotesView();
    } catch (e) {
        console.error('loadQuotes:', e);
        wrap.innerHTML = '<div style="text-align:center;color:var(--red);padding:40px;font-size:14px;">Failed to load quotes: ' + esc(e.message) + '</div>';
    }
}

function renderQuotesView() {
    var wrap = document.getElementById('quotesContent');
    var countEl = document.getElementById('quotesCount');
    if (countEl) countEl.textContent = adminQuotes.length + ' quote' + (adminQuotes.length !== 1 ? 's' : '');

    if (adminQuotes.length === 0) {
        wrap.innerHTML = '<div style="text-align:center;color:var(--text-quaternary);padding:40px;font-size:14px;">No saved quotes found</div>';
        return;
    }

    var rows = adminQuotes.map(function(q, idx) {
        var customer = (q.customer && q.customer.name) || '—';
        var repName = (q.reps && q.reps.name) || '—';
        var date = q.created_at ? new Date(q.created_at).toLocaleDateString() : '—';
        var totals = q.totals || {};
        var pricing = q.pricing || {};

        var sysKw = totals.sysKw || 0;
        var batteryKwh = totals.batteryKwh || 0;
        var systemDesc = '';
        if (sysKw) systemDesc += Number(sysKw).toFixed(2) + ' kW';
        if (batteryKwh) systemDesc += (systemDesc ? ' + ' : '') + Number(batteryKwh).toFixed(2) + ' kWh';
        if (!systemDesc) systemDesc = '—';

        var cogTotal = parseDollar(totals.totalCog);
        var installation = q.installation || {};
        var installTotal = installation.total || 0;
        var cog = cogTotal - installTotal;
        var gpPct = pricing.gpMargin || 0;
        var gpAmt = cogTotal * gpPct / 100;
        var commPct = pricing.salesCommission || 0;
        var commRate = commPct / 100;
        var customerPrice = parseDollar(totals.customerPrice);
        var discount = totals.discount || 0;

        // Derive Price (inc GST, before rebates) from the commission formula
        var priceBeforeComm = cogTotal + gpAmt;
        var baseIncGst = priceBeforeComm * 1.1;
        var priceIncGst = baseIncGst; // fallback if no commission
        if (commRate > 0) {
            var m = commRate / (1 - commRate * 1.1);
            priceIncGst = baseIncGst + (customerPrice + discount) * m / (1 + m);
        }

        var pvStc = totals.pvStcRebate || 0;
        var batStc = totals.batteryStcRebate || 0;
        var commAmtIncGst = priceIncGst - baseIncGst;
        var fixedOverhead = Number(totals.fixedOverhead) || 0;
        var netGp = priceIncGst - (cog * 1.1) - (installTotal * 1.1) - commAmtIncGst - discount + fixedOverhead;
        var netGpPct = priceIncGst > 0 ? (netGp / priceIncGst * 100) : 0;

        return '<tr>' +
            '<td>' + esc(date) + '</td>' +
            '<td>' + esc(customer) + '</td>' +
            '<td>' + esc(repName) + '</td>' +
            '<td>' + esc(systemDesc) + '</td>' +
            '<td style="text-align:right;">' + fmtDollar(priceIncGst) + '</td>' +
            '<td style="text-align:right;">' + fmtDollar(customerPrice) + '</td>' +
            '<td style="text-align:right;">' + fmtDollar(cog * 1.1) + '</td>' +
            '<td style="text-align:right;">' + fmtDollar(installTotal * 1.1) + '</td>' +
            '<td style="text-align:right;">' + (pvStc > 0 ? '-' + fmtDollar(pvStc) : '—') + '</td>' +
            '<td style="text-align:right;">' + (batStc > 0 ? '-' + fmtDollar(batStc) : '—') + '</td>' +
            '<td style="text-align:right;">' + commPct.toFixed(1) + '%</td>' +
            '<td style="text-align:right;">' + fmtDollar(commAmtIncGst) + '</td>' +
            '<td style="text-align:right;">' + (discount ? fmtDollar(discount) : '—') + '</td>' +
            '<td style="text-align:right;">' + fmtDollar(netGp) + '</td>' +
            '<td style="text-align:right;">' + netGpPct.toFixed(1) + '%</td>' +
            '<td style="text-align:center;">' + (q.bom_snapshot ? '<button onclick="showQuoteBOM(' + idx + ')" style="padding:4px 10px;font-size:12px;border:1px solid var(--border-primary);border-radius:6px;background:var(--bg-primary);color:var(--text-secondary);cursor:pointer;">BOM</button>' : '<span style="color:var(--text-quaternary);font-size:11px;">N/A</span>') + '</td>' +
            '</tr>';
    }).join('');

    wrap.innerHTML =
        '<div style="overflow-x:auto;">' +
        '<table class="product-table">' +
        '<thead><tr>' +
            '<th>Date</th>' +
            '<th>Customer</th>' +
            '<th>Rep</th>' +
            '<th>System</th>' +
            '<th style="text-align:right;">Price</th>' +
            '<th style="text-align:right;">Customer Price</th>' +
            '<th style="text-align:right;">COG</th>' +
            '<th style="text-align:right;">Install</th>' +
            '<th style="text-align:right;">PV STC</th>' +
            '<th style="text-align:right;">Bat STC</th>' +
            '<th style="text-align:right;">Comm%</th>' +
            '<th style="text-align:right;">Comm$</th>' +
            '<th style="text-align:right;">Discount</th>' +
            '<th style="text-align:right;">Net GP$</th>' +
            '<th style="text-align:right;">Net GP%</th>' +
            '<th style="text-align:center;">BOM</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>' +
        '</div>';
}

// ==============================
// QUOTE BOM OVERLAY
// ==============================
function showQuoteBOM(idx) {
    var q = adminQuotes[idx];
    if (!q || !q.bom_snapshot) {
        alert('BOM not available — saved before snapshot feature.');
        return;
    }
    var bom = q.bom_snapshot;
    var totals = q.totals || {};
    var customer = q.customer || {};
    var date = q.created_at ? new Date(q.created_at).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
    var addrParts = [customer.address, customer.suburb, customer.state, customer.postcode].filter(Boolean);

    var html = '';

    // Customer header
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;">';
    html += '<div><strong style="font-size:15px;">' + esc(customer.name || '—') + '</strong>';
    if (addrParts.length) html += '<br><span style="color:#6b7280;">' + esc(addrParts.join(', ')) + '</span>';
    if (customer.phone || customer.email) html += '<br><span style="color:#6b7280;">' + [customer.phone, customer.email].filter(Boolean).map(esc).join(' | ') + '</span>';
    html += '</div>';
    html += '<div style="text-align:right;white-space:nowrap;">' + esc(date) + '</div>';
    html += '</div>';

    // BOM table per category
    var grandTotal = 0;
    bom.forEach(function(group) {
        var groupTotal = group.items.reduce(function(s, item) { return s + (item.total || 0); }, 0);
        grandTotal += groupTotal;
        html += '<div style="margin-bottom:14px;">';
        html += '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#2563eb;padding:8px 0;border-bottom:2px solid #2563eb;">' + esc(group.category) + '</div>';
        html += '<table style="width:100%;border-collapse:collapse;font-size:13px;">';
        html += '<thead><tr style="color:#9ca3af;text-transform:uppercase;font-size:11px;letter-spacing:0.5px;">' +
            '<th style="text-align:left;padding:8px 4px;border-bottom:1px solid #e5e7eb;">Description</th>' +
            '<th style="text-align:left;padding:8px 4px;border-bottom:1px solid #e5e7eb;width:120px;">SKU / Code</th>' +
            '<th style="text-align:center;padding:8px 4px;border-bottom:1px solid #e5e7eb;width:50px;">Qty</th>' +
            '<th style="text-align:right;padding:8px 4px;border-bottom:1px solid #e5e7eb;width:100px;">Unit (ex)</th>' +
            '<th style="text-align:right;padding:8px 4px;border-bottom:1px solid #e5e7eb;width:100px;">Total (ex)</th>' +
            '</tr></thead><tbody>';
        group.items.forEach(function(item, ii) {
            var bg = ii % 2 === 0 ? '#f9fafb' : '#fff';
            var pad = item.indent ? '7px 4px 7px 24px' : '7px 4px';
            var fw = item.isGroup ? 'font-weight:600;' : '';
            var clr = item.indent ? 'color:#6b7280;' : '';
            var codeDisplay = item.supplier_code || item.sku || '';
            if (codeDisplay === 'Labour' || codeDisplay === 'Custom') codeDisplay = '';
            html += '<tr style="background:' + bg + ';' + clr + fw + '">' +
                '<td style="padding:' + pad + ';">' + (item.indent ? '- ' : '') + esc(item.desc) + '</td>' +
                '<td style="padding:7px 4px;font-size:11px;color:#9ca3af;">' + esc(codeDisplay) + '</td>' +
                '<td style="text-align:center;padding:7px 4px;">' + item.qty + '</td>' +
                '<td style="text-align:right;padding:7px 4px;">' + (item.isGroup ? '' : '$' + Math.round(item.unit || 0).toLocaleString()) + '</td>' +
                '<td style="text-align:right;padding:7px 4px;">' + (item.isGroup ? '' : '$' + Math.round(item.total || 0).toLocaleString()) + '</td>' +
                '</tr>';
        });
        html += '<tr style="font-weight:600;border-top:1px solid #d1d5db;">' +
            '<td colspan="4" style="padding:7px 4px;text-align:right;">Subtotal</td>' +
            '<td style="padding:7px 4px;text-align:right;">$' + Math.round(groupTotal).toLocaleString() + '</td></tr>';
        html += '</tbody></table></div>';
    });

    // Grand total COG
    html += '<div style="border-top:2px solid #111827;padding:10px 0;font-size:15px;font-weight:700;display:flex;justify-content:space-between;">' +
        '<span>Total COG (ex GST)</span><span>$' + Math.round(grandTotal).toLocaleString() + '</span></div>';

    // Summary section
    html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid #e5e7eb;">';
    html += '<table style="width:100%;font-size:14px;border-collapse:collapse;">';
    var summaryRow = function(label, value, style) {
        return '<tr style="' + (style || '') + '"><td style="padding:6px 0;color:#6b7280;">' + label + '</td><td style="padding:6px 0;text-align:right;font-weight:500;">' + value + '</td></tr>';
    };

    var priceBeforeRebatesIncGst = totals.priceBeforeRebatesIncGst || 0;
    if (!priceBeforeRebatesIncGst && totals.customerPrice) {
        // Fallback: derive from customer price + rebates + discount - overhead - zeroBill
        priceBeforeRebatesIncGst = parseDollar(totals.customerPrice) + (totals.pvStcRebate || 0) + (totals.batteryStcRebate || 0) + (totals.discount || 0) - (totals.fixedOverhead || 0) - (totals.zeroBillPremium || 0);
    }
    html += summaryRow('Price Before Rebates (inc GST)', '$' + Math.round(priceBeforeRebatesIncGst).toLocaleString());

    var pvStcCount = totals.pvStcCount || 0;
    var pvStcRebate = totals.pvStcRebate || 0;
    if (pvStcRebate > 0) html += summaryRow('PV STC Rebate' + (pvStcCount ? ' (' + pvStcCount + ' STCs)' : ''), '-$' + Math.round(pvStcRebate).toLocaleString(), 'color:#059669;');
    var batStcRebate = totals.batteryStcRebate || 0;
    if (batStcRebate > 0) html += summaryRow('Battery STC Rebate', '-$' + Math.round(batStcRebate).toLocaleString(), 'color:#059669;');
    var discount = totals.discount || 0;
    if (discount > 0) html += summaryRow('Discount', '-$' + Math.round(discount).toLocaleString(), 'color:#059669;');
    var zeroBillPremium = totals.zeroBillPremium || 0;
    if (zeroBillPremium > 0) html += summaryRow('Zero Bill Premium', '$' + Math.round(zeroBillPremium).toLocaleString());
    var fixedOverhead = Number(totals.fixedOverhead) || 0;
    if (fixedOverhead > 0) html += summaryRow('Fixed Overhead', '$' + Math.round(fixedOverhead).toLocaleString());

    var customerPrice = totals.customerPrice || '—';
    html += summaryRow('Customer Price (inc GST)', customerPrice, 'border-top:2px solid #2563eb;font-weight:700;font-size:16px;color:#2563eb;');
    html += '</table></div>';

    document.getElementById('adminBomContent').innerHTML = html;
    document.getElementById('adminBomOverlay').style.display = 'block';
    document.body.style.overflow = 'hidden';
}

function closeAdminBOM() {
    document.getElementById('adminBomOverlay').style.display = 'none';
    document.body.style.overflow = '';
}

function printAdminBOM() {
    window.print();
}

// ==============================
// INIT
// ==============================
// ====================
// GOOGLE PLACES AUTOCOMPLETE
// ====================
let googlePlacesReady = false;

async function loadGooglePlaces() {
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://maps.googleapis.com/maps/api/js?key=AIzaSyDm3OvAL51st1XlNM8ywzYSAThgyS8SGrA&libraries=places&loading=async';
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Script failed to load'));
            document.head.appendChild(script);
        });
        let attempts = 0;
        while (!window.google?.maps?.places?.Autocomplete && attempts < 20) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        if (window.google?.maps?.places?.Autocomplete) {
            googlePlacesReady = true;
            attachPlacesAutocomplete('cloneAddress');
            console.log('[OK] Google Places loaded');
        } else {
            console.warn('[!] Google Places API not available');
        }
    } catch (e) {
        console.warn('[!] Google Places not available:', e.message);
    }
}

function attachPlacesAutocomplete(inputId) {
    if (!googlePlacesReady) return;
    const input = document.getElementById(inputId);
    if (!input || input._placesAttached) return;
    const autocomplete = new google.maps.places.Autocomplete(input, {
        componentRestrictions: { country: 'au' },
        fields: ['formatted_address'],
        types: ['address']
    });
    autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace();
        if (place.formatted_address) input.value = place.formatted_address;
    });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    input._placesAttached = true;
}

document.addEventListener('DOMContentLoaded', async () => {
    loadGooglePlaces();
    var authed = await checkAuth();
    if (authed) {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('adminContainer').style.display = '';
        loadContractors();
    }
});
