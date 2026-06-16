
const DATA_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const GEO_COMMUNES = "https://geo.api.gouv.fr/communes";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";

const FUEL_FIELDS = {
  gazole: { price: ["prix_gazole"], update: ["maj_gazole"], label: "Gazole" },
  sp95: { price: ["prix_sp95"], update: ["maj_sp95"], label: "SP95" },
  sp98: { price: ["prix_sp98"], update: ["maj_sp98"], label: "SP98" },
  e10: { price: ["prix_e10"], update: ["maj_e10"], label: "E10" },
  e85: { price: ["prix_e85"], update: ["maj_e85"], label: "E85" },
  gplc: { price: ["prix_gplc"], update: ["maj_gplc"], label: "GPLc" }
};

const BRAND_PATTERNS = [
  { brand: "TotalEnergies", keys: ["totalenergies", "total energies", "total energie", "total énergie", "total access", "total"] },
  { brand: "E.Leclerc", keys: ["e.leclerc", "e leclerc", "leclerc"] },
  { brand: "Intermarché", keys: ["intermarché", "intermarche", "inter marché"] },
  { brand: "Carrefour", keys: ["carrefour"] },
  { brand: "Auchan", keys: ["auchan"] },
  { brand: "Super U", keys: ["super u", "hyper u", "u express", "systeme u", "système u"] },
  { brand: "Avia", keys: ["avia"] },
  { brand: "Esso", keys: ["esso"] },
  { brand: "Shell", keys: ["shell"] },
  { brand: "BP", keys: ["bp"] },
  { brand: "ENI", keys: ["eni", "agip"] },
  { brand: "Dyneff", keys: ["dyneff"] },
  { brand: "Netto", keys: ["netto"] },
  { brand: "Casino", keys: ["casino"] },
  { brand: "Cora", keys: ["cora"] }
];

const PARIS_CENTER = { lat: 48.8566, lon: 2.3522 };
const TERGNIER_CENTER = { lat: 49.6566, lon: 3.2870 };

