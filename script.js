/**
 * EV Charge Finder — Main Application
 * Uses traditional Google Maps callback pattern
 */
'use strict';

// ===== Config =====
const CONFIG = {
    OCMAP_API: 'https://api.openchargemap.io/v3/poi/',
    OCMAP_KEY: '37cb8fd1-5bc6-4bde-8df4-793510861c67',
    DEFAULT_LAT: 20.5937,
    DEFAULT_LNG: 78.9629,
    DEFAULT_ZOOM: 5,
    COUNTRY_CODE: 'IN', // India (ISO 2-letter code)
    MAX_RESULTS: 200,
    // Google Places API (New) uses the same browser key loaded below.
    // CPO_API_URL stays blank until you have a real operator/OCPI endpoint.
    CPO_API_URL: '',
};

// Google Maps Dark Style
const DARK_MAP_STYLE = [
    { elementType: "geometry", stylers: [{ color: "#0a0e1a" }] },
    { elementType: "labels.text.stroke", stylers: [{ color: "#0a0e1a" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#6366f1" }] },
    { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1e293b" }] },
    { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#818cf8" }] },
    { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
    { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#0f1729" }] },
    { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#22c55e" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: "#1e293b" }] },
    { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#111827" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2d3a5c" }] },
    { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#1e293b" }] },
    { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
    { featureType: "transit", elementType: "geometry", stylers: [{ color: "#111827" }] },
    { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#818cf8" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1a3d" }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3b82f6" }] },
    { featureType: "water", elementType: "labels.text.stroke", stylers: [{ color: "#0a0e1a" }] },
];

// ===== Connector Type Map =====
const CONNECTOR_NAMES = {
    1: 'Type 1 (J1772)',
    2: 'CHAdeMO',
    3: 'AC (3-Pin)',
    25: 'Type 2 (Mennekes)',
    30: 'Tesla Supercharger',
    32: 'CCS (Type 1)',
    33: 'CCS (Type 2)',
    0: 'Unknown',
};

// ===== State =====
let map, geocoder, infoWindow, userMarker, userAccuracyCircle, distanceService, autocomplete, routeService, routePolylines = [];
let gMarkers = [];
let userLat = null, userLng = null, userAccuracy = null;
let searchLat = CONFIG.DEFAULT_LAT, searchLng = CONFIG.DEFAULT_LNG;
let stations = [];
let activeStationId = null;
let detailListScrollTop = 0;
let sortAsc = true;
let isSatellite = false;

// ===== Google Maps Callback (traditional pattern) =====
async function initMap() {
    map = new google.maps.Map(document.getElementById("map"), {
        center: { lat: CONFIG.DEFAULT_LAT, lng: CONFIG.DEFAULT_LNG },
        zoom: CONFIG.DEFAULT_ZOOM,
        styles: DARK_MAP_STYLE,
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
    });

    geocoder = new google.maps.Geocoder();
    infoWindow = new google.maps.InfoWindow();
    distanceService = new google.maps.DistanceMatrixService();
    // Routes Library (current Google Maps routing API).
    // DirectionsService/DirectionsRenderer are legacy/deprecated as of Feb 25, 2026.
    try {
        const { Route } = await google.maps.importLibrary('routes');
        routeService = Route;
    } catch (err) {
        console.warn('Google Routes library could not be loaded:', err);
        routeService = null;
    }

    // ===== Add Custom Controls =====
    createMyLocationControl(map);
    createSatelliteToggleControl(map);
    // Search/location filters live on Step 2, so the results page stays focused on map + chargers.

    // ===== Start app after map is ready =====
    google.maps.event.addListenerOnce(map, 'idle', startApp);
}

// ===== Custom Control: My Location =====
function createMyLocationControl(map) {
    const btn = document.createElement("button");
    btn.className = "map-control-btn";
    btn.innerHTML = '<span class="ctrl-icon">📍</span> My Location';
    btn.title = "Center map on your current location";
    btn.type = "button";

    btn.addEventListener("click", async () => {
        btn.innerHTML = '<span class="ctrl-icon">⏳</span> Locating...';
        try {
            const loc = await getUserLocation();
            setUserMarker(loc.lat, loc.lng);
            map.panTo({ lat: loc.lat, lng: loc.lng });
            map.setZoom(13);
            document.getElementById('mapChipText').textContent = 'Your location';
            btn.innerHTML = '<span class="ctrl-icon">📍</span> My Location';

            const radius = document.getElementById('radiusFilter').value;
            const connectorType = document.getElementById('connectorFilter').value;
            await fetchStations(loc.lat, loc.lng, radius, connectorType);
        } catch (err) {
            btn.innerHTML = '<span class="ctrl-icon">📍</span> My Location';
            showToast('Unable to get your location. Please enable location services.', 'error');
        }
    });

    const controlDiv = document.createElement("div");
    controlDiv.style.margin = "10px";
    controlDiv.appendChild(btn);
    map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(controlDiv);
}

// ===== Custom Control: Satellite Toggle =====
function createSatelliteToggleControl(map) {
    const btn = document.createElement("button");
    btn.className = "map-control-btn";
    btn.innerHTML = '<span class="ctrl-icon">🛰️</span> Satellite';
    btn.title = "Toggle satellite / map view";
    btn.type = "button";

    btn.addEventListener("click", () => {
        isSatellite = !isSatellite;
        if (isSatellite) {
            map.setMapTypeId(google.maps.MapTypeId.HYBRID);
            btn.innerHTML = '<span class="ctrl-icon">🗺️</span> Map View';
            btn.classList.add('active');
        } else {
            map.setMapTypeId(google.maps.MapTypeId.ROADMAP);
            // Re-apply dark style when switching back to roadmap
            map.setOptions({ styles: DARK_MAP_STYLE });
            btn.innerHTML = '<span class="ctrl-icon">🛰️</span> Satellite';
            btn.classList.remove('active');
        }
    });

    const controlDiv = document.createElement("div");
    controlDiv.style.margin = "10px";
    controlDiv.appendChild(btn);
    map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(controlDiv);
}

// ===== Custom Control: Search This Area =====
function createSearchThisAreaControl(map) {
    const btn = document.createElement("button");
    btn.className = "map-control-btn search-area-btn";
    btn.innerHTML = '<span class="ctrl-icon">🔍</span> Search This Area';
    btn.title = "Search for EV stations in the current map view";
    btn.type = "button";

    btn.addEventListener("click", async () => {
        const center = map.getCenter();
        const lat = center.lat();
        const lng = center.lng();

        // Calculate radius from map bounds
        const bounds = map.getBounds();
        if (bounds) {
            const ne = bounds.getNorthEast();
            const sw = bounds.getSouthWest();
            const radius = Math.round(haversine(lat, lng, ne.lat(), ne.lng()));
            // Cap radius at 100km
            const searchRadius = Math.min(Math.max(radius, 5), 100);

            document.getElementById('mapChipText').textContent = `Searching this area...`;

            const connectorType = document.getElementById('connectorFilter').value;
            await fetchStations(lat, lng, searchRadius, connectorType);

            document.getElementById('mapChipText').textContent = `Area search (${searchRadius} km)`;
        }
    });

    const controlDiv = document.createElement("div");
    controlDiv.style.margin = "10px";
    controlDiv.appendChild(btn);
    map.controls[google.maps.ControlPosition.TOP_CENTER].push(controlDiv);
}

// Expose initMap globally for the callback
window.initMap = initMap;

// ===== Geolocation =====
// Get the best available GPS position. We intentionally use the browser's
// high-accuracy sensor mode and wait for a good fix instead of immediately
// accepting a stale/network location. On phones this usually gives a much
// better result once GPS has had a few seconds to lock.
function getUserLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('Geolocation not supported'));
            return;
        }

        let settled = false;
        let watchId = null;
        let best = null;
        const startedAt = Date.now();
        const MAX_WAIT = 5000;
        const TARGET_ACCURACY = 1000;

        const finish = (pos) => {
            if (settled || !pos) return;
            settled = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);

            userLat = Number(pos.coords.latitude);
            userLng = Number(pos.coords.longitude);
            userAccuracy = Number(pos.coords.accuracy) || null;
            resolve({ lat: userLat, lng: userLng, accuracy: userAccuracy });
        };

        const onPosition = (pos) => {
            const accuracy = Number(pos.coords.accuracy);
            // Keep the most accurate fix received during the GPS warm-up.
            if (!best || (Number.isFinite(accuracy) && accuracy < best.coords.accuracy)) {
                best = pos;
            }

            if (Number.isFinite(accuracy) && accuracy <= TARGET_ACCURACY) {
                finish(pos);
            } else if (Date.now() - startedAt >= MAX_WAIT) {
                finish(best || pos);
            }
        };

        const onError = (err) => {
            // If the browser reports a timeout but we already have a usable
            // position, use the best fix rather than throwing it away.
            if (best && (Date.now() - startedAt >= MAX_WAIT || err.code === 3)) {
                finish(best);
                return;
            }
            if (!settled) {
                settled = true;
                if (watchId !== null) navigator.geolocation.clearWatch(watchId);
                reject(err);
            }
        };

        try {
            watchId = navigator.geolocation.watchPosition(onPosition, onError, {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 30000
            });

            // Safety timeout: use the best fix collected so far.
            setTimeout(() => {
                if (!settled) {
                    if (best) finish(best);
                    else {
                        settled = true;
                        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
                        reject(new Error('Location timeout'));
                    }
                }
            }, MAX_WAIT + 1000);
        } catch (err) {
            reject(err);
        }
    });
}

function setUserMarker(lat, lng, accuracyMeters = userAccuracy) {
    if (!map || !window.google?.maps) return;
    if (userMarker) userMarker.setMap(null);
    if (userAccuracyCircle) userAccuracyCircle.setMap(null);

    userMarker = new google.maps.Marker({
        position: { lat, lng },
        map: map,
        title: 'Your Location',
        zIndex: 1000,
        icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 9,
            fillColor: '#2563eb',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3,
        },
    });

    // Show the actual GPS accuracy instead of a fixed 200 m circle.
    if (Number.isFinite(Number(accuracyMeters)) && Number(accuracyMeters) > 0) {
        userAccuracyCircle = new google.maps.Circle({
            map: map,
            center: { lat, lng },
            radius: Math.min(Math.max(Number(accuracyMeters), 15), 500),
            fillColor: '#2563eb',
            fillOpacity: 0.08,
            strokeColor: '#2563eb',
            strokeOpacity: 0.25,
            strokeWeight: 1,
        });
    }

    userMarker.addListener('click', () => {
        const acc = Number.isFinite(Number(accuracyMeters))
            ? `±${Math.round(Number(accuracyMeters))} m`
            : 'GPS location';
        infoWindow.setContent(`<div class="popup-content"><h3>📍 Your Location</h3><div class="popup-address">Accuracy ${acc}</div></div>`);
        infoWindow.open(map, userMarker);
    });
}

// ===== Fetch Stations =====
async function fetchStations(lat, lng, radius, connectorTypeId) {
    showLoading(true);

    const params = new URLSearchParams({
        output: 'json',
        countrycode: CONFIG.COUNTRY_CODE,
        latitude: lat,
        longitude: lng,
        distance: radius,
        distanceunit: 'KM',
        maxresults: CONFIG.MAX_RESULTS,
        compact: false,
        verbose: false,
        key: CONFIG.OCMAP_KEY,
    });

    if (connectorTypeId) {
        params.append('connectiontypeid', connectorTypeId);
    }

    try {
        const resp = await fetch(`${CONFIG.OCMAP_API}?${params.toString()}`);
        if (!resp.ok) throw new Error(`API error: ${resp.status}`);
        const data = await resp.json();

        stations = data.map(s => parseStation(s, lat, lng)).filter(s => s);

        // Do NOT trust the API connector filter alone. We fetch the nearby
        // stations first and then keep only chargers that actually match
        // the selected vehicle's connector from our vehicle database.
        if (selectedVehicle) {
            rankStationsForVehicle();
        } else {
            stations.sort((a, b) => a.distance - b.distance);
        }

        updateUI();
        if (map && window.google?.maps) updateMapMarkers();
        showToast(`Found ${stations.length} charging stations`, 'success');

        // Fetch driving distances for top 10 nearest stations
        if (userLat && userLng && stations.length > 0) {
            fetchDrivingDistances(stations.slice(0, 10));
        }
    } catch (err) {
        console.error('Fetch error:', err);
        showToast('Failed to fetch stations. Please try again.', 'error');
        stations = [];
        updateUI();
    } finally {
        showLoading(false);
    }
}

// ===== Parse Station =====
function parseStation(raw, refLat, refLng) {
    const addr = raw.AddressInfo;
    if (!addr || !Number.isFinite(Number(addr.Latitude)) || !Number.isFinite(Number(addr.Longitude))) return null;

    const lat = Number(addr.Latitude);
    const lng = Number(addr.Longitude);
    const dist = haversine(refLat, refLng, lat, lng);

    const connections = (raw.Connections || []).map((c, index) => {
        const typeName = c.ConnectionType ? c.ConnectionType.Title : (CONNECTOR_NAMES[c.ConnectionTypeID] || 'Unknown');
        const currentTypeName = c.CurrentType ? c.CurrentType.Title : '';
        const statusName = c.StatusType ? c.StatusType.Title : 'Unknown';
        const levelName = c.Level ? c.Level.Title : '';
        const power = Number(c.PowerKW);
        return {
            id: c.ID || index + 1,
            typeId: c.ConnectionTypeID || 0,
            typeName,
            powerKW: Number.isFinite(power) && power > 0 ? power : null,
            voltage: c.Voltage || null,
            amps: c.Amps || null,
            quantity: Number(c.Quantity) > 0 ? Number(c.Quantity) : 1,
            statusId: c.StatusTypeID,
            statusName,
            statusOperational: c.StatusType ? c.StatusType.IsOperational : null,
            levelId: c.LevelID,
            levelName,
            currentTypeName,
            isFastChargeCapable: c.IsFastChargeCapable,
            comments: c.Comments || ''
        };
    });

    const operatorName = raw.OperatorInfo?.Title || 'Unknown Network';
    const phone = addr.ContactTelephone1 || addr.ContactTelephone2 || raw.OperatorInfo?.PhonePrimaryContact || '';
    return {
        id: raw.ID,
        name: addr.Title || 'Unnamed Station',
        address: [addr.AddressLine1, addr.AddressLine2, addr.Town, addr.StateOrProvince, addr.Postcode].filter(Boolean).join(', '),
        town: addr.Town || '',
        state: addr.StateOrProvince || '',
        postcode: addr.Postcode || '',
        lat, lng,
        distance: Math.round(dist * 100) / 100,
        connections,
        operator: operatorName,
        brand: raw.OperatorInfo?.Title || '',
        phone,
        numPoints: Number(raw.NumberOfPoints) || connections.reduce((n,c)=>n+c.quantity,0) || 1,
    };
}

// ===== Haversine Distance =====
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg) { return deg * (Math.PI / 180); }

// ===== Distance Matrix Service =====
async function fetchDrivingDistances(stationsToCalc) {
    if (!distanceService || !userLat || !userLng) return;

    const origin = new google.maps.LatLng(userLat, userLng);

    // Distance Matrix supports max 25 destinations per request
    const batchSize = 25;
    for (let i = 0; i < stationsToCalc.length; i += batchSize) {
        const batch = stationsToCalc.slice(i, i + batchSize);
        const destinations = batch.map(s => new google.maps.LatLng(s.lat, s.lng));

        try {
            const response = await distanceService.getDistanceMatrix({
                origins: [origin],
                destinations: destinations,
                travelMode: google.maps.TravelMode.DRIVING,
                unitSystem: google.maps.UnitSystem.METRIC,
                avoidHighways: false,
                avoidTolls: false,
            });

            if (response && response.rows && response.rows[0]) {
                const elements = response.rows[0].elements;
                elements.forEach((el, idx) => {
                    const station = batch[idx];
                    if (el.status === 'OK') {
                        station.drivingDistance = el.distance.text;
                        station.drivingDistanceValue = el.distance.value; // meters
                        station.drivingDuration = el.duration.text;
                        station.drivingDurationValue = el.duration.value; // seconds
                    } else {
                        station.drivingDistance = 'N/A';
                        station.drivingDuration = 'N/A';
                    }

                    // Update the card in real-time
                    updateCardDrivingInfo(station);
                });
            }
        } catch (err) {
            console.error('Distance Matrix error:', err);
        }
    }
}

function updateCardDrivingInfo(station) {
    const el = document.getElementById(`driving-info-${station.id}`);
    if (el) {
        if (station.drivingDistance && station.drivingDistance !== 'N/A') {
            el.innerHTML = `
                <span class="driving-badge drive-dist">🚗 ${station.drivingDistance}</span>
                <span class="driving-badge drive-time">⏱️ ${station.drivingDuration}</span>
            `;
        } else {
            el.innerHTML = `<span class="driving-badge drive-dist">🚗 Route N/A</span>`;
        }
    }
}

// ===== Update UI =====
function updateUI() {
    const $resultsCount = document.getElementById('resultsCount');
    const $navStationCount = document.getElementById('navStationCount');
    const $navConnectorCount = document.getElementById('navConnectorCount');
    const $navNetworkCount = document.getElementById('navNetworkCount');
    const $stationList = document.getElementById('stationList');

    // Results count
    $resultsCount.innerHTML = `<strong>${stations.length}</strong> station${stations.length !== 1 ? 's' : ''} found`;

    // Nav stats
    $navStationCount.textContent = stations.length;
    const totalConnectors = stations.reduce((sum, s) => sum + s.connections.length, 0);
    $navConnectorCount.textContent = totalConnectors;
    const networks = new Set(stations.map(s => s.operator));
    $navNetworkCount.textContent = networks.size;

    // Station list
    if (stations.length === 0) {
        $stationList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🔍</div>
                <h3>No Compatible Stations Found</h3>
                <p>No charging station with the selected vehicle's compatible connector was found in this radius. Try a larger radius or another location.</p>
            </div>
        `;
        return;
    }

    $stationList.innerHTML = stations.map(s => createStationCard(s)).join('');

    // Attach click events
    $stationList.querySelectorAll('.station-card').forEach(card => {
        card.addEventListener('click', () => {
            const id = parseInt(card.dataset.id);
            const station = stations.find(s => s.id === id);
            if (station) selectStation(station);
        });
    });

    $stationList.querySelectorAll('.action-btn[data-action="directions"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.closest('.station-card').dataset.id);
            const station = stations.find(s => s.id === id);
            if (station) openDirections(station);
        });
    });

    $stationList.querySelectorAll('.action-btn[data-action="details"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.closest('.station-card').dataset.id);
            const station = stations.find(s => s.id === id);
            if (station) openDetail(station);
        });
    });
}

function createStationCard(station) {
    const connectorTags = station.connections.slice(0, 3).map(c =>
        `<span class="meta-tag connector">🔌 ${c.typeName}</span>`
    ).join('');

    const powerTag = station.connections.find(c => c.powerKW)
        ? `<span class="meta-tag power">⚡ ${Math.max(...station.connections.filter(c => c.powerKW).map(c => c.powerKW))} kW</span>`
        : '';

    // Driving info: show data if available, loading placeholder if user has location
    let drivingInfoHTML = '';
    if (station.drivingDistance) {
        drivingInfoHTML = station.drivingDistance !== 'N/A'
            ? `<span class="driving-badge drive-dist">🚗 ${station.drivingDistance}</span><span class="driving-badge drive-time">⏱️ ${station.drivingDuration}</span>`
            : `<span class="driving-badge drive-dist">🚗 Route N/A</span>`;
    } else if (userLat && userLng) {
        drivingInfoHTML = `<span class="driving-badge loading">🚗 Calculating...</span>`;
    }

    return `
        <div class="station-card" data-id="${station.id}" id="station-${station.id}">
            <div class="station-header">
                <div class="station-name">${escapeHtml(station.name)}</div>
                <div class="station-distance">📏 ${station.distance} km</div>
            </div>
            <div class="station-address">📍 ${escapeHtml(station.address)}</div>
            <div class="station-driving-info" id="driving-info-${station.id}">${drivingInfoHTML}</div>
            <div class="station-meta">
                <span class="meta-tag operator">🏢 ${escapeHtml(station.operator)}</span>
                ${connectorTags}
                ${powerTag}
                <span class="meta-tag" style="background:rgba(34,197,94,.08);color:var(--green);border:1px solid rgba(34,197,94,.16);">🔌 ${station.numPoints} points</span>
                <span class="meta-tag" style="background:rgba(99,102,241,.08);color:var(--accent-secondary);border:1px solid rgba(99,102,241,.16);">${station.statusOperational === true ? '🟢' : station.statusOperational === false ? '🔴' : '⚫'} ${escapeHtml(station.statusName)}</span>
            </div>
            <div class="station-footer">
                <span class="station-coords">${station.lat.toFixed(5)}, ${station.lng.toFixed(5)}</span>
                <div class="station-actions">
                    <button class="action-btn" data-action="details">Details</button>
                    <button class="action-btn" data-action="directions">Directions</button>
                </div>
            </div>
        </div>
    `;
}

// ===== Map Markers =====
function updateMapMarkers() {
    // Clear existing markers
    gMarkers.forEach(m => m.setMap(null));
    gMarkers = [];

    const bounds = new google.maps.LatLngBounds();

    stations.forEach(station => {
        const marker = new google.maps.Marker({
            position: { lat: station.lat, lng: station.lng },
            map: map,
            title: station.name,
            icon: {
                path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
                fillColor: '#ef4444',
                fillOpacity: 1,
                strokeColor: '#fecaca',
                strokeWeight: 2,
                scale: 1.8,
                anchor: new google.maps.Point(12, 22),
            },
        });

        const distText = station.distance !== null ? `<span class="popup-tag dist">📏 ${station.distance} km</span>` : '';

        marker.addListener('click', () => {
            infoWindow.setContent(`
                <div class="popup-content">
                    <h3>${escapeHtml(station.name)}</h3>
                    <div class="popup-address">${escapeHtml(station.address)}</div>
                    <div class="popup-meta">
                        <span class="popup-tag op">🏢 ${escapeHtml(station.operator)}</span>
                        ${distText}
                    </div>
                    <button class="popup-btn" onclick="window.EVApp.openDetail(${station.id})">View Details</button>
                </div>
            `);
            infoWindow.open(map, marker);
            highlightCard(station.id);
        });

        gMarkers.push(marker);
        bounds.extend({ lat: station.lat, lng: station.lng });
    });

    // Fit bounds
    if (stations.length > 0) {
        map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 });
        const listener = google.maps.event.addListener(map, 'idle', () => {
            if (map.getZoom() > 15) map.setZoom(15);
            google.maps.event.removeListener(listener);
        });
    }
}

function highlightCard(id) {
    document.querySelectorAll('.station-card').forEach(c => c.classList.remove('active'));
    const card = document.getElementById(`station-${id}`);
    if (card) {
        card.classList.add('active');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
}

// ===== Select Station =====
function selectStation(station) {
    if (!map) return;
    map.panTo({ lat: station.lat, lng: station.lng });
    map.setZoom(16);
    highlightCard(station.id);
    activeStationId = station.id;
}

async function enrichStationData(station) {
    let changed = false;
    try {
        const place = await fetchGooglePlaceData(station);
        if (place) {
            station.googlePlace = place;
            changed = true;
        }
    } catch (e) {
        console.warn('Google Places enrichment unavailable:', e);
    }
    if (CONFIG.CPO_API_URL) {
        try {
            const cpo = await fetchCPOData(station);
            if (cpo) {
                station.cpo = cpo;
                changed = true;
            }
        } catch (e) {
            console.warn('CPO live data unavailable:', e);
        }
    }
    return changed;
}

function getGoogleBrowserKey() {
    const scripts = Array.from(document.scripts || []);
    for (const script of scripts) {
        if (script.src.includes('maps.googleapis.com/maps/api/js')) {
            try { return new URL(script.src).searchParams.get('key') || ''; } catch (_) {}
        }
    }
    return '';
}

async function fetchGooglePlaceData(station) {
    const key = getGoogleBrowserKey();
    if (!key || !station.name) return null;
    const query = `${station.name}, ${station.address || ''}, India`;
    const body = {
        textQuery: query,
        maxResultCount: 1,
        locationBias: {
            circle: {
                center: { latitude: station.lat, longitude: station.lng },
                radius: 500
            }
        },
        regionCode: 'IN'
    };
    const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': key,
            'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri,places.nationalPhoneNumber,places.internationalPhoneNumber,places.regularOpeningHours,places.currentOpeningHours,places.businessStatus,places.googleMapsLinks,places.photos,places.accessibilityOptions,places.parkingOptions,places.restroom,places.evChargeOptions'
        },
        body: JSON.stringify(body)
    });
    if (!resp.ok) throw new Error(`Places API ${resp.status}`);
    const data = await resp.json();
    const place = data.places && data.places[0];
    if (!place) return null;
    // Reject an obviously unrelated result by distance.
    if (place.location) {
        const d = haversine(station.lat, station.lng, Number(place.location.latitude), Number(place.location.longitude));
        if (Number.isFinite(d) && d > 1.0) return null;
    }
    return {
        id: place.id || '',
        name: place.displayName?.text || '',
        address: place.formattedAddress || '',
        lat: place.location?.latitude,
        lng: place.location?.longitude,
        rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
        reviewCount: Number.isFinite(Number(place.userRatingCount)) ? Number(place.userRatingCount) : 0,
        mapsUrl: place.googleMapsUri || '',
        phone: place.nationalPhoneNumber || place.internationalPhoneNumber || '',
        businessStatus: place.businessStatus || '',
        openingHours: place.currentOpeningHours || place.regularOpeningHours || null,
        accessibility: place.accessibilityOptions || null,
        parking: place.parkingOptions || null,
        restroom: place.restroom === true ? true : (place.restroom === false ? false : null),
        evChargeOptions: place.evChargeOptions || null,
        photoUrl: place.photos?.[0]?.name ? `https://places.googleapis.com/v1/${place.photos[0].name}/media?maxWidthPx=1200&key=${encodeURIComponent(key)}` : ''
    };
}

async function fetchCPOData(station) {
    const url = new URL(CONFIG.CPO_API_URL, window.location.href);
    url.searchParams.set('stationId', station.id);
    if (station.googlePlace?.id) url.searchParams.set('placeId', station.googlePlace.id);
    const resp = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`CPO API ${resp.status}`);
    const data = await resp.json();
    // Generic adapter: only use fields that the real CPO endpoint actually returns.
    const raw = data.station || data.data || data;
    if (!raw || typeof raw !== 'object') return null;
    const out = {};
    if (raw.status || raw.availability?.status) out.status = raw.status || raw.availability.status;
    if (raw.price || raw.tariff || raw.currentPrice) out.price = raw.price || raw.tariff || raw.currentPrice;
    if (raw.fault || raw.faultStatus || raw.error || raw.maintenance) out.fault = raw.fault || raw.faultStatus || raw.error || raw.maintenance;
    if (raw.lastUpdated || raw.timestamp || raw.last_updated) out.lastUpdated = raw.lastUpdated || raw.timestamp || raw.last_updated;
    return Object.keys(out).length ? out : null;
}

function bindDetailActions(station) {
    const body = document.getElementById('detailBody');
    if (!body) return;
    const dirBtn = body.querySelector('.detail-directions-btn');
    if (dirBtn) dirBtn.addEventListener('click', () => openDirections(station));
    const notifyBtn = body.querySelector('[data-notify-station]');
    if (notifyBtn) notifyBtn.addEventListener('click', () => {
        localStorage.setItem(`ev-alert-${station.id}`, '1');
        notifyBtn.textContent = '🔔 Availability alert saved';
        showToast('Alert saved. A live CPO/OCPI feed is required to trigger availability notifications.', 'info');
    });
}

// ===== Detail Panel =====
function openDetail(stationOrId) {
    let station = stationOrId;
    if (typeof stationOrId === 'number') {
        station = stations.find(s => s.id === stationOrId);
    }
    if (!station) return;

    const $detailPanel = document.getElementById('detailPanel');
    const $detailTitle = document.getElementById('detailTitle');
    const $detailBody = document.getElementById('detailBody');
    const $stationList = document.getElementById('stationList');
    const $app = document.querySelector('.app-container');

    // Remember where the user was in the charger list so Back returns to the same spot.
    if (!$detailPanel.classList.contains('open') && $stationList) {
        detailListScrollTop = $stationList.scrollTop;
    }

    $detailTitle.textContent = station.name;
    $detailBody.innerHTML = buildDetailHTML(station);
    $detailPanel.classList.add('open');
    if ($app) $app.classList.add('detail-view');
    if (!history.state?.evDetail) {
        history.pushState({ evFlowPage: 'resultsPage', evDetail: true }, '', window.location.href);
    }

    // Enrich only when the user opens a station, avoiding a Places API call for every marker.
    enrichStationData(station).then((changed) => {
        if (changed && activeStationId === station.id) {
            $detailBody.innerHTML = buildDetailHTML(station);
            bindDetailActions(station);
        }
    });

    fetchNearbyPlaces(station).then((places) => {
        if (activeStationId !== station.id || !places.length) return;
        const existing = $detailBody.querySelector('.nearby-placeholder');
        if (existing) existing.outerHTML = renderNearbyPlaces(places);
        else $detailBody.insertAdjacentHTML('beforeend', renderNearbyPlaces(places));
    });

    const dirBtn = $detailBody.querySelector('.detail-directions-btn');
    if (dirBtn) {
        dirBtn.addEventListener('click', () => openDirections(station));
    }
    const notifyBtn = $detailBody.querySelector('[data-notify-station]');
    if (notifyBtn) {
        notifyBtn.addEventListener('click', () => {
            localStorage.setItem(`ev-alert-${station.id}`, '1');
            notifyBtn.textContent = '🔔 Availability alert saved';
            showToast('Alert saved. A live network feed is required to send the actual availability notification.', 'info');
        });
    }

    selectStation(station);
}

function closeDetail(goBack = true) {
    const panel = document.getElementById('detailPanel');
    const stationList = document.getElementById('stationList');
    const app = document.querySelector('.app-container');
    panel.classList.remove('open');
    if (app) app.classList.remove('detail-view');
    activeStationId = null;
    document.querySelectorAll('.station-card').forEach(c => c.classList.remove('active'));
    if (goBack && history.state?.evDetail) {
        history.back();
        return;
    }
    if (stationList) {
        requestAnimationFrame(() => {
            stationList.scrollTop = detailListScrollTop;
        });
    }
}

function formatValue(value, fallback = 'Not provided') {
    return value !== null && value !== undefined && String(value).trim() ? escapeHtml(String(value)) : `<span class="muted">${escapeHtml(fallback)}</span>`;
}

function truthyKeys(obj, labels) {
    if (!obj || typeof obj !== 'object') return [];
    return Object.entries(labels)
        .filter(([key]) => obj[key] === true)
        .map(([, label]) => label);
}

function formatGoogleOpeningHours(hours) {
    if (!hours) return { openNow: '', rows: [] };
    const raw = Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions.filter(Boolean) : [];
    const rows = raw.map(line => {
        const parts = String(line).split(':');
        const day = parts.shift()?.trim() || '';
        const time = parts.join(':').trim();
        return { day, time };
    }).filter(x => x.day && x.time);
    const openNow = typeof hours.openNow === 'boolean' ? (hours.openNow ? 'Open now' : 'Closed now') : '';
    return { openNow, rows };
}

async function fetchNearbyPlaces(station) {
    const key = getGoogleBrowserKey();
    if (!key) return [];
    const types = ['restaurant', 'hotel', 'public_bathroom', 'cafe', 'convenience_store'];
    const all = [];
    for (const type of types) {
        try {
            const resp = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': key,
                    'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.googleMapsUri'
                },
                body: JSON.stringify({
                    includedTypes: [type],
                    maxResultCount: 5,
                    rankPreference: 'DISTANCE',
                    locationRestriction: {
                        circle: { center: { latitude: station.lat, longitude: station.lng }, radius: 1000 }
                    }
                })
            });
            if (!resp.ok) continue;
            const data = await resp.json();
            for (const place of (data.places || [])) {
                if (!place.location) continue;
                const distance = haversine(station.lat, station.lng, Number(place.location.latitude), Number(place.location.longitude));
                all.push({
                    type,
                    id: place.id || '',
                    name: place.displayName?.text || '',
                    address: place.formattedAddress || '',
                    lat: Number(place.location.latitude),
                    lng: Number(place.location.longitude),
                    distance,
                    rating: Number.isFinite(Number(place.rating)) ? Number(place.rating) : null,
                    reviews: Number.isFinite(Number(place.userRatingCount)) ? Number(place.userRatingCount) : 0,
                    mapsUrl: place.googleMapsUri || ''
                });
            }
        } catch (e) {
            console.warn('Nearby Places unavailable:', type, e);
        }
    }
    const seen = new Set();
    return all.filter(x => {
        const key2 = x.id || `${x.type}|${x.name}|${x.lat.toFixed(5)}|${x.lng.toFixed(5)}`;
        if (seen.has(key2)) return false;
        seen.add(key2);
        return true;
    }).sort((a,b) => a.distance - b.distance);
}

