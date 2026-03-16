import { useState, useEffect, useCallback, memo } from 'react';
import { ROUND_LABELS, REGION_COLORS, PLAYER_COLORS, ADMIN_PASSWORD } from './constants';
import { getLiveGames } from './api2';
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

const SK_PLAYERS     = 'bracket_players';
const SK_ASSIGNMENTS = 'bracket_assignments';
const SK_SPREADS     = 'bracket_spreads';

const BRACKET_REGIONS = ['South', 'East', 'West', 'Midwest'];
const GAMES_PER_ROUND = { 1: 8, 2: 4, 3: 2, 4: 1 };
const ROUND1_SEEDS    = [
  [1,16],[8,9],[5,12],[4,13],[6,11],[3,14],[7,10],[2,15],
];

function makeTBD(seed = null) {
  return { id: null, name: 'TBD', abbr: 'TBD', seed, score: null, winner: false };
}

function buildFullBracket(apiGames) {
  const real = apiGames.map(g => ({
    ...g,
    _isTBD: (!g.home?.id && !g.away?.id) ||
            (g.home?.name === 'TBD' && g.away?.name === 'TBD'),
  }));

  const result = [];

  BRACKET_REGIONS.forEach(region => {
    for (let round = 1; round <= 4; round++) {
      const need  = GAMES_PER_ROUND[round];
      const found = real.filter(g => g.region === region && g.round === round);
      for (let slot = 0; slot < need; slot++) {
        if (found[slot]) {
          result.push(found[slot]);
        } else {
          const [as, hs] = round === 1 && slot < ROUND1_SEEDS.length
            ? ROUND1_SEEDS[slot] : [null, null];
          result.push({
            id: `placeholder-${region}-r${round}-s${slot}`, source: 'placeholder',
            region, round, roundLabel: ROUND_LABELS[round] ?? `Round ${round}`,
            completed: false, inProgress: false, statusDetail: '', spread: null,
            home: makeTBD(hs), away: makeTBD(as), _isTBD: true, _placeholder: true,
          });
        }
      }
    }
  });

  const ffGames = real.filter(g => g.round === 5);
  for (let slot = 0; slot < 2; slot++) {
    result.push(ffGames[slot] ?? {
      id: `placeholder-ff-s${slot}`, source: 'placeholder',
      region: 'Final Four', round: 5, roundLabel: 'Final Four',
      completed: false, inProgress: false, statusDetail: '', spread: null,
      home: makeTBD(), away: makeTBD(), _isTBD: true, _placeholder: true,
    });
  }

  const champGame = real.find(g => g.round === 6);
  result.push(champGame ?? {
    id: 'placeholder-champ', source: 'placeholder',
    region: 'Championship', round: 6, roundLabel: 'Championship',
    completed: false, inProgress: false, statusDetail: '', spread: null,
    home: makeTBD(), away: makeTBD(), _isTBD: true, _placeholder: true,
  });

  return result;
}

// ── Components ────────────────────────────────────────────────────────────────

const PlayerInput = memo(({ value, onChange, onAdd }) => (
  <div className="player-input">
    <input className="player-input__field" type="text" value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') onAdd(); }}
      placeholder="Enter player name…" />
    <button className="player-input__add" onClick={onAdd}>+</button>
  </div>
));

