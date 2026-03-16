// Run this once to find the right BasketAPI category for D1 March Madness
// Usage: node findCategory.mjs

const RAPID_API_KEY  = "3adde9dc24msh6844a469f4a57a7p11bd83jsn7885d9c9abb1";
const RAPID_API_HOST = "basketapi1.p.rapidapi.com";

const headers = {
  'x-rapidapi-key':  RAPID_API_KEY,
  'x-rapidapi-host': RAPID_API_HOST,
};

async function get(path) {
  const res = await fetch(`https://${RAPID_API_HOST}${path}`, { headers });
  if (!res.ok) return null;
  return res.json();
}

// ── Step 1: scan categories 1–30 on a known D1 tournament date ───────────────
console.log('=== SCANNING CATEGORIES (Mar 20, 2025) ===\n');
const KNOWN_D1_TEAMS = ['Duke', 'Kentucky', 'Kansas', 'Houston', 'Auburn', 'Florida', 'Tennessee', 'Alabama', 'Michigan', 'UCLA', 'Connecticut', 'Gonzaga', 'Purdue'];

for (let cat = 1; cat <= 30; cat++) {
  const data = await get(`/api/basketball/category/${cat}/events/20/3/2025`);
  if (!data?.events?.length) continue;

  const ncaa = data.events.filter(e => {
    const t = e.tournament?.name || '';
    return t.includes('NCAA') && !t.includes('Women') && !t.includes('II') && !t.includes('III');
  });

  const hasD1 = ncaa.some(e =>
    KNOWN_D1_TEAMS.some(team =>
      e.homeTeam?.name?.includes(team) || e.awayTeam?.name?.includes(team)
    )
  );

  if (ncaa.length > 0) {
    const tNames = [...new Set(ncaa.map(e => e.tournament?.name))];
    console.log(`CAT ${cat}: ${data.events.length} total, ${ncaa.length} NCAA men's${hasD1 ? ' ← LIKELY D1 ✓' : ''}`);
    tNames.forEach(n => console.log(`   Tournament name: "${n}"`));
    if (ncaa[0]) console.log(`   Sample: ${ncaa[0].awayTeam?.name} vs ${ncaa[0].homeTeam?.name} | awaySeed=${ncaa[0].awaySeed} homeSeed=${ncaa[0].homeSeed}`);
  }

  await new Promise(r => setTimeout(r, 250));
}

// ── Step 2: try the tournament endpoint directly ──────────────────────────────
console.log('\n=== TRYING TOURNAMENT ENDPOINT (tournament IDs 1–20) ===\n');
for (let tid = 1; tid <= 20; tid++) {
  const data = await get(`/api/basketball/tournament/${tid}/seasons`);
  if (!data?.seasons?.length) continue;
  const names = [...new Set(data.seasons.map(s => s.tournament?.name || ''))].filter(Boolean);
  const isNCAAD1 = names.some(n => n.includes('NCAA') && !n.includes('Women') && !n.includes('II') && !n.includes('III'));
  if (isNCAAD1 || names.some(n => n.toLowerCase().includes('march') || n.toLowerCase().includes('basketball tournament'))) {
    console.log(`TOURNAMENT ${tid}: ${names.join(', ')}`);
    // Try to get rounds for the most recent season
    const latest = data.seasons.sort((a,b) => b.year - a.year)[0];
    console.log(`  Latest season: id=${latest.id} year=${latest.year}`);
    const rounds = await get(`/api/basketball/tournament/${tid}/season/${latest.id}/rounds`);
    if (rounds?.rounds) {
      console.log(`  Rounds: ${JSON.stringify(rounds.rounds)}`);
      // Fetch first round's matches
      const firstRound = rounds.rounds[0]?.round;
      if (firstRound) {
        const matches = await get(`/api/basketball/tournament/${tid}/season/${latest.id}/round/${firstRound}/matches`);
        const events = matches?.events || [];
        if (events.length > 0) {
          console.log(`  Round ${firstRound} sample: ${events[0].awayTeam?.name} vs ${events[0].homeTeam?.name}`);
          console.log(`  Group: "${events[0].group?.name}" roundInfo: "${events[0].roundInfo?.name}"`);
          console.log(`  Seeds: away=${events[0].awaySeed} home=${events[0].homeSeed}`);
        }
      }
    }
  }
  await new Promise(r => setTimeout(r, 250));
}

console.log('\nDone. Paste this output so we can update cacheUpdater.js with the correct IDs.');
