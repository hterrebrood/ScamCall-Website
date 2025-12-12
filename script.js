// API endpoints for KMB/LWB bus data
const API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const API_ROUTES = `${API_BASE}/route/`;
const API_ROUTE_STOP = `${API_BASE}/route-stop/`;
const API_STOP = `${API_BASE}/stop/`;
const API_ETA = `${API_BASE}/eta/`;

let routesData = [];
let selectedRoute = null;
const stopCache = new Map();
const routeStopCache = new Map();

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    await loadRoutes();
    setupEventListeners();
});

// Setup event listeners
function setupEventListeners() {
    const routeSelect = document.getElementById('busRouteSelect');
    const searchInput = document.getElementById('busRouteSearch');
    
    routeSelect.addEventListener('change', (e) => {
        const option = e.target.selectedOptions[0];
        if (!option) return;
        const routeId = option.dataset.route || option.value;
        const bound = option.dataset.bound || '';
        const serviceType = option.dataset.serviceType || '';
        if (routeId) {
            selectRoute(routeId, bound, serviceType);
        }
    });

    searchInput.addEventListener('input', (e) => {
        filterRoutes(e.target.value);
    });
}

// Load all routes
async function loadRoutes() {
    try {
        const response = await fetch(API_ROUTES);
        const data = await response.json();
        routesData = data.data || [];
        populateRouteSelect(routesData);
        
        // No stops panel: we only show route info
    } catch (error) {
        console.error('Error loading routes:', error);
        showError('Failed to load bus routes');
    }
}

// Removed stops fetching/rendering

// Populate the dropdown with routes (show direction labels so duplicates are clear)
function populateRouteSelect(routes) {
    const select = document.getElementById('busRouteSelect');
    
    // Sort routes by route number
    const sortedRoutes = routes.sort((a, b) => {
        const numA = parseInt(a.route) || 999999;
        const numB = parseInt(b.route) || 999999;
        return numA - numB;
    });

    sortedRoutes.forEach(route => {
        const option = document.createElement('option');
        option.value = `${route.route}|${route.bound || ''}|${route.service_type || ''}`;
        option.dataset.route = route.route;
        option.dataset.bound = route.bound || '';
        option.dataset.serviceType = route.service_type || '';
        const direction = route.bound === 'I' ? 'Inbound' : route.bound === 'O' ? 'Outbound' : (route.bound || 'Direction');
        const origin = route.orig_en || route.orig_tc || '';
        const dest = route.dest_en || route.dest_tc || '';
        option.textContent = `Route ${route.route} — ${direction}${origin && dest ? ` (${origin} → ${dest})` : ''}`;
        select.appendChild(option);
    });
}

// Filter routes based on search input
function filterRoutes(searchTerm) {
    const select = document.getElementById('busRouteSelect');
    const searchLower = searchTerm.toLowerCase().trim();
    
    if (!searchLower) {
        // Reset if empty
        select.value = '';
        return;
    }

    // Find first matching route
    for (let option of select.options) {
        const optRoute = (option.dataset.route || option.value || '').toLowerCase();
        if (optRoute && optRoute.includes(searchLower)) {
            select.value = option.value;
            const event = new Event('change');
            select.dispatchEvent(event);
            return;
        }
    }
}

// Select a route and show route-only information
async function selectRoute(routeNumber, bound = '', serviceType = '') {
    try {
        selectedRoute = routeNumber;
        const routeInfo = routesData.find(r => r.route === routeNumber && (bound ? r.bound === bound : true) && (serviceType ? (r.service_type || '').toString() === serviceType.toString() : true))
            || routesData.find(r => r.route === routeNumber);
        displayRouteInfo(routeInfo);
        await loadUpcomingStops(routeInfo, bound);
    } catch (error) {
        console.error('Error selecting route:', error);
        showError('Failed to load route info');
    }
}

// Removed stop details

// Removed stops list rendering