// ── PlayerRow: with inline edit, clear, remove ───────────────────────────────
function PlayerRow({ p, i, isSelected, onSelect, onEdit, onClear, onRemove }) {
  const [editing, setEditing]   = useState(false);
  const [editVal, setEditVal]   = useState(p);
  const color = PLAYER_COLORS[i % PLAYER_COLORS.length];

  const saveEdit = () => {
    const v = editVal.trim();
    if (v && v !== p) onEdit(p, v);
    setEditing(false);
  };
  const cancelEdit = () => { setEditVal(p); setEditing(false); };

  if (editing) {
    return (
      <div className="player-row player-row--editing">
        <span className="player-row__dot" style={{ background: color }} />
        <input
          className="player-edit-input"
          value={editVal}
          autoFocus
          onChange={e => setEditVal(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
        />
        <button className="player-edit-save" onClick={saveEdit}>✓</button>
        <button className="player-edit-cancel" onClick={cancelEdit}>✕</button>
      </div>
    );
  }

  return (
    <div
      className="player-row"
      onClick={() => onSelect(p)}
      style={isSelected ? { borderColor: color, background: color + '14' } : {}}
    >
      <span className="player-row__dot" style={{ background: color }} />
      <span className="player-row__name">{p}</span>
      <div className="player-row__actions">
        <button
          className="player-row__btn player-row__btn--edit"
          title="Rename player"
          onClick={e => { e.stopPropagation(); setEditing(true); setEditVal(p); }}
        >✎</button>
        <button
          className="player-row__btn player-row__btn--clear"
          title="Clear this player's assignments"
          onClick={e => { e.stopPropagation(); onClear(p); }}
        >↺</button>
        <button
          className="player-row__btn player-row__btn--remove"
          title="Remove player"
          onClick={e => { e.stopPropagation(); onRemove(p); }}
        >✕</button>
      </div>
    </div>
  );
}

function TeamSlot({ team, isWinner, isLoser, showScore, round, players, assignments,
                    ownerAtRound, getOwner, assignTeam, isAdmin, tab, selectedPlayer }) {
  if (!team) return null;
  const isTBD     = !team.id || team.name === 'TBD';
  const owner     = isTBD ? null : (round ? ownerAtRound(team.id, round) : getOwner(team.id));
  const color     = owner ? getColor(players, owner) : '#1e2d42';
  const captured  = !isTBD && round && owner && assignments[team.id] && owner !== assignments[team.id];
  const canAssign = isAdmin && tab === 'setup' && selectedPlayer && !isTBD;
  return (
    <div
      onClick={e => { if (canAssign) { e.stopPropagation(); assignTeam(team.id); } }}
      className={[
        'team-slot',
        isWinner  ? 'team-slot--winner'    : '',
        isLoser   ? 'team-slot--loser'     : '',
        canAssign ? 'team-slot--assignable': '',
        isTBD     ? 'team-slot--tbd'       : '',
      ].filter(Boolean).join(' ')}
      style={{ borderLeft: `3px solid ${isTBD ? '#1e2d3e' : color}`, cursor: canAssign ? 'pointer' : 'default' }}>
      <span className="team-slot__seed">{isTBD ? '?' : (team.seed || '?')}</span>
      <span className={['team-slot__name', isWinner && 'team-slot__name--winner', isLoser && 'team-slot__name--loser', isTBD && 'team-slot__name--tbd'].filter(Boolean).join(' ')}>
        {isTBD ? 'TBD' : (team.name?.split(' ').slice(0, 2).join(' ') || team.abbr || 'TBD')}
      </span>
      {captured && <span className="team-slot__capture" title="Captured">⚡</span>}
      {owner    && <span className="team-slot__owner" style={{ background: color }}>{owner.slice(0, 7)}</span>}
      {showScore && !isTBD && team.score != null && (
        <span className={`team-slot__score${isWinner ? ' team-slot__score--winner' : ' team-slot__score--loser'}`}>{team.score}</span>
      )}
      {isWinner && <span className="team-slot__arrow">▶</span>}
    </div>
  );
}

function SpreadPopupBody({ game, fixed, spreads, spreadInput, setSpreadInput,
                           saveSpread, clearSpread, closeCard, isAdmin, ownerAtRound }) {
  if (game._isTBD) {
    return (
      <div className={fixed ? 'bracket-popup-overlay' : 'spread-popup'} onClick={e => e.stopPropagation()}>
        <div className="spread-popup__header">
          <span className="spread-popup__region" style={{ color: REGION_COLORS[game.region] || '#3b82f6' }}>
            {game.region?.toUpperCase()} · {game.roundLabel?.toUpperCase()}
          </span>
          <button className="spread-popup__close" onClick={closeCard}>✕</button>
        </div>
        <div className="spread-popup__matchup">Matchup TBD</div>
        <div className="spread-popup__locked" style={{ marginTop: 8 }}>Teams not yet determined</div>
      </div>
    );
  }

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
        <span className="spread-popup__region" style={{ color: REGION_COLORS[game.region] || '#3b82f6' }}>
          {game.region?.toUpperCase()} · {game.roundLabel?.toUpperCase()}
        </span>
        <button className="spread-popup__close" onClick={closeCard}>✕</button>
      </div>
      <div className="spread-popup__matchup">{game.away.name} vs {game.home.name}</div>
      {hasScores && <div className="spread-popup__score">{game.away.score} – {game.home.score}</div>}
      {spread != null && (
        <div className="spread-popup__info">
          Spread: <strong>{spread > 0 ? `+${spread}` : spread}</strong>
          {covered != null && (
            <span style={{ marginLeft: 8, color: covered ? '#22c55e' : '#ef4444' }}>
              {covered ? '✓ Covered' : '✗ Not covered'}
            </span>
          )}
        </div>
      )}
      {captureMsg && <div className="spread-popup__capture">{captureMsg}</div>}
      <div className="spread-popup__divider">
        {isAdmin ? (
          <>
            <div className="spread-popup__input-label">Set Spread · negative = home favored</div>
            <div className="spread-popup__input-row">
              <input className="spread-popup__input" type="number" value={spreadInput}
                onChange={e => setSpreadInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveSpread(game.id); if (e.key === 'Escape') closeCard(); }}
                placeholder="-7 or +5" />
              <button className="spread-popup__save" onClick={() => saveSpread(game.id)}>✓</button>
              {spreads[game.id] !== undefined && (
                <button className="spread-popup__clear" onClick={() => clearSpread(game.id)}>✕</button>
              )}
            </div>
          </>
        ) : (
          <div className="spread-popup__locked">🔒 Admin access required</div>
        )}
      </div>
    </div>
  );
}

