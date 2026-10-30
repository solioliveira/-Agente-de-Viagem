import crypto from 'node:crypto';
import firebaseConfig from '../firebase-applet-config.json';

// Cache for Google's public X.509 certificates used to verify Firebase ID tokens
const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
let cachedCerts: Record<string, string> | null = null;
let cachedCertsExpiresAt = 0;

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cachedCerts && now < cachedCertsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new Error('Failed to fetch Firebase public certificates');
  }
  const certs = (await res.json()) as Record<string, string>;
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
  const ttlMs = maxAgeMatch ? Number(maxAgeMatch[1]) * 1000 : 3600 * 1000;
  cachedCerts = certs;
  cachedCertsExpiresAt = now + ttlMs;
  return certs;
}

function base64UrlToBuffer(b64u: string): Buffer {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, 'base64');
}

async function verifyFirebaseIdToken(idToken: string): Promise<{ uid: string; email?: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed JWT');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlToBuffer(headerB64).toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(base64UrlToBuffer(payloadB64).toString('utf8')) as {
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    email?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid token header');
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Token expired');
  }
  if (!payload.iat || payload.iat > nowSec + 300) {
    throw new Error('Invalid token issued-at time');
  }
  if (!payload.sub || typeof payload.sub !== 'string') {
    throw new Error('Invalid token subject');
  }

  const expectedProjectId = process.env.FIREBASE_PROJECT_ID || firebaseConfig.projectId;
  if (expectedProjectId && payload.aud !== expectedProjectId) {
    throw new Error('Token audience mismatch');
  }
  if (payload.iss !== `https://securetoken.google.com/${payload.aud}`) {
    throw new Error('Token issuer mismatch');
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[header.kid];
  if (!cert) {
    throw new Error('Unknown signing key ID');
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(`${headerB64}.${payloadB64}`);
  verifier.end();

  const signatureValid = verifier.verify(cert, base64UrlToBuffer(signatureB64));
  if (!signatureValid) {
    throw new Error('Invalid token signature');
  }

  return { uid: payload.sub, email: payload.email };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function formatPriceLevel(priceLevel?: string): string {
  switch (priceLevel) {
    case 'PRICE_LEVEL_FREE':
      return 'Grátis';
    case 'PRICE_LEVEL_INEXPENSIVE':
      return '$ · Econômico';
    case 'PRICE_LEVEL_MODERATE':
      return '$$ · Moderado';
    case 'PRICE_LEVEL_EXPENSIVE':
      return '$$$ · Caro';
    case 'PRICE_LEVEL_VERY_EXPENSIVE':
      return '$$$$ · Muito caro';
    default:
      return 'Faixa não informada';
  }
}

export interface RestaurantResultItem {
  id: string;
  nome: string;
  endereco: string;
  nota: number | null;
  avaliacoes: number | null;
  faixaPreco: string;
  distanciaKm: number;
  abertoAgora: boolean | null;
  horarioInfo?: string;
  culinaria?: string;
  goodForChildren: boolean | null;
  menuForChildren: boolean | null;
  espacoKids: boolean | null;
  googleMapsUrl: string;
}

async function geocodeCityNominatim(
  city: string
): Promise<{ lat: number; lng: number; label: string }> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=pt-BR&q=${encodeURIComponent(
    city
  )}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'AgenteDeViagemApp/1.0 (contato@agentedeviagem.app)',
    },
  });
  if (!res.ok) {
    throw new Error('Não foi possível localizar a cidade informada.');
  }
  const data = (await res.json()) as Array<{
    lat?: string;
    lon?: string;
    display_name?: string;
  }>;
  if (!Array.isArray(data) || data.length === 0 || !data[0].lat || !data[0].lon) {
    throw new Error(`Não encontramos a cidade "${city}". Tente digitar cidade e estado/país.`);
  }
  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    label: String(data[0].display_name || city),
  };
}

