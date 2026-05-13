const translations = {
  zh: {
    brand: "五大联赛身价榜",
    eyebrow: "Transfermarkt 实时数据",
    headline: "欧洲五大联赛球员身价排行榜",
    subhead: "聚合英超、西甲、德甲、意甲、法甲本赛季球员德转身价，支持总榜和联赛内榜单切换。",
    searchLabel: "搜索",
    searchPlaceholder: "球员 / 俱乐部 / 位置",
    limitLabel: "显示",
    rankingEyebrow: "Ranking",
    rank: "排名",
    player: "球员",
    club: "俱乐部",
    league: "联赛",
    position: "位置",
    age: "年龄",
    value: "身价",
    overall: "总榜",
    overallTitle: "总身价排行榜",
    visible: "显示 {count} 名",
    updated: "更新于 {time}",
    source: "数据源：Transfermarkt API，每 30 分钟自动刷新",
    loading: "正在加载实时榜单...",
    empty: "没有匹配的球员",
    error: "数据加载失败，请稍后重试",
    players: "{count} 名球员",
    total: "总身价",
    snapshotPlayers: "快照 Top {count}",
    snapshotTotal: "Top {count} 身价合计",
    staleSource: "实时源暂不可用，正在显示最近成功缓存"
  },
  en: {
    brand: "Big Five Value Board",
    eyebrow: "Live Transfermarkt Data",
    headline: "Europe's Big Five Market Value Rankings",
    subhead:
      "Current player market values across the Premier League, LaLiga, Bundesliga, Serie A and Ligue 1, with overall and league-specific boards.",
    searchLabel: "Search",
    searchPlaceholder: "Player / club / position",
    limitLabel: "Show",
    rankingEyebrow: "Ranking",
    rank: "Rank",
    player: "Player",
    club: "Club",
    league: "League",
    position: "Position",
    age: "Age",
    value: "Value",
    overall: "Overall",
    overallTitle: "Overall Market Value Ranking",
    visible: "{count} shown",
    updated: "Updated {time}",
    source: "Source: Transfermarkt API, refreshed automatically every 30 minutes",
    loading: "Loading live rankings...",
    empty: "No matching players",
    error: "Could not load data. Please try again later.",
    players: "{count} players",
    total: "Squad value",
    snapshotPlayers: "Snapshot top {count}",
    snapshotTotal: "Top {count} value",
    staleSource: "Live source is unavailable; showing the last successful cache"
  }
};

const state = {
  lang: localStorage.getItem("lang") || "zh",
  data: null,
  active: "overall",
  query: "",
  limit: "40"
};

const leagueLogos = {
  GB1: "https://r2.thesportsdb.com/images/media/league/logo/4c377s1535214890.png",
  ES1: "https://r2.thesportsdb.com/images/media/league/logo/gq4b1r1687707889.png",
  L1: "https://r2.thesportsdb.com/images/media/league/logo/620ayu1534764709.png",
  IT1: "https://r2.thesportsdb.com/images/media/league/logo/b0hv7o1719640507.png",
  FR1: "https://r2.thesportsdb.com/images/media/league/logo/pp71fp1719637991.png"
};

const leagueLogoFallback = {
  GB1: "PL",
  ES1: "LL",
  L1: "BL",
  IT1: "SA",
  FR1: "L1"
};

const els = {
  leagueSummary: document.querySelector("#leagueSummary"),
  tabs: document.querySelector("#tabs"),
  searchInput: document.querySelector("#searchInput"),
  limitSelect: document.querySelector("#limitSelect"),
  updatedAt: document.querySelector("#updatedAt"),
  sourceNote: document.querySelector("#sourceNote"),
  rankingTitle: document.querySelector("#rankingTitle"),
  visibleCount: document.querySelector("#visibleCount"),
  body: document.querySelector("#rankingBody"),
  rowTemplate: document.querySelector("#playerRowTemplate"),
  refreshButton: document.querySelector("#refreshButton")
};

function t(key, params = {}) {
  let value = translations[state.lang][key] || translations.en[key] || key;
  for (const [name, replacement] of Object.entries(params)) {
    value = value.replace(`{${name}}`, replacement);
  }
  return value;
}

function formatValue(value) {
  if (!value) return "-";
  const locale = state.lang === "zh" ? "zh-CN" : "en-US";
  if (value >= 1_000_000_000) {
    return `€${(value / 1_000_000_000).toLocaleString(locale, { maximumFractionDigits: 2 })}bn`;
  }
  return `€${(value / 1_000_000).toLocaleString(locale, { maximumFractionDigits: 1 })}m`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(state.lang === "zh" ? "zh-CN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function leagueLabel(league) {
  return state.lang === "zh" ? league.nameZh : league.name;
}

function applyTranslations() {
  document.documentElement.lang = state.lang === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  els.searchInput.placeholder = t("searchPlaceholder");
  document.querySelectorAll(".lang-option").forEach((button) => {
    button.classList.toggle("active", button.dataset.lang === state.lang);
  });
}

function getActivePlayers() {
  if (!state.data) return [];
  const players =
    state.active === "overall"
      ? state.data.overall
      : state.data.leagues.find((league) => league.id === state.active)?.players || [];
  const query = state.query.trim().toLowerCase();
  let filtered = query
    ? players.filter((player) =>
        [player.name, player.club, player.position, player.leagueName, player.leagueNameZh]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(query))
      )
    : players;
  if (state.limit !== "all") filtered = filtered.slice(0, Number(state.limit));
  return filtered;
}