function GameCard({ game, spreads, focusGame, openCard, closeCard, spreadInput, setSpreadInput,
                    saveSpread, clearSpread, players, assignments, ownerAtRound, getOwnerFn,
                    isAdmin, tab, selectedPlayer, assignTeam }) {
  const isTBD     = game._isTBD;
  const spread    = isTBD ? null : (spreads[game.id] ?? game.spread);
  const winner    = isTBD ? null : (game.away.winner ? game.away : game.home.winner ? game.home : null);
  const loser     = winner ? (winner === game.away ? game.home : game.away) : null;
  const covered   = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
  const hasScores = !isTBD && (game.away.score != null || game.home.score != null);
  const isFocused = focusGame === game.id;
  const spreadClass = covered === true ? 'game-card__spread--covered'
    : covered === false ? 'game-card__spread--uncovered' : 'game-card__spread--neutral';
  const slotProps = { players, assignments, ownerAtRound, getOwner: getOwnerFn,
                      assignTeam, isAdmin, tab, selectedPlayer };
  return (
    <div
      className={['game-card', game.inProgress && 'game-card--live', isTBD && 'game-card--tbd'].filter(Boolean).join(' ')}
      style={{ borderLeftColor: isTBD ? '#1e2d3e' : (game.inProgress ? '#22c55e' : REGION_COLORS[game.region] || '#3b82f6') }}>
      <div onClick={() => !isTBD && (isFocused ? closeCard() : openCard(game))}>
        <TeamSlot team={game.away} isWinner={!isTBD && game.away.winner} isLoser={!isTBD && game.home.winner} showScore={hasScores} round={game.round} {...slotProps} />
        <div className="game-card__divider" />
        <TeamSlot team={game.home} isWinner={!isTBD && game.home.winner} isLoser={!isTBD && game.away.winner} showScore={hasScores} round={game.round} {...slotProps} />
        <div className="game-card__footer">
          <span className={['game-card__status', game.inProgress && 'game-card__status--live', isTBD && 'game-card__status--tbd'].filter(Boolean).join(' ')}>
            {isTBD ? 'TBD' : (game.inProgress ? `● ${game.statusDetail || 'LIVE'}` : game.completed ? 'FINAL' : 'SCHED')}
          </span>
          {!isTBD && (spread != null
            ? <span className={`game-card__spread ${spreadClass}`}>{spread > 0 ? `+${spread}` : spread}{covered === true ? ' ✓' : covered === false ? ' ✗' : ''}</span>
            : <span className="game-card__spread-add">+ spread</span>
          )}
        </div>
      </div>
      {isFocused && !isTBD && (
        <SpreadPopupBody game={game} fixed={false} spreads={spreads} spreadInput={spreadInput}
          setSpreadInput={setSpreadInput} saveSpread={saveSpread} clearSpread={clearSpread}
          closeCard={closeCard} isAdmin={isAdmin} ownerAtRound={ownerAtRound} />
      )}
    </div>
  );
}

