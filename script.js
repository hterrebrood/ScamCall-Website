// API endpoints for KMB/LWB bus data
const API_BASE = 'https://data.etabus.gov.hk/v1/transport/kmb';
const API_ROUTES = `${API_BASE}/route/`;
const API_ROUTE = `${API_BASE}/route/`;
const API_ROUTE_STOP = `${API_BASE}/route-stop/`;
const API_STOP = `${API_BASE}/stop/`;

let routesData = [];
let selectedRoute = null;
let map;
let routeLayer;

// Initialize the app
document.addEventListener('DOMContentLoaded', async () => {
    await loadRoutes();
    setupEventListeners();
    initMap();
});
function initMap() {
    map = L.map('map').setView([22.302711, 114.177216], 11); // Hong Kong default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
}

// Setup event listeners
function setupEventListeners() {
    const routeSelect = document.getElementById('busRouteSelect');
    const searchInput = document.getElementById('busRouteSearch');
    
    routeSelect.addEventListener('change', (e) => {
        const routeId = e.target.value;
        if (routeId) {
            selectRoute(routeId);
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

// Populate the dropdown with routes
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
        option.value = route.route;
        option.textContent = `Route ${route.route}`;
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
        if (option.value && option.value.toLowerCase().includes(searchLower)) {
            select.value = option.value;
            const event = new Event('change');
            select.dispatchEvent(event);
            return;
        }
    }
}

// Select a route and show route-only information
async function selectRoute(routeNumber) {
    try {
        selectedRoute = routeNumber;
        const routeInfo = routesData.find(r => r.route === routeNumber);
        displayRouteInfo(routeInfo);
        await drawRouteOnMap(routeNumber);
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
}

// Show error message
function showError(message) {
    console.error(message);
}

// Fetch route stops, then fetch stop coords and draw on map
async function drawRouteOnMap(routeNumber) {
    try {
        // Clear previous layers
        routeLayer.clearLayers();

        // Fetch stops for route
        const res = await fetch(`${API_ROUTE_STOP}${routeNumber}`);
        const json = await res.json();
        const routeStops = (json && json.data) ? json.data : [];

        if (!routeStops.length) {
            return; // nothing to draw
        }

        // Sort by bound, then sequence for a clean polyline
        routeStops.sort((a, b) => {
            if (a.bound !== b.bound) return a.bound.localeCompare(b.bound);
            return (a.seq || 0) - (b.seq || 0);
        });

        // Fetch stop coordinate details in parallel (limit concurrency naïvely)
        const uniqueStops = [...new Set(routeStops.map(s => s.stop))];
        const stopDetailPromises = uniqueStops.map(async (code) => {
            const r = await fetch(`${API_STOP}${code}`);
            const d = await r.json();
            return d.data; // { stop, name_en, lat, long, ... }
        });
        const stopDetails = await Promise.all(stopDetailPromises);
        const stopIndex = new Map(stopDetails.filter(Boolean).map(s => [s.stop, s]));

        // Build coordinates per bound
        const bounds = [];
        let currentBound = routeStops[0].bound;
        let coords = [];

        routeStops.forEach(rs => {
            const sd = stopIndex.get(rs.stop);
            if (!sd) return;
            if (rs.bound !== currentBound) {
                // push previous bound polyline
                if (coords.length) bounds.push(coords);
                coords = [];
                currentBound = rs.bound;
            }
            coords.push([sd.lat, sd.long]);
            // add marker
            const marker = L.circleMarker([sd.lat, sd.long], {
                radius: 4,
                color: '#3498db',
                weight: 2,
                fillColor: '#3498db',
                fillOpacity: 0.8
            }).bindPopup(`<strong>${sd.name_en || sd.name_tc || sd.stop}</strong>`);
            routeLayer.addLayer(marker);
        });
        if (coords.length) bounds.push(coords);

        // Draw polylines
        bounds.forEach(line => {
            if (line.length >= 2) {
                const poly = L.polyline(line, { color: '#e74c3c', weight: 4, opacity: 0.8 });
                routeLayer.addLayer(poly);
            }
        });

        // Fit map to all markers
        const allLatLngs = [];
        bounds.forEach(b => b.forEach(ll => allLatLngs.push(ll)));
        if (allLatLngs.length) {
            map.fitBounds(allLatLngs);
        }
    } catch (err) {
        console.error('Map draw error:', err);
    }
}