function renderSummary() {
  if (!state.data) return;
  els.leagueSummary.replaceChildren(
    ...state.data.leagues.map((league) => {
      const card = document.createElement("article");
      card.className = `league-card league-card-${league.id.toLowerCase()}`;
      card.style.setProperty("--accent", league.accent);
      card.innerHTML = `
        <div class="league-card-top">
          <strong>${leagueLabel(league)}</strong>
          <span class="league-logo-tile" aria-hidden="true">
            <img class="league-logo" src="${leagueLogos[league.id]}" alt="" onerror="this.hidden=true; this.nextElementSibling.style.display='block';" />
            <span class="league-logo-fallback">${leagueLogoFallback[league.id] || league.id}</span>
          </span>
        </div>
        <span>${
          league.isFallback
            ? `${t("snapshotPlayers", { count: league.playerCount })} · ${t("snapshotTotal", { count: league.playerCount })}`
            : `${t("players", { count: league.playerCount })} · ${t("total")}`
        }</span>
        <b>${formatValue(league.totalMarketValue)}</b>
      `;
      return card;
    })
  );
}

function renderTabs() {
  if (!state.data) return;
  const items = [{ id: "overall", label: t("overall") }, ...state.data.leagues.map((league) => ({ id: league.id, label: leagueLabel(league) }))];
  els.tabs.replaceChildren(
    ...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.label;
      button.className = item.id === state.active ? "active" : "";
      button.addEventListener("click", () => {
        state.active = item.id;
        render();
      });
      return button;
    })
  );
}

function renderRows() {
  const players = getActivePlayers();
  els.visibleCount.textContent = t("visible", { count: players.length });
  const rankField = state.active === "overall" ? "overallRank" : "leagueRank";

  if (!players.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-state">${t("empty")}</td>`;
    els.body.replaceChildren(row);
    return;
  }

  const rows = players.map((player) => {
    const row = els.rowTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector(".rank-cell").textContent = `#${player[rankField]}`;
    const link = row.querySelector(".player-cell");
    link.href = player.profileUrl;
    const image = row.querySelector("img");
    image.src = player.imageUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(player.name)}&background=1d2633&color=f6f8fb&size=128`;
    image.alt = player.name;
    if (!player.imageUrl) {
      image.dataset.playerId = player.profilePlayerId || player.id;
      image.dataset.profilePending = "1";
    }
    row.querySelector("strong").textContent = player.name;
    row.querySelector("small").textContent = player.nationality?.slice(0, 2).join(" / ") || "";
    row.querySelector(".club-cell").textContent = player.club;
    row.querySelector(".league-cell").textContent = state.lang === "zh" ? player.leagueNameZh : player.leagueName;
    row.querySelector(".position-cell").textContent = player.position;
    row.querySelector(".age-cell").textContent = player.age ?? "-";
    row.querySelector(".value-cell").textContent = formatValue(player.marketValue);
    return row;
  });
  els.body.replaceChildren(...rows);
  hydrateVisiblePortraits();
}

function hydrateVisiblePortraits() {
  const images = [...document.querySelectorAll("img[data-profile-pending='1']")];
  if (!images.length) return;
  const loadProfile = async (image) => {
    const id = image.dataset.playerId;
    if (!id || image.dataset.profilePending !== "1") return;
    image.dataset.profilePending = "loading";
    try {
      const response = await fetch(`/api/players/${id}/profile`);
      if (!response.ok) throw new Error("profile failed");
      const profile = await response.json();
      if (profile.imageUrl) image.src = profile.imageUrl;
      const link = image.closest("a");
      if (link && profile.profileUrl) link.href = profile.profileUrl;
    } catch {
      image.dataset.profilePending = "failed";
    }
  };

  if (!("IntersectionObserver" in window)) {
    images.slice(0, 20).forEach(loadProfile);
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          observer.unobserve(entry.target);
          loadProfile(entry.target);
        }
      });
    },
    { rootMargin: "240px" }
  );
  images.forEach((image) => observer.observe(image));
}

function renderMeta() {
  if (!state.data) return;
  els.updatedAt.textContent = state.data.liveSourceUnavailable
    ? `${t("updated", { time: formatDate(state.data.refreshedAt) })} · ${t("staleSource")}`
    : t("updated", { time: formatDate(state.data.refreshedAt) });
  els.sourceNote.textContent = t("source");
}

function renderTitle() {
  if (!state.data) return;
  if (state.active === "overall") {
    els.rankingTitle.textContent = t("overallTitle");
    return;
  }
  const league = state.data.leagues.find((item) => item.id === state.active);
  els.rankingTitle.textContent = `${leagueLabel(league)} ${state.lang === "zh" ? "身价排行榜" : "Market Value Ranking"}`;
}

function render() {
  applyTranslations();
  renderSummary();
  renderTabs();
  renderTitle();
  renderRows();
  renderMeta();
}

async function loadData(force = false) {
  els.refreshButton.disabled = true;
  els.updatedAt.textContent = t("loading");
  const response = await fetch(`/api/rankings${force ? "?refresh=1" : ""}`);
  if (!response.ok) throw new Error("Request failed");
  state.data = await response.json();
  els.refreshButton.disabled = false;
  render();
}

document.querySelectorAll(".lang-option").forEach((button) => {
  button.addEventListener("click", () => {
    state.lang = button.dataset.lang;
    localStorage.setItem("lang", state.lang);
    render();
  });
});

els.searchInput.addEventListener("input", (event) => {
  state.query = event.target.value;
  renderRows();
});

els.limitSelect.addEventListener("change", (event) => {
  state.limit = event.target.value;
  renderRows();
});

els.refreshButton.addEventListener("click", () => {
  loadData(true).catch(() => {
    els.updatedAt.textContent = t("error");
    els.refreshButton.disabled = false;
  });
});

applyTranslations();
loadData().catch(() => {
  els.updatedAt.textContent = t("error");
  els.refreshButton.disabled = false;
});
