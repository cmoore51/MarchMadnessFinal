import { useState, useEffect, useCallback, memo } from 'react';
import { ROUND_LABELS, REGION_COLORS, PLAYER_COLORS, ADMIN_PASSWORD } from './constants';
import { getLiveGames } from './api';
import { makeDemoGames } from './demoData';
import { storage } from './storage';
import './index.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
function didCover(winScore, loseScore, spread) {
  if (spread == null) return null;
  return spread < 0 ? (winScore - loseScore) > Math.abs(spread) : true;
}

function getColor(players, p) {
  const i = players.indexOf(p);
  return i >= 0 ? PLAYER_COLORS[i % PLAYER_COLORS.length] : '#5a6a82';
}

// ── Components (defined outside App to avoid re-creation on render) ───────────

const PlayerInput = memo(({ value, onChange, onAdd }) => (
  <div className="player-input">
    <input className="player-input__field" type="text" value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
      placeholder="Enter player name…" />
    <button className="player-input__add" onClick={onAdd}>+</button>
  </div>
));

function TeamSlot({ team, isWinner, isLoser, showScore, round, players, assignments, ownerAtRound, getOwner, assignTeam, isAdmin, tab, selectedPlayer }) {
  if (!team) return null;
  const owner     = round ? ownerAtRound(team.id, round) : getOwner(team.id);
  const color     = owner ? getColor(players, owner) : '#1e2d42';
  const captured  = round && owner && assignments[team.id] && owner !== assignments[team.id];
  const canAssign = isAdmin && tab === 'setup' && selectedPlayer && team.id && team.name !== 'TBD';
  return (
    <div onClick={e => { if (canAssign) { e.stopPropagation(); assignTeam(team.id); } }}
      className={`team-slot${isWinner ? ' team-slot--winner' : ''}${isLoser ? ' team-slot--loser' : ''}${canAssign ? ' team-slot--assignable' : ''}`}
      style={{ borderLeft: `4px solid ${color}`, cursor: canAssign ? 'pointer' : 'default' }}>
      <span className="team-slot__seed">{team.seed || '?'}</span>
      <span className={`team-slot__name${isWinner ? ' team-slot__name--winner' : ''}${isLoser ? ' team-slot__name--loser' : ''}`}>
        {team.name?.split(' ').slice(0, 2).join(' ') || team.abbr || 'TBD'}
      </span>
      {captured && <span className="team-slot__capture" title="Captured">⚡</span>}
      {owner && <span className="team-slot__owner" style={{ background: color }}>{owner.slice(0, 7)}</span>}
      {showScore && team.score != null && (
        <span className={`team-slot__score${isWinner ? ' team-slot__score--winner' : ' team-slot__score--loser'}`}>{team.score}</span>
      )}
      {isWinner && <span className="team-slot__arrow">▶</span>}
    </div>
  );
}

function SpreadPopupBody({ game, fixed, spreads, spreadInput, setSpreadInput, saveSpread, clearSpread, closeCard, isAdmin, ownerAtRound }) {
  const spread     = spreads[game.id] ?? game.spread;
  const winner     = game.away.winner ? game.away : game.home.winner ? game.home : null;
  const loser      = winner ? (winner === game.away ? game.home : game.away) : null;
  const covered    = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
  const lOwner     = loser ? ownerAtRound(loser.id, game.round) : null;
  const captureMsg = covered === false && lOwner ? `⚡ ${lOwner} captures ${winner?.name}!` : null;
  const hasScores  = game.away.score != null || game.home.score != null;
  return (
    <div className={fixed ? 'bracket-popup-overlay' : 'spread-popup'} onClick={e => e.stopPropagation()}>
      <div className="spread-popup__header">
        <span className="spread-popup__region" style={{ color: REGION_COLORS[game.region] || '#1a3a6b' }}>
          {game.region?.toUpperCase()} · {game.roundLabel?.toUpperCase()}
        </span>
        <button className="spread-popup__close" onClick={closeCard}>✕</button>
      </div>
      <div className="spread-popup__matchup">{game.away.name} vs {game.home.name}</div>
      {hasScores && <div className="spread-popup__score">{game.away.score} – {game.home.score}</div>}
      {spread != null && (
        <div className="spread-popup__info">
          Spread: <strong>{spread > 0 ? `+${spread}` : spread}</strong>
          {covered != null && <span style={{ marginLeft: 8, color: covered ? '#1d6534' : '#b91c1c' }}>{covered ? '✓ Covered' : '✗ Not covered'}</span>}
        </div>
      )}
      {captureMsg && <div className="spread-popup__capture">{captureMsg}</div>}
      <div className="spread-popup__divider">
        {isAdmin ? (
          <>
            <div className="spread-popup__input-label">SET SPREAD · negative = home favored</div>
            <div className="spread-popup__input-row">
              <input className="spread-popup__input" type="number" value={spreadInput}
                onChange={e => setSpreadInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveSpread(game.id); if (e.key === 'Escape') closeCard(); }}
                placeholder="e.g. -7 or +5" />
              <button className="spread-popup__save" onClick={() => saveSpread(game.id)}>✓</button>
              {spreads[game.id] !== undefined && <button className="spread-popup__clear" onClick={() => clearSpread(game.id)}>✕</button>}
            </div>
          </>
        ) : (
          <div className="spread-popup__locked">🔒 Spread editing requires admin access</div>
        )}
      </div>
    </div>
  );
}