// Display route-only information
function displayRouteInfo(routeInfo) {
    document.getElementById('busNumber').textContent = routeInfo?.route || '--';
    document.getElementById('origin').textContent = routeInfo?.orig_en || routeInfo?.orig_tc || '--';
    document.getElementById('destination').textContent = routeInfo?.dest_en || routeInfo?.dest_tc || '--';
    document.getElementById('serviceType').textContent = routeInfo?.service_type || '--';
    document.getElementById('time').textContent = new Date().toLocaleTimeString();
    showStaticMap();
}

// Show error message
function showError(message) {
    console.error(message);
}

function showStaticMap() {
    const iframe = document.getElementById('staticMap');
    const placeholder = document.getElementById('mapPlaceholder');
    if (!iframe || !placeholder) return;

    iframe.src = 'https://www.td.gov.hk/filemanager/en/content_314/62a-e_n.png';
    iframe.classList.add('visible');
    placeholder.style.display = 'none';
}

// Load and render upcoming stops with ETAs for the selected route
async function loadUpcomingStops(routeInfo, preferredBound = '') {
    if (!routeInfo) return;
    const routeNumber = routeInfo.route;
    const serviceType = routeInfo.service_type || 1;
    const statusEl = document.getElementById('etaStatus');
    const listEl = document.getElementById('etaList');
    const stopsStatusEl = document.getElementById('stopsStatus');
    const stopsListEl = document.getElementById('stopsList');
    if (!statusEl || !listEl) return;

    if (stopsStatusEl && stopsListEl) {
        stopsListEl.innerHTML = '';
        stopsStatusEl.textContent = 'Loading all stops…';
    }

    listEl.innerHTML = '';
    statusEl.textContent = 'Loading stops and live ETAs…';

    try {
        const routeStops = await fetchAllRouteStops(routeNumber, serviceType);

        if (!routeStops.length) {
            statusEl.textContent = 'No stops found for this route.';
            if (stopsStatusEl) stopsStatusEl.textContent = 'No stops found for this route.';
            return;
        }

        // Determine which bound to show
        routeStops.sort((a, b) => {
            if (a.bound !== b.bound) return a.bound.localeCompare(b.bound);
            return (a.seq || 0) - (b.seq || 0);
        });
        const targetBound = preferredBound || routeInfo.bound || routeStops[0].bound;
        const stopsForBound = routeStops.filter(s => !targetBound || s.bound === targetBound).sort((a, b) => (a.seq || 0) - (b.seq || 0));
        const topStops = stopsForBound.slice(0, 5);

        // Fetch stop details and ETAs
        const enriched = await Promise.all(topStops.map(async (s) => {
            const stop = await getStopDetail(s.stop);
            const eta = await getSoonestEtaForRoute(s.stop, routeNumber);
            return { seq: s.seq, stopId: s.stop, stop, eta };
        }));

        // Preload all stop details for the full list
        const uniqueStops = [...new Set(routeStops.map(s => s.stop))];
        await Promise.all(uniqueStops.map(id => getStopDetail(id)));

        if (stopsStatusEl && stopsListEl) {
            renderAllStops(stopsForBound, stopsStatusEl, stopsListEl, targetBound);
        }

        renderEtaList(enriched, statusEl, listEl);
    } catch (err) {
        console.error('ETA load error:', err);
        statusEl.textContent = 'Unable to load ETAs right now.';
        if (stopsStatusEl) stopsStatusEl.textContent = 'Unable to load stops right now.';
    }
}

async function getStopDetail(stopId) {
    if (stopCache.has(stopId)) return stopCache.get(stopId);
    const res = await fetch(`${API_STOP}${stopId}`);
    const json = await res.json();
    const data = json?.data || null;
    stopCache.set(stopId, data);
    return data;
}

async function getSoonestEtaForRoute(stopId, routeNumber) {
    const res = await fetch(`${API_ETA}${stopId}`);
    const json = await res.json();
    const entries = (json && json.data) ? json.data : [];
    // filter for this route
    const forRoute = entries.filter(e => (e.route || '').toString() === routeNumber.toString());
    if (!forRoute.length) return null;
    // pick soonest eta
    forRoute.sort((a, b) => new Date(a.eta || 0) - new Date(b.eta || 0));
    return forRoute[0];
}

