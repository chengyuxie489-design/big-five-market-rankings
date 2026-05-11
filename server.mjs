import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const API_BASE = "https://transfermarkt-api.fly.dev";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30 * 60 * 1000);
const PROFILE_LIMIT_OVERALL = Number(process.env.PROFILE_LIMIT_OVERALL || 60);
const PROFILE_LIMIT_LEAGUE = Number(process.env.PROFILE_LIMIT_LEAGUE || 40);
const CLUB_LIMIT_PER_LEAGUE = Number(process.env.CLUB_LIMIT_PER_LEAGUE || 8);

const leagues = [
  { id: "GB1", name: "Premier League", nameZh: "英超", country: "England", accent: "#31d7a6" },
  { id: "ES1", name: "LaLiga", nameZh: "西甲", country: "Spain", accent: "#f7cf46" },
  { id: "L1", name: "Bundesliga", nameZh: "德甲", country: "Germany", accent: "#ff4d5f" },
  { id: "IT1", name: "Serie A", nameZh: "意甲", country: "Italy", accent: "#4aa3ff" },
  { id: "FR1", name: "Ligue 1", nameZh: "法甲", country: "France", accent: "#c7f000" }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

let cache = {
  value: null,
  fetchedAt: 0,
  pending: null,
  lastError: null
};
const profileCache = new Map();

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function fetchJson(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "BigFiveMarketRankings/1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return response.json();
}

function formatClubName(name) {
  return name
    .replace("FC Internazionale", "Inter")
    .replace("Manchester City", "Man City")
    .replace("Manchester United", "Man United")
    .replace("Tottenham Hotspur", "Tottenham");
}

function normalizePlayer(player, club, league) {
  return {
    id: String(player.id),
    name: player.name,
    club: formatClubName(club.name),
    clubId: String(club.id),
    league: league.id,
    leagueName: league.name,
    leagueNameZh: league.nameZh,
    country: league.country,
    position: player.position || "Unknown",
    age: player.age ?? null,
    nationality: Array.isArray(player.nationality) ? player.nationality : [],
    marketValue: Number(player.marketValue || 0),
    imageUrl: null,
    profileUrl: `https://www.transfermarkt.com/-/profil/spieler/${player.id}`
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function loadLeague(league) {
  const clubsPayload = await fetchJson(`/competitions/${league.id}/clubs`);
  const clubs = (clubsPayload.clubs || []).slice(0, CLUB_LIMIT_PER_LEAGUE);
  const playerGroups = await mapLimit(clubs, 4, async (club) => {
    try {
      const payload = await fetchJson(`/clubs/${club.id}/players`);
      return (payload.players || []).map((player) => normalizePlayer(player, club, league));
    } catch (error) {
      return [];
    }
  });

  return {
    ...league,
    sourceUpdatedAt: clubsPayload.updatedAt,
    players: playerGroups.flat().filter((player) => player.marketValue > 0)
  };
}

async function enrichProfiles(players) {
  await mapLimit(players, 6, async (player) => {
    await applyProfile(player);
    return player;
  });
}

async function getProfile(playerId) {
  if (profileCache.has(playerId)) return profileCache.get(playerId);
  const profile = await fetchJson(`/players/${playerId}/profile`);
  const value = {
    id: String(playerId),
    imageUrl: profile.imageUrl || null,
    profileUrl: profile.url || `https://www.transfermarkt.com/-/profil/spieler/${playerId}`,
    position: profile.position?.main || null,
    shirtNumber: profile.shirtNumber || null,
    updatedAt: profile.updatedAt || null
  };
  profileCache.set(playerId, value);
  return value;
}

async function applyProfile(player) {
  try {
    const profile = await getProfile(player.id);
    player.imageUrl = profile.imageUrl;
    player.profileUrl = profile.profileUrl;
    player.shirtNumber = profile.shirtNumber;
    if (profile.position) player.position = profile.position;
  } catch {
    player.imageUrl = null;
  }
}

function addRanks(players) {
  players.sort((a, b) => b.marketValue - a.marketValue || a.name.localeCompare(b.name));
  players.forEach((player, index) => {
    player.rank = index + 1;
  });
  return players;
}

async function buildRankings() {
  const loadedLeagues = await mapLimit(leagues, 2, loadLeague);
  const allPlayers = loadedLeagues.flatMap((league) => league.players);
  addRanks(allPlayers);
  loadedLeagues.forEach((league) => addRanks(league.players));

  const profileMap = new Map();
  allPlayers.slice(0, PROFILE_LIMIT_OVERALL).forEach((player) => profileMap.set(player.id, player));
  loadedLeagues.forEach((league) => {
    league.players.slice(0, PROFILE_LIMIT_LEAGUE).forEach((player) => profileMap.set(player.id, player));
  });
  await enrichProfiles([...profileMap.values()]);

  const refreshedAt = new Date().toISOString();
  return {
    refreshedAt,
    cacheTtlMs: CACHE_TTL_MS,
    source: {
      name: "Transfermarkt API",
      url: API_BASE,
      note: "Market values and portraits are fetched from a Transfermarkt data API and cached server-side."
    },
    leagues: loadedLeagues.map((league) => ({
      id: league.id,
      name: league.name,
      nameZh: league.nameZh,
      country: league.country,
      accent: league.accent,
      sourceUpdatedAt: league.sourceUpdatedAt,
      playerCount: league.players.length,
      totalMarketValue: league.players.reduce((sum, player) => sum + player.marketValue, 0),
      players: league.players
    })),
    overall: allPlayers
  };
}

async function getRankings(force = false) {
  const isFresh = cache.value && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (!force && isFresh) return cache.value;
  if (!cache.pending) {
    cache.pending = buildRankings()
      .then((value) => {
        cache.value = value;
        cache.fetchedAt = Date.now();
        cache.lastError = null;
        return value;
      })
      .catch((error) => {
        cache.lastError = error.message;
        if (cache.value) return cache.value;
        throw error;
      })
      .finally(() => {
        cache.pending = null;
      });
  }
  return cache.pending;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    const type = mimeTypes[extname(filePath)] || "application/octet-stream";
    const shouldRevalidate = type.includes("html") || type.includes("css") || type.includes("javascript");
    res.writeHead(200, {
      "Content-Type": type,
      "Cache-Control": shouldRevalidate ? "no-cache" : "public, max-age=3600"
    });
    res.end(body);
  } catch {
    const body = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(body);
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/rankings") {
      const data = await getRankings(url.searchParams.get("refresh") === "1");
      json(res, 200, { ...data, stale: Boolean(cache.lastError), lastError: cache.lastError });
      return;
    }
    const profileMatch = url.pathname.match(/^\/api\/players\/([^/]+)\/profile$/);
    if (profileMatch) {
      const profile = await getProfile(profileMatch[1]);
      json(res, 200, profile);
      return;
    }
    if (url.pathname === "/health") {
      json(res, 200, { ok: true, hasCache: Boolean(cache.value) });
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    json(res, 500, { error: error.message || "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Big Five Market Rankings running on http://localhost:${PORT}`);
});
