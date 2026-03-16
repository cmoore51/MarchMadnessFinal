import { ROUND_LABELS } from './constants';
import { storage } from './storage';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_URL = 'https://basketapi1.p.rapidapi.com/api/basketball';
const RAPID_HEADERS = {
  'X-RapidAPI-Key':  '3adde9dc24msh6844a469f4a57a7p11bd83jsn7885d9c9abb1',
  'X-RapidAPI-Host': 'basketapi1.p.rapidapi.com',
};

const TOURNAMENT_ID = 13434;
const YEAR = 2025;

// Storage keys
const CACHE_KEY       = `bracket_full_cache_${YEAR}_v3`;
const CACHE_TS_KEY    = `bracket_cache_ts_${YEAR}_v3`;

// How long before we re-fetch live data (ms)
// During tournament: 60s. Otherwise: 5 min.
const LIVE_TTL    = 60  * 1000;
const DEFAULT_TTL = 5 * 60 * 1000;

// RapidAPI: 10 req/sec limit — we'll do max 8 in parallel to be safe
const MAX_PARALLEL = 8;

const SEED_ORDER = [1, 8, 5, 4, 6, 3, 7, 2];

let fetchPromise = null;

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function norm(s = '') {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function dayKey(d) {
  return `${d.getFullYear()}_${String(d.getMonth() + 1).padStart(2,'0')}_${String(d.getDate()).padStart(2,'0')}`;
}

function datesInRange(start, end) {
  const dates = [];
  const cur = new Date(start);
  const stop = end < new Date() ? end : new Date();
  while (cur <= stop) {
    dates.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// Run promises in parallel with a concurrency cap
async function pLimit(tasks, limit) {
  const results = [];
  for (let i = 0; i < tasks.length; i += limit) {
    const batch = tasks.slice(i, i + limit).map(fn => fn());
    const batchResults = await Promise.allSettled(batch);
    results.push(...batchResults.map(r => r.status === 'fulfilled' ? r.value : null));
    // Stay under 10 req/sec — wait 1100ms between batches
    if (i + limit < tasks.length) await sleep(1100);
  }
  return results;
}

// ─── ESPN: Primary source for bracket structure ───────────────────────────────
//
// ESPN's scoreboard endpoint returns ALL tournament games — including future
// ones with TBD teams — so we get the full bracket skeleton for free.
// We query with groups=100 (NCAA tournament) over the full date range.

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
 * Fetch ALL tournament games from ESPN for the given year.
 * ESPN pre-populates future rounds with TBD teams, giving us the full bracket.
 * Returns an array of shaped game objects (ESPN format).
 */
async function fetchESPNGames() {
  const ESPN_CACHE_KEY = `espn_games_${YEAR}_v3`;
  const ESPN_TS_KEY    = `espn_ts_${YEAR}_v3`;

  // Check cache freshness
  try {
    const [cached, ts] = await Promise.all([
      storage.get(ESPN_CACHE_KEY),
      storage.get(ESPN_TS_KEY),
    ]);
    if (cached?.value && ts?.value) {
      const age = Date.now() - parseInt(ts.value, 10);
      if (age < DEFAULT_TTL) {
        const games = JSON.parse(cached.value);
        console.log(`ESPN: ${games.length} games from cache (${Math.round(age/1000)}s old)`);
        return games;
      }
    }
  } catch { /* miss */ }

  console.log('ESPN: fetching full bracket…');

  // ESPN scoreboard with groups=100 gives NCAA Tournament games.
  // Fetch a range of dates to capture all rounds.
  // We also use the tournament-specific endpoint as a backup.
  const { start, end: rangeEnd } = { start: new Date('2026-03-15'), end: new Date('2026-04-15') };
  const dates = [];
  const cur = new Date(start);
  while (cur <= rangeEnd) {
    dates.push(cur.toISOString().split('T')[0].replace(/-/g, ''));
    cur.setDate(cur.getDate() + 1);
  }

  // ESPN doesn't rate-limit us, fetch all at once
  const allEvents = [];
  const seen = new Set();

  await Promise.all(dates.map(async ds => {
    try {
      const urls = [
        `https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard?dates=${ds}&groups=100&limit=50`,
      ];
      const results = await Promise.all(urls.map(u =>
        fetch(u).then(r => r.json()).catch(() => ({}))
      ));
      for (const data of results) {
        for (const ev of (data.events ?? [])) {
          if (!seen.has(ev.id)) {
            seen.add(ev.id);
            allEvents.push(ev);
          }
        }
      }
    } catch { /* skip day */ }
  }));

  console.log(`ESPN: raw events fetched: ${allEvents.length}`);

  // Shape ESPN events into our game format
  const games = [];
  for (const ev of allEvents) {
    const comp = ev.competitions?.[0];
    if (!comp) continue;

    const note  = comp.notes?.[0]?.headline ?? '';
    const round = parseESPNRound(note);
    if (round === null || round === 0) continue; // skip non-tournament or First Four

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) continue;

    const homeSeed  = parseInt(home.curatedRank?.current) || parseInt(home.rank) || 0;
    const awaySeed  = parseInt(away.curatedRank?.current) || parseInt(away.rank) || 0;

    const homeAbbr  = (home.team.abbreviation ?? '').toUpperCase();
    const awayAbbr  = (away.team.abbreviation ?? '').toUpperCase();
    const homeName  = home.team.shortDisplayName || home.team.displayName || homeAbbr;
    const awayName  = away.team.shortDisplayName || away.team.displayName || awayAbbr;
    const homeId    = String(home.team.id ?? '');
    const awayId    = String(away.team.id ?? '');

    const region    = parseESPNRegion(note)
      ?? (round === 5 ? 'Final Four' : round === 6 ? 'Championship' : null);
    if (!region) continue;

    // Status
    const state      = comp.status?.type?.state ?? 'pre';         // pre/in/post
    const completed  = state === 'post';
    const inProgress = state === 'in';
    const statusDetail = comp.status?.type?.shortDetail ?? '';

    const homeScore = completed || inProgress
      ? parseInt(home.score) || null
      : null;
    const awayScore = completed || inProgress
      ? parseInt(away.score) || null
      : null;

    const homeWon = completed && homeScore != null && awayScore != null
      && homeScore > awayScore;
    const awayWon = completed && homeScore != null && awayScore != null
      && awayScore > homeScore;

    // Spread from ESPN odds
    let spread = null;
    const odds = comp.odds?.[0];
    if (odds) {
      const sp = odds.spread ?? odds.homeTeamOdds?.pointSpread?.alternateDisplayValue;
      if (sp != null) {
        const m = String(sp).match(/([-+]?\d+(\.\d+)?)/);
        if (m) spread = parseFloat(m[1]);
      }
    }

    // Is this team actually named or TBD?
    const homeTBD = !homeId || homeName === 'TBD' || homeName === '' || home.team.id == null;
    const awayTBD = !awayId || awayName === 'TBD' || awayName === '' || away.team.id == null;

    games.push({
      id:          `espn_${ev.id}`,
      espnId:      ev.id,
      source:      'espn',
      region,
      round,
      roundLabel:  ROUND_LABELS[round] ?? `Round ${round}`,
      completed,
      inProgress,
      statusDetail,
      spread,
      home: {
        id:     homeTBD ? null : homeId,
        name:   homeTBD ? 'TBD' : homeName,
        abbr:   homeTBD ? 'TBD' : homeAbbr,
        seed:   homeSeed || null,
        score:  homeScore,
        winner: homeWon,
      },
      away: {
        id:     awayTBD ? null : awayId,
        name:   awayTBD ? 'TBD' : awayName,
        abbr:   awayTBD ? 'TBD' : awayAbbr,
        seed:   awaySeed || null,
        score:  awayScore,
        winner: awayWon,
      },
    });
  }

  // Sort by round → region → seed bracket order
  const regionOrder = ['South', 'East', 'Midwest', 'West', 'Final Four', 'Championship'];
  games.sort((a, b) => {
    if (a.round !== b.round) return a.round - b.round;
    const ri = r => { const i = regionOrder.indexOf(r); return i < 0 ? 99 : i; };
    if (a.region !== b.region) return ri(a.region) - ri(b.region);
    const prio = s => {
      const i = SEED_ORDER.indexOf(s ?? 17);
      return i < 0 ? 99 : i;
    };
    return prio(a.home.seed) - prio(b.home.seed);
  });

  console.log(`ESPN: shaped ${games.length} tournament games`);

  if (games.length > 5) {
    try {
      await Promise.all([
        storage.set(ESPN_CACHE_KEY, JSON.stringify(games)),
        storage.set(ESPN_TS_KEY, String(Date.now())),
      ]);
    } catch (e) { console.warn('ESPN cache save failed:', e.message); }
  }

  return games;
}

// ─── RapidAPI BasketAPI: Live scores overlay ──────────────────────────────────
//
// We use this ONLY to get live/recent scores, then merge onto ESPN games.
// This avoids the slow day-by-day approach — instead we just fetch today
// and the past ~7 days (tournament window).

async function fetchRapidScores() {
  const RAPID_CACHE_KEY = `rapid_scores_${YEAR}_v3`;
  const RAPID_TS_KEY    = `rapid_ts_${YEAR}_v3`;

  // Check cache — short TTL for live scores
  try {
    const [cached, ts] = await Promise.all([
      storage.get(RAPID_CACHE_KEY),
      storage.get(RAPID_TS_KEY),
    ]);
    if (cached?.value && ts?.value) {
      const age = Date.now() - parseInt(ts.value, 10);
      if (age < LIVE_TTL) {
        const scores = JSON.parse(cached.value);
        console.log(`RapidAPI: ${scores.length} scores from cache (${Math.round(age/1000)}s old)`);
        return scores;
      }
    }
  } catch { /* miss */ }

  console.log('RapidAPI: fetching recent scores…');

  // Fetch the past 14 days + today (covers full tournament window)
  // We can fire all of these in parallel since limit is 10/sec and
  // 14 dates / 8 batch = 2 batches = ~1.1s total
  const today = new Date();
  const dates = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    // Only fetch dates in tournament window
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

  const results = await pLimit(dates.map(d => fetchDate(d)), MAX_PARALLEL);
  const allGames = results.flat().filter(Boolean);

  console.log(`RapidAPI: ${allGames.length} raw events`);

  if (allGames.length > 0) {
    try {
      await Promise.all([
        storage.set(RAPID_CACHE_KEY, JSON.stringify(allGames)),
        storage.set(RAPID_TS_KEY, String(Date.now())),
      ]);
    } catch (e) { console.warn('RapidAPI cache save failed:', e.message); }
  }

  return allGames;
}

// ─── Team name matching ───────────────────────────────────────────────────────

function buildMatchKey(name = '', abbr = '') {
  return norm(name);
}

/**
 * Try to match a RapidAPI team to an ESPN team by name similarity.
 * Returns true if they're likely the same team.
 */
function teamsMatch(rapidName = '', rapidAbbr = '', espnName = '', espnAbbr = '') {
  if (!rapidName && !rapidAbbr) return false;
  if (!espnName && !espnAbbr) return false;

  const rn = norm(rapidName);
  const ra = norm(rapidAbbr);
  const en = norm(espnName);
  const ea = norm(espnAbbr);

  // Exact match
  if (rn && en && rn === en) return true;
  if (ra && ea && ra === ea) return true;

  // Abbreviation cross-match
  if (ra && en && en.includes(ra)) return true;
  if (ea && rn && rn.includes(ea)) return true;

  // Partial name match (one contains the other)
  if (rn && en && (rn.includes(en) || en.includes(rn))) return true;

  // Word overlap (>= 1 shared word, ignoring short words)
  const rWords = rn.split(' ').filter(w => w.length > 2);
  const eWords = en.split(' ').filter(w => w.length > 2);
  if (rWords.length && eWords.length) {
    const shared = rWords.filter(w => eWords.includes(w));
    if (shared.length >= 1) return true;
  }

  return false;
}

// ─── Merge RapidAPI scores onto ESPN games ────────────────────────────────────

function mergeScores(espnGames, rapidRaw) {
  if (!rapidRaw.length) return espnGames;

  // Shape RapidAPI games minimally — just need scores + team names
  const rapidShaped = rapidRaw.map(g => {
    const status    = mapRapidStatus(g.status);
    const homeScore = g.homeScore?.current ?? g.homeScore?.display ?? null;
    const awayScore = g.awayScore?.current ?? g.awayScore?.display ?? null;
    return {
      rapidId:      String(g.id),
      homeName:     g.homeTeam?.name ?? '',
      homeAbbr:     g.homeTeam?.shortName ?? g.homeTeam?.nameCode ?? '',
      awayName:     g.awayTeam?.name ?? '',
      awayAbbr:     g.awayTeam?.shortName ?? g.awayTeam?.nameCode ?? '',
      homeScore:    homeScore != null ? Number(homeScore) : null,
      awayScore:    awayScore != null ? Number(awayScore) : null,
      status,
      statusDetail: g.status?.description ?? '',
      spread:       parseSpread(g.odds?.homeHandicap ?? g.odds?.spread ?? null),
    };
  });

  let merged = 0;
  const result = espnGames.map(eg => {
    // Skip TBD games — nothing to merge
    if (!eg.home.id && !eg.away.id) return eg;
    if (eg.home.name === 'TBD' && eg.away.name === 'TBD') return eg;

    // Find matching RapidAPI game
    const rapidMatch = rapidShaped.find(rg =>
      teamsMatch(rg.homeName, rg.homeAbbr, eg.home.name, eg.home.abbr) &&
      teamsMatch(rg.awayName, rg.awayAbbr, eg.away.name, eg.away.abbr)
    ) || rapidShaped.find(rg =>
      // Try swapped home/away
      teamsMatch(rg.homeName, rg.homeAbbr, eg.away.name, eg.away.abbr) &&
      teamsMatch(rg.awayName, rg.awayAbbr, eg.home.name, eg.home.abbr)
    );

    if (!rapidMatch) return eg;

    merged++;
    const swapped = teamsMatch(rapidMatch.homeName, rapidMatch.homeAbbr, eg.away.name, eg.away.abbr);

    const homeScore = swapped ? rapidMatch.awayScore : rapidMatch.homeScore;
    const awayScore = swapped ? rapidMatch.homeScore : rapidMatch.awayScore;
    const completed  = rapidMatch.status === 'post';
    const inProgress = rapidMatch.status === 'in';

    return {
      ...eg,
      completed:    completed  || eg.completed,
      inProgress:   inProgress && !completed,
      statusDetail: rapidMatch.statusDetail || eg.statusDetail,
      spread:       rapidMatch.spread ?? eg.spread,
      home: {
        ...eg.home,
        score:  homeScore ?? eg.home.score,
        winner: completed && homeScore != null && awayScore != null
          ? homeScore > awayScore
          : eg.home.winner,
      },
      away: {
        ...eg.away,
        score:  awayScore ?? eg.away.score,
        winner: completed && homeScore != null && awayScore != null
          ? awayScore > homeScore
          : eg.away.winner,
      },
    };
  });

  console.log(`Merged ${merged}/${espnGames.length} ESPN games with RapidAPI scores`);
  return result;
}

function mapRapidStatus(s) {
  if (!s) return 'pre';
  const type = s.type ?? -99;
  const desc = (s.description ?? '').toLowerCase();
  if (type === 100 || type === 110)                                   return 'post';
  if (desc.includes('ended') || desc.includes('finished')
    || desc.includes('final'))                                        return 'post';
  if (type === 0 || type === -1 || type === 120)                      return 'pre';
  if (desc.includes('not started') || desc.includes('postponed'))    return 'pre';
  return 'in';
}

function parseSpread(v) {
  if (v == null) return null;
  const m = String(v).match(/([-+]?\d+(\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getLiveGames() {
  if (fetchPromise) return fetchPromise;

  fetchPromise = (async () => {
    try {
      // Kick off ESPN (primary) and RapidAPI (scores) in parallel
      // ESPN is fast (no rate limit), RapidAPI uses our parallel fetcher
      const [espnGames, rapidRaw] = await Promise.all([
        fetchESPNGames(),
        fetchRapidScores().catch(e => {
          console.warn('RapidAPI fetch failed, using ESPN only:', e.message);
          return [];
        }),
      ]);

      if (espnGames.length === 0) {
        console.warn('No ESPN games found — check tournament date range');
        return [];
      }

      // Merge live scores from RapidAPI onto ESPN bracket structure
      const merged = mergeScores(espnGames, rapidRaw);

      const completed  = merged.filter(g => g.completed).length;
      const inProgress = merged.filter(g => g.inProgress).length;
      const tbd        = merged.filter(g => !g.home.id || !g.away.id).length;
      console.log(`Final: ${merged.length} games | ${completed} completed | ${inProgress} live | ${tbd} TBD slots`);

      return merged;

    } finally {
      setTimeout(() => { fetchPromise = null; }, 30_000);
    }
  })();

  return fetchPromise;
}

// ─── Dev utilities ────────────────────────────────────────────────────────────

export const clearAllCache = async () => {
  const keys = [
    `espn_games_${YEAR}_v3`,
    `espn_ts_${YEAR}_v3`,
    `rapid_scores_${YEAR}_v3`,
    `rapid_ts_${YEAR}_v3`,
    CACHE_KEY,
    CACHE_TS_KEY,
  ];
  await Promise.all(keys.map(k => storage.delete(k).catch(() => {})));
  console.log('All cache cleared');
  window.location.reload();
};

export const clearGameCache = async () => {
  await Promise.all([
    storage.delete(`rapid_scores_${YEAR}_v3`),
    storage.delete(`rapid_ts_${YEAR}_v3`),
  ]);
  console.log('Score cache cleared');
  window.location.reload();
};

export const clearESPNMeta = async () => {
  await Promise.all([
    storage.delete(`espn_games_${YEAR}_v3`),
    storage.delete(`espn_ts_${YEAR}_v3`),
  ]);
  console.log('ESPN cache cleared');
  window.location.reload();
};