function GameCard({ game, spreads, focusGame, openCard, closeCard, spreadInput, setSpreadInput, saveSpread, clearSpread, players, assignments, ownerAtRound, getOwnerFn, isAdmin, tab, selectedPlayer, assignTeam }) {
  const spread     = spreads[game.id] ?? game.spread;
  const winner     = game.away.winner ? game.away : game.home.winner ? game.home : null;
  const loser      = winner ? (winner === game.away ? game.home : game.away) : null;
  const covered    = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
  const hasScores  = game.away.score != null || game.home.score != null;
  const isFocused  = focusGame === game.id;
  const spreadClass = covered === true ? 'game-card__spread--covered' : covered === false ? 'game-card__spread--uncovered' : 'game-card__spread--neutral';
  const slotProps  = { players, assignments, ownerAtRound, getOwner: getOwnerFn, assignTeam, isAdmin, tab, selectedPlayer };
  return (
    <div className={`game-card${game.inProgress ? ' game-card--live' : ''}`}
      style={{ borderLeftColor: game.inProgress ? '#16a34a' : REGION_COLORS[game.region] || '#2a3a5a' }}>
      <div onClick={() => isFocused ? closeCard() : openCard(game)}>
        <TeamSlot team={game.away} isWinner={game.away.winner} isLoser={game.home.winner} showScore={hasScores} round={game.round} {...slotProps} />
        <div className="game-card__divider" />
        <TeamSlot team={game.home} isWinner={game.home.winner} isLoser={game.away.winner} showScore={hasScores} round={game.round} {...slotProps} />
        <div className="game-card__footer">
          <span className={`game-card__status${game.inProgress ? ' game-card__status--live' : ''}`}>
            {game.inProgress ? `● ${game.statusDetail || 'LIVE'}` : game.completed ? 'FINAL' : 'SCHED'}
          </span>
          {spread != null
            ? <span className={`game-card__spread ${spreadClass}`}>{spread > 0 ? `+${spread}` : spread}{covered === true ? ' ✓' : covered === false ? ' ✗' : ''}</span>
            : <span className="game-card__spread-add">+ spread</span>}
        </div>
      </div>
      {isFocused && <SpreadPopupBody game={game} fixed={false} spreads={spreads} spreadInput={spreadInput} setSpreadInput={setSpreadInput} saveSpread={saveSpread} clearSpread={clearSpread} closeCard={closeCard} isAdmin={isAdmin} ownerAtRound={ownerAtRound} />}
    </div>
  );
}

function MiniSlot({ team, isWinner, isLoser, round, players, assignments, ownerAtRound, getOwnerFn }) {
  if (!team) return null;
  const owner    = round ? ownerAtRound(team.id, round) : getOwnerFn(team.id);
  const color    = owner ? getColor(players, owner) : '#0d1b2a';
  const captured = round && owner && assignments[team.id] && owner !== assignments[team.id];
  return (
    <div className={`mini-slot${isWinner ? ' mini-slot--winner' : ''}${isLoser ? ' mini-slot--loser' : ''}`}
      style={{ borderLeft: `3px solid ${color}` }}>
      <span className="mini-slot__seed">{team.seed || '?'}</span>
      <span className={`mini-slot__name${isWinner ? ' mini-slot__name--winner' : ''}${isLoser ? ' mini-slot__name--loser' : ''}`}>
        {team.name?.split(' ').slice(0, 2).join(' ') || team.abbr || 'TBD'}
      </span>
      {captured && <span className="mini-slot__capture">⚡</span>}
      {owner && <span className="mini-slot__owner" style={{ background: color }}>{owner.slice(0, 6)}</span>}
      {team.score != null && <span className={`mini-slot__score${isWinner ? ' mini-slot__score--winner' : ' mini-slot__score--loser'}`}>{team.score}</span>}
    </div>
  );
}