function MiniSlot({ team, isWinner, isLoser, round, players, assignments, ownerAtRound, getOwnerFn }) {
  if (!team) return null;
  const isTBD    = !team.id || team.name === 'TBD';
  const owner    = isTBD ? null : (round ? ownerAtRound(team.id, round) : getOwnerFn(team.id));
  const color    = owner ? getColor(players, owner) : '#0d1b2a';
  const captured = !isTBD && round && owner && assignments[team.id] && owner !== assignments[team.id];
  return (
    <div className={['mini-slot', isWinner && 'mini-slot--winner', isLoser && 'mini-slot--loser', isTBD && 'mini-slot--tbd'].filter(Boolean).join(' ')}
      style={{ borderLeft: `3px solid ${isTBD ? '#1e2d3e' : color}` }}>
      <span className="mini-slot__seed">{isTBD ? '?' : (team.seed || '?')}</span>
      <span className={['mini-slot__name', isWinner && 'mini-slot__name--winner', isLoser && 'mini-slot__name--loser', isTBD && 'mini-slot__name--tbd'].filter(Boolean).join(' ')}>
        {isTBD ? 'TBD' : (team.name?.split(' ').slice(0, 2).join(' ') || team.abbr || 'TBD')}
      </span>
      {captured && <span className="mini-slot__capture">⚡</span>}
      {owner    && <span className="mini-slot__owner" style={{ background: color }}>{owner.slice(0, 6)}</span>}
      {!isTBD && team.score != null && (
        <span className={`mini-slot__score${isWinner ? ' mini-slot__score--winner' : ' mini-slot__score--loser'}`}>{team.score}</span>
      )}
    </div>
  );
}

function MiniCard({ game, spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn }) {
  if (!game) return <div className="mini-card--placeholder" />;
  const isTBD     = game._isTBD;
  const spread    = isTBD ? null : (spreads[game.id] ?? game.spread);
  const winner    = isTBD ? null : (game.away.winner ? game.away : game.home.winner ? game.home : null);
  const loser     = winner ? (winner === game.away ? game.home : game.away) : null;
  const covered   = winner && loser && spread != null ? didCover(winner.score, loser.score, spread) : null;
  const sc        = covered === true ? 'mini-card__spread--covered' : covered === false ? 'mini-card__spread--uncovered' : 'mini-card__spread--neutral';
  const isFocused = focusGame === game.id;
  const slotProps = { players, assignments, ownerAtRound, getOwnerFn };
  return (
    <div
      className={['mini-card', game.inProgress && 'mini-card--live', isTBD && 'mini-card--tbd'].filter(Boolean).join(' ')}
      onClick={e => { if (isTBD) return; e.stopPropagation(); isFocused ? closeCard() : openCard(game); }}>
      <MiniSlot team={game.away} isWinner={!isTBD && game.away.winner} isLoser={!isTBD && game.home.winner} round={game.round} {...slotProps} />
      <div className="game-card__divider" />
      <MiniSlot team={game.home} isWinner={!isTBD && game.home.winner} isLoser={!isTBD && game.away.winner} round={game.round} {...slotProps} />
      <div className="mini-card__footer">
        <span className={['mini-card__status', game.inProgress && 'mini-card__status--live', isTBD && 'mini-card__status--tbd'].filter(Boolean).join(' ')}>
          {isTBD ? 'TBD' : (game.inProgress ? '● LIVE' : game.completed ? 'FINAL' : 'SCHED')}
        </span>
        {!isTBD && (spread != null
          ? <span className={`mini-card__spread ${sc}`}>{spread > 0 ? `+${spread}` : spread}{covered === true ? ' ✓' : covered === false ? ' ✗' : ''}</span>
          : <span className="mini-card__spread mini-card__spread--neutral">+ sprd</span>
        )}
      </div>
    </div>
  );
}

