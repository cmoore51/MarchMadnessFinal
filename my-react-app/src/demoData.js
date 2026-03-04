import { ROUND_LABELS } from './constants';

const t = (name, abbr, seed) => ({ id: `team_${abbr}`, name, abbr, seed });

const game = (id, region, round, away, home, aScore, hScore, spread) => {
  const done = aScore !== null;
  return {
    id, source: "demo", region, round,
    roundLabel: ROUND_LABELS[round],
    date: "2025-03-20",
    status: done ? "final" : "pre",
    statusDetail: done ? "Final" : "TBD",
    away: { ...away, score: aScore, winner: done && aScore > hScore },
    home: { ...home, score: hScore, winner: done && hScore > aScore },
    completed: done,
    inProgress: false,
    spread,
  };
};

export function makeDemoGames() {
  return [
    // ── SOUTH ──
    game("s1",  "South", 1, t("Alabama St",  "ALST", 16), t("Auburn",      "AUB",  1),  63, 83, -19.5),
    game("s2",  "South", 1, t("Louisville",  "LOU",   8), t("Creighton",   "CRE",  9),  75, 89,   1.5),
    game("s3",  "South", 1, t("UC San Diego","UCSD", 12), t("Michigan",    "MICH", 5),  65, 68,  -6.5),
    game("s4",  "South", 1, t("Yale",        "YALE", 13), t("Texas A&M",   "TAMU", 4),  77, 80,    -9),
    game("s5",  "South", 1, t("N. Carolina", "UNC",  11), t("Ole Miss",    "MISS", 6),  64, 71,    -3),
    game("s6",  "South", 1, t("Lipscomb",    "LIP",  14), t("Iowa State",  "ISU",  3),  55, 82,   -17),
    game("s7",  "South", 1, t("Marquette",   "MARQ",  7), t("New Mexico",  "UNM", 10),  66, 75,     3),
    game("s8",  "South", 1, t("Bryant",      "BRY",  15), t("Michigan St", "MSU",  2),  62, 87, -20.5),
    game("s9",  "South", 2, t("Creighton",   "CRE",   9), t("Auburn",      "AUB",  1),  70, 82,   -11),
    game("s10", "South", 2, t("Michigan",    "MICH",  5), t("Texas A&M",   "TAMU", 4),  91, 79,   3.5),
    game("s11", "South", 2, t("Ole Miss",    "MISS",  6), t("Iowa State",  "ISU",  3),  91, 78,     4),
    game("s12", "South", 2, t("New Mexico",  "UNM",  10), t("Michigan St", "MSU",  2),  63, 71,  -8.5),
    game("s13", "South", 3, t("Michigan",    "MICH",  5), t("Auburn",      "AUB",  1),  65, 78,    -8),
    game("s14", "South", 3, t("Ole Miss",    "MISS",  6), t("Michigan St", "MSU",  2),  70, 73,  -5.5),
    game("s15", "South", 4, t("Michigan St", "MSU",   2), t("Auburn",      "AUB",  1),  64, 70,  -5.5),

    // ── EAST ──
    game("e1",  "East",  1, t("Mt St Mary's","MSM",  16), t("Duke",        "DUKE", 1),  49, 93,   -25),
    game("e2",  "East",  1, t("Miss State",  "MSST",  8), t("Baylor",      "BAY",  9),  72, 75,     1),
    game("e3",  "East",  1, t("Liberty",     "LIB",  12), t("Oregon",      "ORE",  5),  52, 81,  -8.5),
    game("e4",  "East",  1, t("Akron",       "AKR",  13), t("Arizona",     "ARIZ", 4),  65, 93, -14.5),
    game("e5",  "East",  1, t("VCU",         "VCU",  11), t("BYU",         "BYU",  6),  71, 80,  -5.5),
    game("e6",  "East",  1, t("Montana",     "MONT", 14), t("Wisconsin",   "WIS",  3),  66, 85,   -16),
    game("e7",  "East",  1, t("Vanderbilt",  "VAN",  10), t("Saint Mary's","SMC",  7),  56, 59,    -2),
    game("e8",  "East",  1, t("Robert Morris","RMU", 15), t("Alabama",     "ALA",  2),  81, 90,   -22),
    game("e9",  "East",  2, t("Baylor",      "BAY",   9), t("Duke",        "DUKE", 1),  66, 89, -13.5),
    game("e10", "East",  2, t("Oregon",      "ORE",   5), t("Arizona",     "ARIZ", 4),  83, 87,    -5),
    game("e11", "East",  2, t("Wisconsin",   "WIS",   3), t("BYU",         "BYU",  6),  89, 91,   4.5),
    game("e12", "East",  2, t("Saint Mary's","SMC",   7), t("Alabama",     "ALA",  2),  66, 80,   -10),
    game("e13", "East",  3, t("Arizona",     "ARIZ",  4), t("Duke",        "DUKE", 1),  93,100,    -6),
    game("e14", "East",  3, t("BYU",         "BYU",   6), t("Alabama",     "ALA",  2),  88,113,  -8.5),
    game("e15", "East",  4, t("Alabama",     "ALA",   2), t("Duke",        "DUKE", 1),  65, 85,    -7),

    // ── WEST ──
    game("w1",  "West",  1, t("Norfolk St",  "NORF", 16), t("Florida",     "FLA",  1),  69, 95,   -23),
    game("w2",  "West",  1, t("Oklahoma",    "OKLA",  9), t("UConn",       "UCON", 8),  59, 67,  -1.5),
    game("w3",  "West",  1, t("Memphis",     "MEM",   5), t("Colorado St", "CSU", 12),  70, 78,   6.5),
    game("w4",  "West",  1, t("Grand Canyon","GCU",  13), t("Maryland",    "MD",   4),  49, 81,   -16),
    game("w5",  "West",  1, t("Missouri",    "MIZ",   6), t("Drake",       "DRKE",11),  57, 67,     4),
    game("w6",  "West",  1, t("UNC Wilm",    "UNCW", 14), t("Texas Tech",  "TTU",  3),  72, 82, -15.5),
    game("w7",  "West",  1, t("Kansas",      "KU",    7), t("Arkansas",    "ARK", 10),  72, 79,     3),
    game("w8",  "West",  1, t("Omaha",       "UNO",  15), t("St. John's",  "SJU",  2),  53, 83,   -24),
    game("w9",  "West",  2, t("UConn",       "UCON",  8), t("Florida",     "FLA",  1),  75, 77,    -8),
    game("w10", "West",  2, t("Colorado St", "CSU",  12), t("Maryland",    "MD",   4),  71, 72,  -4.5),
    game("w11", "West",  2, t("Drake",       "DRKE", 11), t("Texas Tech",  "TTU",  3),  64, 77,    -9),
    game("w12", "West",  2, t("St. John's",  "SJU",   2), t("Arkansas",    "ARK", 10),  66, 75,   8.5),
    game("w13", "West",  3, t("Maryland",    "MD",    4), t("Florida",     "FLA",  1),  71, 87,    -6),
    game("w14", "West",  3, t("Arkansas",    "ARK",  10), t("Texas Tech",  "TTU",  3),  83, 85,  -9.5),
    game("w15", "West",  4, t("Texas Tech",  "TTU",   3), t("Florida",     "FLA",  1),  79, 84,    -6),

    // ── MIDWEST ──
    game("m1",  "Midwest",1, t("SIU-E",      "SIUE", 16), t("Houston",     "HOU",  1),  40, 78, -26.5),
    game("m2",  "Midwest",1, t("Georgia",    "UGA",   9), t("Gonzaga",     "GONZ", 8),  68, 89,    -2),
    game("m3",  "Midwest",1, t("Clemson",    "CLEM",  5), t("McNeese",     "MCN", 12),  67, 69,   7.5),
    game("m4",  "Midwest",1, t("High Point", "HP",   13), t("Purdue",      "PUR",  4),  63, 75,   -14),
    game("m5",  "Midwest",1, t("Xavier",     "XAV",  11), t("Illinois",    "ILL",  6),  73, 86,  -6.5),
    game("m6",  "Midwest",1, t("Troy",       "TROY", 14), t("Kentucky",    "UK",   3),  57, 76,   -17),
    game("m7",  "Midwest",1, t("Utah State", "USU",  10), t("UCLA",        "UCLA", 7),  47, 72,    -4),
    game("m8",  "Midwest",1, t("Wofford",    "WOF",  15), t("Tennessee",   "TENN", 2),  62, 77, -19.5),
    game("m9",  "Midwest",2, t("Gonzaga",    "GONZ",  8), t("Houston",     "HOU",  1),  76, 81,  -7.5),
    game("m10", "Midwest",2, t("McNeese",    "MCN",  12), t("Purdue",      "PUR",  4),  62, 76,    -6),
    game("m11", "Midwest",2, t("Illinois",   "ILL",   6), t("Kentucky",    "UK",   3),  75, 84,    -5),
    game("m12", "Midwest",2, t("UCLA",       "UCLA",  7), t("Tennessee",   "TENN", 2),  58, 67,    -8),
    game("m13", "Midwest",3, t("Purdue",     "PUR",   4), t("Houston",     "HOU",  1),  60, 62,    -7),
    game("m14", "Midwest",3, t("Kentucky",   "UK",    3), t("Tennessee",   "TENN", 2),  65, 78,    -3),
    game("m15", "Midwest",4, t("Tennessee",  "TENN",  2), t("Houston",     "HOU",  1),  50, 69,  -7.5),

    // ── FINAL FOUR & CHAMPIONSHIP ──
    game("ff1",  "Final Four",   5, t("Auburn",  "AUB", 1), t("Florida", "FLA", 1), 73, 79, -1.5),
    game("ff2",  "Final Four",   5, t("Duke",    "DUKE",1), t("Houston", "HOU", 1), 67, 70, -2.5),
    game("champ","Championship", 6, t("Houston", "HOU", 1), t("Florida", "FLA", 1), 63, 65,   -1),
  ];
}