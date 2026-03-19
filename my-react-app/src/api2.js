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
const RAPID_TTL   = 60  * 1000;   // 60s — re-fetch live scores frequently
const ESPN_TTL    = 5 * 60 * 1000; // 5min — bracket skeleton changes rarely

// RapidAPI: 10 req/sec — use max 8 in parallel
const MAX_PARALLEL = 8;

// Standard seed-order for sorting bracket columns
const SEED_ORDER = [1, 8, 5, 4, 6, 3, 7, 2];

let fetchPromise = null;

// ─── Persistent spread store ──────────────────────────────────────────────────
// Spreads are stored separately and NEVER overwritten with null.
// Once a spread is seen for a game it persists across all future fetches,
// even after ESPN removes odds when a game goes live.

const SPREAD_STORE_KEY = `espn_spreads_${YEAR}_v1`;
let _spreadStore = null; // in-memory cache of { espnId: spread }

async function loadSpreadStore() {
  if (_spreadStore) return _spreadStore;
  try {
    const res = await storage.get(SPREAD_STORE_KEY);
    _spreadStore = res?.value ? JSON.parse(res.value) : {};
  } catch {
    _spreadStore = {};
  }
  return _spreadStore;
}

async function saveSpread(espnId, spread) {
  if (!espnId || spread == null) return;
  const store = await loadSpreadStore();
  if (store[espnId] === spread) return; // no change
  store[espnId] = spread;
  try {
    await storage.set(SPREAD_STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Spread store save failed:', e.message);
  }
}

async function getStoredSpread(espnId) {
  const store = await loadSpreadStore();
  return store[espnId] ?? null;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function dayKey(d) {
  return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2,'0')}_${String(d.getDate()).padStart(2,'0')}`;
}

// Parallel fetch with rate-limit cap
async function pLimit(tasks, limit) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch   = tasks.slice(i, i + limit).map(fn => fn());
    const settled = await Promise.allSettled(batch);
    results.push(...settled.map(r => r.status === 'fulfilled' ? r.value : null));
    if (i + limit < tasks.length) await sleep(1100); // stay under 10 req/sec
  }
  return results;
}

// ─── Date / time formatting ───────────────────────────────────────────────────

/**
 * Format a Unix timestamp (seconds) as "M/D h:MMam/pm"
 * e.g. 1742400000 → "3/19 11:30 AM"
 */
function formatGameTime(timestampSec) {
  if (!timestampSec) return null;
  // Convert to CDT (UTC-5). During tournament (March/April) Central is CDT = UTC-5.
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

/**
 * Build a live clock string from RapidAPI status fields.
 * Examples: "H1 14:32", "H2 4:05", "OT 1:12", "HALF"
 */
function formatLiveClock(status) {
  if (!status) return 'LIVE';
  // RapidAPI only gives us description — no period number or clock time
  // e.g. {"code":6,"description":"1st half","type":"inprogress"}
  const desc = (status.description ?? '').toLowerCase().trim();

  if (desc.includes('halftime') || desc.includes('half time') || desc === 'ht') return 'HALF';
  if (desc.includes('1st half')  || desc === '1h')    return '1st Half';
  if (desc.includes('2nd half')  || desc === '2h')    return '2nd Half';
  if (desc.includes('overtime')  || desc.includes('extra time') || desc === 'ot') return 'OT';
  if (desc.includes('inprogress') || desc.includes('in progress')) return 'LIVE';

  // Return the raw description capitalised if it's short and meaningful
  if (desc.length > 0 && desc.length < 25) {
    return status.description.replace(/\b\w/g, c => c.toUpperCase());
  }
  return 'LIVE';
}

// ─── ESPN: Live clock (today only, very fast — 1 request) ───────────────────
// ESPN's scoreboard includes displayClock ("14:32") and period (1/2) for
// in-progress games. We fetch just today's date since that's all we need.
// Returns a map of { espnId → { clock, period } }

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
      if (state !== 'in') continue; // only care about live games
      const clock  = comp.status?.displayClock ?? null;  // e.g. "14:32"
      const period = comp.status?.period ?? null;         // 1 or 2
      const desc   = (comp.status?.type?.shortDetail ?? '').toLowerCase();
      if (clock || period) {
        clocks[ev.id] = { clock, period, desc };
      }
    }
    console.log(`ESPN live clocks: ${Object.keys(clocks).length} in-progress games`);
    return clocks;
  } catch (e) {
    console.warn('ESPN live clock fetch failed:', e.message);
    return {};
  }
}

/**
 * Format ESPN clock + period into a display string like "1st 14:32"
 */
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

// ─── RapidAPI: Primary data source ───────────────────────────────────────────

function mapRapidStatus(s) {
  if (!s) return 'pre';
  const type = s.type ?? -99;
  const desc = (s.description ?? '').toLowerCase();
  if (type === 100 || type === 110)                                return 'post';
  if (desc.includes('ended') || desc.includes('finished')
    || desc.includes('final'))                                     return 'post';
  if (type === 0 || type === -1 || type === 120)                   return 'pre';
  if (desc.includes('not started') || desc.includes('postponed')) return 'pre';
  return 'in';
}

function parseSpread(v) {
  if (v == null) return null;
  const m = String(v).match(/([-+]?\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Shape a raw RapidAPI event into our canonical game object.
 * round/region are filled in later via ESPN enrichment.
 */
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
  // statusDetail: live clock when in-progress, formatted time when scheduled, blank when final
  const statusDetail = inProgress
    ? liveDetail
    : completed
      ? 'FINAL'
      : (gameTime ?? '');

  return {
    id:           String(g.id),
    rapidId:      String(g.id),
    source:       'rapidapi',
    // round/region/roundLabel filled in by ESPN enrichment
    round:        g.roundInfo?.round ?? 1,
    region:       null,
    roundLabel:   null,
    completed,
    inProgress,
    statusDetail,
    gameTime,      // "3/19 11:30 AM" — always set for scheduled/completed
    liveDetail,    // "H2 4:05" — only set when in-progress
    spread:       null, // spread comes from ESPN only
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

/**
 * Fetch all tournament games from RapidAPI for the tournament window.
 * Returns shaped game objects (round/region still null — enriched by ESPN).
 */
async function fetchRapidGames() {
  const CACHE_KEY = `rapid_games_${YEAR}_v5`;
  const TS_KEY    = `rapid_ts_${YEAR}_v5`;

  try {
    const [cached, ts] = await Promise.all([storage.get(CACHE_KEY), storage.get(TS_KEY)]);
    if (cached?.value && ts?.value) {
      const age = Date.now() - parseInt(ts.value, 10);
      if (age < RAPID_TTL) {
        const games = JSON.parse(cached.value);
        console.log(`RapidAPI: ${games.length} games from cache (${Math.round(age/1000)}s old)`);
        return games;
      }
    }
  } catch { /* miss */ }

  console.log('RapidAPI: fetching tournament games…');

  // Fetch the tournament window — past 14 days up to today
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
      return (data.events ?? []).filter(g =>
        g.tournament?.uniqueTournament?.id === TOURNAMENT_ID
      );
    } catch (e) {
      console.warn(`RapidAPI ${dayKey(date)}:`, e.message);
      return [];
    }
  };

  const results  = await pLimit(dates.map(d => fetchDate(d)), MAX_PARALLEL);
  const rawGames = results.flat().filter(Boolean);

  console.log(`RapidAPI: ${rawGames.length} raw events`);

  const shaped = rawGames.map(shapeRapidGame).filter(g => {
    // Filter out First Four play-in games — they aren't in the main bracket
    // First Four: same seed vs same seed (11v11, 16v16) or round 0
    const homeSeed = g.home?.seed;
    const awaySeed = g.away?.seed;
    const isFirstFour = (homeSeed != null && awaySeed != null && homeSeed === awaySeed)
      || g.round === 0;
    if (isFirstFour) console.log(`Filtered First Four: ${g.away.name} vs ${g.home.name}`);
    return !isFirstFour;
  });

  if (shaped.length > 0) {
    try {
      await Promise.all([
        storage.set(CACHE_KEY, JSON.stringify(shaped)),
        storage.set(TS_KEY,    String(Date.now())),
      ]);
    } catch (e) { console.warn('RapidAPI cache save failed:', e.message); }
  }

  return shaped;
}

// ─── ESPN: Bracket skeleton + enrichment ─────────────────────────────────────

function parseESPNRound(note = '') {
  if (!note.includes("Men's Basketball Championship")) return null;
  const n = note.toLowerCase();
  if (n.includes('first four'))                                              return 0;
  if (n.includes('first round')    || n.includes('1st round'))              return 1;
  if (n.includes('second round')   || n.includes('2nd round'))              return 2;
  if (n.includes('sweet 16')       || n.includes('regional semifinal'))     return 3;
  if (n.includes('elite eight')    || n.includes('elite 8')
    || n.includes('regional final'))                                         return 4;
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

/**
 * Fetch ESPN bracket skeleton.
 * Returns a map: normKey → { round, region, roundLabel, homeSeed, awaySeed,
 *                             homeName, awayName, homeId, awayId,
 *                             gameTime, spread, completed, inProgress,
 *                             homeScore, awayScore, homeWon, awayWon, statusDetail }
 * The map key is built from both team names so RapidAPI games can look up their metadata.
 */
async function fetchESPNSkeleton() {
  const ESPN_CACHE_KEY = `espn_skeleton_${YEAR}_v6`;
  const ESPN_TS_KEY    = `espn_skeleton_ts_${YEAR}_v6`;

  // Pre-load the spread store so getStoredSpread() calls below are fast
  await loadSpreadStore();

  try {
    const [cached, ts] = await Promise.all([storage.get(ESPN_CACHE_KEY), storage.get(ESPN_TS_KEY)]);
    if (cached?.value && ts?.value) {
      const age = Date.now() - parseInt(ts.value, 10);
      if (age < ESPN_TTL) {
        const skeleton = JSON.parse(cached.value);
        console.log(`ESPN skeleton: ${Object.keys(skeleton).length} entries from cache`);
        return skeleton;
      }
    }
  } catch { /* miss */ }

  console.log('ESPN: fetching bracket skeleton…');

  const start    = new Date('2026-03-15');
  const rangeEnd = new Date('2026-04-15');
  const dates    = [];
  const cur      = new Date(start);
  while (cur <= rangeEnd) {
    dates.push(cur.toISOString().split('T')[0].replace(/-/g, ''));
    cur.setDate(cur.getDate() + 1);
  }

  const allEvents = [];
  const seen      = new Set();

  await Promise.all(dates.map(async ds => {
    try {
      const url  = `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${ds}&groups=100&limit=50`;
      const data = await fetch(url).then(r => r.json()).catch(() => ({}));
      for (const ev of (data.events ?? [])) {
        if (!seen.has(ev.id)) { seen.add(ev.id); allEvents.push(ev); }
      }
    } catch { /* skip */ }
  }));

  console.log(`ESPN: ${allEvents.length} raw events`);

  // Build lookup map
  const skeleton = {}; // key → ESPN game data

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

    // Game time from ESPN date string
    const espnDate = comp.date ?? ev.date ?? null;
    let gameTime = null;
    if (espnDate) {
      const d = new Date(espnDate);
      if (!isNaN(d)) gameTime = formatGameTime(Math.floor(d.getTime() / 1000));
    }

    // Spread — read from ESPN odds first, then fall back to our persistent store
    let spread = null;
    const odds = comp.odds?.[0];
    if (odds) {
      const sp = odds.spread ?? odds.homeTeamOdds?.pointSpread?.alternateDisplayValue;
      if (sp != null) {
        const m = String(sp).match(/([-+]?\d+(\.\d+)?)/);
        if (m) spread = parseFloat(m[1]);
      }
    }
    // Persist this spread (write-only, never null)
    if (spread != null) {
      saveSpread(ev.id, spread); // async, fire-and-forget
    } else {
      // ESPN dropped the odds — recover from our persistent store
      spread = await getStoredSpread(ev.id);
    }

    const statusDetail = completed ? 'FINAL' : (gameTime ?? '');

    const entry = {
      espnId:      ev.id,
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

    // Index by all useful key combinations for fuzzy matching
    const keys = buildESPNKeys(homeName, homeAbbr, awayName, awayAbbr);
    keys.forEach(k => { skeleton[k] = entry; });
  }

  console.log(`ESPN skeleton: ${Object.keys(skeleton).length} lookup entries`);

  if (Object.keys(skeleton).length > 10) {
    try {
      await Promise.all([
        storage.set(ESPN_CACHE_KEY, JSON.stringify(skeleton)),
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

// Known RapidAPI → ESPN name corrections
// RapidAPI often abbreviates or uses different school names than ESPN
const NAME_ALIASES = {
  'south methodist':    'smu',
  'south. methodist':   'smu',
  'miami ohio':         'miami oh',
  'maryland baltimore': 'umbc',        // First Four — filtered anyway
  'prairie view':       'prairie view', // First Four — filtered anyway
  'lehigh mountain':    'lehigh',
};

function normAlias(s = '') {
  const n = norm(s);
  return NAME_ALIASES[n] ?? n;
}

// Build all name variants for a team including alias expansion
function teamVariants(name = '', abbr = '') {
  const raw  = norm(name);
  const alias = normAlias(name);
  const ab   = norm(abbr);
  return [...new Set([raw, alias, ab].filter(Boolean))];
}

// Two teams match if any variant of one contains or equals any variant of the other,
// using strict word-boundary logic to prevent "texas" matching "texas tech"
function oneTeamMatches(variants1, variants2) {
  for (const v1 of variants1) {
    for (const v2 of variants2) {
      if (!v1 || !v2) continue;
      // Exact match
      if (v1 === v2) return true;
      // One fully contains the other AND they share enough characters (≥4)
      // to avoid short false-positive matches like "miami" in "miami ohio"
      if (v1.length >= 4 && v2.length >= 4) {
        if (v1 === v2) return true;
        // Require the shorter to be a whole-word match inside the longer
        const shorter = v1.length <= v2.length ? v1 : v2;
        const longer  = v1.length <= v2.length ? v2 : v1;
        // Only match if shorter is at word boundary in longer
        const escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(^|\\s)' + escaped + '(\\s|$)');
        if (re.test(longer)) return true;
      }
    }
  }
  return false;
}

/**
 * Look up ESPN metadata for a RapidAPI game using multi-tier matching.
 */
function lookupESPN(rapidGame, skeleton) {
  const hV = teamVariants(rapidGame.home.name, rapidGame.home.abbr);
  const aV = teamVariants(rapidGame.away.name, rapidGame.away.abbr);

  // Tier 1: direct key lookup (fast, exact)
  for (const h of hV) {
    for (const a of aV) {
      if (skeleton[`${h}|||${a}`]) return skeleton[`${h}|||${a}`];
      if (skeleton[`${a}|||${h}`]) return skeleton[`${a}|||${h}`];
    }
  }

  // Tier 2: fuzzy scan — for each skeleton pair, check if both teams match
  const pairKeys = Object.keys(skeleton).filter(k => k.includes('|||'));
  for (const k of pairKeys) {
    const [left, right] = k.split('|||');
    const lV = [left], rV = [right];
    // Normal orientation
    if (oneTeamMatches(hV, lV) && oneTeamMatches(aV, rV)) return skeleton[k];
    // Swapped orientation (home/away can differ between APIs)
    if (oneTeamMatches(hV, rV) && oneTeamMatches(aV, lV)) return skeleton[k];
  }

  return null;
}

// ─── Merge: RapidAPI primary + ESPN enrichment ────────────────────────────────

/**
 * For each RapidAPI game:
 *   1. Look it up in ESPN skeleton to get round/region/seeds/gameTime/spread
 *   2. RapidAPI wins on: scores, live status, live clock
 *   3. ESPN wins on: round, region, seeds, gameTime (for pre-game), spread (always)
 *
 * Then append any ESPN-only games (TBD future slots) not found in RapidAPI.
 */
function mergeRapidWithESPN(rapidGames, skeleton, liveClocks = {}) {
  // Track which ESPN entries were matched (to find unmatched TBD slots later)
  const matchedESPNIds = new Set();
  const enriched       = [];

  for (const rg of rapidGames) {
    const meta = lookupESPN(rg, skeleton);

    if (meta) {
      matchedESPNIds.add(meta.espnId);

      // RapidAPI is authoritative for live/completed state
      // ESPN fills in round, region, seeds, gameTime
      const gameTime = rg.gameTime ?? meta.gameTime;

      // Use ESPN live clock if available (has real clock time like "14:32")
      // Fall back to RapidAPI's half description if not
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
        id:          `espn_${meta.espnId}`, // use ESPN id for stability
        rapidId:     rg.rapidId,
        source:      'rapidapi',
        round:       meta.round,
        region:      meta.region,
        roundLabel:  meta.roundLabel,
        gameTime,
        statusDetail,
        // Spread always comes from ESPN only
        spread: meta.spread ?? null,
        home: {
          ...rg.home,
          seed: rg.home.seed ?? meta.homeSeed,
          name: rg.home.name || meta.homeName,
          abbr: rg.home.abbr || meta.homeAbbr,
          // RapidAPI scores win
        },
        away: {
          ...rg.away,
          seed: rg.away.seed ?? meta.awaySeed,
          name: rg.away.name || meta.awayName,
          abbr: rg.away.abbr || meta.awayAbbr,
        },
      });
    } else {
      // No ESPN match — keep as-is (unknown round/region, filtered out later)
      console.warn(`No ESPN match for: ${rg.away.name} vs ${rg.home.name}`);
      enriched.push(rg);
    }
  }

  // Append ESPN-only entries (future TBD rounds not yet in RapidAPI)
  const espnOnlyEntries = Object.values(skeleton).filter(e =>
    e.espnId && !matchedESPNIds.has(e.espnId)
  );

  // De-duplicate ESPN entries (same espnId appears multiple times from key variants)
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

  // Filter out games with no round/region (unmatched RapidAPI noise)
  const valid = enriched.filter(g => g.round != null && g.region != null);

  // Sort: round → region → seed bracket order
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

export async function getLiveGames() {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      // Fetch all three in parallel:
      // RapidAPI → scores/status, ESPN skeleton → bracket structure, ESPN live → clock
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
      fetchPromise = null; // reset immediately so next poll always fetches fresh
    }
  })();

  return fetchPromise;
}

// ─── Dev utilities ────────────────────────────────────────────────────────────

export const clearAllCache = async () => {
  const keys = [
    `rapid_games_${YEAR}_v5`,   `rapid_ts_${YEAR}_v5`,
    `espn_skeleton_${YEAR}_v6`, `espn_skeleton_ts_${YEAR}_v6`,
    `espn_spreads_${YEAR}_v1`,
  ];
  await Promise.all(keys.map(k => storage.delete(k).catch(() => {})));
  _spreadStore = null;
  console.log('All cache cleared');
  window.location.reload();
};

export const clearGameCache = async () => {
  await Promise.all([
    storage.delete(`rapid_games_${YEAR}_v5`),
    storage.delete(`rapid_ts_${YEAR}_v5`),
  ]);
  console.log('RapidAPI cache cleared');
  window.location.reload();
};

export const clearESPNMeta = async () => {
  await Promise.all([
    storage.delete(`espn_skeleton_${YEAR}_v6`),
    storage.delete(`espn_skeleton_ts_${YEAR}_v6`),
  ]);
  console.log('ESPN skeleton cache cleared');
  window.location.reload();
};