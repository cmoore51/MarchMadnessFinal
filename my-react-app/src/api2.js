import { ROUND_LABELS } from './constants';
import { storage } from './storage';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://basketapi1.p.rapidapi.com/api/basketball';
const RAPID_HEADERS = {
  'X-RapidAPI-Key':  import.meta.env.VITE_RAPID_API_KEY,
  'X-RapidAPI-Host': 'basketapi1.p.rapidapi.com',
};

const TOURNAMENT_ID = 13434;
const YEAR          = 2026;

// Cache TTLs
const RAPID_TTL   = 60 * 1000;
const ESPN_TTL    = 2 * 60 * 1000;

const MAX_PARALLEL = 8;

const SEED_ORDER = [1, 8, 5, 4, 6, 3, 7, 2];

let fetchPromise = null;

// ─── Persistent spread store ──────────────────────────────────────────────────
// Stores ESPN-sourced spreads keyed by ESPN game ID.
// Write-only — once saved, never overwritten with null.

const SPREAD_STORE_KEY = `espn_spreads_${YEAR}`;
let _spreadStore = null;

async function loadSpreadStore() {
  if (_spreadStore) return _spreadStore;
  try {
    const res = await storage.get(SPREAD_STORE_KEY);
    if (res != null) {
      // Handle both raw object (Supabase JSONB) and legacy string
      _spreadStore = typeof res === 'string' ? JSON.parse(res) : res;
      // Safety: must be a plain object
      if (typeof _spreadStore !== 'object' || Array.isArray(_spreadStore)) _spreadStore = {};
    } else {
      _spreadStore = {};
    }
  } catch {
    _spreadStore = {};
  }
  return _spreadStore;
}

// In saveSpread, also save under stable key
async function saveSpread(espnId, spread, stableKey = null) {
  if (!espnId || spread == null) return;
  const store = await loadSpreadStore();
  let changed = false;
  if (store[espnId] !== spread) { store[espnId] = spread; changed = true; }
  if (stableKey && store[stableKey] !== spread) { store[stableKey] = spread; changed = true; }
  if (!changed) return;
  try { await storage.set(SPREAD_STORE_KEY, store); } 
  catch (e) { console.warn('Spread store save failed:', e.message); }
}

// In getStoredSpread, accept either key
async function getStoredSpread(espnId, stableKey = null) {
  const store = await loadSpreadStore();
  return store[espnId] ?? (stableKey ? store[stableKey] : null) ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function dayKey(d) {
  return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2,'0')}_${String(d.getDate()).padStart(2,'0')}`;
}

async function pLimit(tasks, limit) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch   = tasks.slice(i, i + limit).map(fn => fn());
    const settled = await Promise.allSettled(batch);
    results.push(...settled.map(r => r.status === 'fulfilled' ? r.value : null));
    if (i + limit < tasks.length) await sleep(1100);
  }
  return results;
}

// ─── Storage helpers ──────────────────────────────────────────────────────────
// Supabase returns raw JSONB values (objects/arrays/strings), NOT { value: "..." }.
// These helpers normalize reads/writes so nothing else needs to think about it.

function safeParseStorage(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return raw; // already parsed object/array from JSONB
}

function safeParseTimestamp(raw) {
  if (raw == null) return null;
  // Could be a number, a string "1711234567890", or an object if something went wrong
  const n = parseInt(typeof raw === 'object' ? JSON.stringify(raw) : String(raw), 10);
  return isNaN(n) ? null : n;
}

// ─── Date / time formatting ───────────────────────────────────────────────────

function formatGameTime(timestampSec) {
  if (!timestampSec) return null;
  const CDT_OFFSET_MS = -5 * 60 * 60 * 1000;
  const d = new Date(timestampSec * 1000 + CDT_OFFSET_MS);
  const month = d.getUTCMonth() + 1;
  const day   = d.getUTCDate();
  let   hours = d.getUTCHours();
  const mins  = String(d.getUTCMinutes()).padStart(2, '0');
  const ampm  = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${month}/${day} ${hours}:${mins} CDT`;
}

