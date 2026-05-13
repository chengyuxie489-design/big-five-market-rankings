import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(__dirname, "public");
const PORT = Number(process.env.PORT || 3000);
const API_BASE = "https://transfermarkt-api.fly.dev";
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 30 * 60 * 1000);
const PROFILE_LIMIT_OVERALL = Number(process.env.PROFILE_LIMIT_OVERALL || 20);
const PROFILE_LIMIT_LEAGUE = Number(process.env.PROFILE_LIMIT_LEAGUE || 8);
const CLUB_LIMIT_PER_LEAGUE = Number(process.env.CLUB_LIMIT_PER_LEAGUE || 8);
const UPSTREAM_TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

const leagues = [
  { id: "GB1", name: "Premier League", nameZh: "英超", country: "England", accent: "#31d7a6" },
  { id: "ES1", name: "LaLiga", nameZh: "西甲", country: "Spain", accent: "#f7cf46" },
  { id: "L1", name: "Bundesliga", nameZh: "德甲", country: "Germany", accent: "#ff4d5f" },
  { id: "IT1", name: "Serie A", nameZh: "意甲", country: "Italy", accent: "#4aa3ff" },
  { id: "FR1", name: "Ligue 1", nameZh: "法甲", country: "France", accent: "#c7f000" }
];

const fallbackPlayers = {
  GB1: [
    ["418560", "Erling Haaland", "Man City", "Centre-Forward", 25, ["Norway"], 200000000],
    ["581678", "Bukayo Saka", "Arsenal", "Right Winger", 24, ["England"], 150000000],
    ["433177", "Phil Foden", "Man City", "Attacking Midfield", 25, ["England"], 140000000],
    ["406635", "Declan Rice", "Arsenal", "Defensive Midfield", 27, ["England"], 120000000],
    ["401173", "Rodri", "Man City", "Defensive Midfield", 29, ["Spain"], 110000000],
    ["568177", "Cole Palmer", "Chelsea", "Attacking Midfield", 24, ["England"], 110000000],
    ["580195", "Moises Caicedo", "Chelsea", "Defensive Midfield", 24, ["Ecuador"], 90000000],
    ["357565", "Bruno Fernandes", "Man United", "Attacking Midfield", 31, ["Portugal"], 50000000]
  ],
  ES1: [
    ["937958", "Lamine Yamal", "Barcelona", "Right Winger", 18, ["Spain"], 200000000],
    ["342229", "Kylian Mbappé", "Real Madrid", "Centre-Forward", 27, ["France"], 200000000],
    ["683840", "Jude Bellingham", "Real Madrid", "Attacking Midfield", 22, ["England"], 180000000],
    ["937955", "Pedri", "Barcelona", "Central Midfield", 23, ["Spain"], 150000000],
    ["371998", "Vinicius Junior", "Real Madrid", "Left Winger", 25, ["Brazil"], 150000000],
    ["646740", "Federico Valverde", "Real Madrid", "Central Midfield", 27, ["Uruguay"], 130000000],
    ["646740", "Rodrygo", "Real Madrid", "Right Winger", 25, ["Brazil"], 100000000],
    ["580195", "Gavi", "Barcelona", "Central Midfield", 21, ["Spain"], 90000000]
  ],
  L1: [
    ["487969", "Florian Wirtz", "Bayer Leverkusen", "Attacking Midfield", 23, ["Germany"], 140000000],
    ["580195", "Jamal Musiala", "Bayern Munich", "Attacking Midfield", 23, ["Germany"], 140000000],
    ["418560", "Harry Kane", "Bayern Munich", "Centre-Forward", 32, ["England"], 90000000],
    ["475959", "Josko Gvardiol", "RB Leipzig", "Centre-Back", 24, ["Croatia"], 70000000],
    ["598577", "Xavi Simons", "RB Leipzig", "Attacking Midfield", 23, ["Netherlands"], 70000000],
    ["369081", "Michael Olise", "Bayern Munich", "Right Winger", 24, ["France"], 65000000],
    ["418560", "Benjamin Sesko", "RB Leipzig", "Centre-Forward", 22, ["Slovenia"], 65000000],
    ["418560", "Aleksandar Pavlovic", "Bayern Munich", "Defensive Midfield", 22, ["Germany"], 55000000]
  ],
  IT1: [
    ["581678", "Lautaro Martínez", "Inter", "Centre-Forward", 28, ["Argentina"], 95000000],
    ["580195", "Nicolò Barella", "Inter", "Central Midfield", 29, ["Italy"], 80000000],
    ["598577", "Khvicha Kvaratskhelia", "Napoli", "Left Winger", 25, ["Georgia"], 80000000],
    ["580195", "Alessandro Bastoni", "Inter", "Centre-Back", 27, ["Italy"], 75000000],
    ["580195", "Rafael Leão", "AC Milan", "Left Winger", 26, ["Portugal"], 70000000],
    ["580195", "Marcus Thuram", "Inter", "Centre-Forward", 28, ["France"], 65000000],
    ["580195", "Gleison Bremer", "Juventus", "Centre-Back", 29, ["Brazil"], 60000000],
    ["580195", "Kenan Yildiz", "Juventus", "Second Striker", 21, ["Turkey"], 50000000]
  ],
  FR1: [
    ["745648", "João Neves", "Paris Saint-Germain", "Central Midfield", 21, ["Portugal"], 110000000],
    ["576024", "Warren Zaïre-Emery", "Paris Saint-Germain", "Central Midfield", 20, ["France"], 80000000],
    ["576024", "Vitinha", "Paris Saint-Germain", "Central Midfield", 26, ["Portugal"], 80000000],
    ["576024", "Achraf Hakimi", "Paris Saint-Germain", "Right-Back", 27, ["Morocco"], 70000000],
    ["576024", "Bradley Barcola", "Paris Saint-Germain", "Left Winger", 23, ["France"], 70000000],
    ["576024", "Ousmane Dembélé", "Paris Saint-Germain", "Right Winger", 29, ["France"], 60000000],
    ["576024", "Gonçalo Ramos", "Paris Saint-Germain", "Centre-Forward", 24, ["Portugal"], 50000000],
    ["576024", "Nuno Mendes", "Paris Saint-Germain", "Left-Back", 24, ["Portugal"], 55000000]
  ]
};

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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        headers: {
          "Accept": "application/json",
          "User-Agent": "BigFiveMarketRankings/1.0"
        }
      });

      if (response.ok) {
        return response.json();
      }
      lastError = new Error(`${path} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 650 * attempt));
    }
  }

  throw lastError;
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

function buildFallbackLeague(league) {
  return {
    ...league,
    sourceUpdatedAt: new Date("2026-05-11T00:00:00.000Z").toISOString(),
    isFallback: true,
    players: (fallbackPlayers[league.id] || []).map(([id, name, club, position, age, nationality, marketValue], index) => ({
      id: `${id}-${league.id}-${index}`,
      name,
      club,
      clubId: "",
      league: league.id,
      leagueName: league.name,
      leagueNameZh: league.nameZh,
      country: league.country,
      position,
      age,
      nationality,
      marketValue,
      imageUrl: null,
      profileUrl: `https://www.transfermarkt.com/-/profil/spieler/${id}`
    }))
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