function nearbyTypeLabel(type) {
    return type === 'restaurant' ? '🍽️ Restaurants' : type === 'hotel' ? '🏨 Hotels' : type === 'public_bathroom' ? '🚻 Restrooms' : type === 'cafe' ? '☕ Cafes' : '🛒 Convenience stores';
}

function renderNearbyPlaces(places) {
    if (!places || !places.length) return '';
    const groups = ['restaurant', 'hotel', 'public_bathroom', 'cafe', 'convenience_store'].map(type => {
        const items = places.filter(p => p.type === type).slice(0, 5);
        if (!items.length) return '';
        return `<div class="nearby-group"><div class="nearby-group-title">${nearbyTypeLabel(type)}</div>${items.map(p => `
            <div class="nearby-card">
                <div class="nearby-main">
                    <div class="nearby-name">${escapeHtml(p.name || 'Unnamed place')}</div>
                    <div class="nearby-meta">${p.distance.toFixed(2)} km${p.rating ? ` · ⭐ ${p.rating}${p.reviews ? ` (${p.reviews.toLocaleString('en-IN')})` : ''}` : ''}</div>
                    ${p.address ? `<div class="nearby-address">${escapeHtml(p.address)}</div>` : ''}
                </div>
                ${p.mapsUrl ? `<a class="nearby-map-link" href="${escapeHtml(p.mapsUrl)}" target="_blank" rel="noopener">Map ↗</a>` : ''}
            </div>`).join('')}</div>`;
    }).join('');
    return groups ? `<div class="detail-section"><div class="detail-section-title">📍 Nearby places <span class="section-subtitle">within 1 km</span></div>${groups}</div>` : '';
}