function BracketColumn({ games, region, round, fp, players, assignments, spreads,
                         focusGame, openCard, closeCard, ownerAtRound, getOwnerFn }) {
  const rGames    = games.filter(g => g.region === region && g.round === round);
  const groupSize = Math.pow(2, round - 1);
  const cardProps = { spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn };
  return (
    <div className="bracket-col">
      {rGames.map((g, i) => {
        const isTBD    = g._isTBD;
        const involved = isTBD
          ? fp === 'All'
          : fp === 'All' || [g.away, g.home].some(t => t.id && ownerAtRound(t.id, round) === fp);
        return (
          <div key={g.id || i} className="bracket-col__slot" style={{ flex: groupSize }}>
            <div className={involved ? 'fade-full' : 'fade-dim'}>
              <MiniCard game={g} {...cardProps} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RegionStrip({ games, region, dir, fp, players, assignments, spreads,
                       focusGame, openCard, closeCard, ownerAtRound, getOwnerFn }) {
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

// ── Standings panel — used in both bracket sidebar and bracket tab inline ─────
function StandingsPanel({ players, scores, eliminationInfo, getColorFn }) {
  if (players.length === 0) return null;
  const elim            = eliminationInfo.eliminated;
  const active          = players.filter(p => !elim.includes(p)).sort((a, b) => (scores[b] || 0) - (scores[a] || 0));
  const firstEliminated = elim[0] || null;
  return (
    <div className="standings">
      <div className="section-title">Standings</div>
      {active.length === 0 && elim.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text3)' }}>No teams assigned yet.</div>
      )}
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

  // ── Storage ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [p, a, s] = await Promise.all([
          storage.get(SK_PLAYERS),
          storage.get(SK_ASSIGNMENTS),
          storage.get(SK_SPREADS),
        ]);
        if (p) setPlayers(JSON.parse(p.value));
        if (a) setAssignments(JSON.parse(a.value));
        if (s) setSpreads(JSON.parse(s.value));
      } catch { /* no saved data yet */ }
      setStorageReady(true);
    })();
  }, []);

  useEffect(() => { if (storageReady) storage.set(SK_PLAYERS,     JSON.stringify(players)).catch(() => {}); }, [players, storageReady]);
  useEffect(() => { if (storageReady) storage.set(SK_ASSIGNMENTS, JSON.stringify(assignments)).catch(() => {}); }, [assignments, storageReady]);
  useEffect(() => { if (storageReady) storage.set(SK_SPREADS,     JSON.stringify(spreads)).catch(() => {}); }, [spreads, storageReady]);

  // ── Load games ─────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const live = await getLiveGames();
        if (!cancelled) setGames(buildFullBracket(live.length > 0 ? live : makeDemoGames()));
      } catch {
        if (!cancelled) setGames(buildFullBracket(makeDemoGames()));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Ownership ──────────────────────────────────────────────────────────────
  const ownership = (() => {
    const own = {};
    Object.entries(assignments).forEach(([tid, p]) => { own[tid] = { owner: p, capturedFrom: null }; });
    [...games].filter(g => !g._isTBD).sort((a, b) => a.round - b.round).forEach(g => {
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

  const getOwnerFn = useCallback(id => ownership[id]?.owner || null, [ownership]);
  const getColorFn = useCallback(p  => getColor(players, p), [players]);

  const scores = (() => {
    const s = {};
    players.forEach(p => s[p] = 0);
    Object.values(ownership).forEach(v => { if (v.owner && s[v.owner] !== undefined) s[v.owner]++; });
    return s;
  })();

  const eliminationInfo = (() => {
    if (!games.some(g => !g._isTBD && g.completed)) return { eliminated: [], eliminatedInRound: {} };
    const live = {};
    Object.entries(assignments).forEach(([tid, p]) => { live[tid] = p; });
    const counts = {};
    players.forEach(p => counts[p] = 0);
    Object.entries(live).forEach(([, p]) => { if (counts[p] !== undefined) counts[p]++; });
    const eliminatedInRound = {};
    [...games].filter(g => !g._isTBD).sort((a, b) => a.round - b.round).forEach(g => {
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

  const ownershipAtRound = (() => {
    const snap = { 1: {} };
    Object.entries(assignments).forEach(([tid, p]) => { snap[1][tid] = p; });
    const live = { ...snap[1] };
    let cur = 1;
    [...games].filter(g => !g._isTBD).sort((a, b) => a.round - b.round).forEach(g => {
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

  // Rename a player — updates assignments and selection too
  const editPlayer = useCallback((oldName, newName) => {
    if (!newName || players.includes(newName)) return;
    setPlayers(prev => prev.map(p => p === oldName ? newName : p));
    setAssignments(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(k => { if (n[k] === oldName) n[k] = newName; });
      return n;
    });
    setSelectedPlayer(prev => prev === oldName ? newName : prev);
    setFilterPlayer(prev => prev === oldName ? newName : prev);
  }, [players]);

  // Clear only a single player's assignments
  const clearPlayerAssignments = useCallback((name) => {
    setAssignments(prev => {
      const n = { ...prev };
      Object.keys(n).forEach(k => { if (n[k] === name) delete n[k]; });
      return n;
    });
  }, []);

  const removePlayer = useCallback(name => {
    setPlayers(prev => prev.filter(p => p !== name));
    setAssignments(prev => { const n = { ...prev }; Object.keys(n).forEach(k => { if (n[k] === name) delete n[k]; }); return n; });
    setSelectedPlayer(prev => prev === name ? null : prev);
    setFilterPlayer(prev => prev === name ? 'All' : prev);
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
    [SK_PLAYERS, SK_ASSIGNMENTS, SK_SPREADS].forEach(k => storage.delete(k).catch(() => {}));
  };

  // ── Derived ────────────────────────────────────────────────────────────────
  const bracketGames = games.filter(g => g.round >= 1);
  const ff           = bracketGames.filter(g => g.round === 5);
  const champ        = bracketGames.filter(g => g.round === 6);
  const focusedGame  = bracketGames.find(g => g.id === focusGame);

  const teamsByRegion = (() => {
    const map = {};
    bracketGames.filter(g => g.round === 1 && !g._isTBD).forEach(g => {
      if (!map[g.region]) map[g.region] = [];
      [g.away, g.home].forEach(t => {
        if (t.id && t.name !== 'TBD' && !map[g.region].find(x => x.id === t.id))
          map[g.region].push(t);
      });
    });
    return map;
  })();

  const displayRegions = activeRegion === 'All' ? BRACKET_REGIONS : [activeRegion];

  const standingsProps = { players, scores, eliminationInfo, getColorFn };
  const cardProps  = { spreads, focusGame, openCard, closeCard, spreadInput, setSpreadInput, saveSpread, clearSpread, players, assignments, ownerAtRound, getOwnerFn, isAdmin };
  const miniProps  = { spreads, focusGame, openCard, closeCard, players, assignments, ownerAtRound, getOwnerFn };
  const stripProps = { games: bracketGames, fp: filterPlayer, players, assignments, spreads, focusGame, openCard, closeCard, ownerAtRound, getOwnerFn };

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
          {[['full', 'Full'], ['bracket', 'Bracket'], ['rules', 'Rules'], ...(isAdmin ? [['setup', 'Setup']] : [])].map(([k, l]) => (
            <button key={k} className={`nav-btn${tab === k ? ' nav-btn--active' : ''}`} onClick={() => setTab(k)}>{l}</button>
          ))}
          <button
            className={`admin-btn${isAdmin ? ' admin-btn--active' : ''}`}
            onClick={() => isAdmin ? lock() : setShowAdminLogin(v => !v)}
            title={isAdmin ? 'Lock admin' : 'Unlock admin'}>
            {isAdmin ? '🔓' : '🔒'}
          </button>
        </nav>
        {showAdminLogin && !isAdmin && (
          <div className="admin-login">
            <span className="admin-login__label">Admin Password:</span>
            <input
              className={`admin-login__input${adminError ? ' admin-login__input--error' : ''}`}
              type="password" value={adminInput} autoFocus
              onChange={e => { setAdminInput(e.target.value); setAdminError(false); }}
              onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); if (e.key === 'Escape') { setShowAdminLogin(false); setAdminInput(''); setAdminError(false); } }}
              placeholder="Enter password…" />
            <button className="admin-login__submit" onClick={tryUnlock}>Unlock</button>
            {adminError && <span className="admin-login__error">Wrong password</span>}
            <button className="admin-login__close" onClick={() => { setShowAdminLogin(false); setAdminInput(''); setAdminError(false); }}>✕</button>
          </div>
        )}
      </header>

      {/* ── SETUP TAB ── */}
      {tab === 'setup' && (
        <div className="page page--wide">
          <div className="setup-grid">

            {/* Column 1: Players */}
            <div>
              <div className="section-title">Players</div>
              <PlayerInput value={inputValue} onChange={setInputValue} onAdd={addPlayer} />
              {players.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.7 }}>
                  No players yet.<br />Type a name and press Enter or +.
                </p>
              )}
              {players.map((p, i) => (
                <PlayerRow
                  key={p} p={p} i={i}
                  isSelected={selectedPlayer === p}
                  onSelect={name => setSelectedPlayer(selectedPlayer === name ? null : name)}
                  onEdit={editPlayer}
                  onClear={clearPlayerAssignments}
                  onRemove={removePlayer}
                />
              ))}
              {selectedPlayer && (
                <div className="player-hint">
                  Click a team chip to assign to{' '}
                  <strong style={{ color: getColorFn(selectedPlayer) }}>{selectedPlayer}</strong>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                {Object.keys(assignments).length > 0 && (
                  <button className="clear-btn" onClick={() => setAssignments({})}>Clear All Assignments</button>
                )}
                {players.length > 0 && (
                  <button className="clear-btn" onClick={resetEverything}>Reset Everything</button>
                )}
              </div>
            </div>

            {/* Column 2: Assign Teams */}
            <div>
              <div className="section-title">Assign Teams</div>
              <p style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 16, lineHeight: 1.6 }}>
                Select a player on the left, then click a team chip to assign them.
              </p>
              {Object.keys(teamsByRegion).length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--text3)' }}>Loading teams…</p>
              )}
              {Object.keys(teamsByRegion).sort().map(region => {
                const regionIds   = teamsByRegion[region].map(t => t.id);
                const alreadyHere = selectedPlayer ? regionIds.some(tid => assignments[tid] === selectedPlayer) : false;
                return (
                  <div key={region} className="teams-grid__region">
                    <div className="teams-grid__region-header">
                      <span className="teams-grid__region-label" style={{ color: REGION_COLORS[region] || 'var(--text3)' }}>
                        {region}
                      </span>
                      {alreadyHere && selectedPlayer && (
                        <span className="teams-grid__region-warning">{selectedPlayer} already picked here</span>
                      )}
                    </div>
                    <div className="teams-grid__chips">
                      {teamsByRegion[region].sort((a, b) => (a.seed || 99) - (b.seed || 99)).map(team => {
                        const owner   = assignments[team.id];
                        const color   = owner ? getColorFn(owner) : 'var(--border2)';
                        const blocked = !!selectedPlayer && !owner && alreadyHere;
                        return (
                          <div key={team.id} className="team-chip"
                            onClick={() => !blocked && !owner && assignTeam(team.id)}
                            title={owner ? `${team.name} → ${owner}` : blocked ? `${selectedPlayer} already picked here` : selectedPlayer ? `Assign to ${selectedPlayer}` : team.name}
                            style={{
                              background: owner ? getColorFn(owner) + '22' : 'transparent',
                              border: `1px solid ${blocked ? 'var(--border)' : owner ? getColorFn(owner) : 'var(--border2)'}`,
                              color: owner ? getColorFn(owner) : blocked ? 'var(--text3)' : 'var(--text2)',
                              cursor: selectedPlayer && !blocked && !owner ? 'pointer' : 'default',
                              opacity: blocked ? 0.25 : 1,
                            }}>
                            {team.seed} {team.abbr}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Column 3: Standings */}
            <div>
              <StandingsPanel {...standingsProps} />
            </div>
          </div>
        </div>
      )}

      {/* ── RULES TAB ── */}
      {tab === 'rules' && (
        <div className="page page--centered">
          <div className="section-title">How It Works</div>
          <div className="rules-list">
            {[
              ['✓ Covers',            '#22c55e', 'Favorite wins AND covers the spread. Their owner advances normally.'],
              ['✗ No Cover',          '#ef4444', "Favorite wins but DOESN'T cover. The losing team's owner steals the winning team — look for ⚡."],
              ['Upset',               '#f59e0b', "Underdog wins outright = automatic cover. The winner's owner keeps them."],
              ['⚡ Captured',         '#f97316', 'A team was stolen mid-tournament due to a no-cover. The current owner may differ from the original picker.'],
              ['💀 First Eliminated', '#ef4444', 'The first player to lose all their teams across all regions gets the shame crown.'],
              ['Spreads',             '#3b82f6', 'Pulled automatically from ESPN. Click any game card to enter or override manually (admin only).'],
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
        <div className="bracket-page">

          {/* Filter bar: outside the scroll container so it spans full viewport width */}
          <div className="bracket-filters">
            {['All', ...BRACKET_REGIONS].map(r => (
              <button key={r} onClick={e => { e.stopPropagation(); setActiveRegion(r); }}
                className={`region-btn${activeRegion === r ? ' region-btn--active' : ''}`}
                style={activeRegion === r
                  ? { borderColor: REGION_COLORS[r] || 'var(--accent)', color: REGION_COLORS[r] || 'var(--accent)', background: (REGION_COLORS[r] || '#1d4ed8') + '18' }
                  : {}}>
                {r}
              </button>
            ))}
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

          {/* Content row: scrollable games + sticky sidebar */}
          <div className="bracket-layout">
            <div className="bracket-scroll">
              {loading ? (
                <div className="loading">
                  <div className="loading__icon">🏀</div>
                  <div className="loading__text">Loading tournament data…</div>
                </div>
              ) : (
                <>
                  {displayRegions.map(region => (
                    <div key={region} className="region-section">
                      <div className="region-section__title"
                        style={{ color: REGION_COLORS[region] || 'var(--accent)', borderBottomColor: (REGION_COLORS[region] || '#1d4ed8') + '55' }}>
                        {region} Region
                      </div>
                      <div className="region-section__rounds">
                        {[1, 2, 3, 4].map(round => {
                          const roundGames = bracketGames.filter(g => g.region === region && g.round === round);
                          if (roundGames.length === 0) return null;
                          return (
                            <div key={round} className="round-col">
                              <div className="round-col__label">{ROUND_LABELS[round] || `R${round}`}</div>
                              <div className="round-col__games">
                                {roundGames.map(g => {
                                  const isTBD    = g._isTBD;
                                  const involved = isTBD
                                    ? filterPlayer === 'All'
                                    : filterPlayer === 'All' || [g.away, g.home].some(t => t.id && ownerAtRound(t.id, round) === filterPlayer);
                                  return (
                                    <div key={g.id} className={involved ? 'fade-full' : 'fade-dim'}>
                                      <GameCard game={g} tab={tab} selectedPlayer={selectedPlayer} assignTeam={assignTeam} {...cardProps} />
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>

            {/* Sidebar — hidden on mobile via CSS */}
            <div className="bracket-sidebar">
              <StandingsPanel {...standingsProps} />
            </div>
          </div>

          {/* Standings shown below on mobile */}
          {players.length > 0 && (
            <div className="standings-bar">
              <StandingsPanel {...standingsProps} />
            </div>
          )}
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

          <div className="scroll-hint">← Scroll sideways to see full bracket →</div>

          <div className="full-bracket__layout">
            {/*
              Standard NCAA bracket layout:
              Top-left: East (rounds go L→R toward center)
              Bottom-left: South (rounds go L→R toward center)
              Top-right: West (rounds go R→L toward center)
              Bottom-right: Midwest (rounds go R→L toward center)
            */}
            <div className="bracket-half">
              <RegionStrip region="East"  dir="ltr" {...stripProps} />
              <RegionStrip region="South" dir="ltr" {...stripProps} />
            </div>

            <div className="bracket-center">
              <div className="bracket-center__label bracket-center__label--ff">Final Four</div>
              {ff[0] && (
                <div className={filterPlayer === 'All' || (!ff[0]._isTBD && [ff[0].away, ff[0].home].some(t => t.id && ownerAtRound(t.id, 5) === filterPlayer)) ? 'fade-full' : 'fade-dim'}>
                  <MiniCard game={ff[0]} {...miniProps} />
                </div>
              )}
              <div className="bracket-center__spacer" />
              <div className="bracket-center__label bracket-center__label--champ">🏆 Championship</div>
              {champ[0] && (
                <div className={filterPlayer === 'All' || (!champ[0]._isTBD && [champ[0].away, champ[0].home].some(t => t.id && ownerAtRound(t.id, 6) === filterPlayer)) ? 'fade-full' : 'fade-dim'}>
                  <MiniCard game={champ[0]} {...miniProps} />
                </div>
              )}
              <div className="bracket-center__spacer" />
              {ff[1] && (
                <div className={filterPlayer === 'All' || (!ff[1]._isTBD && [ff[1].away, ff[1].home].some(t => t.id && ownerAtRound(t.id, 5) === filterPlayer)) ? 'fade-full' : 'fade-dim'}>
                  <MiniCard game={ff[1]} {...miniProps} />
                </div>
              )}
            </div>

            <div className="bracket-half">
              <RegionStrip region="West"    dir="rtl" {...stripProps} />
              <RegionStrip region="Midwest" dir="rtl" {...stripProps} />
            </div>
          </div>

          {focusedGame && !focusedGame._isTBD && (
            <SpreadPopupBody game={focusedGame} fixed spreads={spreads} spreadInput={spreadInput}
              setSpreadInput={setSpreadInput} saveSpread={saveSpread} clearSpread={clearSpread}
              closeCard={closeCard} isAdmin={isAdmin} ownerAtRound={ownerAtRound} />
          )}
        </div>
      )}
    </div>
  );
}