function MiniCard({ game, spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn }) {
  if (!game) return <div className="mini-card--placeholder" />;
  const spread   = spreads[game.id] ?? game.spread;
  const winner   = game.away.winner ? game.away : game.home.winner ? game.home : null;
  const loser    = winner ? (winner === game.away ? game.home : game.away) : null;
  const covered  = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
  const sc       = covered === true ? 'mini-card__spread--covered' : covered === false ? 'mini-card__spread--uncovered' : 'mini-card__spread--neutral';
  const isFocused = focusGame === game.id;
  const slotProps = { players, assignments, ownerAtRound, getOwnerFn };
  return (
    <div className={`mini-card${game.inProgress ? ' mini-card--live' : ''}`}
      onClick={e => { e.stopPropagation(); isFocused ? closeCard() : openCard(game); }}>
      <MiniSlot team={game.away} isWinner={game.away.winner} isLoser={game.home.winner} round={game.round} {...slotProps} />
      <div className="game-card__divider" />
      <MiniSlot team={game.home} isWinner={game.home.winner} isLoser={game.away.winner} round={game.round} {...slotProps} />
      <div className="mini-card__footer">
        <span className={`mini-card__status${game.inProgress ? ' mini-card__status--live' : ''}`}>
          {game.inProgress ? '● LIVE' : game.completed ? 'FINAL' : 'SCHED'}
        </span>
        {spread != null
          ? <span className={`mini-card__spread ${sc}`}>{spread > 0 ? `+${spread}` : spread}{covered === true ? ' ✓' : covered === false ? ' ✗' : ''}</span>
          : <span className="mini-card__spread mini-card__spread--neutral">+ sprd</span>}
      </div>
    </div>
  );
}

