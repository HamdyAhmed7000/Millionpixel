import { useMemo, useState } from 'react';

export function spotPrestige(slot) {
  const x = (Number(slot) - 1) % 1000, y = Math.floor((Number(slot) - 1) / 1000);
  if ([0, 999].includes(x) && [0, 999].includes(y)) return '✦ Corner landmark';
  if ([499, 500].includes(x) && [499, 500].includes(y)) return '✦ Center landmark';
  if (x === 777 && y === 777) return '✦ Lucky 777';
  return null;
}
export function achievementLabels(stats = {}) {
  return [stats.pioneer_number && `🏅 Launch pioneer #${stats.pioneer_number}`, stats.center_pioneer && '🏆 Center Pioneer', stats.viral_spot && '🔥 Viral Spot', stats.art_director && '🎨 Art Director', stats.golden_explorer && '✧ Golden Explorer'].filter(Boolean);
}
function contiguousSize(cells) {
  const remaining = new Set(cells.map(Number)); let largest = 0;
  while (remaining.size) {
    const first = remaining.values().next().value, queue = [first]; remaining.delete(first);
    for (let i = 0; i < queue.length; i++) {
      const slot = queue[i], x = (slot - 1) % 1000;
      for (const next of [x > 0 ? slot - 1 : 0, x < 999 ? slot + 1 : 0, slot - 1000, slot + 1000]) {
        if (remaining.delete(next)) queue.push(next);
      }
    }
    largest = Math.max(largest, queue.length);
  }
  return largest;
}
export default function CommunityGames({ data, error, supabase, session, profile, refresh, notify, onFocus, huntMode, setHuntMode, setHeatmap, heatmap, setTerritories, territories, onSignIn }) {
  const [guildName, setGuildName] = useState(''), [guildDescription, setGuildDescription] = useState(''), [busy, setBusy] = useState('');
  const [rankMode, setRankMode] = useState('influencers');
  const [fadePreview, setFadePreview] = useState(0);
  const connections = useMemo(() => {
    const groups = new Map();
    for (const cell of data?.territory || []) { if (!groups.has(cell.guild_id)) groups.set(cell.guild_id, []); groups.get(cell.guild_id).push(cell.slot); }
    return new Map([...groups].map(([id, cells]) => [id, contiguousSize(cells)]));
  }, [data?.territory]);
  const act = async (key, rpc, args) => {
    if (!session) { onSignIn(); return; }
    if (busy) return;
    setBusy(key);
    try {
      const result = await supabase.rpc(rpc, args);
      if (result.error) { notify(result.error.message); return; }
      if (rpc === 'create_canvas_guild') { setGuildName(''); setGuildDescription(''); notify('Guild submitted for review.'); }
      else notify('Saved.');
      await refresh();
    } catch { notify('Could not save. Please try again.'); } finally { setBusy(''); }
  };
  const people = [...(rankMode === 'empire' ? data?.empires || data?.people || [] : data?.people || [])].sort((a, b) => rankMode === 'empire' ? b.area - a.area : rankMode === 'pioneers' ? (a.pioneer_number || 999999) - (b.pioneer_number || 999999) : Number(b.weekly_interactions || b.weekly_clicks) - Number(a.weekly_interactions || a.weekly_clicks));
  const ranks = (rankMode === 'pioneers' ? (data?.pioneers || people).filter(person => person.pioneer_number) : people).slice(0, 10);
  const myLabels = achievementLabels(data?.my_achievements);
  return <section className="canvas-games" id="canvas-games" aria-label="Canvas community games">
    <div className="games-title"><div><span className="eyebrow">BUILD · EXPLORE · COMPETE</span><h2>The canvas is a community.</h2><p>Make a guild, find a golden pixel, or vote for tomorrow’s champion.</p></div><a href="#game-plans" className="text-button">Future plans ↓</a></div>
    {error && <p role="status" className="games-notice">{error} <button className="text-button" onClick={refresh}>Retry</button></p>}
    {!data && !error && <p role="status">Loading community…</p>}
    <div className="game-grid">
      <article className="game-card guild-card"><span className="eyebrow">TERRITORY WARS</span><h3>Find your guild</h3><p>One guild per person. Members’ active, approved tiles count toward its territory. Connect tiles to build toward a 100 × 100 mega-banner.</p>
        <div className="game-guild-list">{(data?.guilds || []).map(guild => <div className="game-guild" key={guild.id}><div><b>{guild.name}</b><small>{guild.description}</small><span>{guild.members} members · {guild.area} active tiles · {connections.get(guild.id) || 0} connected on map</span>{guild.status !== 'approved' && <em>{guild.status} review</em>}</div><div>{guild.status === 'approved' ? <button disabled={!!busy} onClick={() => act(guild.id, 'join_canvas_guild', { p_guild_id: data.my_guild === guild.id ? null : guild.id })}>{data.my_guild === guild.id ? 'Leave' : 'Join'}</button> : profile?.is_admin && guild.status === 'pending' ? <><button disabled={!!busy} onClick={() => act(guild.id, 'review_canvas_guild', { p_guild_id: guild.id, p_approve: true })}>Approve</button><button disabled={!!busy} onClick={() => act(guild.id, 'review_canvas_guild', { p_guild_id: guild.id, p_approve: false })}>Reject</button></> : null}</div></div>)}</div>
        {!data?.guilds?.length && <p className="game-empty">Start the first guild. Names and descriptions are reviewed before appearing publicly.</p>}
        <form onSubmit={event => { event.preventDefault(); act('create', 'create_canvas_guild', { p_name: guildName, p_description: guildDescription }); }}><label>Guild name<input required minLength="3" maxLength="40" value={guildName} onChange={event => setGuildName(event.target.value)} placeholder="e.g. Indie Artists" /></label><label>About your guild<input maxLength="200" value={guildDescription} onChange={event => setGuildDescription(event.target.value)} placeholder="What brings you together?" /></label><button disabled={!!busy || !data} type="submit">{busy === 'create' ? 'Submitting…' : 'Create guild for review'}</button></form>
        <button className="text-button" aria-pressed={territories} onClick={() => { setTerritories(!territories); onFocus(null); }}>{territories ? 'Hide' : 'Show'} guild territory map ↗</button><small>Map shows up to 10,000 guild tiles. Rankings count all active tiles.</small>
      </article>
      <article className="game-card hunt-card"><span className="eyebrow">DAILY SCAVENGER HUNT · UTC</span><h3>Find the golden pixels ✧</h3><p>Three hidden pixels each day. Up to 300 searches per account. Open a clue’s 10 × 10 area, zoom in and tap squares to search. Sign in to save your finds.</p><div className="hunt-clues">{(data?.hunt || []).map((clue, index) => <button key={index} className={clue.found ? 'found' : ''} onClick={() => { setHuntMode(true); onFocus((clue.row + 4) * 1000 + clue.column + 5, 80); }}><b>{clue.found ? '✓ Collected' : `Clue ${index + 1}`}</b><span>Columns {clue.column}–{clue.column + 9}<br />Rows {clue.row}–{clue.row + 9}</span></button>)}</div><p className="game-reward">Reward: Golden Explorer badge and a golden photo border.</p><small>Your discoveries: {data?.golden_finds || 0} · Clues reset at 00:00 UTC.</small>{huntMode && <button className="text-button" onClick={() => setHuntMode(false)}>Stop hunting</button>}
      </article>
      <article className="game-card battle-card"><span className="eyebrow">PHOTO BATTLE · DAILY UTC ROUND</span><h3>Which photo gets your vote?</h3><p>One changeable vote per signed-in user. Tomorrow’s unique winner needs at least two votes and earns a neon border for 24 hours.</p><div className="battle-pair">{data?.battle?.length === 2 ? data.battle.map(spot => <div key={spot.slot}><button className="battle-image" onClick={() => onFocus(spot.slot, 30, true)}><img src={supabase.storage.from('published-images').getPublicUrl(spot.image_path).data.publicUrl} alt={`Battle photo by ${spot.name}`} loading="lazy" /></button><b>{spot.name}</b><small>#{spot.slot} · {spot.votes} votes</small><button disabled={!!busy} aria-pressed={data.my_vote === spot.slot} onClick={() => act(`vote:${spot.slot}`, 'vote_canvas_battle', { p_slot: spot.slot })}>{data.my_vote === spot.slot ? '✓ Your vote' : 'Vote'}</button></div>) : <p>Two approved images are needed for a battle.</p>}</div>{data?.champion && <button className="text-button" onClick={() => onFocus(data.champion, 30, true)}>Today’s champion: Spot #{data.champion} ↗</button>}
      </article>
      <article className="game-card"><span className="eyebrow">LIVE RANKINGS · REFRESH EVERY 30s</span><h3>Climb the canvas</h3><div className="game-tabs" role="group" aria-label="Community ranking"><button aria-pressed={rankMode === 'influencers'} onClick={() => setRankMode('influencers')}>Influencers</button><button aria-pressed={rankMode === 'empire'} onClick={() => setRankMode('empire')}>Largest empire</button><button aria-pressed={rankMode === 'pioneers'} onClick={() => setRankMode('pioneers')}>Pioneers</button></div><ol className="game-ranks">{ranks.map((person, index) => <li key={person.spot}><button onClick={() => onFocus(person.spot, 30, true)}><span>{index + 1}</span><div><b>{person.name}</b><small>Level {person.level} {person.pioneer_number ? `· Pioneer #${person.pioneer_number}` : ''}</small></div><strong>{rankMode === 'empire' ? `${person.area} tiles` : rankMode === 'pioneers' ? `#${person.pioneer_number}` : `${person.weekly_interactions || person.weekly_clicks || 0} visits`}</strong></button></li>)}</ol>{!ranks.length && <p className="game-empty">Achievements appear as approved spots grow.</p>}<small>Weekly visits combine daily unique photo opens and settled hovers. Pioneers are the first 100 approved owners during the first seven launch days.</small><button className="text-button" aria-pressed={heatmap} onClick={() => { setHeatmap(!heatmap); onFocus(null); }}>{heatmap ? 'Hide' : 'Show'} weekly interaction heatmap ↗</button>
      </article>
      <article className="game-card"><span className="eyebrow">YOUR ACHIEVEMENTS</span><h3>A story with milestones.</h3><p>Level {data?.my_achievements?.level || 1} · {data?.my_achievements?.area || 0} active tiles</p><div className="achievement-chips">{myLabels.length ? myLabels.map(label => <span key={label}>{label}</span>) : <span>Your first badge is ahead.</span>}</div><ul className="badge-rules"><li>🏆 Center Pioneer: an active tile in the central 100 × 100 area.</li><li>🔥 Viral Spot: 1,000 daily unique photo opens on one active spot.</li><li>🎨 Art Director: an approved composite image covering at least 10 connected tiles.</li><li>✧ Golden Explorer: find a daily golden pixel.</li></ul><small>Levels grow with active tiles and photo opens. Art Director applies to reviewed composites covering 10 or more tiles.</small></article>
      <article className="game-card"><span className="eyebrow">MONTHLY LANDMARK CROWN</span><h3>King of the canvas ♛</h3><p>The active corner, center or Lucky 777 landmark with the most photo opens this calendar month earns the crown.</p>{data?.landmark_crown ? <button className="crown-winner" onClick={() => onFocus(data.landmark_crown.slot, 30, true)}><b>♛ {data.landmark_crown.name}</b><span>Spot #{data.landmark_crown.slot} · {data.landmark_crown.views} views</span></button> : <p className="game-empty">A landmark’s first photo open starts this month’s race.</p>}<p>Collectible coordinates: (0,0), (999,999), the four center tiles and (777,777).</p><small>Coordinate labels use zero-based map coordinates. Monthly crowns are free recognition. Existing paid placements keep their original expiry.</small></article>
    </div>
    <section className="future-game-plans" id="game-plans"><div><span className="eyebrow">FUTURE PLANS · CHECKOUT DISABLED</span><h3>Longer stories, coming later.</h3><p>Six- and twelve-month plans, renewal fees and landmark auctions are waiting for pricing and launch rules. The current offer remains 50 EGP for 30 days.</p></div><div className="future-plan-cards">{[6,12].map(months => <article key={months}><b>{months}-month placement</b><span>Price to be announced</span><button disabled>Not available to purchase</button></article>)}</div><details><summary>Preview the optional fading effect</summary><p>Concept preview only. This does not change any published image. Future activity and renewal rules will be shown before purchase.</p><label>Example age: {fadePreview} months<input type="range" min="0" max="12" value={fadePreview} onChange={event => setFadePreview(Number(event.target.value))} /></label><div className="fade-concept" style={{ filter: `grayscale(${Math.max(0, (fadePreview - 6) / 6)})`, opacity: Math.max(.4, 1 - Math.max(0, fadePreview - 6) / 10) }}>✦ Your story on the canvas</div></details></section>
  </section>;
}