function formatEvChargeOptions(options) {
    if (!options || !Array.isArray(options.connectorAggregations)) return [];
    return options.connectorAggregations.map((x) => {
        const type = x.type || x.connectorType || '';
        const count = Number(x.count);
        const power = Number(x.maxChargeRateKw);
        const parts = [
            type,
            Number.isFinite(count) && count > 0 ? `${count} point${count === 1 ? '' : 's'}` : '',
            Number.isFinite(power) && power > 0 ? `up to ${power} kW` : ''
        ].filter(Boolean);
        return parts.join(' · ');
    }).filter(Boolean);
}

function buildDetailHTML(s) {
    const totalGuns = s.connections.reduce((n, c) => n + (Number(c.quantity) || 1), 0);
    const powers = s.connections.map(c => c.powerKW).filter(v => Number.isFinite(v));
    const maxPower = powers.length ? Math.max(...powers) : null;
    const connectorTypes = [...new Set(s.connections.map(c => c.typeName).filter(Boolean))];
    const chargingTypes = [...new Set(s.connections.map(c => c.currentTypeName).filter(Boolean))];
    const google = s.googlePlace || null;
    const cpo = s.cpo || null;

    const googleName = google?.name || '';
    const googlePhoto = google?.photoUrl || '';
    const googleAddress = google?.address || '';
    const googleRating = Number.isFinite(google?.rating) ? `⭐ ${google.rating} / 5` : '';
    const googleReviews = google?.reviewCount ? `${google.reviewCount.toLocaleString('en-IN')} reviews` : '';
    const googleHours = formatGoogleOpeningHours(google?.openingHours);
    const googleHoursHTML = googleHours.rows.length ? `<div class="opening-hours">${googleHours.rows.map(r => `<div class="opening-row"><span>${escapeHtml(r.day)}</span><b>${escapeHtml(r.time)}</b></div>`).join('')}</div>` : '';
    const googleOpenNow = googleHours.openNow;
    const googleParking = truthyKeys(google?.parking, {
        freeParkingLot: 'Free parking lot', paidParkingLot: 'Paid parking lot',
        freeStreetParking: 'Free street parking', paidStreetParking: 'Paid street parking',
        valetParking: 'Valet parking', freeGarageParking: 'Free garage parking',
        paidGarageParking: 'Paid garage parking'
    });
    const googleAccessibility = truthyKeys(google?.accessibility, {
        wheelchairAccessibleEntrance: '♿ Accessible entrance',
        wheelchairAccessibleParking: '♿ Accessible parking',
        wheelchairAccessibleRestroom: '♿ Accessible restroom',
        wheelchairAccessibleSeating: '♿ Accessible seating'
    });
    const googleEvOptions = formatEvChargeOptions(google?.evChargeOptions);
    const googleBusinessStatus = google?.businessStatus ? String(google.businessStatus).replaceAll('_', ' ') : '';
    const operator = s.operator && !/^unknown network$/i.test(s.operator) ? s.operator : '';

    const connectorsHTML = s.connections.length ? s.connections.map((c, i) => {
        const power = c.powerKW ? `${c.powerKW} kW` : '';
        const acdc = c.currentTypeName || '';
        const status = c.statusName && !/^unknown$/i.test(c.statusName) ? c.statusName : '';
        const statusDot = c.statusOperational === true ? '🟢' : (c.statusOperational === false ? '🔴' : '⚫');
        const bits = [status && `${statusDot} ${status}`, acdc].filter(Boolean).join(' · ');
        const mini = [
            power && `<div class="connector-mini"><b>Power</b><br>${escapeHtml(power)}</div>`,
            c.quantity && `<div class="connector-mini"><b>Guns</b><br>${c.quantity}</div>`,
            c.voltage && `<div class="connector-mini"><b>Voltage</b><br>${escapeHtml(String(c.voltage))} V</div>`,
            c.amps && `<div class="connector-mini"><b>Current</b><br>${escapeHtml(String(c.amps))} A</div>`,
            c.levelName && `<div class="connector-mini"><b>Level</b><br>${escapeHtml(c.levelName)}</div>`
        ].filter(Boolean).join('');
        return `
            <div class="connector-card rich">
                <div class="connector-icon">🔌</div>
                <div class="connector-info">
                    <div class="connector-type">Charger / Connector ${i + 1}: ${escapeHtml(c.typeName || 'Unknown')}</div>
                    ${bits ? `<div class="connector-detail">${escapeHtml(bits)}</div>` : ''}
                    ${mini ? `<div class="connector-grid">${mini}</div>` : ''}
                </div>
                <div class="connector-power">${power ? escapeHtml(power) : '—'}</div>
            </div>`;
    }).join('') : '<p style="color:var(--text-muted);font-size:.85rem;">No connector details available.</p>';

    const cpoSection = cpo ? `
        <div class="detail-section">
            <div class="detail-section-title">⚡ Live CPO data</div>
            <div class="feature-grid">
                ${cpo.status ? `<div class="feature-item"><span class="feature-label">Live status</span><span class="feature-value">${escapeHtml(String(cpo.status))}</span></div>` : ''}
                ${cpo.price ? `<div class="feature-item"><span class="feature-label">Current charging price</span><span class="feature-value">${escapeHtml(String(cpo.price))}</span></div>` : ''}
                ${cpo.fault ? `<div class="feature-item"><span class="feature-label">Charger fault / maintenance</span><span class="feature-value">${escapeHtml(String(cpo.fault))}</span></div>` : ''}
                ${cpo.lastUpdated ? `<div class="feature-item"><span class="feature-label">Live data updated</span><span class="feature-value">${escapeHtml(String(cpo.lastUpdated))}</span></div>` : ''}
            </div>
        </div>` : '';

    return `
        ${googlePhoto ? `<div class="detail-photo-wrap"><img class="detail-photo" src="${escapeHtml(googlePhoto)}" alt="${escapeHtml(googleName || s.name)}" loading="lazy"></div>` : ''}

        <div class="detail-section">
            <div class="detail-section-title">📍 Station</div>
            <div class="detail-info-grid">
                <div class="detail-info-item full"><div class="detail-info-label">Station name</div><div class="detail-info-value">${escapeHtml(googleName || s.name)}</div></div>
                <div class="detail-info-item full"><div class="detail-info-label">Address</div><div class="detail-info-value">${escapeHtml(googleAddress || s.address || 'Not provided')}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Location</div><div class="detail-info-value" style="font-family:monospace;font-size:.76rem;">${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}</div></div>
                <div class="detail-info-item"><div class="detail-info-label">Distance</div><div class="detail-info-value" style="color:var(--cyan);">📏 ${s.distance} km</div></div>
            </div>
        </div>

        ${operator || googleRating || googleReviews || google?.phone || googleHours || googleBusinessStatus || google?.parking || google?.accessibility || google?.restroom !== null || googleEvOptions.length || google?.mapsUrl ? `<div class="detail-section"><div class="detail-section-title">🏢 Google Places</div><div class="detail-info-grid">
            ${operator ? `<div class="detail-info-item"><div class="detail-info-label">Operator / Brand</div><div class="detail-info-value">${escapeHtml(operator)}</div></div>` : ''}
            ${googleRating ? `<div class="detail-info-item"><div class="detail-info-label">Rating</div><div class="detail-info-value">${googleRating}</div></div>` : ''}
            ${googleReviews ? `<div class="detail-info-item"><div class="detail-info-label">Reviews</div><div class="detail-info-value">${escapeHtml(googleReviews)}</div></div>` : ''}
            ${google?.phone ? `<div class="detail-info-item"><div class="detail-info-label">Phone</div><div class="detail-info-value"><a href="tel:${escapeHtml(google.phone)}" style="color:var(--accent-secondary);">${escapeHtml(google.phone)}</a></div></div>` : ''}
            ${googleBusinessStatus ? `<div class="detail-info-item"><div class="detail-info-label">Business status</div><div class="detail-info-value">${escapeHtml(googleBusinessStatus)}</div></div>` : ''}
            ${googleHoursHTML ? `<div class="detail-info-item full"><div class="detail-info-label">Opening hours ${googleOpenNow ? `<span class="hours-now ${googleHours.openNow === 'Open now' ? 'open' : 'closed'}">${escapeHtml(googleOpenNow)}</span>` : ''}</div><div class="detail-info-value">${googleHoursHTML}</div></div>` : ''}

            ${googleParking.length ? `<div class="detail-info-item full"><div class="detail-info-label">Parking</div><div class="detail-info-value">${escapeHtml(googleParking.join(', '))}</div></div>` : ''}
            ${googleAccessibility.length ? `<div class="detail-info-item full"><div class="detail-info-label">Accessibility</div><div class="detail-info-value">${escapeHtml(googleAccessibility.join(', '))}</div></div>` : ''}
            ${google?.restroom !== null && google?.restroom !== undefined ? `<div class="detail-info-item"><div class="detail-info-label">Restroom</div><div class="detail-info-value">${google.restroom ? 'Available' : 'Not available'}</div></div>` : ''}
            ${googleEvOptions.length ? `<div class="detail-info-item full"><div class="detail-info-label">Google EV charging options</div><div class="detail-info-value">${escapeHtml(googleEvOptions.join(' | '))}</div></div>` : ''}
            ${google?.mapsUrl ? `<div class="detail-info-item full"><a href="${escapeHtml(google.mapsUrl)}" target="_blank" rel="noopener" style="color:var(--accent-secondary);">Open this place in Google Maps ↗</a></div>` : ''}
        </div></div>` : ''}

        <div class="detail-section">
            <div class="detail-section-title">⚡ Charger summary</div>
            <div class="feature-grid">
                ${s.numPoints ? `<div class="feature-item"><span class="feature-label">Total charging points</span><span class="feature-value">${s.numPoints}</span></div>` : ''}
                ${totalGuns ? `<div class="feature-item"><span class="feature-label">Total charging guns</span><span class="feature-value">${totalGuns}</span></div>` : ''}
                ${connectorTypes.length ? `<div class="feature-item"><span class="feature-label">Connector types</span><span class="feature-value">${escapeHtml(connectorTypes.join(', '))}</span></div>` : ''}
                ${chargingTypes.length ? `<div class="feature-item"><span class="feature-label">AC / DC</span><span class="feature-value">${escapeHtml(chargingTypes.join(', '))}</span></div>` : ''}
                ${maxPower ? `<div class="feature-item"><span class="feature-label">Maximum speed</span><span class="feature-value">${maxPower} kW</span></div>` : ''}
            </div>
        </div>

        <div class="detail-section">
            <div class="detail-section-title">🔋 Individual chargers / connectors (${s.connections.length})</div>
            ${connectorsHTML}
        </div>

        ${cpoSection}

        <div class="nearby-placeholder"></div>

        <div class="detail-section">
            <div class="detail-section-title">📝 Data availability</div>
            <div class="data-source-note">Only data actually returned by Open Charge Map, Google Places (New), or a configured CPO/OCPI endpoint is shown. Missing fields are intentionally hidden — no guessed “Not found” values.</div>
        </div>

        <div class="detail-section">
            <button class="detail-directions-btn">🧭 Get Directions</button>
        </div>
    `;
}

