import { useState, useEffect, useCallback, memo } from 'react';
import { ROUND_LABELS, REGION_COLORS, PLAYER_COLORS, ADMIN_PASSWORD } from './constants';
import { getLiveGames } from './api';
import { makeDemoGames } from './demoData';

// ── Google Fonts ─────────────────────────────────────────────────────────────
// Remove this block and add the link to your index.html instead:
// <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
// const interLink = document.createElement('link');
// interLink.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap';
// interLink.rel = 'stylesheet';
// document.head.appendChild(interLink);

// ── Helpers ───────────────────────────────────────────────────────────────────
function didCover(winScore, loseScore, spread) {
  if (spread == null) return null;
  if (spread < 0) return (winScore - loseScore) > Math.abs(spread);
  return true;
}

// ── Stable PlayerInput (outside App so it never remounts) ─────────────────────
const PlayerInput = memo(({ value, onChange, onAdd }) => (
  <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter") onAdd(); }}
      placeholder="Enter player name..."
      style={{
        flex: 1, padding: "10px 12px",
        background: "#ffffff", border: "2px solid #c0d0e8",
        borderRadius: 6, color: "#0d1b2a",
        fontSize: 13, fontFamily: "'Inter', sans-serif", outline: "none",
      }}
    />
    <button onClick={onAdd} style={{
      padding: "10px 18px", background: "#4a90d9",
      border: "none", borderRadius: 6, color: "#000",
      fontSize: 18, fontWeight: "bold", cursor: "pointer", flexShrink: 0,
    }}>+</button>
  </div>
));

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]           = useState("full");
  const [games, setGames]       = useState([]);
  const [loading, setLoading]   = useState(true);

  const [players, setPlayers]               = useState([]);
  const [assignments, setAssignments]       = useState({});  // teamId -> playerName
  const [spreads, setSpreads]               = useState({});  // gameId -> number
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [inputValue, setInputValue]         = useState("");

  const [activeRegion, setActiveRegion] = useState("All");
  const [filterPlayer, setFilterPlayer] = useState("All");
  const [focusGame, setFocusGame]       = useState(null);
  const [spreadInput, setSpreadInput]   = useState("");

  const [isAdmin, setIsAdmin]               = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminInput, setAdminInput]         = useState("");
  const [adminError, setAdminError]         = useState(false);

  // ── Load data ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const live = await getLiveGames();
        setGames(live.length > 0 ? live : makeDemoGames());
      } catch {
        setGames(makeDemoGames());
      }
      setLoading(false);
    })();
  }, []);

  // ── Ownership computation ──────────────────────────────────────────────────
  const ownership = (() => {
    const own = {};
    Object.entries(assignments).forEach(([tid, player]) => {
      own[tid] = { owner: player, capturedFrom: null };
    });
    [...games].sort((a, b) => a.round - b.round).forEach(game => {
      if (!game.completed) return;
      const winner = game.away.winner ? game.away : game.home.winner ? game.home : null;
      const loser  = winner ? (winner === game.away ? game.home : game.away) : null;
      if (!winner || !loser) return;
      const wOwner  = own[winner.id]?.owner;
      const lOwner  = own[loser.id]?.owner;
      if (!wOwner && !lOwner) return;
      const spread  = spreads[game.id] ?? game.spread;
      const covered = didCover(winner.score, loser.score, spread);
      if (covered === false && lOwner) {
        own[winner.id] = { owner: lOwner, capturedFrom: wOwner || null };
      } else if (wOwner) {
        own[winner.id] = { owner: wOwner, capturedFrom: own[winner.id]?.capturedFrom ?? null };
      }
    });
    return own;
  })();

  const getOwner = id => ownership[id]?.owner || null;
  const getColor = p => { const i = players.indexOf(p); return i >= 0 ? PLAYER_COLORS[i % PLAYER_COLORS.length] : "#5a6a82"; };

  // ── Live scores (teams still active) ──────────────────────────────────────
  const scores = (() => {
    const s = {};
    players.forEach(p => s[p] = 0);
    Object.values(ownership).forEach(v => { if (v.owner && s[v.owner] !== undefined) s[v.owner]++; });
    return s;
  })();

  // ── Elimination tracking ───────────────────────────────────────────────────
  const eliminationInfo = (() => {
    const anyDone = games.some(g => g.completed);
    if (!anyDone) return { eliminated: [], eliminatedInRound: {} };

    const live = {};
    Object.entries(assignments).forEach(([tid, player]) => { live[tid] = player; });

    const activeCounts = {};
    players.forEach(p => activeCounts[p] = 0);
    Object.entries(live).forEach(([, player]) => {
      if (activeCounts[player] !== undefined) activeCounts[player]++;
    });

    const eliminatedInRound = {};

    [...games].sort((a, b) => a.round - b.round).forEach(game => {
      if (!game.completed) return;
      const winner = game.away.winner ? game.away : game.home.winner ? game.home : null;
      const loser  = winner ? (winner === game.away ? game.home : game.away) : null;
      if (!winner || !loser) return;
      const wOwner  = live[winner.id];
      const lOwner  = live[loser.id];
      const spread  = spreads[game.id] ?? game.spread;
      const covered = didCover(winner.score, loser.score, spread);
      if (covered === false && lOwner) {
        if (wOwner && activeCounts[wOwner] !== undefined) {
          activeCounts[wOwner]--;
          if (activeCounts[wOwner] === 0 && !eliminatedInRound[wOwner]) eliminatedInRound[wOwner] = game.round;
        }
        live[winner.id] = lOwner;
      } else if (wOwner) {
        // winner's owner keeps team — no change
      }
      if (lOwner && activeCounts[lOwner] !== undefined) {
        if (!(covered === false && lOwner)) {
          activeCounts[lOwner]--;
          if (activeCounts[lOwner] === 0 && !eliminatedInRound[lOwner]) eliminatedInRound[lOwner] = game.round;
        }
      }
      delete live[loser.id];
    });

    const hasAssignment = p => Object.values(assignments).some(a => a === p);
    const eliminated = players.filter(p => hasAssignment(p) && eliminatedInRound[p] !== undefined);
    eliminated.sort((a, b) => eliminatedInRound[a] - eliminatedInRound[b]);
    return { eliminated, eliminatedInRound };
  })();

  const firstEliminated = eliminationInfo.eliminated[0] || null;

  // ── Player actions ─────────────────────────────────────────────────────────
  const addPlayer = useCallback(() => {
    const name = inputValue.trim();
    if (!name || players.includes(name)) return;
    setPlayers(prev => [...prev, name]);
    setInputValue("");
  }, [inputValue, players]);

  const removePlayer = useCallback((name) => {
    setPlayers(prev => prev.filter(p => p !== name));
    setAssignments(prev => { const n = { ...prev }; Object.keys(n).forEach(k => { if (n[k] === name) delete n[k]; }); return n; });
    setSelectedPlayer(prev => prev === name ? null : prev);
  }, []);

  const assignTeam = useCallback((teamId) => {
    if (!selectedPlayer || !teamId) return;
    setAssignments(prev => ({ ...prev, [teamId]: selectedPlayer }));
  }, [selectedPlayer]);

  // ── Derived helpers ────────────────────────────────────────────────────────
  const allRegions = [...new Set(games.map(g => g.region))].filter(Boolean).sort();

  const teamsByRegion = (() => {
    const map = {};
    games.filter(g => g.round === 1 || g.round === 0).forEach(game => {
      const reg = game.region;
      if (!map[reg]) map[reg] = [];
      [game.away, game.home].forEach(t => {
        if (t.id && t.name !== "TBD" && !map[reg].find(x => x.id === t.id)) map[reg].push(t);
      });
    });
    return map;
  })();

  // ownershipAtRound[round][teamId] = owner name at start of that round
  const ownershipAtRound = (() => {
    const snap = {};
    snap[1] = {};
    Object.entries(assignments).forEach(([tid, player]) => { snap[1][tid] = player; });

    const live = { ...snap[1] };
    let currentRound = 1;

    [...games].sort((a, b) => a.round - b.round).forEach(game => {
      if (!game.completed) return;
      if (game.round > currentRound) {
        for (let r = currentRound + 1; r <= game.round; r++) snap[r] = { ...live };
        currentRound = game.round;
      }
      const winner = game.away.winner ? game.away : game.home.winner ? game.home : null;
      const loser  = winner ? (winner === game.away ? game.home : game.away) : null;
      if (!winner || !loser) return;
      const wOwner  = live[winner.id];
      const lOwner  = live[loser.id];
      const spread  = spreads[game.id] ?? game.spread;
      const covered = didCover(winner.score, loser.score, spread);
      if (covered === false && lOwner) live[winner.id] = lOwner;
      delete live[loser.id];
    });
    for (let r = currentRound + 1; r <= 6; r++) { if (!snap[r]) snap[r] = { ...live }; }
    return snap;
  })();

  function ownerAtRound(teamId, round) {
    return ownershipAtRound[round]?.[teamId] ?? ownershipAtRound[1]?.[teamId] ?? null;
  }

  // ── Sub-components ─────────────────────────────────────────────────────────
  // (TeamSlot, GameCard, RegionView, StandingsPanel, MiniCard, RegionHalf)
  // are defined inline below so they close over the state above.
  // For a larger project you could lift them to separate files and pass
  // props explicitly — the pattern here keeps everything self-contained.

  function TeamSlot({ team, isWinner, isLoser, showScore, round }) {
    if (!team) return null;
    const owner    = round ? ownerAtRound(team.id, round) : getOwner(team.id);
    const color    = owner ? getColor(owner) : "#1e2d42";
    const origOwner = assignments[team.id];
    const captured  = round && owner && origOwner && owner !== origOwner;
    const canAssign = isAdmin && tab === "setup" && selectedPlayer && team.id && team.name !== "TBD";
    return (
      <div
        onClick={e => { if (canAssign) { e.stopPropagation(); assignTeam(team.id); } }}
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "6px 9px",
          background: isWinner ? "#f0f7f0" : isLoser ? "#fdf2f2" : "#ffffff",
          borderLeft: `4px solid ${color}`, opacity: isLoser ? 0.75 : 1,
          cursor: canAssign ? "pointer" : "default", minWidth: 0,
        }}
      >
        <span style={{ fontSize: 12, color: "#5a6a82", width: 16, textAlign: "right", flexShrink: 0, fontWeight: "bold" }}>{team.seed || "?"}</span>
        <span style={{ fontSize: 13, flex: 1, fontWeight: isWinner ? "bold" : "normal", color: isWinner ? "#0d1b2a" : isLoser ? "#5a6a82" : "#0d1b2a", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          {team.name?.split(" ").slice(0, 2).join(" ") || team.abbr || "TBD"}
        </span>
        {captured && <span style={{ fontSize: 11, color: "#c2410c", flexShrink: 0 }} title="Captured">⚡</span>}
        {owner && (
          <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, background: color, color: "#ffffff", fontWeight: "bold", maxWidth: 60, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 0 }}>
            {owner.slice(0, 7)}
          </span>
        )}
        {showScore && team.score != null && (
          <span style={{ fontSize: 13, fontWeight: "bold", minWidth: 22, textAlign: "right", flexShrink: 0, color: isWinner ? "#1d6534" : "#5a6a82" }}>{team.score}</span>
        )}
        {isWinner && <span style={{ fontSize: 11, color: "#22c55e", flexShrink: 0 }}>▶</span>}
      </div>
    );
  }

  function GameCard({ game }) {
    const hasScores = game.away.score != null || game.home.score != null;
    const spread    = spreads[game.id] ?? game.spread;
    const winner    = game.away.winner ? game.away : game.home.winner ? game.home : null;
    const loser     = winner ? (winner === game.away ? game.home : game.away) : null;
    const covered   = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
    const isLive    = game.inProgress;
    const isFocused = focusGame === game.id;
    const lOwner    = loser ? ownerAtRound(loser.id, game.round) : null;
    const captureMsg = covered === false && lOwner ? `⚡ ${lOwner} captures ${winner?.name}!` : null;

    function openCard() {
      if (isFocused) { setFocusGame(null); setSpreadInput(""); }
      else { setFocusGame(game.id); setSpreadInput(spread != null ? String(spread) : ""); }
    }
    function saveSpread() {
      const v = parseFloat(spreadInput);
      if (!isNaN(v)) setSpreads(p => ({ ...p, [game.id]: v }));
      setFocusGame(null); setSpreadInput("");
    }
    function clearSpread() {
      setSpreads(p => { const n = { ...p }; delete n[game.id]; return n; });
      setSpreadInput(""); setFocusGame(null);
    }

    return (
      <div style={{ position: "relative" }}>
        <div onClick={openCard}
          style={{ width: 190, border: `1px solid ${isLive ? "#16a34a" : "#dde3ed"}`, borderLeft: `4px solid ${isLive ? "#16a34a" : REGION_COLORS[game.region] || "#2a3a5a"}`, borderRadius: 5, overflow: "hidden", background: "#ffffff", cursor: "pointer", boxShadow: "0 1px 4px #00000011" }}>
          <TeamSlot team={game.away} isWinner={game.away.winner} isLoser={game.home.winner} showScore={hasScores} round={game.round} />
          <div style={{ height: 1, background: "#e8ecf4" }} />
          <TeamSlot team={game.home} isWinner={game.home.winner} isLoser={game.away.winner} showScore={hasScores} round={game.round} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 8px", background: "#f7f9fc", borderTop: "1px solid #e0e8f0" }}>
            <span style={{ fontSize: 11, color: isLive ? "#1d6534" : "#5a6a82" }}>
              {isLive ? `● ${game.statusDetail || "LIVE"}` : game.completed ? "FINAL" : game.statusDetail || "SCHED"}
            </span>
            {spread != null ? (
              <span style={{ fontSize: 10, color: covered === true ? "#1d6534" : covered === false ? "#b91c1c" : "#5a6a82", fontWeight: "bold" }}>
                {spread > 0 ? `+${spread}` : spread}{covered === true ? " ✓" : covered === false ? " ✗" : ""}
              </span>
            ) : (
              <span style={{ fontSize: 11, color: "#5a6a82", cursor: "pointer", textDecoration: "underline dotted" }}>+ spread</span>
            )}
          </div>
        </div>
        {isFocused && (
          <div onClick={e => e.stopPropagation()} style={{ position: "absolute", top: "100%", left: 0, zIndex: 999, background: "#ffffff", border: "1px solid #c0d0e8", borderRadius: 6, padding: 14, width: 260, boxShadow: "0 8px 32px #00000022", marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: REGION_COLORS[game.region] || "#1a3a6b", letterSpacing: 1 }}>{game.region?.toUpperCase()} · {game.roundLabel?.toUpperCase()}</span>
              <button onClick={() => { setFocusGame(null); setSpreadInput(""); }} style={{ background: "#f7f9fc", border: "1px solid #c0d0e8", color: "#5a6a82", width: 20, height: 20, borderRadius: 3, cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "#5a6a82", marginBottom: 6 }}>{game.away.name} vs {game.home.name}</div>
            {hasScores && <div style={{ fontSize: 18, fontWeight: "bold", color: "#0d1b2a", marginBottom: 8 }}>{game.away.score} – {game.home.score}</div>}
            {spread != null && (
              <div style={{ fontSize: 10, color: "#5a6a82", marginBottom: 8 }}>
                Spread: <span style={{ color: "#0d1b2a" }}>{spread > 0 ? `+${spread}` : spread}</span>
                {covered != null && <span style={{ marginLeft: 8, color: covered ? "#1d6534" : "#b91c1c" }}>{covered ? "✓ Covered" : "✗ Not covered"}</span>}
              </div>
            )}
            {captureMsg && <div style={{ fontSize: 11, color: "#c2410c", background: "#fff5ee", border: "1px solid #ffcc9944", borderRadius: 3, padding: "4px 6px", marginBottom: 8 }}>{captureMsg}</div>}
            <div style={{ borderTop: "1px solid #e0e8f0", paddingTop: 10, marginTop: 4 }}>
              {isAdmin ? (
                <>
                  <div style={{ fontSize: 10, color: "#5a6a82", marginBottom: 5, letterSpacing: 1 }}>SET SPREAD · negative = home favored</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <input type="number" value={spreadInput} onChange={e => setSpreadInput(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveSpread(); if (e.key === "Escape") { setFocusGame(null); setSpreadInput(""); } }}
                      placeholder="e.g. -7 or +5"
                      style={{ flex: 1, padding: "6px 8px", background: "#f7f9fc", border: "1px solid #c0d0e8", borderRadius: 4, color: "#0d1b2a", fontSize: 11, fontFamily: "'Inter', sans-serif", outline: "none" }} />
                    <button onClick={saveSpread} style={{ background: "#1a3a6b", border: "none", borderRadius: 4, color: "#fff", padding: "6px 10px", cursor: "pointer", fontSize: 11, fontWeight: "bold" }}>✓</button>
                    {spreads[game.id] !== undefined && (
                      <button onClick={clearSpread} style={{ background: "#fff0f0", border: "1px solid #ffcccc", color: "#b91c1c", padding: "6px 8px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>✕</button>
                    )}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "#5a6a82", textAlign: "center" }}>🔒 Spread editing requires admin access</div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  function RegionView({ region, filterPlayer = "All" }) {
    const rounds = [...new Set(games.filter(g => g.region === region).map(g => g.round))].sort((a, b) => a - b);
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {rounds.map(round => {
          const rGames = games.filter(g => g.region === region && g.round === round);
          return (
            <div key={round} style={{ flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: "#5a6a82", textAlign: "center", marginBottom: 8, fontWeight: "600" }}>{ROUND_LABELS[round] || `R${round}`}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {rGames.map(g => {
                  const involved = filterPlayer === "All" || [g.away, g.home].some(t => ownerAtRound(t.id, round) === filterPlayer);
                  return (
                    <div key={g.id} style={{ opacity: involved ? 1 : 0.2, transition: "opacity 0.15s" }}>
                      <GameCard game={g} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  function StandingsPanel() {
    if (players.length === 0) return null;
    const elim   = eliminationInfo.eliminated;
    const active = players.filter(p => !elim.includes(p)).sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
    return (
      <div style={{ background: "#ffffff", border: "1px solid #d0dcea", borderRadius: 6, padding: 10, boxShadow: "0 2px 12px #00000011", width: "100%" }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "#1a3a6b", marginBottom: 8, fontWeight: "bold" }}>STANDINGS</div>
        {active.length === 0 && elim.length === 0 && <div style={{ fontSize: 11, color: "#5a6a82" }}>No teams assigned yet.</div>}
        {active.map((p, i) => (
          <div key={p} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
            <span style={{ fontSize: 11, color: "#5a6a82", width: 12 }}>{i + 1}</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: getColor(p), flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 12, color: "#0d1b2a", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p}</span>
            <span style={{ fontSize: 13, fontWeight: "700", color: getColor(p) }}>{scores[p] || 0}</span>
          </div>
        ))}
        {elim.length > 0 && (
          <>
            <div style={{ borderTop: "1px solid #e0e8f0", margin: "8px 0 7px", paddingTop: 7, fontSize: 10, letterSpacing: 2, color: "#b91c1c", fontWeight: "bold" }}>ELIMINATED</div>
            {elim.map((p, i) => (
              <div key={p} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
                <span style={{ fontSize: 10, width: 12, flexShrink: 0 }}>{i === 0 ? "💀" : "✕"}</span>
                <span style={{ flex: 1, fontSize: 10, color: i === 0 ? "#b91c1c" : "#5a6a82", textDecoration: "line-through", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{p}</span>
                <span style={{ fontSize: 11, color: "#5a6a82", flexShrink: 0, whiteSpace: "nowrap" }}>{ROUND_LABELS[eliminationInfo.eliminatedInRound[p]] || `R${eliminationInfo.eliminatedInRound[p] || 0}`}</span>
              </div>
            ))}
          </>
        )}
        {firstEliminated && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "#fff5f5", border: "1px solid #ffcccc", borderRadius: 5, textAlign: "center" }}>
            <div style={{ fontSize: 11, color: "#b91c1c", letterSpacing: 1, marginBottom: 3 }}>💀 FIRST ELIMINATED</div>
            <div style={{ fontSize: 13, fontWeight: "bold", color: "#cc1111" }}>{firstEliminated}</div>
            <div style={{ fontSize: 10, color: "#aa6655", marginTop: 3 }}>last team out in {ROUND_LABELS[eliminationInfo.eliminatedInRound[firstEliminated]] || "Round ?"}</div>
          </div>
        )}
      </div>
    );
  }

  // ── Full bracket mini-card ─────────────────────────────────────────────────
  function MiniCard({ game }) {
    if (!game) return <div style={{ width: 160, height: 52, background: "#f7f9fc", borderRadius: 4, border: "1px solid #d0d8e8" }} />;
    const spread  = spreads[game.id] ?? game.spread;
    const winner  = game.away.winner ? game.away : game.home.winner ? game.home : null;
    const loser   = winner ? (winner === game.away ? game.home : game.away) : null;
    const covered = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;

    function MiniSlot({ team, isWinner, isLoser, round }) {
      if (!team) return null;
      const owner    = round ? ownerAtRound(team.id, round) : getOwner(team.id);
      const color    = owner ? getColor(owner) : "#0d1b2a";
      const captured = round && owner && assignments[team.id] && owner !== assignments[team.id];
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 6px", background: isWinner ? "#f0f7f0" : isLoser ? "#fdf2f2" : "#ffffff", borderLeft: `3px solid ${color}`, opacity: isLoser ? 0.7 : 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, color: "#5a6a82", width: 13, textAlign: "right", flexShrink: 0, fontWeight: "bold" }}>{team.seed || "?"}</span>
          <span style={{ fontSize: 11, flex: 1, fontWeight: isWinner ? "bold" : "normal", color: isWinner ? "#0d1b2a" : isLoser ? "#5a6a82" : "#0d1b2a", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
            {team.name?.split(" ").slice(0, 2).join(" ") || team.abbr || "TBD"}
          </span>
          {captured && <span style={{ fontSize: 10, color: "#c2410c", flexShrink: 0 }}>⚡</span>}
          {owner && <span style={{ fontSize: 11, padding: "1px 4px", borderRadius: 3, background: color, color: "#fff", fontWeight: "bold", maxWidth: 48, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", flexShrink: 0 }}>{owner.slice(0, 6)}</span>}
          {team.score != null && <span style={{ fontSize: 11, fontWeight: "bold", minWidth: 20, textAlign: "right", flexShrink: 0, color: isWinner ? "#1d6534" : "#5a6a82" }}>{team.score}</span>}
        </div>
      );
    }

    return (
      <div onClick={e => { e.stopPropagation(); setFocusGame(focusGame === game.id ? null : game.id); setSpreadInput(spread != null ? String(spread) : ""); }}
        style={{ width: 160, border: `1px solid ${game.inProgress ? "#16a34a" : "#dde3ed"}`, borderRadius: 4, overflow: "hidden", background: "#ffffff", cursor: "pointer", flexShrink: 0, boxShadow: "0 1px 3px #00000011" }}>
        <MiniSlot team={game.away} isWinner={game.away.winner} isLoser={game.home.winner} round={game.round} />
        <div style={{ height: 1, background: "#e8ecf4" }} />
        <MiniSlot team={game.home} isWinner={game.home.winner} isLoser={game.away.winner} round={game.round} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "2px 6px", background: "#f7f9fc", borderTop: "1px solid #e0e8f0" }}>
          <span style={{ fontSize: 10, color: game.inProgress ? "#1d6534" : "#5a6a82" }}>
            {game.inProgress ? `● ${game.statusDetail || "LIVE"}` : game.completed ? "FINAL" : "SCHED"}
          </span>
          {spread != null ? (
            <span style={{ fontSize: 11, fontWeight: "bold", color: covered === true ? "#1d6534" : covered === false ? "#b91c1c" : "#5a6a82" }}>
              {spread > 0 ? `+${spread}` : spread}{covered === true ? " ✓" : covered === false ? " ✗" : ""}
            </span>
          ) : <span style={{ fontSize: 10, color: "#5a6a82" }}>+ sprd</span>}
        </div>
      </div>
    );
  }

  const CARD_H  = 72;
  const CARD_GAP = 8;
  const SLOT    = CARD_H + CARD_GAP;
  const TOTAL_H = 8 * SLOT - CARD_GAP;
  const COL_W   = 168;
  const NUM_ROUNDS = 4;

  function cy(r, i) {
    if (r === 1) return i * SLOT + CARD_H / 2;
    return (cy(r - 1, 2 * i) + cy(r - 1, 2 * i + 1)) / 2;
  }
  function topY(r, i) { return cy(r, i) - CARD_H / 2; }

  function RegionHalf({ region, dir, filterPlayer = "All" }) {
    const cols = [];
    for (let r = 1; r <= NUM_ROUNDS; r++) {
      const rGames   = games.filter(g => g.region === region && g.round === r);
      const colIndex = dir === "ltr" ? r - 1 : NUM_ROUNDS - r;
      const x        = colIndex * COL_W;
      rGames.forEach((g, i) => {
        const involved = filterPlayer === "All" || [g.away, g.home].some(t => ownerAtRound(t.id, r) === filterPlayer);
        cols.push(
          <div key={`${r}-${i}`} style={{ position: "absolute", left: x, top: topY(r, i), width: 160, opacity: involved ? 1 : 0.2, transition: "opacity 0.15s" }}>
            <MiniCard game={g} />
          </div>
        );
      });
    }
    return <div style={{ position: "relative", width: NUM_ROUNDS * COL_W, height: TOTAL_H, flexShrink: 0 }}>{cols}</div>;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  const displayRegions = activeRegion === "All"
    ? (allRegions.length > 0 ? allRegions : ["South", "East", "West", "Midwest"])
    : [activeRegion];

  const ff    = games.filter(g => g.round === 5);
  const champ = games.filter(g => g.round === 6);

  return (
    <div style={{ minHeight: "100vh", background: "#f0f2f5", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#0d1b2a" }}>

      {/* ── Header ── */}
      <div style={{ background: "#0d1b2a", borderBottom: "2px solid #1a3a6b", padding: "12px 16px", position: "sticky", top: 0, zIndex: 100, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 17, fontWeight: "700", letterSpacing: 1, color: "#fff" }}>🏀 MARCH MADNESS 2026</div>
          <div style={{ fontSize: 11, letterSpacing: 0.5, color: "#4a90d9", marginTop: 2 }}>SPREAD BRACKET</div>
        </div>
        <div style={{ display: "flex", gap: 5, marginLeft: "auto", alignItems: "center" }}>
          {[["bracket", "BRACKET"], ["full", "FULL"], ["rules", "RULES"], ...(isAdmin ? [["setup", "SETUP"]] : [])].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ background: tab === k ? "#4a9eff22" : "none", border: `1px solid ${tab === k ? "#4a90d9" : "#1a3a6b"}`, color: tab === k ? "#4a90d9" : "#7a9cc0", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 10, letterSpacing: 1, fontFamily: "inherit" }}>{l}</button>
          ))}
          <button onClick={() => { if (isAdmin) { setIsAdmin(false); setShowAdminLogin(false); setAdminInput(""); setAdminError(false); setTab("full"); } else setShowAdminLogin(v => !v); }}
            title={isAdmin ? "Lock admin" : "Unlock admin"}
            style={{ background: isAdmin ? "#00cc6622" : "none", border: `1px solid ${isAdmin ? "#16a34a" : "#5a6a82"}`, color: isAdmin ? "#16a34a" : "#7a9cc0", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 13, lineHeight: 1, marginLeft: 4 }}>
            {isAdmin ? "🔓" : "🔒"}
          </button>
        </div>
        {showAdminLogin && !isAdmin && (
          <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, paddingTop: 8, borderTop: "1px solid #1a3a6b", marginTop: 4 }}>
            <span style={{ fontSize: 11, color: "#7a9cc0", whiteSpace: "nowrap" }}>ADMIN PASSWORD:</span>
            <input type="password" value={adminInput} autoFocus
              onChange={e => { setAdminInput(e.target.value); setAdminError(false); }}
              onKeyDown={e => {
                if (e.key === "Enter") { if (adminInput === ADMIN_PASSWORD) { setIsAdmin(true); setShowAdminLogin(false); setAdminInput(""); } else { setAdminError(true); setAdminInput(""); } }
                if (e.key === "Escape") { setShowAdminLogin(false); setAdminInput(""); setAdminError(false); }
              }}
              placeholder="Enter password…"
              style={{ padding: "4px 8px", background: "#0d1828", border: `1px solid ${adminError ? "#b91c1c" : "#2a4060"}`, borderRadius: 4, color: "#fff", fontSize: 11, fontFamily: "inherit", outline: "none", width: 180 }} />
            <button onClick={() => { if (adminInput === ADMIN_PASSWORD) { setIsAdmin(true); setShowAdminLogin(false); setAdminInput(""); } else { setAdminError(true); setAdminInput(""); } }}
              style={{ background: "#1a3a6b", border: "none", borderRadius: 4, color: "#fff", padding: "4px 12px", cursor: "pointer", fontSize: 11, fontWeight: "bold", fontFamily: "inherit" }}>Unlock</button>
            {adminError && <span style={{ fontSize: 11, color: "#b91c1c" }}>Incorrect password</span>}
            <button onClick={() => { setShowAdminLogin(false); setAdminInput(""); setAdminError(false); }} style={{ background: "none", border: "none", color: "#5a6a82", cursor: "pointer", fontSize: 13, padding: "0 4px" }}>✕</button>
          </div>
        )}
      </div>

      {/* ── SETUP TAB ── */}
      {tab === "setup" && (
        <div style={{ padding: 24, maxWidth: 1060, margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 180px", gap: 24 }}>
            {/* Players */}
            <div>
              <div style={{ fontSize: 13, letterSpacing: 2, color: "#1a3a6b", marginBottom: 14, fontWeight: "bold" }}>PLAYERS</div>
              <PlayerInput value={inputValue} onChange={setInputValue} onAdd={addPlayer} />
              {players.length === 0 && <div style={{ fontSize: 11, color: "#5a6a82", lineHeight: 1.7 }}>No players yet.<br />Type a name and press Enter or +.</div>}
              {players.map((p, i) => {
                const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
                const count = Object.values(assignments).filter(a => a === p).length;
                return (
                  <div key={p} onClick={() => setSelectedPlayer(selectedPlayer === p ? null : p)}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: selectedPlayer === p ? color + "22" : "#ffffff", border: `1px solid ${selectedPlayer === p ? color : "#dde3ed"}`, borderRadius: 5, cursor: "pointer", marginBottom: 6, transition: "all 0.15s" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
                    <span style={{ flex: 1, fontSize: 12, color: "#0d1b2a" }}>{p}</span>
                    <span style={{ fontSize: 11, color: "#5a6a82" }}>{count} teams</span>
                    <button onClick={e => { e.stopPropagation(); removePlayer(p); }} style={{ background: "none", border: "none", color: "#5a6a82", cursor: "pointer", fontSize: 12, padding: "0 2px" }}>✕</button>
                  </div>
                );
              })}
              {selectedPlayer && <div style={{ marginTop: 10, padding: 10, background: "#05080f", border: `1px solid ${getColor(selectedPlayer)}55`, borderRadius: 5, fontSize: 11, color: "#778" }}>Click a team → assign to <strong style={{ color: getColor(selectedPlayer) }}>{selectedPlayer}</strong></div>}
              {Object.keys(assignments).length > 0 && <button onClick={() => setAssignments({})} style={{ marginTop: 14, background: "none", border: "1px solid #441111", color: "#aa4444", padding: "5px 12px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: "inherit" }}>Clear All</button>}
            </div>

            {/* Team assignment grid */}
            <div>
              <div style={{ fontSize: 13, letterSpacing: 2, color: "#1a3a6b", marginBottom: 4, fontWeight: "bold" }}>ASSIGN TEAMS</div>
              <div style={{ fontSize: 11, color: "#5a6a82", marginBottom: 14 }}>One team per region per player.</div>
              {Object.keys(teamsByRegion).sort().map(region => {
                const regionIds  = teamsByRegion[region].map(t => t.id);
                const alreadyHere = selectedPlayer ? regionIds.some(tid => assignments[tid] === selectedPlayer) : false;
                return (
                  <div key={region} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                      <div style={{ fontSize: 11, letterSpacing: 2, color: REGION_COLORS[region] || "#5a6a82" }}>{region.toUpperCase()}</div>
                      {alreadyHere && selectedPlayer && <div style={{ fontSize: 11, color: "#ff8c00", background: "#1a1000", border: "1px solid #ff8c0044", borderRadius: 3, padding: "1px 5px" }}>{selectedPlayer} already picked here</div>}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                      {teamsByRegion[region].sort((a, b) => (a.seed || 99) - (b.seed || 99)).map(team => {
                        const owner   = assignments[team.id];
                        const color   = owner ? getColor(owner) : "#0d1b2a";
                        const blocked = !!selectedPlayer && !owner && alreadyHere;
                        return (
                          <div key={team.id} onClick={() => !blocked && !owner && assignTeam(team.id)}
                            title={owner ? `${team.name} → ${owner}` : blocked ? `${selectedPlayer} already has a team in ${region}` : selectedPlayer ? `Assign to ${selectedPlayer}` : team.name}
                            style={{ padding: "4px 8px", borderRadius: 3, background: owner ? color + "22" : "transparent", border: `1px solid ${blocked ? "#222" : color}`, fontSize: 11, color: owner ? color : blocked ? "#2a2a2a" : "#5a6a82", cursor: selectedPlayer && !blocked && !owner ? "pointer" : "default", opacity: blocked ? 0.3 : 1, transition: "all 0.12s" }}>
                            {team.seed} {team.abbr}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Standings */}
            <div>
              <div style={{ fontSize: 13, letterSpacing: 2, color: "#1a3a6b", marginBottom: 14, fontWeight: "bold" }}>LIVE STANDINGS</div>
              <StandingsPanel />
            </div>
          </div>
        </div>
      )}

      {/* ── RULES TAB ── */}
      {tab === "rules" && (
        <div style={{ padding: 24, maxWidth: 560, margin: "0 auto" }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: "#1a3a6b", marginBottom: 14 }}>HOW THE SPREAD BRACKET WORKS</div>
          {[
            ["✓ COVERS",         "#16a34a", "Favorite wins AND covers the spread. Their owner advances normally."],
            ["✗ NO COVER",       "#b91c1c", "Favorite wins but DOESN'T cover. The losing team's owner steals the winning team and moves on with it — look for ⚡."],
            ["UPSET",            "#FFD93D", "Underdog wins outright = automatic cover. Winner's owner keeps them."],
            ["⚡ CAPTURED",      "#c2410c", "A team was stolen mid-tournament due to a no-cover."],
            ["💀 FIRST ELIM.",   "#b91c1c", "The first player to lose all of their teams across all regions."],
          ].map(([t, c, d]) => (
            <div key={t} style={{ marginBottom: 10, padding: 12, background: "#ffffff", border: `1px solid ${c}44`, borderLeft: `3px solid ${c}`, borderRadius: 5, boxShadow: "0 1px 4px #00000011" }}>
              <div style={{ fontSize: 10, fontWeight: "bold", color: c, marginBottom: 3 }}>{t}</div>
              <div style={{ fontSize: 10, color: "#5a6a82", lineHeight: 1.6 }}>{d}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── BRACKET TAB ── */}
      {tab === "bracket" && (
        <div style={{ display: "flex", alignItems: "flex-start" }}>
          <div style={{ flex: 1, padding: "12px 14px", minWidth: 0, overflowX: "auto" }} onClick={() => { if (focusGame) { setFocusGame(null); setSpreadInput(""); } }}>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {["All", "South", "East", "West", "Midwest", "Final Four", "Championship"].map(r => {
                  const has = r === "All" || games.some(g => g.region === r);
                  if (!has) return null;
                  return <button key={r} onClick={e => { e.stopPropagation(); setActiveRegion(r); }} style={{ background: activeRegion === r ? (REGION_COLORS[r] || "#1a3a6b") + "22" : "#ffffff", border: `1px solid ${activeRegion === r ? (REGION_COLORS[r] || "#1a3a6b") : "#dde3ed"}`, color: activeRegion === r ? (REGION_COLORS[r] || "#1a3a6b") : "#5a6a82", padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 11, letterSpacing: 1, fontFamily: "inherit", fontWeight: activeRegion === r ? "bold" : "normal" }}>{r.toUpperCase()}</button>;
                })}
              </div>
              {players.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
                  <span style={{ fontSize: 11, color: "#5a6a82", letterSpacing: 1 }}>SHOW:</span>
                  <select value={filterPlayer} onChange={e => setFilterPlayer(e.target.value)} style={{ padding: "4px 8px", background: "#ffffff", border: "1px solid #c0d0e8", borderRadius: 4, color: "#0d1b2a", fontSize: 11, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
                    <option value="All">All Players</option>
                    {players.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
            {loading ? (
              <div style={{ padding: 60, textAlign: "center", color: "#5a6a82", fontSize: 11, letterSpacing: 3 }}>
                <div style={{ fontSize: 28, marginBottom: 14 }}>🏀</div>LOADING...
              </div>
            ) : (
              displayRegions.map(region => (
                <div key={region} style={{ marginBottom: 28 }}>
                  <div style={{ fontSize: 16, letterSpacing: 0.5, marginBottom: 12, color: REGION_COLORS[region] || "#1a3a6b", borderBottom: `2px solid ${(REGION_COLORS[region] || "#1a3a6b")}55`, paddingBottom: 6, fontWeight: "bold" }}>
                    {region.toUpperCase()} REGION
                  </div>
                  <RegionView region={region} filterPlayer={filterPlayer} />
                </div>
              ))
            )}
          </div>
          <div style={{ width: 200, flexShrink: 0, padding: "12px 12px 12px 0", position: "sticky", top: 60, alignSelf: "flex-start" }}>
            <StandingsPanel />
          </div>
        </div>
      )}

      {/* ── FULL BRACKET TAB ── */}
      {tab === "full" && (
        <div style={{ padding: "16px 12px", overflowX: "auto" }} onClick={() => { if (focusGame) { setFocusGame(null); setSpreadInput(""); } }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, minWidth: NUM_ROUNDS * COL_W * 2 + 220 }}>
            <span style={{ fontSize: 15, fontWeight: "bold", letterSpacing: 2, color: "#0d1b2a" }}>🏀 FULL BRACKET 2026</span>
            {players.length > 0 && (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "#5a6a82", letterSpacing: 1 }}>SHOW:</span>
                <select value={filterPlayer} onChange={e => setFilterPlayer(e.target.value)} onClick={e => e.stopPropagation()} style={{ padding: "4px 8px", background: "#ffffff", border: "1px solid #c0d0e8", borderRadius: 4, color: "#0d1b2a", fontSize: 11, fontFamily: "inherit", cursor: "pointer", outline: "none" }}>
                  <option value="All">All Players</option>
                  {players.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "flex-start", gap: 0, minWidth: "max-content" }}>
            {/* Left half */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24, flexShrink: 0 }}>
              {["South", "West"].map(r => (
                <div key={r}>
                  <div style={{ fontSize: 13, letterSpacing: 2, color: REGION_COLORS[r], marginBottom: 6, fontWeight: "bold", borderBottom: `2px solid ${REGION_COLORS[r]}44`, paddingBottom: 4 }}>{r.toUpperCase()}</div>
                  <RegionHalf region={r} dir="ltr" filterPlayer={filterPlayer} />
                </div>
              ))}
            </div>

            {/* Center: FF + Champ */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, flexShrink: 0, width: 220, height: TOTAL_H * 2 + 24 + 44, paddingTop: 22 }}>
              <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 2, color: "#854d0e", marginBottom: 4 }}>FINAL FOUR</div>
              {ff[0] && <div style={{ opacity: filterPlayer === "All" || [ff[0].away, ff[0].home].some(t => ownerAtRound(t.id, 5) === filterPlayer) ? 1 : 0.2 }}><MiniCard game={ff[0]} /></div>}
              <div style={{ height: 8 }} />
              <div style={{ fontSize: 11, fontWeight: "bold", letterSpacing: 2, color: "#7c5cbf", margin: "4px 0" }}>🏆 CHAMPIONSHIP</div>
              {champ[0] && <div style={{ opacity: filterPlayer === "All" || [champ[0].away, champ[0].home].some(t => ownerAtRound(t.id, 6) === filterPlayer) ? 1 : 0.2 }}><MiniCard game={champ[0]} /></div>}
              <div style={{ height: 8 }} />
              {ff[1] && <div style={{ opacity: filterPlayer === "All" || [ff[1].away, ff[1].home].some(t => ownerAtRound(t.id, 5) === filterPlayer) ? 1 : 0.2 }}><MiniCard game={ff[1]} /></div>}
            </div>

            {/* Right half */}
            <div style={{ display: "flex", flexDirection: "column", gap: 24, flexShrink: 0 }}>
              {["East", "Midwest"].map(r => (
                <div key={r}>
                  <div style={{ fontSize: 13, letterSpacing: 2, color: REGION_COLORS[r], textAlign: "right", marginBottom: 6, fontWeight: "bold", borderBottom: `2px solid ${REGION_COLORS[r]}44`, paddingBottom: 4 }}>{r.toUpperCase()}</div>
                  <RegionHalf region={r} dir="rtl" filterPlayer={filterPlayer} />
                </div>
              ))}
            </div>
          </div>

          {/* Full bracket popup */}
          {focusGame && (() => {
            const game    = games.find(g => g.id === focusGame);
            if (!game) return null;
            const spread  = spreads[game.id] ?? game.spread;
            const winner  = game.away.winner ? game.away : game.home.winner ? game.home : null;
            const loser   = winner ? (winner === game.away ? game.home : game.away) : null;
            const covered = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
            const lOwner  = loser ? getOwner(loser.id) : null;
            const captureMsg = covered === false && lOwner ? `⚡ ${lOwner} captures ${winner?.name}!` : null;
            const saveS   = () => { const v = parseFloat(spreadInput); if (!isNaN(v)) setSpreads(p => ({ ...p, [game.id]: v })); setFocusGame(null); setSpreadInput(""); };
            return (
              <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 999, background: "#ffffff", border: "1px solid #c0d0e8", borderRadius: 8, padding: 16, width: 260, boxShadow: "0 16px 64px #00000033" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <span style={{ fontSize: 11, color: REGION_COLORS[game.region] || "#1a3a6b", letterSpacing: 1 }}>{game.region?.toUpperCase()} · R{game.round}</span>
                  <button onClick={() => { setFocusGame(null); setSpreadInput(""); }} style={{ background: "#f7f9fc", border: "1px solid #c0d0e8", color: "#5a6a82", width: 22, height: 22, borderRadius: 3, cursor: "pointer", fontSize: 13, lineHeight: 1, padding: 0 }}>✕</button>
                </div>
                <div style={{ fontSize: 12, color: "#5a6a82", marginBottom: 8 }}>{game.away.name} vs {game.home.name}</div>
                {(game.away.score != null || game.home.score != null) && <div style={{ fontSize: 20, fontWeight: "bold", color: "#0d1b2a", marginBottom: 10 }}>{game.away.score} – {game.home.score}</div>}
                {spread != null && <div style={{ fontSize: 11, color: "#5a6a82", marginBottom: 8 }}>Spread: <span style={{ color: "#0d1b2a" }}>{spread > 0 ? `+${spread}` : spread}</span>{covered != null && <span style={{ marginLeft: 8, color: covered ? "#1d6534" : "#b91c1c" }}>{covered ? "✓ Covered" : "✗ Not covered"}</span>}</div>}
                {captureMsg && <div style={{ fontSize: 10, color: "#c2410c", background: "#fff5ee", border: "1px solid #ffcc9944", borderRadius: 3, padding: "5px 8px", marginBottom: 10 }}>{captureMsg}</div>}
                <div style={{ borderTop: "1px solid #e0e8f0", paddingTop: 10 }}>
                  {isAdmin ? (
                    <>
                      <div style={{ fontSize: 10, color: "#5a6a82", marginBottom: 6, letterSpacing: 1 }}>SET SPREAD · neg = home favored</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input type="number" value={spreadInput} onChange={e => setSpreadInput(e.target.value)}
                          onKeyDown={e => { if (e.key === "Enter") saveS(); if (e.key === "Escape") { setFocusGame(null); setSpreadInput(""); } }}
                          placeholder="e.g. -7"
                          style={{ flex: 1, padding: "6px 8px", background: "#f7f9fc", border: "1px solid #c0d0e8", borderRadius: 4, color: "#0d1b2a", fontSize: 12, fontFamily: "inherit", outline: "none" }} />
                        <button onClick={saveS} style={{ background: "#1a3a6b", border: "none", borderRadius: 4, color: "#fff", padding: "6px 12px", cursor: "pointer", fontSize: 13, fontWeight: "bold" }}>✓</button>
                        {spreads[game.id] !== undefined && <button onClick={() => { setSpreads(p => { const n = { ...p }; delete n[game.id]; return n; }); setFocusGame(null); setSpreadInput(""); }} style={{ background: "#fff0f0", border: "1px solid #ffcccc", color: "#b91c1c", padding: "6px 8px", borderRadius: 4, cursor: "pointer" }}>✕</button>}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 11, color: "#5a6a82", textAlign: "center" }}>🔒 Spread editing requires admin access</div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}