async function searchGooglePlacesNearby(params: {
  lat: number;
  lng: number;
  radiusMeters: number;
  apiKey: string;
}): Promise<{ places: RestaurantResultItem[]; quotaExceeded?: boolean }> {
  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': params.apiKey,
      'X-Goog-Maps-Solution-ID': 'gmp_mcp_codeassist_v1_aistudio',
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.regularOpeningHours,places.googleMapsUri,places.primaryTypeDisplayName,places.goodForChildren,places.menuForChildren',
    },
    body: JSON.stringify({
      includedTypes: ['restaurant'],
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      languageCode: 'pt-BR',
      locationRestriction: {
        circle: {
          center: {
            latitude: params.lat,
            longitude: params.lng,
          },
          radius: params.radiusMeters,
        },
      },
    }),
  });

  if (res.status === 429) {
    return { places: [], quotaExceeded: true };
  }

  const payload = (await res.json().catch(() => ({}))) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      formattedAddress?: string;
      location?: { latitude?: number; longitude?: number };
      rating?: number;
      userRatingCount?: number;
      priceLevel?: string;
      currentOpeningHours?: { openNow?: boolean };
      regularOpeningHours?: { openNow?: boolean };
      googleMapsUri?: string;
      primaryTypeDisplayName?: { text?: string };
      goodForChildren?: boolean;
      menuForChildren?: boolean;
    }>;
    error?: { status?: string; message?: string };
  };

  if (payload?.error?.status === 'RESOURCE_EXHAUSTED') {
    return { places: [], quotaExceeded: true };
  }

  if (!res.ok) {
    throw new Error(payload?.error?.message || 'Falha na consulta à Google Places API (New).');
  }

  const rawPlaces = Array.isArray(payload.places) ? payload.places : [];
  const filtered: RestaurantResultItem[] = [];

  for (const p of rawPlaces) {
    if (!p.id || !p.displayName?.text) continue;
    const openNow =
      p.currentOpeningHours?.openNow ?? p.regularOpeningHours?.openNow ?? null;
    // Filter openNow when opening hours are reported
    if (openNow === false) continue;

    const rating = typeof p.rating === 'number' ? p.rating : 0;
    const count = typeof p.userRatingCount === 'number' ? p.userRatingCount : 0;

    // Filter by minimum rating 4.2 and at least 50 reviews
    if (rating < 4.2 || count < 50) continue;

    const pLat = Number(p.location?.latitude ?? params.lat);
    const pLng = Number(p.location?.longitude ?? params.lng);
    const dist = haversineKm(params.lat, params.lng, pLat, pLng);

    const mapsUrl =
      p.googleMapsUri ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        p.displayName.text
      )}&query_place_id=${encodeURIComponent(p.id)}`;

    filtered.push({
      id: p.id,
      nome: p.displayName.text,
      endereco: p.formattedAddress || '',
      nota: rating,
      avaliacoes: count,
      faixaPreco: formatPriceLevel(p.priceLevel),
      distanciaKm: dist,
      abertoAgora: openNow ?? true,
      culinaria: p.primaryTypeDisplayName?.text || undefined,
      goodForChildren: typeof p.goodForChildren === 'boolean' ? p.goodForChildren : null,
      menuForChildren: typeof p.menuForChildren === 'boolean' ? p.menuForChildren : null,
      espacoKids: null,
      googleMapsUrl: mapsUrl,
    });
  }

  return { places: filtered };
}

function parseOsmBoolean(val?: string): boolean | null {
  if (!val) return null;
  const clean = val.toLowerCase().trim();
  if (clean === 'yes' || clean === 'true' || clean === 'only' || clean === 'designated') {
    return true;
  }
  if (clean === 'no' || clean === 'false') {
    return false;
  }
  return null;
}

async function searchOpenStreetMapNearby(params: {
  lat: number;
  lng: number;
  radiusMeters: number;
}): Promise<RestaurantResultItem[]> {
  const query = `[out:json][timeout:18];(node["amenity"="restaurant"](around:${params.radiusMeters},${params.lat},${params.lng});way["amenity"="restaurant"](around:${params.radiusMeters},${params.lat},${params.lng}););out center 45;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  interface OverpassElement {
    type: string;
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
  }

  let elements: OverpassElement[] | null = null;

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent': 'AgenteDeViagemApp/1.0',
        },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { elements?: OverpassElement[] };
      if (Array.isArray(data.elements)) {
        elements = data.elements;
        break;
      }
    } catch {
      // try next mirror
    }
  }

  if (!elements) {
    throw new Error('Serviço gratuito de mapas indisponível no momento. Tente novamente em instantes.');
  }

  const elementList: OverpassElement[] = elements;
  const seenNames = new Set<string>();
  const results: Array<RestaurantResultItem & { score: number }> = [];

  for (const el of elementList) {
    const tags = el.tags || {};
    const nome = (tags.name || tags['name:pt'] || '').trim();
    if (!nome || !el.id) continue;

    const rLat = typeof el.lat === 'number' ? el.lat : el.center?.lat;
    const rLng = typeof el.lon === 'number' ? el.lon : el.center?.lon;
    if (typeof rLat !== 'number' || typeof rLng !== 'number') continue;

    const dedupeKey = `${nome.toLowerCase()}_${Math.round(rLat * 100)}_${Math.round(rLng * 100)}`;
    if (seenNames.has(dedupeKey)) continue;
    seenNames.add(dedupeKey);

    const rua = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
    const bairro = tags['addr:suburb'] || tags['addr:neighbourhood'] || tags['addr:city'] || '';
    const endereco = [rua, bairro].filter(Boolean).join(' — ') || 'Endereço no Google Maps';
    const culinariaRaw = tags.cuisine ? tags.cuisine.replace(/;/g, ', ').replace(/_/g, ' ') : '';
    const horario = tags.opening_hours || '';
    const dist = haversineKm(params.lat, params.lng, rLat, rLng);

    const espacoKids =
      parseOsmBoolean(tags.kids_area) ??
      parseOsmBoolean(tags['kids_area:indoor']) ??
      parseOsmBoolean(tags['kids_area:outdoor']) ??
      parseOsmBoolean(tags.playground) ??
      null;

    const menuForChildren =
      parseOsmBoolean(tags['diet:kids']) ??
      parseOsmBoolean(tags.kids_menu) ??
      parseOsmBoolean(tags['menu:kids']) ??
      null;

    const goodForChildren =
      parseOsmBoolean(tags.children) ??
      parseOsmBoolean(tags.family) ??
      parseOsmBoolean(tags.highchair) ??
      (espacoKids === true || menuForChildren === true ? true : null);

    // Score by metadata richness so well-documented popular restaurants rank first
    let score = 0;
    if (tags.website || tags['contact:website']) score += 3;
    if (tags.phone || tags['contact:phone']) score += 2;
    if (tags.opening_hours) score += 3;
    if (tags.cuisine) score += 2;
    if (tags['addr:street']) score += 2;
    if (tags.wikidata || tags.wikipedia) score += 3;
    if (goodForChildren === true || menuForChildren === true || espacoKids === true) score += 2;

    const queryMaps = `${nome} ${rua || bairro || `${rLat},${rLng}`}`.trim();
    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      queryMaps
    )}`;

    results.push({
      id: `osm_${el.type}_${el.id}`,
      nome,
      endereco,
      nota: null,
      avaliacoes: null,
      faixaPreco: 'Consultar no Google Maps',
      distanciaKm: dist,
      abertoAgora: null,
      horarioInfo: horario || undefined,
      culinaria: culinariaRaw || undefined,
      goodForChildren,
      menuForChildren,
      espacoKids,
      googleMapsUrl,
      score,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.distanciaKm - b.distanciaKm;
  });

  return results.slice(0, 20).map(({ score: _score, ...rest }) => rest);
}

export default async function placesHandler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido.' });
    return;
  }

  // Verify Firebase ID token so only logged-in users can query
  const authHeader = String(req.headers?.authorization || req.headers?.Authorization || '');
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Não autorizado. Faça login com o Google.' });
    return;
  }

  const idToken = authHeader.slice('Bearer '.length).trim();
  try {
    await verifyFirebaseIdToken(idToken);
  } catch {
    res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const allowedRadii = [1, 3, 5, 10];
    const radiusKm = allowedRadii.includes(Number(body.radiusKm)) ? Number(body.radiusKm) : 3;
    const radiusMeters = radiusKm * 1000;

    let lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
    let lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
    let locationLabel = 'Sua localização atual';

    const cityInput = typeof body.city === 'string' ? body.city.trim() : '';

    if ((lat === null || lng === null) && !cityInput) {
      res.status(400).json({
        error: 'Permita o uso da localização ou digite o nome de uma cidade para buscar.',
      });
      return;
    }

    if (cityInput && (lat === null || lng === null)) {
      const geo = await geocodeCityNominatim(cityInput);
      lat = geo.lat;
      lng = geo.lng;
      locationLabel = geo.label;
    }

    if (lat === null || lng === null) {
      res.status(400).json({
        error: 'Coordenadas inválidas. Digite o nome de uma cidade.',
      });
      return;
    }

    const googleApiKey = (
      process.env.GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_PLACES_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      ''
    ).trim();

    // Hybrid Mode: If Google Places API key is configured in server environment, use Google Places API (New) first
    if (googleApiKey && !googleApiKey.startsWith('MY_')) {
      try {
        const gResult = await searchGooglePlacesNearby({
          lat,
          lng,
          radiusMeters,
          apiKey: googleApiKey,
        });
        if (gResult.quotaExceeded) {
          res.status(429).json({
            error: 'Limite de cota da Google Places API atingido.',
            quotaExceeded: true,
          });
          return;
        }
        res.status(200).json({
          source: 'google_places',
          location: { lat, lng, label: locationLabel, radiusKm },
          places: gResult.places,
        });
        return;
      } catch (gErr) {
        console.warn(
          'Google Places API failed, falling back to free OpenStreetMap:',
          gErr instanceof Error ? gErr.message : gErr
        );
      }
    }

    // Free Default Mode: OpenStreetMap (Overpass API)
    const osmPlaces = await searchOpenStreetMapNearby({
      lat,
      lng,
      radiusMeters,
    });

    res.status(200).json({
      source: 'openstreetmap',
      location: { lat, lng, label: locationLabel, radiusKm },
      places: osmPlaces,
    });
  } catch (err) {
    console.error('Places API error:', err);
    res.status(500).json({
      error:
        err instanceof Error
          ? err.message
          : 'Não foi possível buscar os restaurantes agora. Tente novamente em instantes.',
    });
  }
}
