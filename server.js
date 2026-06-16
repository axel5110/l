
const DATA_API = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records";
const GEO_COMMUNES = "https://geo.api.gouv.fr/communes";
const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";
const STATION_PAGE = "https://www.prix-carburants.gouv.fr/station/";
const OVERPASS_API = "https://overpass-api.de/api/interpreter";

const FUEL_FIELDS = {
  gazole: { price: ["prix_gazole", "gazole_prix", "price_gazole"], update: ["maj_gazole", "gazole_maj"], label: "Gazole" },
  sp95: { price: ["prix_sp95", "sp95_prix", "price_sp95"], update: ["maj_sp95", "sp95_maj"], label: "SP95" },
  sp98: { price: ["prix_sp98", "sp98_prix", "price_sp98"], update: ["maj_sp98", "sp98_maj"], label: "SP98" },
  e10: { price: ["prix_e10", "e10_prix", "price_e10"], update: ["maj_e10", "e10_maj"], label: "E10" },
  e85: { price: ["prix_e85", "e85_prix", "price_e85"], update: ["maj_e85", "e85_maj"], label: "E85" },
  gplc: { price: ["prix_gplc", "gplc_prix", "price_gplc"], update: ["maj_gplc", "gplc_maj"], label: "GPLc" }
};

const PARIS_CP = Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, "0")}`);

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
  { brand: "Cora", keys: ["cora"] },
  { brand: "Système U", keys: ["système u", "systeme u"] }
];

const clean = (v) => String(v ?? "").replace(/[<>"']/g, "").trim();
const normalize = (v) => clean(v).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const escapeWhere = (v) => clean(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=180",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

function getFirst(row, names) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== null && row[name] !== "") return row[name];
  }
  return "";
}

function getPrice(row, fuel) {
  const cfg = FUEL_FIELDS[fuel];
  let value = getFirst(row, cfg.price);
  let n = Number(String(value ?? "").replace(",", "."));
  if (Number.isFinite(n) && n > 0) return n;

  const arrays = [row.prix, row.prices, row.carburants].filter(Boolean);
  for (const arr of arrays) {
    const list = Array.isArray(arr) ? arr : [arr];
    for (const item of list) {
      const carburant = normalize(item.nom || item.name || item.carburant || item.type || "");
      if (!carburant) continue;
      const wanted = normalize(FUEL_FIELDS[fuel].label);
      if (carburant.includes(wanted) || wanted.includes(carburant)) {
        n = Number(String(item.valeur || item.value || item.prix || item.price || "").replace(",", "."));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
  }
  return null;
}

function getUpdate(row, fuel) {
  return getFirst(row, FUEL_FIELDS[fuel].update);
}

function coordToDecimal(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return Math.abs(n) > 1000 ? n / 100000 : n;
}

function getCoords(row) {
  const lat = coordToDecimal(row.latitude ?? row.lat);
  const lon = coordToDecimal(row.longitude ?? row.lon ?? row.lng);
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

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return clean(value);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

function detectBrand(text) {
  const t = normalize(text);
  for (const rule of BRAND_PATTERNS) {
    if (rule.keys.some(k => t.includes(normalize(k)))) return rule.brand;
  }
  return "";
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractOfficialName(html) {
  const patterns = [
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
    /<title[^>]*>([\s\S]*?)<\/title>/i
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m && m[1]) {
      const raw = stripHtml(m[1]);
      const brand = detectBrand(raw);
      if (brand) return brand;

      const name = raw
        .replace(/Prix des carburants/gi, "")
        .replace(/prix-carburants\.gouv\.fr/gi, "")
        .replace(/Station-service/gi, "")
        .replace(/^[-|–]+|[-|–]+$/g, "")
        .trim();

      if (name.length >= 3) return name;
    }
  }
  return detectBrand(stripHtml(html));
}

async function getOfficialName(id) {
  if (!id) return "";
  try {
    const r = await fetch(`${STATION_PAGE}${encodeURIComponent(id)}`, {
      headers: { "Accept": "text/html", "User-Agent": "Carburio/1.0 (+https://carburio.com)" }
    });
    if (!r.ok) return "";
    return extractOfficialName(await r.text());
  } catch {
    return "";
  }
}

async function getOsmStationName(lat, lon) {
  if (!lat || !lon) return "";
  try {
    const query = `
      [out:json][timeout:8];
      (
        node["amenity"="fuel"](around:250,${lat},${lon});
        way["amenity"="fuel"](around:250,${lat},${lon});
        relation["amenity"="fuel"](around:250,${lat},${lon});
      );
      out center tags 5;
    `;
    const r = await fetch(OVERPASS_API, {
      method: "POST",
      headers: { "Content-Type": "text/plain", "User-Agent": "Carburio/1.0 (+https://carburio.com)" },
      body: query
    });
    if (!r.ok) return "";
    const data = await r.json();
    const candidates = data.elements || [];
    for (const el of candidates) {
      const tags = el.tags || {};
      const text = [tags.brand, tags.name, tags.operator].filter(Boolean).join(" ");
      const brand = detectBrand(text);
      if (brand) return brand;
      if (tags.brand) return clean(tags.brand);
      if (tags.name) return clean(tags.name);
      if (tags.operator) return clean(tags.operator);
    }
  } catch {}
  return "";
}

function fallbackName(row) {
  const direct = clean(row.nom_station || row.nom || row.enseigne || row.marque || row.name);
  if (direct) {
    const brand = detectBrand(direct);
    return brand || direct;
  }

  const brand = detectBrand([row.adresse, row.ville, row.services_service, row.horaires_jour].flat().join(" "));
  if (brand) return brand;

  if (row.adresse) return `Station-service – ${clean(row.adresse)}`;
  if (row.ville) return `Station-service – ${clean(row.ville)}`;
  return "Station-service";
}

function deptFromPostcode(cp) {
  const code = clean(cp);
  if (!/^\d{5}$/.test(code)) return "";
  if (code.startsWith("97") || code.startsWith("98")) return code.slice(0, 3);
  return code.slice(0, 2);
}

async function postcodesFromCity(q) {
  const query = clean(q);
  const n = normalize(query);

  if (query === "02700" || n.includes("tergnier")) {
    return { codes: ["02700", "02300", "02800"], depts: ["02"], center: { lat: 49.6566, lon: 3.2870 }, radiusKm: 40 };
  }

  if (query === "02300" || n.includes("chauny") || n.includes("viry-noureuil")) {
    return { codes: ["02300", "02700", "02800"], depts: ["02"], center: { lat: 49.615, lon: 3.218 }, radiusKm: 40 };
  }

  if (query === "02800" || n.includes("beautor") || n.includes("la fere") || n.includes("la-fere")) {
    return { codes: ["02800", "02700", "02300"], depts: ["02"], center: { lat: 49.652, lon: 3.345 }, radiusKm: 40 };
  }

  if (n === "paris") return { codes: PARIS_CP, depts: ["75"], center: { lat: 48.8566, lon: 2.3522 }, radiusKm: 18 };

  if (/^\d{5}$/.test(query)) {
    return { codes: [query], depts: [deptFromPostcode(query)].filter(Boolean), center: null, radiusKm: 45 };
  }

  const params = new URLSearchParams({
    nom: query,
    fields: "nom,codesPostaux,centre,codeDepartement",
    boost: "population",
    limit: "8"
  });

  const r = await fetch(`${GEO_COMMUNES}?${params.toString()}`, { headers: { "Accept": "application/json" } });
  if (!r.ok) return { codes: [], depts: [], center: null, radiusKm: 45 };

  const data = await r.json();
  const codes = [];
  const depts = [];
  let center = null;

  for (const commune of data) {
    if (!center && commune.centre?.coordinates?.length === 2) {
      center = { lon: commune.centre.coordinates[0], lat: commune.centre.coordinates[1] };
    }
    if (commune.codeDepartement && !depts.includes(commune.codeDepartement)) depts.push(commune.codeDepartement);
    for (const cp of commune.codesPostaux || []) {
      if (!codes.includes(cp)) codes.push(cp);
      const d = deptFromPostcode(cp);
      if (d && !depts.includes(d)) depts.push(d);
    }
  }

  return { codes: codes.slice(0, 30), depts: depts.slice(0, 4), center, radiusKm: 45 };
}

async function postcodeFromPosition(lat, lon) {
  try {
    const params = new URLSearchParams({ format: "jsonv2", lat: String(lat), lon: String(lon), zoom: "18", addressdetails: "1" });
    const r = await fetch(`${NOMINATIM_REVERSE}?${params.toString()}`, {
      headers: { "Accept": "application/json", "User-Agent": "Carburio/1.0 (+https://carburio.com)" }
    });
    if (!r.ok) return "";
    const data = await r.json();
    return clean(data.address?.postcode || "");
  } catch {
    return "";
  }
}

function buildWhereByPostcodes(codes) {
  return codes.map(cp => `cp="${escapeWhere(cp)}"`).join(" or ");
}

function buildWhereByDepts(depts) {
  return depts.map(d => `code_departement="${escapeWhere(d)}"`).join(" or ");
}

async function fetchRows(where, limit = 100) {
  if (!where) return [];
  const params = new URLSearchParams({
    lang: "fr",
    timezone: "Europe/Paris",
    limit: String(limit),
    where
  });

  const r = await fetch(`${DATA_API}?${params.toString()}`, { headers: { "Accept": "application/json" } });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`API officielle carburants ${r.status}: ${txt.slice(0, 120)}`);
  }
  const data = await r.json();
  return data.results || [];
}

async function fetchRowsSmart(geo) {
  const all = [];
  const seen = new Set();

  async function addRows(rows) {
    for (const row of rows) {
      const id = clean(row.id || `${row.adresse}-${row.cp}-${row.ville}`);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(row);
    }
  }

  // On cherche TOUJOURS les CP exacts, puis le département pour que toutes les villes de France aient des résultats proches.
  if (geo.codes?.length) {
    await addRows(await fetchRows(buildWhereByPostcodes(geo.codes), 100));
  }

  if (geo.depts?.length) {
    await addRows(await fetchRows(buildWhereByDepts(geo.depts), 100));
  }

  return all;
}

async function apiCarburants(request) {
  const url = new URL(request.url);
  let q = clean(url.searchParams.get("q"));
  const fuel = normalize(url.searchParams.get("fuel") || "e10").replace("prix_", "");
  const lat = Number(url.searchParams.get("lat"));
  const lon = Number(url.searchParams.get("lon"));

  if (!FUEL_FIELDS[fuel]) return json({ error: "Carburant non reconnu", results: [] }, 400);

  let origin = null;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    origin = { lat, lon };
    if (!q) q = await postcodeFromPosition(lat, lon);
  }

  if (!q) return json({ error: "Ville, code postal ou position manquante", results: [] }, 400);

  const geo = await postcodesFromCity(q);
  if (!origin && geo.center) origin = geo.center;

  const rows = await fetchRowsSmart(geo);

  async function buildResultsForFuel(chosenFuel) {
    const seen = new Set();
    let base = rows.filter(row => {
      const id = clean(row.id || `${row.adresse}-${row.cp}-${row.ville}`);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(row => {
      const price = getPrice(row, chosenFuel);
      if (!price) return null;

      const coords = getCoords(row);
      const distanceKm = origin ? haversineKm(origin, coords) : null;

      if (origin && distanceKm !== null && geo.radiusKm && distanceKm > geo.radiusKm) return null;

      return {
        row,
        id: clean(row.id),
        name: fallbackName(row),
        nameSource: "Nom déduit",
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
      if (origin && a.distanceKm !== null && b.distanceKm !== null) return a.distanceKm - b.distanceKm;
      return a.price - b.price;
    }).slice(0, 20);

    // Enrichissement noms : OSM d'abord, puis page officielle si peu de résultats.
    base = await Promise.all(base.map(async item => {
      let enriched = "";
      if (item.lat && item.lon) enriched = await getOsmStationName(item.lat, item.lon);
      if (!enriched && item.id && base.length <= 12) enriched = await getOfficialName(item.id);

      if (enriched) {
        return {
          ...item,
          name: enriched,
          nameSource: detectBrand(enriched) ? "Enseigne" : "Nom station"
        };
      }
      return item;
    }));

    return base.map(({ row, ...item }) => item);
  }

  let results = await buildResultsForFuel(fuel);
  let fallbackFuel = "";

  if (!results.length) {
    for (const f of ["gazole", "sp95", "sp98", "e10", "e85", "gplc"].filter(x => x !== fuel)) {
      const alt = await buildResultsForFuel(f);
      if (alt.length) {
        results = alt;
        fallbackFuel = f;
        break;
      }
    }
  }

  const msg = fallbackFuel
    ? `Aucun prix ${FUEL_FIELDS[fuel].label} trouvé. Affichage des stations proches avec ${FUEL_FIELDS[fallbackFuel].label}.`
    : `${results.length} station(s) trouvée(s) avec prix, noms, distance et carte.`;

  return json({
    meta: {
      q,
      fuel,
      postcodes: geo.codes,
      departments: geo.depts,
      rowsFoundBeforeFuelFilter: rows.length,
      fallbackFuel,
      message: msg
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
        return json({ error: "Impossible de charger les carburants", detail: String(error.message || error), results: [] }, 502);
      }
    }
    return env.ASSETS.fetch(request);
  }
};