function formatLiveClock(status) {
  if (!status) return 'LIVE';
  const desc = (status.description ?? '').toLowerCase().trim();
  if (desc.includes('halftime') || desc.includes('half time') || desc === 'ht') return 'HALF';
  if (desc.includes('1st half')  || desc === '1h')    return '1st Half';
  if (desc.includes('2nd half')  || desc === '2h')    return '2nd Half';
  if (desc.includes('overtime') || desc.includes('extra time') || desc.includes('aet') || desc === 'ot') return 'OT';
  if (desc.includes('inprogress') || desc.includes('in progress')) return 'LIVE';
  if (desc.length > 0 && desc.length < 25) return status.description.replace(/\b\w/g, c => c.toUpperCase());
  return 'LIVE';
}

async function fetchESPNLiveClock() {
  const today = new Date();
  const ds = today.toISOString().split('T')[0].replace(/-/g, '');
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${ds}&groups=100&limit=50`;
    const data = await fetch(url).then(r => r.json()).catch(() => ({}));
    const clocks = {};
    for (const ev of (data.events ?? [])) {
      const comp = ev.competitions?.[0];
      if (!comp) continue;
      const state = comp.status?.type?.state ?? 'pre';
      if (state !== 'in') continue;
      const clock  = comp.status?.displayClock ?? null;
      const period = comp.status?.period ?? null;
      const desc   = (comp.status?.type?.shortDetail ?? '').toLowerCase();
      if (clock || period) clocks[ev.id] = { clock, period, desc };
    }
    return clocks;
  } catch (e) {
    console.warn('ESPN live clock fetch failed:', e.message);
    return {};
  }
}

function formatESPNLiveClock(clockData) {
  if (!clockData) return 'LIVE';
  const { clock, period, desc } = clockData;
  if (desc && (desc.includes('half') || desc === 'ht')) return 'HALF';
  if (desc && desc.includes('end of')) return desc.replace('end of', 'End of');
  const periodLabel = period === 1 ? '1st' : period === 2 ? '2nd' : period >= 3 ? 'OT' : null;
  if (periodLabel && clock && clock !== '0:00') return `${periodLabel} ${clock}`;
  if (periodLabel) return periodLabel;
  if (clock && clock !== '0:00') return clock;
  return 'LIVE';
}

// ─── RapidAPI ─────────────────────────────────────────────────────────────────

function mapRapidStatus(s) {
  if (!s) return 'pre';
  const type = s.type ?? -99;
  const desc = (s.description ?? '').toLowerCase().trim();
  if (type === 100 || type === 110 || type === 120) return 'post';
  if (desc.includes('ended') || desc.includes('finished') || desc.includes('final') || desc === 'ft' || desc === 'aet') return 'post';
  if (type === 0 || type === -1) return 'pre';
  if (desc.includes('not started') || desc.includes('postponed')) return 'pre';
  return 'in';
}

function shapeRapidGame(g) {
  const status     = mapRapidStatus(g.status);
  const completed  = status === 'post';
  const inProgress = status === 'in';

  const homeScore = g.homeScore?.current ?? g.homeScore?.display ?? null;
  const awayScore = g.awayScore?.current ?? g.awayScore?.display ?? null;
  const homeWon   = completed && homeScore != null && awayScore != null && Number(homeScore) > Number(awayScore);
  const awayWon   = completed && homeScore != null && awayScore != null && Number(awayScore) > Number(homeScore);

  const gameTime     = formatGameTime(g.startTimestamp);
  const liveDetail   = inProgress ? formatLiveClock(g.status) : null;
  const statusDetail = inProgress ? liveDetail : completed ? 'FINAL' : (gameTime ?? '');

  return {
    id:          String(g.id),
    rapidId:     String(g.id),
    source:      'rapidapi',
    round:       g.roundInfo?.round ?? 1,
    region:      null,
    roundLabel:  null,
    completed,
    inProgress,
    statusDetail,
    gameTime,
    liveDetail,
    spread:      null,
    home: {
      id:     String(g.homeTeam?.id ?? ''),
      name:   g.homeTeam?.shortName || g.homeTeam?.name || '',
      abbr:   (g.homeTeam?.nameCode ?? g.homeTeam?.shortName ?? '').toUpperCase(),
      seed:   g.homeTeam?.ranking ?? null,
      score:  homeScore != null ? Number(homeScore) : null,
      winner: homeWon,
    },
    away: {
      id:     String(g.awayTeam?.id ?? ''),
      name:   g.awayTeam?.shortName || g.awayTeam?.name || '',
      abbr:   (g.awayTeam?.nameCode ?? g.awayTeam?.shortName ?? '').toUpperCase(),
      seed:   g.awayTeam?.ranking ?? null,
      score:  awayScore != null ? Number(awayScore) : null,
      winner: awayWon,
    },
  };
}

async function fetchRapidGames() {
  const CACHE_KEY = `rapid_games_${YEAR}`;
  const TS_KEY    = `rapid_ts_${YEAR}`;

  try {
    const [cached, ts] = await Promise.all([storage.get(CACHE_KEY), storage.get(TS_KEY)]);
    const tsVal = safeParseTimestamp(ts);
    if (cached != null && tsVal != null) {
      const age = Date.now() - tsVal;
      if (age < RAPID_TTL) {
        const games = safeParseStorage(cached);
        if (Array.isArray(games)) {
          console.log(`RapidAPI: ${games.length} games from cache (${Math.round(age/1000)}s old)`);
          return games;
        }
      }
    }
  } catch { /* miss */ }

  console.log('RapidAPI: fetching tournament games…');

  const today = new Date();
  const dates = [];
  for (let i = 20; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    if (d >= new Date('2026-03-15')) dates.push(d);
  }

  if (dates.length === 0) return [];

  const fetchDate = (date) => async () => {
    const d = date.getDate(), m = date.getMonth() + 1, y = date.getFullYear();
    try {
      const res = await fetch(`${BASE_URL}/matches/${d}/${m}/${y}`, { headers: RAPID_HEADERS });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.events ?? []).filter(g => g.tournament?.uniqueTournament?.id === TOURNAMENT_ID);
    } catch (e) {
      console.warn(`RapidAPI ${dayKey(date)}:`, e.message);
      return [];
    }
  };

  const results  = await pLimit(dates.map(d => fetchDate(d)), MAX_PARALLEL);
  const rawGames = results.flat().filter(Boolean);

const FIRST_FOUR_TEAMS = new Set([
  'maryland baltimore', 'howard',
  'texas', 'nc state',
  'prairie view', 'lehigh',
  'miami ohio', 'south methodist', 'smu',
]);

// Inside fetchRapidGames .filter() or .map()
const shaped = rawGames.map(shapeRapidGame).filter(g => {
  // 1. Explicit Round 0
  if (g.round === 0) return false;

  const homeSeed = g.home?.seed;
  const awaySeed = g.away?.seed;
  const isSameSeed = homeSeed != null && awaySeed != null && homeSeed === awaySeed;

  if (isSameSeed) {
    // LOGIC FIX: If the game is COMPLETED, we need to know who won 
    // to map them to the Round 1 game. 
    if (g.completed) {
       const winner = g.home.winner ? g.home : g.away;
       // We log this so we know which team is "advancing" from the play-in
       console.log(`First Four Winner: ${winner.name} (Seed ${winner.seed})`);
    }
    return false; // Still filter from the main list so it doesn't show in the bracket
  }
  return true;
});

  if (shaped.length > 0) {
    try {
      // Save raw array — Supabase stores native JSONB
      await Promise.all([
        storage.set(CACHE_KEY, shaped),
        storage.set(TS_KEY,    String(Date.now())),
      ]);
    } catch (e) { console.warn('RapidAPI cache save failed:', e.message); }
  }

  return shaped;
}

// ─── ESPN skeleton ────────────────────────────────────────────────────────────

function parseESPNRound(note = '') {
  if (!note.includes("Men's Basketball Championship")) return null;
  const n = note.toLowerCase();
  if (n.includes('first four'))                                              return 0;
  if (n.includes('first round')    || n.includes('1st round'))              return 1;
  if (n.includes('second round')   || n.includes('2nd round'))              return 2;
  if (n.includes('sweet 16')       || n.includes('regional semifinal'))     return 3;
  if (n.includes('elite eight')    || n.includes('elite 8') || n.includes('regional final')) return 4;
  if (n.includes('final four')     || n.includes('national semifinal'))     return 5;
  if (n.includes('national championship') || /championship\s*game/i.test(n)) return 6;
  return 1;
}

function parseESPNRegion(note = '') {
  for (const r of ['South', 'East', 'West', 'Midwest']) {
    if (note.includes(r)) return r;
  }
  return null;
}

async function fetchESPNSkeleton() {
  const ESPN_CACHE_KEY = `espn_skeleton_${YEAR}`;
  const ESPN_TS_KEY    = `espn_skeleton_ts_${YEAR}`;

  await loadSpreadStore();

  try {
    const [cached, ts] = await Promise.all([storage.get(ESPN_CACHE_KEY), storage.get(ESPN_TS_KEY)]);
    const tsVal = safeParseTimestamp(ts);
    if (cached != null && tsVal != null) {
      const age = Date.now() - tsVal;
      if (age < ESPN_TTL) {
        const skeleton = safeParseStorage(cached);
        if (skeleton && typeof skeleton === 'object' && !Array.isArray(skeleton)) {
          const store = await loadSpreadStore();
          let updated = false;
          for (const entry of Object.values(skeleton)) {
            if (entry.espnId && entry.spread == null) {
              // Try both espnId and stableKey
              const stableKey = entry.stableKey ?? null;
              const stored = store[entry.espnId] ?? (stableKey ? store[stableKey] : null) ?? null;
              if (stored != null) {
                entry.spread = stored;
                updated = true;
              }
            }
          }
          if (updated) {
            storage.set(ESPN_CACHE_KEY, skeleton).catch(() => {});
          }
          console.log(`ESPN skeleton: ${Object.keys(skeleton).length} entries from cache`);
          return skeleton;
        }
      }
    }
  } catch { /* miss */ }

  console.log('ESPN: fetching bracket skeleton…');

  const TOURNAMENT_DATES = [
    '20260319',
    '20260320','20260321','20260322','20260326',
    '20260327','20260328','20260329','20260404',
    '20260406',                     
  ];

  const allEvents = [];
  const seen      = new Set();

  await Promise.all(TOURNAMENT_DATES.map(async ds => {
    try {
      const url  = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${ds}&groups=100&limit=50`;
      const data = await fetch(url).then(r => r.json()).catch(() => ({}));
      for (const ev of (data.events ?? [])) {
        if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
      }
    } catch { /* skip */ }
  }));

  console.log(`ESPN: ${allEvents.length} raw events`);

  const skeleton = {};

  for (const ev of allEvents) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const note  = comp.notes?.[0]?.headline ?? '';
    const round = parseESPNRound(note);
    if (round === null || round === 0) continue;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeSeed = parseInt(home.curatedRank?.current) || parseInt(home.rank) || null;
    const awaySeed = parseInt(away.curatedRank?.current) || parseInt(away.rank) || null;

    const homeAbbr  = (home.team.abbreviation ?? '').toUpperCase();
    const awayAbbr  = (away.team.abbreviation ?? '').toUpperCase();

    const homeName  = home.team.shortDisplayName || home.team.displayName || homeAbbr;
    const awayName  = away.team.shortDisplayName || away.team.displayName || awayAbbr;

    const homeId    = String(home.team.id ?? '');
    const awayId    = String(away.team.id ?? '');

    const region = parseESPNRegion(note)
      ?? (round === 5 ? 'Final Four' : round === 6 ? 'Championship' : null);
    if (!region) continue;

    const homeTBD = !homeId || homeName === 'TBD' || homeName === '' || home.team.id == null;
    const awayTBD = !awayId || awayName === 'TBD' || awayName === '' || away.team.id == null;

    const state      = comp.status?.type?.state ?? 'pre';
    const completed  = state === 'post';
    const inProgress = state === 'in';

    const homeScore = (completed || inProgress) ? (parseInt(home.score) || null) : null;
    const awayScore = (completed || inProgress) ? (parseInt(away.score) || null) : null;

    const espnDate = comp.date ?? ev.date ?? null;
    let gameTime = null;
    if (espnDate) {
      const d = new Date(espnDate);
      if (!isNaN(d)) gameTime = formatGameTime(Math.floor(d.getTime() / 1000));
    }

    // Build stable key from region + round + seeds (survives API source changes)
    const s1 = Math.min(homeSeed ?? 99, awaySeed ?? 99);
    const s2 = Math.max(homeSeed ?? 99, awaySeed ?? 99);
    const stableKey = (region && round && s1 !== 99)
      ? `stable_${region}_r${round}_${s1}v${s2}`
      : null;

    // Spread: read from ESPN odds, persist under both espnId and stableKey,
    // or fall back to stored value via either key
    let spread = null;
    const odds = comp.odds?.[0];

    if (odds) {
      const sp = odds.spread ?? odds.homeTeamOdds?.pointSpread?.alternateDisplayValue;
      if (sp != null) {
        const m = String(sp).match(/([-+]?\d+(\.\d+)?)/);
        if (m) spread = parseFloat(m[1]);
      }
    }
    if (spread != null) {
      saveSpread(ev.id, spread, stableKey); // persist under both keys
    } else {
      spread = await getStoredSpread(ev.id, stableKey); // recover via either key
    }

    const statusDetail = completed ? 'FINAL' : (gameTime ?? '');

    const entry = {
      espnId:      ev.id,
      stableKey,                              // stored on the entry for cache-hit recovery
      round,
      region,
      roundLabel:  ROUND_LABELS[round] ?? `Round ${round}`,
      homeSeed,    awaySeed,
      homeName:    homeTBD ? 'TBD' : homeName,
      awayName:    awayTBD ? 'TBD' : awayName,
      homeAbbr:    homeTBD ? 'TBD' : homeAbbr,
      awayAbbr:    awayTBD ? 'TBD' : awayAbbr,
      homeId:      homeTBD ? null  : homeId,
      awayId:      awayTBD ? null  : awayId,
      gameTime,
      spread,
      completed,
      inProgress,
      homeScore,   awayScore,
      homeWon:     completed && homeScore != null && awayScore != null && homeScore > awayScore,
      awayWon:     completed && homeScore != null && awayScore != null && awayScore > homeScore,
      statusDetail,
    };

    const keys = buildESPNKeys(homeName, homeAbbr, awayName, awayAbbr);
    keys.forEach(k => { skeleton[k] = entry; });
  }

  console.log(`ESPN skeleton: ${Object.keys(skeleton).length} lookup entries`);

  if (Object.keys(skeleton).length > 10) {
    try {
      await Promise.all([
        storage.set(ESPN_CACHE_KEY, skeleton),
        storage.set(ESPN_TS_KEY,    String(Date.now())),
      ]);
    } catch (e) { console.warn('ESPN skeleton cache failed:', e.message); }
  }

  return skeleton;
}