function BracketColumn({ games, region, round, fp, players, assignments, spreads, focusGame, openCard, closeCard, ownerAtRound, getOwnerFn }) {
  const rGames   = games.filter(g => g.region === region && g.round === round);
  const groupSize = Math.pow(2, round - 1);
  const cardProps = { spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn };
  return (
    <div className="bracket-col">
      {rGames.map(g => {
        const involved = fp === 'All' || [g.away, g.home].some(t => ownerAtRound(t.id, round) === fp);
        return (
          <div key={g.id} className="bracket-col__slot" style={{ flex: groupSize }}>
            <div className={involved ? 'fade-full' : 'fade-dim'}>
              <MiniCard game={g} {...cardProps} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RegionStrip({ games, region, dir, fp, players, assignments, spreads, focusGame, openCard, closeCard, ownerAtRound, getOwnerFn }) {
  const rounds        = [1, 2, 3, 4];
  const orderedRounds = dir === 'ltr' ? rounds : [...rounds].reverse();
  const colProps      = { games, region, fp, players, assignments, spreads, focusGame, openCard, closeCard, ownerAtRound, getOwnerFn };
  return (
    <div className="region-strip">
      <div className={`region-strip__title${dir === 'rtl' ? ' region-strip__title--right' : ''}`}
        style={{ color: REGION_COLORS[region], borderBottomColor: REGION_COLORS[region] + '55' }}>
        {region}
      </div>
      <div className="region-strip__rounds">
        {orderedRounds.map(r => <BracketColumn key={r} round={r} {...colProps} />)}
      </div>
    </div>
  );
}

function StandingsPanel({ players, scores, eliminationInfo, getColorFn }) {
  if (players.length === 0) return null;
  const elim   = eliminationInfo.eliminated;
  const active = players.filter(p => !elim.includes(p)).sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const firstEliminated = elim[0] || null;
  return (
    <div className="standings">
      <div className="section-title">Standings</div>
      {active.length === 0 && elim.length === 0 && <div style={{ fontSize: 12, color: '#7a8a9a' }}>No teams assigned yet.</div>}
      {active.map((p, i) => (
        <div key={p} className="standings__row">
          <span className="standings__rank">{i + 1}</span>
          <span className="standings__dot" style={{ background: getColorFn(p) }} />
          <span className="standings__name">{p}</span>
          <span className="standings__score" style={{ color: getColorFn(p) }}>{scores[p] || 0}</span>
        </div>
      ))}
      {elim.length > 0 && (
        <>
          <div className="standings__elim-title">Eliminated</div>
          {elim.map((p, i) => (
            <div key={p} className="standings__elim-row">
              <span className="standings__elim-icon">{i === 0 ? '💀' : '✕'}</span>
              <span className="standings__elim-name">{p}</span>
              <span className="standings__elim-round">{ROUND_LABELS[eliminationInfo.eliminatedInRound[p]] || `R${eliminationInfo.eliminatedInRound[p]}`}</span>
            </div>
          ))}
        </>
      )}
      {firstEliminated && (
        <div className="standings__first-out">
          <div className="standings__first-out-label">💀 First Eliminated</div>
          <div className="standings__first-out-name">{firstEliminated}</div>
          <div className="standings__first-out-sub">out in {ROUND_LABELS[eliminationInfo.eliminatedInRound[firstEliminated]] || 'Round ?'}</div>
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]         = useState('full');
  const [games, setGames]     = useState([]);
  const [loading, setLoading] = useState(true);

  const [players, setPlayers]               = useState([]);
  const [assignments, setAssignments]       = useState({});
  const [spreads, setSpreads]               = useState({});
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [inputValue, setInputValue]         = useState('');
  const [storageReady, setStorageReady]     = useState(false);

  const [activeRegion, setActiveRegion] = useState('All');
  const [filterPlayer, setFilterPlayer] = useState('All');
  const [focusGame, setFocusGame]       = useState(null);
  const [spreadInput, setSpreadInput]   = useState('');

  const [isAdmin, setIsAdmin]               = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminInput, setAdminInput]         = useState('');
  const [adminError, setAdminError]         = useState(false);

  // ── Load from storage on mount ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [p, a, s] = await Promise.all([
          storage.get('bracket:players'),
          storage.get('bracket:assignments'),
          storage.get('bracket:spreads'),
        ]);
        if (p) setPlayers(JSON.parse(p.value));
        if (a) setAssignments(JSON.parse(a.value));
        if (s) setSpreads(JSON.parse(s.value));
      } catch { /* no saved data yet */ }
      setStorageReady(true);
    })();
  }, []);

  // ── Persist on change ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!storageReady) return;
    storage.set('bracket:players', JSON.stringify(players)).catch(() => {});
  }, [players, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    storage.set('bracket:assignments', JSON.stringify(assignments)).catch(() => {});
  }, [assignments, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    storage.set('bracket:spreads', JSON.stringify(spreads)).catch(() => {});
  }, [spreads, storageReady]);

  // ── Load game data ─────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const live = await getLiveGames();
        setGames(live.length > 0 ? live : makeDemoGames());
      } catch { setGames(makeDemoGames()); }
      setLoading(false);
    })();
  }, []);

  // ── Ownership computation ──────────────────────────────────────────────────
  const ownership = (() => {
    const own = {};
    Object.entries(assignments).forEach(([tid, p]) => { own[tid] = { owner: p, capturedFrom: null }; });
    [...games].sort((a, b) => a.round - b.round).forEach(g => {
      if (!g.completed) return;
      const winner = g.away.winner ? g.away : g.home.winner ? g.home : null;
      const loser  = winner ? (winner === g.away ? g.home : g.away) : null;
      if (!winner || !loser) return;
      const wOwner = own[winner.id]?.owner, lOwner = own[loser.id]?.owner;
      if (!wOwner && !lOwner) return;
      const covered = didCover(winner.score, loser.score, spreads[g.id] ?? g.spread);
      if (covered === false && lOwner) own[winner.id] = { owner: lOwner, capturedFrom: wOwner || null };
      else if (wOwner) own[winner.id] = { owner: wOwner, capturedFrom: own[winner.id]?.capturedFrom ?? null };
    });
    return own;
  })();

  const getOwnerFn  = useCallback(id => ownership[id]?.owner || null, [ownership]);
  const getColorFn  = useCallback(p  => getColor(players, p), [players]);

  const scores = (() => {
    const s = {};
    players.forEach(p => s[p] = 0);
    Object.values(ownership).forEach(v => { if (v.owner && s[v.owner] !== undefined) s[v.owner]++; });
    return s;
  })();

  const eliminationInfo = (() => {
    if (!games.some(g => g.completed)) return { eliminated: [], eliminatedInRound: {} };
    const live = {};
    Object.entries(assignments).forEach(([tid, p]) => { live[tid] = p; });
    const counts = {};
    players.forEach(p => counts[p] = 0);
    Object.entries(live).forEach(([, p]) => { if (counts[p] !== undefined) counts[p]++; });
    const eliminatedInRound = {};
    [...games].sort((a, b) => a.round - b.round).forEach(g => {
      if (!g.completed) return;
      const winner  = g.away.winner ? g.away : g.home.winner ? g.home : null;
      const loser   = winner ? (winner === g.away ? g.home : g.away) : null;
      if (!winner || !loser) return;
      const wOwner  = live[winner.id], lOwner = live[loser.id];
      const covered = didCover(winner.score, loser.score, spreads[g.id] ?? g.spread);
      if (covered === false && lOwner) {
        if (wOwner && counts[wOwner] !== undefined) {
          counts[wOwner]--;
          if (counts[wOwner] === 0 && !eliminatedInRound[wOwner]) eliminatedInRound[wOwner] = g.round;
        }
        live[winner.id] = lOwner;
      } else if (lOwner && counts[lOwner] !== undefined) {
        counts[lOwner]--;
        if (counts[lOwner] === 0 && !eliminatedInRound[lOwner]) eliminatedInRound[lOwner] = g.round;
      }
      delete live[loser.id];
    });
    const hasAssignment = p => Object.values(assignments).some(a => a === p);
    const eliminated = players
      .filter(p => hasAssignment(p) && eliminatedInRound[p] !== undefined)
      .sort((a, b) => eliminatedInRound[a] - eliminatedInRound[b]);
    return { eliminated, eliminatedInRound };
  })();

  // ── ownershipAtRound ───────────────────────────────────────────────────────
  const ownershipAtRound = (() => {
    const snap = { 1: {} };
    Object.entries(assignments).forEach(([tid, p]) => { snap[1][tid] = p; });
    const live = { ...snap[1] };
    let cur = 1;
    [...games].sort((a, b) => a.round - b.round).forEach(g => {
      if (!g.completed) return;
      if (g.round > cur) { for (let r = cur + 1; r <= g.round; r++) snap[r] = { ...live }; cur = g.round; }
      const winner  = g.away.winner ? g.away : g.home.winner ? g.home : null;
      const loser   = winner ? (winner === g.away ? g.home : g.away) : null;
      if (!winner || !loser) return;
      const covered = didCover(winner.score, loser.score, spreads[g.id] ?? g.spread);
      if (covered === false && live[loser.id]) live[winner.id] = live[loser.id];
      delete live[loser.id];
    });
    for (let r = cur + 1; r <= 6; r++) { if (!snap[r]) snap[r] = { ...live }; }
    return snap;
  })();

  const ownerAtRound = useCallback((tid, round) =>
    ownershipAtRound[round]?.[tid] ?? ownershipAtRound[1]?.[tid] ?? null,
  [ownershipAtRound]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const openCard    = useCallback(g => { setFocusGame(g.id); setSpreadInput((spreads[g.id] ?? g.spread) != null ? String(spreads[g.id] ?? g.spread) : ''); }, [spreads]);
  const closeCard   = useCallback(() => { setFocusGame(null); setSpreadInput(''); }, []);
  const saveSpread  = useCallback(gid => { const v = parseFloat(spreadInput); if (!isNaN(v)) setSpreads(p => ({ ...p, [gid]: v })); closeCard(); }, [spreadInput, closeCard]);
  const clearSpread = useCallback(gid => { setSpreads(p => { const n = { ...p }; delete n[gid]; return n; }); closeCard(); }, [closeCard]);

  const addPlayer = useCallback(() => {
    const name = inputValue.trim();
    if (!name || players.includes(name)) return;
    setPlayers(prev => [...prev, name]);
    setInputValue('');
  }, [inputValue, players]);

  const removePlayer = useCallback(name => {
    setPlayers(prev => prev.filter(p => p !== name));
    setAssignments(prev => { const n = { ...prev }; Object.keys(n).forEach(k => { if (n[k] === name) delete n[k]; }); return n; });
    setSelectedPlayer(prev => prev === name ? null : prev);
  }, []);

  const assignTeam = useCallback(teamId => {
    if (!selectedPlayer || !teamId) return;
    setAssignments(prev => ({ ...prev, [teamId]: selectedPlayer }));
  }, [selectedPlayer]);

  const tryUnlock = () => {
    if (adminInput === ADMIN_PASSWORD) { setIsAdmin(true); setShowAdminLogin(false); setAdminInput(''); setAdminError(false); }
    else { setAdminError(true); setAdminInput(''); }
  };
  const lock = () => { setIsAdmin(false); setShowAdminLogin(false); setAdminInput(''); setAdminError(false); setTab('full'); };

  const resetEverything = () => {
    setPlayers([]); setAssignments({}); setSpreads({});
    ['bracket:players', 'bracket:assignments', 'bracket:spreads']
      .forEach(k => storage.delete(k).catch(() => {}));
  };

  // ── Derived data ───────────────────────────────────────────────────────────
  const allRegions = [...new Set(games.map(g => g.region))].filter(Boolean).sort();
  const ff         = games.filter(g => g.round === 5);
  const champ      = games.filter(g => g.round === 6);
  const focusedGame = games.find(g => g.id === focusGame);

  const teamsByRegion = (() => {
    const map = {};
    games.filter(g => g.round === 1 || g.round === 0).forEach(g => {
      if (!map[g.region]) map[g.region] = [];
      [g.away, g.home].forEach(t => {
        if (t.id && t.name !== 'TBD' && !map[g.region].find(x => x.id === t.id)) map[g.region].push(t);
      });
    });
    return map;
  })();

  const displayRegions = activeRegion === 'All'
    ? (allRegions.length > 0 ? allRegions : ['South', 'East', 'West', 'Midwest'])
    : [activeRegion];

  // Shared props bundles to avoid repetition
  const cardProps = { spreads, focusGame, openCard, closeCard, spreadInput, setSpreadInput, saveSpread, clearSpread, players, assignments, ownerAtRound, getOwnerFn, isAdmin };
  const miniProps = { spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn };
  const stripProps = { games, fp: filterPlayer, players, assignments, spreads, focusGame, openCard, closeCard, ownerAtRound, getOwnerFn };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app" onClick={() => { if (focusGame) closeCard(); }}>

      {/* ── Header ── */}
      <header className="header">
        <div className="header__brand">
          <div className="header__title">🏀 March Madness 2026</div>
          <div className="header__subtitle">Spread Bracket</div>
        </div>
        <nav className="header__nav">
          {[['bracket', 'Bracket'], ['full', 'Full'], ['rules', 'Rules'], ...(isAdmin ? [['setup', 'Setup']] : [])].map(([k, l]) => (
            <button key={k} className={`nav-btn${tab === k ? ' nav-btn--active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
          <button className={`admin-btn${isAdmin ? ' admin-btn--active' : ''}`}
            onClick={() => isAdmin ? lock() : setShowAdminLogin(v => !v)}
            title={isAdmin ? 'Lock admin' : 'Unlock admin'}>
            {isAdmin ? '🔓' : '🔒'}
          </button>
        </nav>
        {showAdminLogin && !isAdmin && (
          <div className="admin-login">
            <span className="admin-login__label">Admin Password:</span>
            <input className={`admin-login__input${adminError ? ' admin-login__input--error' : ''}`}
              type="password" value={adminInput} autoFocus
              onChange={e => { setAdminInput(e.target.value); setAdminError(false); }}
              onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); if (e.key === 'Escape') { setShowAdminLogin(false); setAdminInput(''); setAdminError(false); } }}
              placeholder="Enter password…" />
            <button className="admin-login__submit" onClick={tryUnlock}>Unlock</button>
            {adminError && <span className="admin-login__error">Incorrect password</span>}
            <button className="admin-login__close" onClick={() => { setShowAdminLogin(false); setAdminInput(''); setAdminError(false); }}>✕</button>
          </div>
        )}
      </header>

      {/* ── SETUP TAB ── */}
      {tab === 'setup' && (
        <div className="page page--wide">
          <div className="setup-grid">
            <div>
              <div className="section-title">Players</div>
              <PlayerInput value={inputValue} onChange={setInputValue} onAdd={addPlayer} />
              {players.length === 0 && <p style={{ fontSize: 12, color: '#7a8a9a', lineHeight: 1.7 }}>No players yet.<br />Type a name and press Enter or +.</p>}
              {players.map((p, i) => {
                const color = PLAYER_COLORS[i % PLAYER_COLORS.length];
                const count = Object.values(assignments).filter(a => a === p).length;
                return (
                  <div key={p} className="player-row" onClick={() => setSelectedPlayer(selectedPlayer === p ? null : p)}
                    style={selectedPlayer === p ? { borderColor: color, background: color + '18' } : {}}>
                    <span className="player-row__dot" style={{ background: color }} />
                    <span className="player-row__name">{p}</span>
                    <span className="player-row__count">{count} teams</span>
                    <button className="player-row__remove" onClick={e => { e.stopPropagation(); removePlayer(p); }}>✕</button>
                  </div>
                );
              })}
              {selectedPlayer && <div className="player-hint">Click a team to assign to <strong style={{ color: getColorFn(selectedPlayer) }}>{selectedPlayer}</strong></div>}
              {Object.keys(assignments).length > 0 && <button className="clear-btn" onClick={() => setAssignments({})}>Clear Assignments</button>}
              {players.length > 0 && <button className="clear-btn" style={{ marginTop: 6 }} onClick={resetEverything}>Reset Everything</button>}
            </div>
            <div>
              <div className="section-title">Assign Teams</div>
              <p style={{ fontSize: 12, color: '#7a8a9a', marginBottom: 18 }}>One team per region per player. Select a player on the left, then click a team chip to assign.</p>
              {Object.keys(teamsByRegion).sort().map(region => {
                const regionIds   = teamsByRegion[region].map(t => t.id);
                const alreadyHere = selectedPlayer ? regionIds.some(tid => assignments[tid] === selectedPlayer) : false;
                return (
                  <div key={region} className="teams-grid__region">
                    <div className="teams-grid__region-header">
                      <span className="teams-grid__region-label" style={{ color: REGION_COLORS[region] || '#5a6a82' }}>{region.toUpperCase()}</span>
                      {alreadyHere && selectedPlayer && <span className="teams-grid__region-warning">{selectedPlayer} already picked here</span>}
                    </div>
                    <div className="teams-grid__chips">
                      {teamsByRegion[region].sort((a, b) => (a.seed || 99) - (b.seed || 99)).map(team => {
                        const owner   = assignments[team.id];
                        const color   = owner ? getColorFn(owner) : '#0d1b2a';
                        const blocked = !!selectedPlayer && !owner && alreadyHere;
                        return (
                          <div key={team.id} className="team-chip"
                            onClick={() => !blocked && !owner && assignTeam(team.id)}
                            title={owner ? `${team.name} → ${owner}` : blocked ? `${selectedPlayer} already picked here` : selectedPlayer ? `Assign to ${selectedPlayer}` : team.name}
                            style={{ background: owner ? color + '22' : 'transparent', border: `1px solid ${blocked ? '#2a2a35' : color}`, color: owner ? color : blocked ? '#3a3a48' : '#5a6a82', cursor: selectedPlayer && !blocked && !owner ? 'pointer' : 'default', opacity: blocked ? 0.3 : 1 }}>
                            {team.seed} {team.abbr}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
            <div>
              <div className="section-title">Live Standings</div>
              <StandingsPanel players={players} scores={scores} eliminationInfo={eliminationInfo} getColorFn={getColorFn} />
            </div>
          </div>
        </div>
      )}

      {/* ── RULES TAB ── */}
      {tab === 'rules' && (
        <div className="page page--centered">
          <div className="section-title">How the Spread Bracket Works</div>
          <div className="rules-list">
            {[
              ['✓ Covers',            '#16a34a', 'Favorite wins AND covers the spread. Their owner advances normally.'],
              ['✗ No Cover',          '#b91c1c', "Favorite wins but DOESN'T cover. The losing team's owner steals the winning team — look for ⚡."],
              ['Upset',               '#d97706', "Underdog wins outright = automatic cover. The winner's owner keeps them."],
              ['⚡ Captured',         '#c2410c', 'A team was stolen mid-tournament due to a no-cover. The current owner may differ from the original picker.'],
              ['💀 First Eliminated', '#b91c1c', 'The first player to lose all of their teams across all regions gets the shame crown.'],
              ['Spreads',             '#1a3a6b', 'Pulled automatically from ESPN when available. Click any game card to enter or override manually.'],
            ].map(([title, color, desc]) => (
              <div key={title} className="rule-card" style={{ borderLeftColor: color }}>
                <div className="rule-card__title" style={{ color }}>{title}</div>
                <div className="rule-card__desc">{desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── BRACKET TAB ── */}
      {tab === 'bracket' && (
        <div className="bracket-layout">
          <div className="bracket-scroll">
            <div className="bracket-filters">
              {['All', 'South', 'East', 'West', 'Midwest', 'Final Four', 'Championship'].map(r => {
                if (r !== 'All' && !games.some(g => g.region === r)) return null;
                return (
                  <button key={r} onClick={e => { e.stopPropagation(); setActiveRegion(r); }}
                    className={`region-btn${activeRegion === r ? ' region-btn--active' : ''}`}
                    style={activeRegion === r ? { borderColor: REGION_COLORS[r] || '#1a3a6b', color: REGION_COLORS[r] || '#1a3a6b', background: (REGION_COLORS[r] || '#1a3a6b') + '18' } : {}}>
                    {r}
                  </button>
                );
              })}
              {players.length > 0 && (
                <div className="player-filter">
                  <span className="player-filter__label">Show:</span>
                  <select className="player-filter__select" value={filterPlayer} onChange={e => setFilterPlayer(e.target.value)}>
                    <option value="All">All Players</option>
                    {players.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
            </div>
            {loading ? (
              <div className="loading"><div className="loading__icon">🏀</div><div className="loading__text">Loading tournament data…</div></div>
            ) : displayRegions.map(region => (
              <div key={region} className="region-section">
                <div className="region-section__title"
                  style={{ color: REGION_COLORS[region] || '#1a3a6b', borderBottomColor: (REGION_COLORS[region] || '#1a3a6b') + '55' }}>
                  {region} Region
                </div>
                <div className="region-section__rounds">
                  {[...new Set(games.filter(g => g.region === region).map(g => g.round))].sort((a, b) => a - b).map(round => (
                    <div key={round} className="round-col">
                      <div className="round-col__label">{ROUND_LABELS[round] || `R${round}`}</div>
                      <div className="round-col__games">
                        {games.filter(g => g.region === region && g.round === round).map(g => {
                          const involved = filterPlayer === 'All' || [g.away, g.home].some(t => ownerAtRound(t.id, round) === filterPlayer);
                          return (
                            <div key={g.id} className={involved ? 'fade-full' : 'fade-dim'}>
                              <GameCard game={g} tab={tab} selectedPlayer={selectedPlayer} assignTeam={assignTeam} {...cardProps} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="bracket-sidebar">
            <StandingsPanel players={players} scores={scores} eliminationInfo={eliminationInfo} getColorFn={getColorFn} />
          </div>
        </div>
      )}

      {/* ── FULL BRACKET TAB ── */}
      {tab === 'full' && (
        <div className="full-bracket" onClick={() => { if (focusGame) closeCard(); }}>
          <div className="full-bracket__header">
            <span className="full-bracket__title">🏀 Full Bracket 2026</span>
            {players.length > 0 && (
              <div className="player-filter">
                <span className="player-filter__label">Show:</span>
                <select className="player-filter__select" value={filterPlayer}
                  onChange={e => setFilterPlayer(e.target.value)} onClick={e => e.stopPropagation()}>
                  <option value="All">All Players</option>
                  {players.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="full-bracket__layout">
            <div className="bracket-half">
              <RegionStrip region="South" dir="ltr" {...stripProps} />
              <RegionStrip region="West"  dir="ltr" {...stripProps} />
            </div>

            <div className="bracket-center">
              <div className="bracket-center__label bracket-center__label--ff">Final Four</div>
              {ff[0] && <div className={filterPlayer === 'All' || [ff[0].away, ff[0].home].some(t => ownerAtRound(t.id, 5) === filterPlayer) ? 'fade-full' : 'fade-dim'}><MiniCard game={ff[0]} {...miniProps} /></div>}
              <div className="bracket-center__spacer" />
              <div className="bracket-center__label bracket-center__label--champ">🏆 Championship</div>
              {champ[0] && <div className={filterPlayer === 'All' || [champ[0].away, champ[0].home].some(t => ownerAtRound(t.id, 6) === filterPlayer) ? 'fade-full' : 'fade-dim'}><MiniCard game={champ[0]} {...miniProps} /></div>}
              <div className="bracket-center__spacer" />
              {ff[1] && <div className={filterPlayer === 'All' || [ff[1].away, ff[1].home].some(t => ownerAtRound(t.id, 5) === filterPlayer) ? 'fade-full' : 'fade-dim'}><MiniCard game={ff[1]} {...miniProps} /></div>}
            </div>

            <div className="bracket-half">
              <RegionStrip region="East"    dir="rtl" {...stripProps} />
              <RegionStrip region="Midwest" dir="rtl" {...stripProps} />
            </div>
          </div>

          {focusedGame && (
            <SpreadPopupBody game={focusedGame} fixed spreads={spreads} spreadInput={spreadInput}
              setSpreadInput={setSpreadInput} saveSpread={saveSpread} clearSpread={clearSpread}
              closeCard={closeCard} isAdmin={isAdmin} ownerAtRound={ownerAtRound} />
          )}
        </div>
      )}
    </div>
  );
}