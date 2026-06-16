
(() => {
  const form = document.getElementById("compareForm");
  const placeInput = document.getElementById("placeInput");
  const fuelSelect = document.getElementById("fuelSelect");
  const status = document.getElementById("compareStatus");
  const results = document.getElementById("compareResults");
  const geoButton = document.getElementById("geoButton");
  const geoHeroButton = document.getElementById("geoHeroButton");
  const debugBox = document.getElementById("debugBox");

  let userPosition = null;
  let map;
  let markersLayer;

  const fuelLabels = {
    gazole: "Gazole",
    sp95: "SP95",
    sp98: "SP98",
    e10: "E10",
    e85: "E85",
    gplc: "GPLc"
  };

  const clean = (v) => String(v ?? "").replace(/[<>"']/g, "").trim();

  function formatPrice(value) {
    const n = Number(String(value ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return "Non dispo";
    return n.toFixed(3).replace(".", ",") + " €/L";
  }

  function logoInitial(name) {
    const n = clean(name || "Station");
    return `<div class="station-logo">${n.charAt(0).toUpperCase()}</div>`;
  }

  function initMap() {
    if (!window.L) return;
    if (!map) {
      map = L.map("map", { scrollWheelZoom: false }).setView([46.7, 2.4], 6);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap"
      }).addTo(map);
      markersLayer = L.layerGroup().addTo(map);
    }
  }

  function updateMap(items, fuel) {
    initMap();
    if (!map || !markersLayer) return;

    markersLayer.clearLayers();
    const bounds = [];

    if (userPosition) {
      const userMarker = L.circleMarker([userPosition.lat, userPosition.lon], {
        radius: 9,
        weight: 3
      }).bindPopup("Ta position");
      markersLayer.addLayer(userMarker);
      bounds.push([userPosition.lat, userPosition.lon]);
    }

    items.forEach((item) => {
      if (!item.lat || !item.lon) return;
      const marker = L.marker([item.lat, item.lon]).bindPopup(`
        <strong>${clean(item.name)}</strong><br>
        <span class="popup-price">${formatPrice(item.price)}</span><br>
        ${clean(item.address)}<br>
        ${clean(item.cp)} ${clean(item.city)}<br>
        ${item.distanceText ? "Distance : " + clean(item.distanceText) + "<br>" : ""}
        <a target="_blank" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.address,item.cp,item.city].filter(Boolean).join(" "))}">Itinéraire</a>
      `);
      markersLayer.addLayer(marker);
      bounds.push([item.lat, item.lon]);
    });

    if (bounds.length) {
      map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
    }
  }

  function render(items, fuel, meta = {}) {
    results.innerHTML = "";
    const label = fuelLabels[fuel] || fuel.toUpperCase();

    updateMap(items, fuel);

    if (!items.length) {
      status.textContent = meta.message || "Aucune station trouvée avec ce carburant.";
      return;
    }

    status.textContent = meta.message || `${items.length} station(s) trouvée(s).`;

    items.forEach((item, index) => {
      const name = clean(item.name || "Station-service");
      const address = clean(item.address);
      const cp = clean(item.cp);
      const city = clean(item.city);
      const distance = clean(item.distanceText);
      const maj = clean(item.updateDateText);
      const mapQuery = encodeURIComponent([address, cp, city].filter(Boolean).join(" "));
      const sourceBadge = item.nameSource ? `<span class="name-source">${clean(item.nameSource)}</span>` : "";
      const shownFuel = item.displayedFuel ? (fuelLabels[item.displayedFuel] || item.displayedFuel.toUpperCase()) : label;
      const unavailableText = item.selectedFuelUnavailable ? `Carburant demandé non trouvé · affichage ${shownFuel}` : shownFuel;
      const info = `${unavailableText}${distance ? " · à " + distance : ""}${maj ? " · Mis à jour : " + maj : ""}`;

      const card = document.createElement("div");
      card.className = "result-card";
      card.innerHTML = `
        <div class="result-main">
          ${logoInitial(name)}
          <div>
            <strong>${index + 1}. ${name} ${sourceBadge}</strong>
            <div class="address">${address}${address && (cp || city) ? " · " : ""}${cp} ${city}</div>
            <div class="small">${info}</div>
            ${mapQuery ? `<a class="map-link" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${mapQuery}">Itinéraire</a>` : ""}
          </div>
        </div>
        <div class="price-badge">${formatPrice(item.price)}<span class="date">${item.displayedFuel ? (fuelLabels[item.displayedFuel] || item.displayedFuel.toUpperCase()) : label}</span></div>
      `;
      results.appendChild(card);
    });
  }

  async function searchStations() {
    const q = clean(placeInput.value);
    const fuel = String(fuelSelect.value || "e10").replace("prix_", "");

    if (!q && !userPosition) {
      status.textContent = "Entre une ville/code postal ou utilise ta position.";
      return;
    }

    const params = new URLSearchParams({ fuel });
    if (q) params.set("q", q);
    if (userPosition) {
      params.set("lat", String(userPosition.lat));
      params.set("lon", String(userPosition.lon));
    }

    results.innerHTML = "";
    debugBox.textContent = "";
    status.textContent = "Recherche des prix, noms, distances et carte…";

    try {
      const response = await fetch(`/api/carburants?${params.toString()}`, { headers: { "Accept": "application/json" } });
      const text = await response.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch (_) {
        throw new Error("Réponse API non JSON : " + text.slice(0, 160));
      }

      if (!response.ok || data.error) {
        throw new Error(data.error || data.detail || "Erreur API serveur");
      }

      render(data.results || [], fuel, data.meta || {});
    } catch (error) {
      console.error(error);
      status.textContent = "Erreur : l’API Carburio ne répond pas correctement.";
      debugBox.innerHTML = `Teste cette URL : <a class="map-link" href="/api/carburants?q=02700&fuel=e10" target="_blank">/api/carburants?q=02700&fuel=e10</a><br>${clean(error.message)}`;
    }
  }

  function askLocation() {
    if (!navigator.geolocation) {
      status.textContent = "Ton navigateur ne permet pas la géolocalisation.";
      return;
    }

    status.textContent = "Autorise la localisation pour calculer la distance…";

    navigator.geolocation.getCurrentPosition(async (position) => {
      userPosition = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      status.textContent = "Position trouvée. Clique sur afficher les prix.";
      initMap();
      if (map) {
        map.setView([userPosition.lat, userPosition.lon], 12);
      }
      if (placeInput.value.trim()) {
        await searchStations();
      }
    }, () => {
      status.textContent = "Localisation refusée. Tu peux entrer un code postal à la place.";
    }, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 120000
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await searchStations();
    });
  }

  if (geoButton) geoButton.addEventListener("click", askLocation);
  if (geoHeroButton) geoHeroButton.addEventListener("click", askLocation);

  initMap();
})();