function buildESPNKeys(homeName, homeAbbr, awayName, awayAbbr) {
  const hVariants = [...new Set([norm(homeName), norm(homeAbbr)].filter(Boolean))];
  const aVariants = [...new Set([norm(awayName), norm(awayAbbr)].filter(Boolean))];
  const keys = [];
  for (const h of hVariants) {
    for (const a of aVariants) {
      keys.push(`${h}|||${a}`);
      keys.push(`${a}|||${h}`);
    }
  }
  return keys;
}

// ─── Team name matching ───────────────────────────────────────────────────────

const NAME_ALIASES = {
  'south methodist':    'smu',
  'south. methodist':   'smu',
  'miami ohio':         'miami oh',
  'maryland baltimore': 'umbc',
  'prairie view':       'prairie view',
  'lehigh mountain':    'lehigh',
  'iowa hawkeyes':      'iowa',
  'duke blue devils':   'duke',
  'kansas jayhawks':    'kansas',
  'kentucky wildcats':  'kentucky',
  'michigan wolverines':'michigan',
  'ohio state buckeyes':'ohio state',
  'florida gators':     'florida',
  'alabama crimson':    'alabama',
  'houston cougars':    'houston',
  'gonzaga bulldogs':   'gonzaga',
  'arizona wildcats':   'arizona',
  'baylor bears':       'baylor',
  'villanova wildcats': 'villanova',
  'purdue boilermakers':'purdue',
  'tennessee volunteers':'tennessee',
  'marquette golden':   'marquette',
  'creighton bluejays': 'creighton',
  'san diego st':       'san diego state',
};