function renderEtaList(items, statusEl, listEl) {
    listEl.innerHTML = '';
    if (!items.length) {
        statusEl.textContent = 'No ETA data for this route right now.';
        return;
    }
    statusEl.textContent = '';

    items.forEach(item => {
        const li = document.createElement('li');
        li.className = 'eta-item';

        const name = item.stop?.name_en || item.stop?.name_tc || item.stopId || 'Stop';
        const etaText = formatEta(item.eta);
        const etaClass = item.eta ? (etaText.includes('min') && parseInt(etaText) <= 5 ? 'eta-time soon' : 'eta-time') : 'eta-time none';

        const stopDiv = document.createElement('div');
        stopDiv.className = 'eta-stop';
        stopDiv.textContent = name;

        const etaDiv = document.createElement('div');
        etaDiv.className = etaClass;
        etaDiv.textContent = etaText;

        li.appendChild(stopDiv);
        li.appendChild(etaDiv);
        listEl.appendChild(li);
    });
}

function formatEta(etaEntry) {
    if (!etaEntry || !etaEntry.eta) return 'No ETA available';
    const etaTime = new Date(etaEntry.eta);
    if (isNaN(etaTime)) return 'No ETA available';
    const diffMin = Math.max(0, Math.round((etaTime.getTime() - Date.now()) / 60000));
    if (diffMin === 0) return 'Arriving';
    return `${diffMin} min`;
}

async function fetchAllRouteStops(routeNumber, serviceType) {
    const cacheKey = `${routeNumber}`;
    if (routeStopCache.has(cacheKey)) {
        return routeStopCache.get(cacheKey);
    }

    try {
        const res = await fetch(API_ROUTE_STOP);
        const json = await res.json();
        const data = json?.data || [];

        if (!Array.isArray(data) || !data.length) {
            return [];
        }

        const serviceCandidates = Array.from(new Set([serviceType, 1, 2, 3].filter(Boolean).map(s => s.toString())));
        let matched = [];

        for (const svc of serviceCandidates) {
            matched = data.filter(d => (d.route || '').toString() === routeNumber.toString() && (d.service_type || '').toString() === svc);
            if (matched.length) break;
        }

        // If still none, fallback to any service type for that route
        if (!matched.length) {
            matched = data.filter(d => (d.route || '').toString() === routeNumber.toString());
        }

        routeStopCache.set(cacheKey, matched);
        return matched;
    } catch (err) {
        console.error('Route-stop fetch error list', routeNumber, serviceType, err);
        return [];
    }
}

function renderAllStops(routeStops, statusEl, listEl, boundLabel = '') {
    listEl.innerHTML = '';
    if (!routeStops.length) {
        statusEl.textContent = 'No stops to display.';
        return;
    }
    statusEl.textContent = '';

    // Single combined list in sequence order
    const sorted = routeStops
        .slice()
        .sort((a, b) => {
            if ((a.seq || 0) !== (b.seq || 0)) return (a.seq || 0) - (b.seq || 0);
            return (a.bound || '').localeCompare(b.bound || '');
        });

    const group = document.createElement('div');
    group.className = 'stops-group';

    const boundTitle = document.createElement('div');
    boundTitle.className = 'stops-bound';
    const label = boundLabel === 'I' ? 'Inbound' : boundLabel === 'O' ? 'Outbound' : (boundLabel || 'All stops');
    boundTitle.textContent = label;
    group.appendChild(boundTitle);

    const entriesWrap = document.createElement('div');
    entriesWrap.className = 'stops-entries';

    sorted.forEach(s => {
        const stopDetail = stopCache.get(s.stop);
        const name = stopDetail?.name_en || stopDetail?.name_tc || s.stop;

        const row = document.createElement('div');
        row.className = 'stops-entry';

        const seq = document.createElement('div');
        seq.className = 'stops-seq';
        seq.textContent = s.seq != null ? s.seq : '';

        const nm = document.createElement('div');
        nm.className = 'stops-name';
        nm.textContent = name;

        row.appendChild(seq);
        row.appendChild(nm);
        entriesWrap.appendChild(row);
    });

    group.appendChild(entriesWrap);
    listEl.appendChild(group);
}