// ===== Directions inside this page's Google Map =====
async function openDirections(station) {
    if (!station || !map) return;

    const originLat = Number.isFinite(Number(userLat)) ? Number(userLat) : Number(searchLat);
    const originLng = Number.isFinite(Number(userLng)) ? Number(userLng) : Number(searchLng);
    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
        showToast('Starting location is not available. Please change your location.', 'error');
        return;
    }

    const destinationLat = Number(station.lat);
    const destinationLng = Number(station.lng);
    if (!Number.isFinite(destinationLat) || !Number.isFinite(destinationLng)) {
        showToast('This charging station has an invalid map location.', 'error');
        return;
    }

    if (!routeService) {
        showToast('Google Routes is not available. Enable Routes API in Google Cloud and try again.', 'error');
        return;
    }

    const detailPanel = document.getElementById('detailPanel');
    if (detailPanel && detailPanel.classList.contains('open')) closeDetail();

    document.getElementById('resultsPage')?.classList.remove('hidden');
    document.getElementById('vehiclePage')?.classList.add('hidden');
    document.getElementById('locationPage')?.classList.add('hidden');

    // Remove the previous in-page route before drawing a new one.
    routePolylines.forEach(polyline => polyline.setMap(null));
    routePolylines = [];

    const origin = { lat: originLat, lng: originLng };
    const destination = { lat: destinationLat, lng: destinationLng };

    try {
        const response = await routeService.computeRoutes({
            origin,
            destination,
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis', 'viewport']
        });

        const routes = response?.routes || [];
        if (!routes.length) {
            showToast('No driving route was found for this station.', 'error');
            return;
        }

        const route = routes[0];
        routePolylines = route.createPolylines({
            polylineOptions: {
                strokeOpacity: 0.9,
                strokeWeight: 5
            }
        });
        routePolylines.forEach(polyline => polyline.setMap(map));

        if (route.viewport) {
            map.fitBounds(route.viewport);
        } else if (route.path?.length) {
            const bounds = new google.maps.LatLngBounds();
            route.path.forEach(point => bounds.extend(point));
            map.fitBounds(bounds);
        }

        const distanceKm = Number(route.distanceMeters) / 1000;
        const durationMin = Number(route.durationMillis) / 60000;
        const distanceText = Number.isFinite(distanceKm)
            ? `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`
            : '';
        const durationText = Number.isFinite(durationMin)
            ? (durationMin < 60 ? `${Math.round(durationMin)} min` : `${Math.floor(durationMin / 60)} hr ${Math.round(durationMin % 60)} min`)
            : '';

        showToast(`Route to ${station.name}${distanceText ? ` • ${distanceText}` : ''}${durationText ? ` • ${durationText}` : ''}`, 'info');

        const mapArea = document.querySelector('.results-page .map-area');
        if (window.innerWidth <= 900 && mapArea) {
            mapArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    } catch (err) {
        console.warn('Google Routes request failed:', err);
        const code = err?.code || err?.status || '';
        const message = String(err?.message || '').toLowerCase();
        if (code === 'PERMISSION_DENIED' || code === 'REQUEST_DENIED' || message.includes('denied') || message.includes('permission')) {
            showToast('Route request denied. Enable Routes API + billing for this Google Maps project.', 'error');
        } else {
            showToast('Route could not be calculated. Try another station or change the location.', 'error');
        }
    }
}

