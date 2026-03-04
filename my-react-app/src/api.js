import { ROUND_LABELS } from './constants';

// ── Switch dates here when 2026 tournament begins ─────────────────────────
const ESPN_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard" +
  "?dates=20250201-20250501&groups=50&limit=500";
// 2026: "?dates=20260201-20260501&groups=50&limit=500"

function inferRound(note) {
  const n = note.toLowerCase();
  if (n.includes("Men's Basketball Championship")) {
    if (n.includes("first round")  || n.includes("1st round"))          return 1;
    if (n.includes("second round") || n.includes("2nd round"))          return 2;
    if (n.includes("sweet 16")     || n.includes("regional semifinal")) return 3;
    if (n.includes("elite 8")      || n.includes("regional final"))     return 4;
    if (n.includes("final four"))                                        return 5;
    if (n.includes("national championship") || /\bchampionship\s*$/.test(n)) return 6;
  }
  return 1;
}

function inferRegion(note) {
  for (const r of ["South", "East", "West", "Midwest"]) {
    if (note.includes(r)) return r;
  }
  if (note.toLowerCase().includes("final four"))   return "Final Four";
  if (note.toLowerCase().includes("championship")) return "Championship";
  return "Tournament";
}

function parseSpread(oddsStr) {
  if (!oddsStr) return null;
  const m = oddsStr.match(/([-+]?\d+(\.\d+)?)\s*$/);
  return m ? parseFloat(m[1]) : null;
}

export async function getLiveGames() {
  const res  = await fetch(ESPN_URL);
  const data = await res.json();

  return data.events
    .filter(ev => {
      const note = ev.competitions[0].notes?.[0]?.headline || "";
      return note.includes("Men's Basketball Championship");
    })
    .map(ev => {
      const comp      = ev.competitions[0];
      const status    = ev.status.type.state;       // 'pre' | 'in' | 'post'
      const completed = ev.status.type.completed;
      const home      = comp.competitors.find(c => c.homeAway === "home");
      const away      = comp.competitors.find(c => c.homeAway === "away");

      const mapTeam = (c) => ({
        id:     `team_${c.team.abbreviation}`,
        name:   c.team.shortDisplayName || c.team.name,
        abbr:   c.team.abbreviation,
        seed:   parseInt(c.curatedRank?.current) || 0,
        score:  completed ? parseInt(c.score) : null,
        winner: c.winner || false,
      });

      const note   = comp.notes?.[0]?.headline || "";
      const round  = inferRound(note);
      const region = inferRegion(note);

      return {
        id:          ev.id,
        source:      "espn",
        region,
        round,
        roundLabel:  round === 6 ? "National Championship" : (ROUND_LABELS[round] || note),
        date:        ev.date.split("T")[0],
        status,
        statusDetail: ev.status.type.detail,
        away:        mapTeam(away),
        home:        mapTeam(home),
        completed,
        inProgress:  status === "in",
        spread:      parseSpread(comp.odds?.[0]?.details),
      };
    });
}