function addRanks(players, field) {
  players.sort((a, b) => b.marketValue - a.marketValue || a.name.localeCompare(b.name));
  players.forEach((player, index) => {
    player[field] = index + 1;
  });
  return players;
}

async function buildRankings() {
  const loadedLeagues = await mapLimit(leagues, 2, async (league) => {
    try {
      return await loadLeague(league);
    } catch (error) {
      return {
        ...league,
        sourceUpdatedAt: null,
        loadError: error.message,
        players: []
      };
    }
  });
  const allPlayers = loadedLeagues.flatMap((league) => league.players);
  if (!allPlayers.length) {
    const fallbackLeagues = leagues.map(buildFallbackLeague);
    const fallbackAllPlayers = fallbackLeagues.flatMap((league) => league.players);
    addRanks(fallbackAllPlayers, "overallRank");
    fallbackLeagues.forEach((league) => addRanks(league.players, "leagueRank"));
    return {
      refreshedAt: new Date().toISOString(),
      cacheTtlMs: CACHE_TTL_MS,
      fallback: true,
      source: {
        name: "Cached emergency snapshot",
        url: "https://www.transfermarkt.com",
        note: "Live Transfermarkt API is temporarily unavailable, so an emergency snapshot is shown until the source recovers."
      },
      leagues: fallbackLeagues.map((league) => ({
        id: league.id,
        name: league.name,
        nameZh: league.nameZh,
        country: league.country,
        accent: league.accent,
        sourceUpdatedAt: league.sourceUpdatedAt,
        playerCount: league.players.length,
        totalMarketValue: league.players.reduce((sum, player) => sum + player.marketValue, 0),
        isFallback: true,
        players: league.players
      })),
      overall: fallbackAllPlayers
    };
  }
  addRanks(allPlayers, "overallRank");
  loadedLeagues.forEach((league) => addRanks(league.players, "leagueRank"));

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