function normAlias(s = '') {
  const n = norm(s);
  return NAME_ALIASES[n] ?? n;
}

function teamVariants(name = '', abbr = '') {
  const raw   = norm(name);
  const alias = normAlias(name);
  const ab    = norm(abbr);
  return [...new Set([raw, alias, ab].filter(Boolean))];
}

function oneTeamMatches(variants1, variants2) {
  for (const v1 of variants1) {
    for (const v2 of variants2) {
      if (!v1 || !v2) continue;
      if (v1 === v2) return true;
      if (v1.length >= 4 && v2.length >= 4) {
        const shorter = v1.length <= v2.length ? v1 : v2;
        const longer  = v1.length <= v2.length ? v2 : v1;
        const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|\\s)' + escaped + '(\\s|$)');
        if (re.test(longer)) return true;
      }
    }
  }
  return false;
}

function lookupESPN(rapidGame, skeleton) {
  const hV = teamVariants(rapidGame.home.name, rapidGame.home.abbr);
  const aV = teamVariants(rapidGame.away.name, rapidGame.away.abbr);

  for (const h of hV) {
    for (const a of aV) {
      if (skeleton[`${h}|||${a}`]) return skeleton[`${h}|||${a}`];
      if (skeleton[`${a}|||${h}`]) return skeleton[`${a}|||${h}`];
    }
  }

  const pairKeys = Object.keys(skeleton).filter(k => k.includes('|||'));
  for (const k of pairKeys) {
    const [left, right] = k.split('|||');
    const lV = [left], rV = [right];
    if (oneTeamMatches(hV, lV) && oneTeamMatches(aV, rV)) return skeleton[k];
    if (oneTeamMatches(hV, rV) && oneTeamMatches(aV, lV)) return skeleton[k];
  }

  return null;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

function mergeRapidWithESPN(rapidGames, skeleton, liveClocks = {}) {
  const matchedESPNIds = new Set();
  const enriched       = [];

  for (const rg of rapidGames) {
    const meta = lookupESPN(rg, skeleton);

    if (meta) {
      matchedESPNIds.add(meta.espnId);

      const gameTime = rg.gameTime ?? meta.gameTime;

      const espnClock = rg.inProgress ? liveClocks[meta.espnId] : null;
      const liveLabel = espnClock
        ? formatESPNLiveClock(espnClock)
        : (rg.liveDetail ?? 'LIVE');

      const statusDetail = rg.inProgress
        ? liveLabel
        : rg.completed
          ? 'FINAL'
          : (gameTime ?? '');

      enriched.push({
        ...rg,
        id:          `espn_${meta.espnId}`,
        rapidId:     rg.rapidId,
        source:      'rapidapi',
        round:       meta.round,
        region:      meta.region,
        roundLabel:  meta.roundLabel,
        gameTime,
        statusDetail,
        spread:      meta.spread ?? null,
        home: {
          ...rg.home,
          name: meta.homeName && meta.homeName !== 'TBD' ? meta.homeName : rg.home.name,
          abbr: meta.homeAbbr && meta.homeAbbr !== 'TBD' ? meta.homeAbbr : rg.home.abbr,
          seed: rg.home.seed ?? meta.homeSeed,
          id:   rg.home.id   || meta.homeId || rg.home.id,
        },
        away: {
          ...rg.away,
          name: meta.awayName && meta.awayName !== 'TBD' ? meta.awayName : rg.away.name,
          abbr: meta.awayAbbr && meta.awayAbbr !== 'TBD' ? meta.awayAbbr : rg.away.abbr,
          seed: rg.away.seed ?? meta.awaySeed,
          id:   rg.away.id   || meta.awayId || rg.away.id,
        },
      });
    } else {
      console.warn(`No ESPN match for: ${rg.away.name} vs ${rg.home.name}`);
      enriched.push(rg);
    }
  }

  // Append ESPN-only entries (TBD future slots)
  const espnOnlyEntries = Object.values(skeleton).filter(e =>
    e.espnId && !matchedESPNIds.has(e.espnId)
  );

  const seenEspnIds = new Set();
  for (const e of espnOnlyEntries) {
    if (seenEspnIds.has(e.espnId)) continue;
    seenEspnIds.add(e.espnId);

    enriched.push({
      id:          `espn_${e.espnId}`,
      espnId:      e.espnId,
      source:      'espn',
      round:       e.round,
      region:      e.region,
      roundLabel:  e.roundLabel,
      completed:   e.completed,
      inProgress:  e.inProgress,
      gameTime:    e.gameTime,
      liveDetail:  null,
      statusDetail: e.statusDetail,
      spread:      e.spread,
      home: {
        id:     e.homeId,
        name:   e.homeName,
        abbr:   e.homeAbbr,
        seed:   e.homeSeed,
        score:  e.homeScore,
        winner: e.homeWon,
      },
      away: {
        id:     e.awayId,
        name:   e.awayName,
        abbr:   e.awayAbbr,
        seed:   e.awaySeed,
        score:  e.awayScore,
        winner: e.awayWon,
      },
    });
  }

  const seen = new Set();
  const valid = enriched.filter(g => {
    if (g.round == null || g.region == null) return false;
    const key = g.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const regionOrder = ['South', 'East', 'Midwest', 'West', 'Final Four', 'Championship'];
  valid.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    const ri = r => { const i = regionOrder.indexOf(r); return i < 0 ? 99 : i; };
    if (a.region !== b.region) return ri(a.region) - ri(b.region);
    const prio = s => { const i = SEED_ORDER.indexOf(s ?? 17); return i < 0 ? 99 : i; };
    const aSeed = a.home?.seed ?? a.away?.seed ?? 17;
    const bSeed = b.home?.seed ?? b.away?.seed ?? 17;
    return prio(aSeed) - prio(bSeed);
  });

  return valid;
}

// ─── Main export ──────────────────────────────────────────────────────────────
// Export a map of ESPN teamId → team name, built from the skeleton cache
export async function getESPNTeamNameMap() {
  const skeleton = await fetchESPNSkeleton();
  const map = {}; // espnTeamId → name
  const seen = new Set();
  for (const entry of Object.values(skeleton)) {
    if (seen.has(entry.espnId)) continue;
    seen.add(entry.espnId);
    if (entry.homeId) map[entry.homeId] = entry.homeName;
    if (entry.awayId) map[entry.awayId] = entry.awayName;
  }
  return map;
}

export async function getLiveGames() {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      const [rapidGames, skeleton, liveClocks] = await Promise.all([
        fetchRapidGames().catch(e => {
          console.warn('RapidAPI fetch failed, using ESPN only:', e.message);
          return [];
        }),
        fetchESPNSkeleton(),
        fetchESPNLiveClock(),
      ]);

      const merged = mergeRapidWithESPN(rapidGames, skeleton, liveClocks);

      const completed  = merged.filter(g => g.completed).length;
      const inProgress = merged.filter(g => g.inProgress).length;
      const tbd        = merged.filter(g => !g.home?.id && !g.away?.id).length;
      console.log(`Final: ${merged.length} games | ${completed} completed | ${inProgress} live | ${tbd} TBD`);

      return merged;

    } finally {
      fetchPromise = null;
    }
  })();

  return fetchPromise;
}

// ─── Dev utilities ────────────────────────────────────────────────────────────

export const clearAllCache = async () => {
  const keys = [
    `rapid_games_${YEAR}`,   `rapid_ts_${YEAR}`,
    `espn_skeleton_${YEAR}`, `espn_skeleton_ts_${YEAR}`,
    `espn_spreads_${YEAR}`,
  ];
  await Promise.all(keys.map(k => storage.delete(k).catch(() => {})));
  _spreadStore = null;
  console.log('All cache cleared');
  window.location.reload();
};

export const clearGameCache = async () => {
  await Promise.all([
    storage.delete(`rapid_games_${YEAR}`),
    storage.delete(`rapid_ts_${YEAR}`),
  ]);
  console.log('RapidAPI cache cleared');
  window.location.reload();
};

export const clearESPNMeta = async () => {
  await Promise.all([
    storage.delete(`espn_skeleton_${YEAR}`),
    storage.delete(`espn_skeleton_ts_${YEAR}`),
  ]);
  console.log('ESPN skeleton cache cleared');
  window.location.reload();
};