// ===== Search by city/area =====
// Uses OpenStreetMap Nominatim first so search does not depend on
// Google's legacy Places/Geocoding APIs being enabled.
async function searchWithNominatim(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=1&q=${encodeURIComponent(query + ', India')}`;
    const resp = await fetch(url, {
        headers: { 'Accept-Language': 'en-IN,en;q=0.8' }
    });
    if (!resp.ok) throw new Error(`Search service error: ${resp.status}`);
    const data = await resp.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    return {
        lat: Number(data[0].lat),
        lng: Number(data[0].lon),
        displayName: data[0].display_name || query
    };
}

async function searchByText(query) {
    query = query.trim();
    if (!query) {
        showToast('Please enter a city or area name.', 'error');
        return;
    }

    showLoading(true);
    try {
        // 1) Reliable no-key search
        let result = null;
        try {
            result = await searchWithNominatim(query);
        } catch (searchErr) {
            console.warn('Nominatim search failed:', searchErr);
        }

        // 2) Google Geocoder fallback if available
        if (!result && geocoder) {
            result = await new Promise((resolve) => {
                geocoder.geocode({
                    address: query + ', India',
                    componentRestrictions: { country: 'IN' }
                }, (results, status) => {
                    if (status === 'OK' && results && results.length) {
                        const location = results[0].geometry.location;
                        resolve({
                            lat: location.lat(),
                            lng: location.lng(),
                            displayName: results[0].formatted_address || query
                        });
                    } else {
                        resolve(null);
                    }
                });
            });
        }

        if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lng)) {
            showToast('Location not found. Try a city or area name.', 'error');
            return;
        }

        const searchLat = result.lat;
        const searchLng = result.lng;
        const radius = document.getElementById('radiusFilter').value;
        const connectorType = document.getElementById('connectorFilter').value;

        window.__evSearchCenter = { lat: searchLat, lng: searchLng };
        map.panTo({ lat: searchLat, lng: searchLng });
        map.setZoom(12);
        document.getElementById('mapChipText').textContent = `Searching near ${query}`;

        await fetchStations(searchLat, searchLng, radius, connectorType);
        showToast(`Showing chargers near ${query}`, 'success');
    } catch (err) {
        console.error('Search error:', err);
        showToast('Search failed. Please try again.', 'error');
    } finally {
        showLoading(false);
    }
}

// ===== Sort =====
function toggleSort() {
    sortAsc = !sortAsc;
    stations.sort((a, b) => sortAsc ? a.distance - b.distance : b.distance - a.distance);
    document.getElementById('sortBtn').textContent = sortAsc ? '⇅ Distance ↑' : '⇅ Distance ↓';
    updateUI();
}

// ===== Helpers =====
function showLoading(show) {
    const el = document.getElementById('loadingOverlay');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
}

function showToast(message, type = 'info') {
    const $toast = document.getElementById('toast');
    $toast.textContent = message;
    $toast.className = `toast ${type} show`;
    setTimeout(() => $toast.classList.remove('show'), 3500);
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// ===== Vehicle database (from India EV Connector Database — 2026 Snapshot) =====
const VEHICLE_DATABASE = {
    car: [
        ['Tata','Tiago EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Tigor EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Punch EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Nexon EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Curvv EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Harrier EV','Type 2 (AC) + CCS2 (DC)'],['Tata','Sierra EV','Type 2 (AC) + CCS2 (DC)'],
        ['MG','Comet EV','Type 2 (AC)'],['MG','Windsor EV','Type 2 (AC) + CCS2 (DC)'],['MG','ZS EV','Type 2 (AC) + CCS2 (DC)'],['MG','ZEV11','Type 2 (AC) + CCS2 (DC)'],['MG','Cyberster','Type 2 (AC) + CCS2 (DC)'],
        ['Mahindra','XUV400 EV','Type 2 (AC) + CCS2 (DC)'],['Mahindra','BE 6','Type 2 (AC) + CCS2 (DC)'],['Mahindra','XEV 9e','Type 2 (AC) + CCS2 (DC)'],['Mahindra','XUV 3XO EV','Type 2 (AC) + CCS2 (DC)'],['Mahindra','XEV 9S','Type 2 (AC) + CCS2 (DC)'],
        ['Hyundai','Creta Electric','Type 2 (AC) + CCS2 (DC)'],['Hyundai','Ioniq 5','Type 2 (AC) + CCS2 (DC)'],['Hyundai','Kona Electric','Type 2 (AC) + CCS2 (DC)'],
        ['Kia','EV6','Type 2 (AC) + CCS2 (DC)'],['Kia','EV9','Type 2 (AC) + CCS2 (DC)'],['Kia','Carens Clavis EV','Type 2 (AC) + CCS2 (DC)'],['Kia','Syros EV','Type 2 (AC) + CCS2 (DC)'],
        ['BYD','Atto 3','Type 2 (AC) + CCS2 (DC)'],['BYD','Seal','Type 2 (AC) + CCS2 (DC)'],['BYD','e6','Type 2 (AC) + CCS2 (DC)'],['BYD','Sealion 7','Type 2 (AC) + CCS2 (DC)'],['BYD','Sealion 5','Type 2 (AC) + CCS2 (DC)'],['BYD','Dolphin','Type 2 (AC) + CCS2 (DC)'],['BYD','M9','Type 2 (AC) + CCS2 (DC)'],
        ['Maruti Suzuki','e Vitara','Type 2 (AC) + CCS2 (DC)'],['Toyota','Urban Cruiser EV','Type 2 (AC) + CCS2 (DC)'],['Citroen','eC3','Type 2 (AC) + CCS2 (DC)'],['Citroen','eC3X','Type 2 (AC) + CCS2 (DC)'],
        ['VinFast','VF6','Type 2 (AC) + CCS2 (DC)'],['VinFast','VF7','Type 2 (AC) + CCS2 (DC)'],['VinFast','VF8','Type 2 (AC) + CCS2 (DC)'],['VinFast','VF9','Type 2 (AC) + CCS2 (DC)'],
        ['BMW','iX1','Type 2 (AC) + CCS2 (DC)'],['BMW','i4','Type 2 (AC) + CCS2 (DC)'],['BMW','i5','Type 2 (AC) + CCS2 (DC)'],['BMW','i7','Type 2 (AC) + CCS2 (DC)'],['BMW','iX','Type 2 (AC) + CCS2 (DC)'],
        ['Mercedes-Benz','EQA','Type 2 (AC) + CCS2 (DC)'],['Mercedes-Benz','EQB','Type 2 (AC) + CCS2 (DC)'],['Mercedes-Benz','EQE SUV','Type 2 (AC) + CCS2 (DC)'],['Mercedes-Benz','EQS','Type 2 (AC) + CCS2 (DC)'],
        ['Volvo','EX30','Type 2 (AC) + CCS2 (DC)'],['Volvo','XC40 Recharge','Type 2 (AC) + CCS2 (DC)']
    ],
    bike: [
        ['Ola Electric','S1 Pro','Type 6 (LECCS)'],['Ola Electric','S1','Type 6 (LECCS)'],['Ola Electric','S1 X','Type 6 (LECCS)'],['Ola Electric','Roadster X','Type 6 (LECCS)'],
        ['Ather','450X','Type 7 / Ather LECCS'],['Ather','450S','Type 7 / Ather LECCS'],['Ather','Rizta','Type 7 / Ather LECCS'],
        ['Hero','Vida V1 Pro','Type 7 / Vida LECCS'],['Hero','Vida V2','Type 7 / Vida LECCS'],['Hero','Vida VX2','Type 7 / Vida LECCS'],
        ['TVS','iQube','Proprietary / TVS connector'],['TVS','X','Proprietary / TVS connector'],
        ['Bajaj','Chetak','Proprietary / Chetak connector'],['Bajaj','Chetak C25','Proprietary / Chetak connector'],['Bajaj','Chetak 3501','Proprietary / Chetak connector'],
        ['Revolt','RV1','Proprietary / Revolt connector'],['Revolt','RV1+','Proprietary / Revolt connector'],['Revolt','RV400','Proprietary / Revolt connector'],
        ['Ultraviolette','F77','Type 6 (LECCS)'],['Ultraviolette','F77 Mach 2','Type 6 (LECCS)'],['Ultraviolette','Tesseract','Type 6 (LECCS)'],
        ['Tork','Kratos R','Type 6 (LECCS)'],['Matter','Aera','Type 7 / Matter connector'],['River','Indie','Proprietary / River connector'],['Royal Enfield','Flying Flea C6','Proprietary / Flying Flea connector']
    ]
};

let selectedVehicle = null;
let selectedLocation = null;

let vehicleFlowInitialized = false;

function initVehicleFlow() {
    if (vehicleFlowInitialized) return;
    vehicleFlowInitialized = true;
    const typeButtons = document.querySelectorAll('.vehicle-type-card');
    const companySelect = document.getElementById('companySelect');
    const modelSelect = document.getElementById('modelSelect');
    const vehicleNext = document.getElementById('vehicleNext');
    const connectorPreview = document.getElementById('connectorPreview');
    const selectedConnector = document.getElementById('selectedConnector');

    typeButtons.forEach(btn => btn.addEventListener('click', () => {
        typeButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        const type = btn.dataset.type;
        selectedVehicle = null;
        companySelect.innerHTML = '<option value="">Select company</option>';
        modelSelect.innerHTML = '<option value="">Select model</option>';
        modelSelect.disabled = true;
        vehicleNext.disabled = true;
        connectorPreview.classList.add('hidden');
        [...new Set(VEHICLE_DATABASE[type].map(row => row[0]))].forEach(company => {
            companySelect.add(new Option(company, company));
        });
        document.getElementById('vehicleSelects').classList.remove('hidden');
        companySelect.focus();
    }));

    companySelect.addEventListener('change', () => {
        const type = document.querySelector('.vehicle-type-card.selected')?.dataset.type;
        const company = companySelect.value;
        modelSelect.innerHTML = '<option value="">Select model</option>';
        modelSelect.disabled = !company;
        vehicleNext.disabled = true;
        connectorPreview.classList.add('hidden');
        if (!type || !company) return;
        VEHICLE_DATABASE[type].filter(row => row[0] === company).forEach(row => modelSelect.add(new Option(row[1], row[1])));
    });

    modelSelect.addEventListener('change', () => {
        const type = document.querySelector('.vehicle-type-card.selected')?.dataset.type;
        const company = companySelect.value;
        const model = modelSelect.value;
        const row = VEHICLE_DATABASE[type || 'car'].find(r => r[0] === company && r[1] === model);
        selectedVehicle = row ? { type, company: row[0], model: row[1], connector: row[2] } : null;
        if (selectedVehicle) {
            selectedConnector.textContent = selectedVehicle.connector;
            connectorPreview.classList.remove('hidden');
            vehicleNext.disabled = false;
        } else {
            connectorPreview.classList.add('hidden');
            vehicleNext.disabled = true;
        }
    });

    vehicleNext.addEventListener('click', showLocationPage);
    document.getElementById('locationBack').addEventListener('click', () => {
        if (history.state?.evFlowPage === 'locationPage') history.back();
        else setFlowPage('vehiclePage', false);
    });
    document.getElementById('findChargersBtn').addEventListener('click', submitFlowLocation);
    document.getElementById('flowLocationInput').addEventListener('keydown', e => { if (e.key === 'Enter') submitFlowLocation(); });
    document.getElementById('useMyLocationBtn').addEventListener('click', async () => {
        const btn = document.getElementById('useMyLocationBtn');
        btn.textContent = '⏳ Getting your location...';
        try {
            const loc = await getUserLocation();
            await finishLocationFlow(loc.lat, loc.lng, 'Your current location');
        } catch (e) {
            btn.textContent = '📍 Use my current location';
            showToast('Location access unavailable. Please enter your city or area.', 'error');
        }
    });
    document.getElementById('resultsBack').addEventListener('click', () => {
        if (history.state?.evFlowPage === 'resultsPage') history.back();
        else setFlowPage('locationPage', false);
    });
    document.getElementById('resultsLocationBtn').addEventListener('click', () => {
        setFlowPage('locationPage');
        document.getElementById('flowLocationInput').focus();
    });

    // Station detail is a separate view. Both Back and Close must return
    // to the charger list and restore the previous scroll position.
    const detailBack = document.getElementById('detailBack');
    const detailClose = document.getElementById('detailClose');
    if (detailBack) detailBack.addEventListener('click', closeDetail);
    if (detailClose) detailClose.addEventListener('click', closeDetail);
}

initVehicleFlow();

// ===== Flow history / browser Back support =====
function setFlowPage(page, push = true) {
    const pages = ['vehiclePage', 'locationPage', 'resultsPage'];
    pages.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', id !== page);
    });
    if (push) history.pushState({ evFlowPage: page }, '', window.location.href);
}

function restoreFlowPage(page) {
    if (page === 'locationPage' && selectedVehicle) {
        const icon = selectedVehicle.type === 'car' ? '🚗' : '🏍️';
        document.getElementById('selectedVehicleChip').textContent = `${icon} ${selectedVehicle.company} ${selectedVehicle.model} • ${selectedVehicle.connector}`;
        applyVehicleConnectorFilter();
        setFlowPage('locationPage', false);
        return;
    }
    if (page === 'resultsPage' && selectedLocation && selectedVehicle) {
        setFlowPage('resultsPage', false);
        return;
    }
    setFlowPage('vehiclePage', false);
}

function initFlowHistory() {
    if (!history.state || !history.state.evFlowPage) {
        history.replaceState({ evFlowPage: 'vehiclePage' }, '', window.location.href);
    }
    window.addEventListener('popstate', (e) => {
        // If station details are open, browser Back closes only the details first.
        const panel = document.getElementById('detailPanel');
        if (panel && panel.classList.contains('open')) {
            closeDetail(false);
            return;
        }
        restoreFlowPage(e.state?.evFlowPage || 'vehiclePage');
    });
}

function showLocationPage() {
    if (!selectedVehicle) return;
    const icon = selectedVehicle.type === 'car' ? '🚗' : '🏍️';
    document.getElementById('selectedVehicleChip').textContent = `${icon} ${selectedVehicle.company} ${selectedVehicle.model} • ${selectedVehicle.connector}`;
    applyVehicleConnectorFilter();
    setFlowPage('locationPage');
    document.getElementById('flowLocationInput').focus();
}

async function submitFlowLocation() {
    if (!selectedVehicle) return;
    const query = document.getElementById('flowLocationInput').value.trim();
    if (!query) { showToast('Please enter a city, area or landmark.', 'error'); return; }
    const btn = document.getElementById('findChargersBtn');
    btn.disabled = true; btn.innerHTML = 'Searching location...';
    try {
        let result = null;
        try { result = await searchWithNominatim(query); } catch (e) { console.warn(e); }
        if (!result && geocoder) {
            result = await new Promise(resolve => geocoder.geocode({address: query + ', India', componentRestrictions:{country:'IN'}}, (results,status) => {
                if (status === 'OK' && results?.length) { const l=results[0].geometry.location; resolve({lat:l.lat(),lng:l.lng(),displayName:results[0].formatted_address||query}); } else resolve(null);
            }));
        }
        if (!result) throw new Error('Location not found');
        await finishLocationFlow(result.lat, result.lng, result.displayName || query);
    } catch (e) {
        showToast('Location not found. Try a city or area name.', 'error');
    } finally { btn.disabled = false; btn.innerHTML = 'Find charging stations <span>→</span>'; }
}

async function finishLocationFlow(lat, lng, label) {
    selectedLocation = { lat, lng, label };
    userLat = lat; userLng = lng; window.__evSearchCenter = {lat,lng};
    const icon = selectedVehicle.type === 'car' ? '🚗' : '🏍️';
    document.getElementById('resultsVehicle').textContent = `${icon} ${selectedVehicle.company} ${selectedVehicle.model} • ${selectedVehicle.connector}`;
    setFlowPage('resultsPage');
    if (map) { map.panTo({lat,lng}); map.setZoom(12); }
    document.getElementById('mapChipText').textContent = `Near ${label}`;
    setUserMarker(lat,lng);
    applyVehicleConnectorFilter();
    await fetchStationsForVehicle(lat,lng,document.getElementById('radiusFilter').value);
}

function applyVehicleConnectorFilter() {
    const select = document.getElementById('connectorFilter');
    const hint = document.getElementById('locationConnectorHint');
    select.innerHTML = '';

    if (!selectedVehicle) {
        select.disabled = true;
        select.add(new Option('Auto from selected vehicle', ''));
        if (hint) hint.textContent = 'Connector will be matched automatically';
        return;
    }

    const connector = selectedVehicle.connector || '';
    const options = [];
    if (connector.includes('CCS2')) options.push(['CCS2', '33']);
    if (connector.includes('Type 2')) options.push(['Type 2', '25']);

    if (options.length) {
        options.forEach(([label, value]) => select.add(new Option(label, value)));
        select.value = options.some(x => x[1] === '33') ? '33' : options[0][1];
    } else {
        select.add(new Option(connector, ''));
        select.value = '';
    }

    select.disabled = options.length <= 1;
    if (hint) hint.textContent = `Searching with ${connector} compatibility`;
}

async function fetchStationsForVehicle(lat,lng,radius) {
    // Fetch nearby stations without forcing a single OCM connector ID.
    // A vehicle such as Type 2 + CCS2 can use either compatible connector,
    // so the final compatibility filter is handled locally from the PDF data.
    await fetchStations(lat,lng,radius,'');
    // fetchStations() already applies rankStationsForVehicle().
    updateUI();
    if (map && window.google?.maps) updateMapMarkers();
}

function getVehicleOcmConnectorId() {
    // Prefer CCS2 for vehicles supporting both AC Type 2 and DC CCS2.
    if (selectedVehicle?.connector.includes('CCS2')) return '33';
    if (selectedVehicle?.connector.includes('Type 2')) return '25';
    return '';
}

function rankStationsForVehicle() {
    if (!selectedVehicle || !Array.isArray(stations)) return;

    const wanted = String(selectedVehicle.connector || '').toLowerCase();
    const connectionText = (c) => [
        c.typeName, c.currentTypeName, c.levelName, c.comments
    ].filter(Boolean).join(' ').toLowerCase();

    let connectionMatcher;

    // Cars from the supplied database use Type 2 AC and/or CCS2 DC.
    if (wanted.includes('ccs2') && wanted.includes('type 2')) {
        connectionMatcher = text =>
            /ccs\s*\(?type\s*2\)?|ccs2|combo\s*2|combined charging system/i.test(text) ||
            /type\s*2|mennekes/i.test(text);
    } else if (wanted.includes('ccs2')) {
        connectionMatcher = text => /ccs\s*\(?type\s*2\)?|ccs2|combo\s*2|combined charging system/i.test(text);
    } else if (wanted.includes('type 2')) {
        connectionMatcher = text => /type\s*2|mennekes/i.test(text);
    }
    // Bikes: use the connector terminology supplied in the PDF.
    else if (wanted.includes('type 6') || wanted.includes('leccs')) {
        connectionMatcher = text => /type\s*6|leccs/i.test(text);
    } else if (wanted.includes('type 7') && wanted.includes('ather')) {
        connectionMatcher = text => /type\s*7|ather\s*leccs|leccs/i.test(text);
    } else if (wanted.includes('type 7') && wanted.includes('vida')) {
        connectionMatcher = text => /type\s*7|vida\s*leccs|leccs/i.test(text);
    } else if (wanted.includes('proprietary')) {
        if (wanted.includes('tvs')) connectionMatcher = text => /tvs\s*connector|\btvs\b/i.test(text);
        else if (wanted.includes('chetak')) connectionMatcher = text => /chetak/i.test(text);
        else if (wanted.includes('revolt')) connectionMatcher = text => /revolt/i.test(text);
        else if (wanted.includes('matter')) connectionMatcher = text => /matter/i.test(text);
        else if (wanted.includes('river')) connectionMatcher = text => /river/i.test(text);
        else if (wanted.includes('flying flea')) connectionMatcher = text => /flying\s*flea/i.test(text);
        else connectionMatcher = () => false;
    } else {
        connectionMatcher = () => false;
    }

    stations.forEach(s => {
        // Keep ONLY the actual connector records that match the selected
        // vehicle. Incompatible connectors at the same station are also hidden.
        const compatibleConnections = (s.connections || []).filter(c =>
            connectionMatcher(connectionText(c))
        );
        s.connections = compatibleConnections;
        s.vehicleMatch = compatibleConnections.length > 0;
    });

    // IMPORTANT: incompatible stations are removed, not merely moved lower.
    stations = stations.filter(s => s.vehicleMatch);
    stations.sort((a, b) => a.distance - b.distance);
}

// ===== Expose for popup buttons =====
window.EVApp = {
    openDetail: (id) => openDetail(id),
};

// ===== Start App (called after map is ready) =====
async function startApp() {
    // New 3-step flow: vehicle -> location -> compatible charging results.
    initFlowHistory();
    initVehicleFlow();
}