const clean = (v) => String(v ?? "").replace(/[<>"']/g, "").trim();
const normalize = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const num = (v) => Number(String(v ?? "").replace(",", ".").trim());

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function detectBrand(text) {
  const t = normalize(text);
  for (const rule of BRAND_PATTERNS) {
    if (rule.keys.some(k => t.includes(normalize(k)))) return rule.brand;
  }
  return "";
}

function coordToDecimal(value) {
  const n = num(value);
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) > 1000 ? n / 100000 : n;
}

function getCoords(row) {
  const lat = coordToDecimal(row.latitude);
  const lon = coordToDecimal(row.longitude);
  return lat !== null && lon !== null ? { lat, lon } : null;
}

function haversineKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const lat1 = a.lat * Math.PI / 180;
  const lat2 = b.lat * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(km) {
  if (km === null || !Number.isFinite(km)) return "";
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1).replace(".", ",")} km`;
}

function getFirst(row, fields) {
  for (const f of fields) {
    if (row[f] !== undefined && row[f] !== null && row[f] !== "") return row[f];
  }
  return "";
}

function getPrice(row, fuel) {
  const value = getFirst(row, FUEL_FIELDS[fuel].price);
  const n = num(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function getUpdate(row, fuel) {
  return getFirst(row, FUEL_FIELDS[fuel].update);
}

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return clean(value);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

async function cityCenter(q) {
  const query = clean(q);
  const n = normalize(query);

  if (query === "02700" || n.includes("tergnier")) {
    return { ...TERGNIER_CENTER, label: "Tergnier", radiusKm: 45 };
  }

  if (n === "paris" || /^750(0[1-9]|1[0-9]|20)$/.test(query)) {
    return { ...PARIS_CENTER, label: "Paris", radiusKm: 18 };
  }

  if (/^\d{5}$/.test(query)) {
    const params = new URLSearchParams({
      codePostal: query,
      fields: "nom,codesPostaux,centre",
      format: "json",
      limit: "1"
    });
    const r = await fetch(`${GEO_COMMUNES}?${params.toString()}`, { headers: { "Accept": "application/json" } });
    if (r.ok) {
      const data = await r.json();
      const c = data?.[0];
      if (c?.centre?.coordinates?.length === 2) {
        return { lon: c.centre.coordinates[0], lat: c.centre.coordinates[1], label: c.nom || query, radiusKm: 35 };
      }
    }
  }

  const params = new URLSearchParams({
    nom: query,
    fields: "nom,codesPostaux,centre",
    boost: "population",
    limit: "1"
  });

  const r = await fetch(`${GEO_COMMUNES}?${params.toString()}`, { headers: { "Accept": "application/json" } });
  if (!r.ok) return null;
  const data = await r.json();
  const c = data?.[0];

  if (c?.centre?.coordinates?.length === 2) {
    return { lon: c.centre.coordinates[0], lat: c.centre.coordinates[1], label: c.nom || query, radiusKm: 35 };
  }

  return null;
}

async function postcodeFromPosition(lat, lon) {
  try {
    const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "18", addressdetails: "1" });
    const r = await fetch(`${NOMINATIM_REVERSE}?${params.toString()}`, {
      headers: { "Accept": "application/json", "User-Agent": "Carburio/1.0 (+https://carburio.com)" }
    });
    if (!r.ok) return "";
    const data = await r.json();
    return clean(data.address?.postcode || data.address?.city || "");
  } catch {
    return "";
  }
}

async function fetchFuelRowsAround(center, radiusKm) {
  const radiusMeters = Math.round(radiusKm * 1000);

  const params = new URLSearchParams({
    lang: "fr",
    timezone: "Europe/Paris",
    limit: "100",
    where: `within_distance(geom, geom'POINT(${center.lon} ${center.lat})', ${radiusMeters}m)`
  });

  const r = await fetch(`${DATA_API}?${params.toString()}`, { headers: { "Accept": "application/json" } });

  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`API carburants ${r.status}: ${txt.slice(0, 160)}`);
  }

  const data = await r.json();
  return data.results || [];
}

async function fetchOsmStations(center, radiusKm) {
  const radiusMeters = Math.min(Math.round(radiusKm * 1000), 50000);

  try {
    const query = `
      [out:json][timeout:10];
      (
        node["amenity"="fuel"](around:${radiusMeters},${center.lat},${center.lon});
        way["amenity"="fuel"](around:${radiusMeters},${center.lat},${center.lon});
        relation["amenity"="fuel"](around:${radiusMeters},${center.lat},${center.lon});
      );
      out center tags 150;
    `;

    const r = await fetch(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "User-Agent": "Carburio/1.0 (+https://carburio.com)" },
      body: query
    });

    if (!r.ok) return [];

    const data = await r.json();

    return (data.elements || []).map(el => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      const tags = el.tags || {};
      const rawName = clean([tags.brand, tags.name, tags.operator].filter(Boolean).join(" "));
      const brand = detectBrand(rawName);
      const name = brand || clean(tags.brand || tags.name || tags.operator || "");
      return {
        lat,
        lon,
        name,
        brand: brand || name
      };
    }).filter(x => x.lat && x.lon && x.name);
  } catch {
    return [];
  }
}

function nearestOsmName(stationCoords, osmStations) {
  if (!stationCoords || !osmStations.length) return "";
  let best = null;

  for (const osm of osmStations) {
    const d = haversineKm(stationCoords, { lat: osm.lat, lon: osm.lon });
    if (d !== null && d <= 0.6 && (!best || d < best.d)) {
      best = { ...osm, d };
    }
  }

  return best?.brand || best?.name || "";
}

function fallbackName(row) {
  const direct = clean(row.nom_station || row.nom || row.enseigne || row.marque || row.name);
  if (direct) return detectBrand(direct) || direct;

  const text = [row.adresse, row.ville, row.services_service, row.horaires_jour].flat().join(" ");
  const brand = detectBrand(text);
  if (brand) return brand;

  if (row.adresse) return `Station-service – ${clean(row.adresse)}`;
  if (row.ville) return `Station-service – ${clean(row.ville)}`;
  return "Station-service";
}

async function apiCarburants(request) {
  const url = new URL(request.url);
  let q = clean(url.searchParams.get("q"));
  const fuel = normalize(url.searchParams.get("fuel") || "e10").replace("prix_", "");
  const lat = num(url.searchParams.get("lat"));
  const lon = num(url.searchParams.get("lon"));

  if (!FUEL_FIELDS[fuel]) {
    return json({ error: "Carburant non reconnu", results: [] }, 400);
  }

  let center = null;

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    center = { lat, lon, label: "Votre position", radiusKm: 35 };
    if (!q) q = await postcodeFromPosition(lat, lon);
  } else {
    if (!q) return json({ error: "Ville, code postal ou position manquante", results: [] }, 400);
    center = await cityCenter(q);
  }

  if (!center) {
    return json({ error: "Ville introuvable", detail: "Essaie avec un code postal ou une ville plus précise.", results: [] }, 404);
  }

  let rows = await fetchFuelRowsAround(center, center.radiusKm);

  // Si la ville est petite et qu'il y a peu de stations, on élargit un peu.
  if (rows.length < 3) {
    rows = await fetchFuelRowsAround(center, Math.min(center.radiusKm + 25, 60));
    center.radiusKm = Math.min(center.radiusKm + 25, 60);
  }

  const osmStations = await fetchOsmStations(center, center.radiusKm);

  function buildResults(chosenFuel) {
    const seen = new Set();

    return rows.map(row => {
      const id = clean(row.id || `${row.adresse}-${row.cp}-${row.ville}`);
      if (seen.has(id)) return null;
      seen.add(id);

      const price = getPrice(row, chosenFuel);
      if (!price) return null;

      const coords = getCoords(row);
      const distanceKm = haversineKm(center, coords);
      if (distanceKm !== null && distanceKm > center.radiusKm) return null;

      const osmName = nearestOsmName(coords, osmStations);
      const name = osmName || fallbackName(row);

      return {
        id,
        name,
        nameSource: osmName ? "Enseigne" : "Nom déduit",
        address: clean(row.adresse),
        cp: clean(row.cp),
        city: clean(row.ville),
        price,
        displayedFuel: chosenFuel,
        selectedFuelUnavailable: chosenFuel !== fuel,
        updateDateText: formatDate(getUpdate(row, chosenFuel)),
        lat: coords?.lat ?? null,
        lon: coords?.lon ?? null,
        distanceKm,
        distanceText: formatDistance(distanceKm)
      };
    }).filter(Boolean).sort((a, b) => {
      if (a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return a.price - b.price;
    }).slice(0, 20);
  }

  let results = buildResults(fuel);
  let fallbackFuel = "";

  if (!results.length) {
    for (const f of ["gazole", "sp95", "sp98", "e10", "e85", "gplc"].filter(x => x !== fuel)) {
      const alt = buildResults(f);
      if (alt.length) {
        results = alt;
        fallbackFuel = f;
        break;
      }
    }
  }

  const message = fallbackFuel
    ? `Aucun prix ${FUEL_FIELDS[fuel].label} trouvé. Affichage des stations proches avec ${FUEL_FIELDS[fallbackFuel].label}.`
    : `${results.length} station(s) trouvée(s) autour de ${center.label}.`;

  return json({
    meta: {
      q,
      fuel,
      center: { lat: center.lat, lon: center.lon, label: center.label },
      radiusKm: center.radiusKm,
      rowsFoundBeforeFuelFilter: rows.length,
      osmStationsFound: osmStations.length,
      fallbackFuel,
      message
    },
    results
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/carburants") {
      try {
        return await apiCarburants(request);
      } catch (error) {
        return json({
          error: "Impossible de charger les carburants",
          detail: String(error.message || error),
          results: []
        }, 502);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
