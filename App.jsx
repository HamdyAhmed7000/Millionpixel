import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabase.js';

const MAP_SIZE = 1000;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const SPOT_PRICE_EGP = 50;
const PAYMENT_NUMBER = '01024227390';
const PAYMENT_METHODS = { instapay: 'InstaPay', vodafone_cash: 'Vodafone Cash', credits: 'Account credits' };
const formatEGP = amount => `${Number(amount).toFixed(2)} EGP`;
const PENDING_CLAIM_KEY = 'million-pixel-pending-claim-slot';
const allowedArtwork = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

function slotCoordinates(slot) {
  const index = Number(slot) - 1;
  return { x: index % MAP_SIZE, y: Math.floor(index / MAP_SIZE) };
}

function extensionOf(file) {
  const suffix = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '');
  return suffix || (file.type === 'application/pdf' ? 'pdf' : 'img');
}

function App() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const imageCache = useRef(new Map());
  const mosaicImageCache = useRef(new Map());
  const likeLock = useRef(false);
  const claimResumeRef = useRef(false);
  const loadTimer = useRef(null);
  const updateVisibleRef = useRef(null);
  const viewAnimation = useRef(null);
  const activePointers = useRef(new Map());
  const pinchState = useRef(null);
  const mosaicRef = useRef(null);
  const mosaicDirty = useRef(true);
  const view = useRef({ width: 0, height: 0, baseScale: 0, scale: 0, panX: 0, panY: 0 });
  const drag = useRef(null);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [authMode, setAuthMode] = useState('signin');
  const [published, setPublished] = useState([]);
  const [usedSlotCount, setUsedSlotCount] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedSpotSize, setSelectedSpotSize] = useState(1);
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  const [previewStyle, setPreviewStyle] = useState('default');
  const [pixelSearch, setPixelSearch] = useState('');
  const [searchingPixel, setSearchingPixel] = useState(false);
  const [discoveryQuery, setDiscoveryQuery] = useState('');
  const [discoveryTag, setDiscoveryTag] = useState('');
  const [joinedAfter, setJoinedAfter] = useState('');
  const [joinedBefore, setJoinedBefore] = useState('');
  const [discoveryResults, setDiscoveryResults] = useState([]);
  const [discoveryMessage, setDiscoveryMessage] = useState('');
  const [activityFeed, setActivityFeed] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]);
  const [discoveryBusy, setDiscoveryBusy] = useState(false);
  const [communityChallenges, setCommunityChallenges] = useState([]);
  const [challengeBusy, setChallengeBusy] = useState('');
  const [replaySpots, setReplaySpots] = useState([]);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayProgress, setReplayProgress] = useState(0);
  const [replayMessage, setReplayMessage] = useState('');
  const [useCredits, setUseCredits] = useState(true);
  const replayCanvasRef = useRef(null);
  const referralCodeFromLink = new URLSearchParams(window.location.search).get('ref') || '';
  const [selectedImage, setSelectedImage] = useState(null);
  const [imageLikes, setImageLikes] = useState({ count: 0, liked: false });
  const [likeBusy, setLikeBusy] = useState(false);
  const [pendingClaims, setPendingClaims] = useState([]);
  const [myClaims, setMyClaims] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [drawer, setDrawer] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [form, setForm] = useState({ displayName: '', contact: '', description: '', websiteUrl: '', tags: '', referralCode: referralCodeFromLink, paymentMethod: 'instapay', paymentReference: '', artwork: null, proof: null });
  const grossSpotPrice = selectedSpotSize * selectedSpotSize;
  const availableCredits = Number(profile?.credit_balance || 0);
  const creditForThisClaim = useCredits ? Math.min(availableCredits, grossSpotPrice) : 0;
  const claimAmountDue = Math.max(0, grossSpotPrice - creditForThisClaim);
  const challengeGroups = [...new Map(communityChallenges.map(item => [item.challenge_id, { ...item, candidates: [] }])).values()]
    .map(group => ({ ...group, candidates: communityChallenges.filter(item => item.challenge_id === group.challenge_id && item.slot_number) }));
  const featuredChallenge = communityChallenges.filter(item => item.slot_number)
    .sort((a, b) => Number(b.vote_count) - Number(a.vote_count))[0];

  const notify = useCallback(message => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3000);
  }, []);

  const resumePendingClaim = useCallback(() => {
    if (claimResumeRef.current) return true;
    const savedValue = window.localStorage.getItem(PENDING_CLAIM_KEY);
    let savedSlot = Number(savedValue);
    let savedSize = 1;
    try {
      const savedClaim = JSON.parse(savedValue);
      if (savedClaim && typeof savedClaim === 'object') { savedSlot = Number(savedClaim.slot); savedSize = Number(savedClaim.size) || 1; }
    } catch { /* Backward-compatible single-slot value. */ }
    if (!Number.isInteger(savedSlot) || savedSlot < 1 || savedSlot > MAP_SIZE * MAP_SIZE) return false;
    claimResumeRef.current = true;
    setSelectedSlot(savedSlot);
    setSelectedSpotSize([1, 2, 4].includes(savedSize) ? savedSize : 1);
    setFormOpen(true);
    setDrawer('');
    window.localStorage.removeItem(PENDING_CLAIM_KEY);
    return true;
  }, []);

  const loadPublished = useCallback(async bounds => {
    if (!supabase || !bounds) return;
    const rows = [];
    let legacySchema = false;
    for (let offset = 0; ; offset += 1000) {
      const queryRows = fields => supabase.from('published_slots').select(fields)
        .gte('col_index', Math.max(0, bounds.minX - 3)).lte('col_index', Math.min(999, bounds.maxX + 3))
        .gte('row_index', Math.max(0, bounds.minY - 3)).lte('row_index', Math.min(999, bounds.maxY + 3))
        .gt('expires_at', new Date().toISOString()).range(offset, offset + 999);
      let { data, error } = await queryRows(legacySchema
        ? 'slot_number, col_index, row_index, display_name, image_path, description, published_at, expires_at'
        : 'slot_number, col_index, row_index, anchor_slot, spot_size, display_name, image_path, description, website_url, published_at, expires_at');
      if (error && !legacySchema) {
        legacySchema = true;
        ({ data, error } = await queryRows('slot_number, col_index, row_index, display_name, image_path, description, published_at, expires_at'));
      }
      if (error) { console.error(error); return; }
      rows.push(...(data || []));
      if (!data || data.length < 1000) break;
    }
    const decorated = rows.map(row => {
      const storage = supabase.storage.from('published-images');
      const imageUrl = storage.getPublicUrl(row.image_path).data.publicUrl;
      const thumbnailUrl = storage.getPublicUrl(row.image_path, { transform: { width: 64, height: 64, resize: 'cover' } }).data.publicUrl;
      return { ...row, anchor_slot: row.anchor_slot || row.slot_number, spot_size: Number(row.spot_size) || 1, imageUrl, thumbnailUrl };
    });
    const visibleImageUrls = new Set(decorated.map(row => row.imageUrl));
    for (const imageUrl of imageCache.current.keys()) if (!visibleImageUrls.has(imageUrl)) imageCache.current.delete(imageUrl);
    for (const imageUrl of mosaicImageCache.current.keys()) if (!visibleImageUrls.has(imageUrl)) mosaicImageCache.current.delete(imageUrl);
    mosaicDirty.current = true;
    setPublished(decorated);
  }, []);

  const refreshUsedSlotCount = useCallback(async () => {
    if (!supabase) return;
    const { count, error } = await supabase.from('published_slots')
      .select('slot_number', { count: 'exact', head: true })
      .gt('expires_at', new Date().toISOString());
    if (!error && count != null) setUsedSlotCount(count);
  }, []);

  const loadDiscovery = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('get_spot_discovery_leaderboard');
    if (error) { console.warn('Discovery metrics are unavailable until migration 0004 is applied.', error); return; }
    const spots = data || [];
    setLeaderboard(spots);
  }, []);

  const loadChallenges = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.rpc('get_community_challenge_spots');
    if (!error) setCommunityChallenges(data || []);
    else console.warn('Community challenges are unavailable until migration 0005 is applied.', error);
  }, []);

  const voteForChallenge = async (challengeId, slotNumber) => {
    if (!session?.user) { setAuthMode('signin'); setAuthMessage('Sign in to vote in community challenges.'); setDrawer('signin'); return; }
    setChallengeBusy(`${challengeId}:${slotNumber}`);
    const { error } = await supabase.rpc('vote_for_community_challenge', { p_challenge_id: challengeId, p_slot_number: slotNumber });
    setChallengeBusy('');
    if (error) { notify(error.message || 'Your vote could not be saved.'); return; }
    await loadChallenges(); notify('Your vote is in. You can change it any time this month.');
  };

  const createWeeklyReplay = async () => {
    if (!supabase) { notify('Connect Supabase before creating a replay.'); return; }
    setReplayMessage('Gathering this week’s public spots…');
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase.from('published_slots')
      .select('slot_number,anchor_slot,col_index,row_index,spot_size,display_name,image_path,published_at')
      .gt('expires_at', new Date().toISOString()).gte('published_at', since).order('published_at', { ascending: true }).limit(1000);
    if (error) { setReplayMessage('Could not load this week’s published spots.'); return; }
    const unique = new Map();
    for (const spot of data || []) {
      const anchor = Number(spot.anchor_slot || spot.slot_number);
      if (!unique.has(anchor)) unique.set(anchor, { ...spot, anchor_slot: anchor, imageUrl: supabase.storage.from('published-images').getPublicUrl(spot.image_path).data.publicUrl });
    }
    const spots = [...unique.values()];
    if (!spots.length) { setReplayMessage('No spots went live in the last seven days yet.'); return; }
    setReplaySpots(spots); setReplayProgress(0); setReplayMessage('The replay will download as a shareable WebM video when it finishes.'); setReplayOpen(true);
  };

  const copyReferralLink = async () => {
    const code = profile?.referral_code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/?ref=${encodeURIComponent(code)}`);
      notify('Referral link copied.');
    } catch { notify(`Your referral code is ${code}. You can copy it from your account.`); }
  };

  const searchCanvas = async event => {
    event.preventDefault();
    if (!supabase) { setDiscoveryMessage('Connect Supabase before searching the public canvas.'); return; }
    const query = discoveryQuery.trim().replace(/[%_,()]/g, ' ');
    const tag = discoveryTag.trim().replace(/[%_,()]/g, ' ');
    if (!query && !tag && !joinedAfter && !joinedBefore) { setDiscoveryMessage('Enter a name, keyword, tag, or date range to search.'); return; }
    setDiscoveryBusy(true); setDiscoveryMessage('');
    const queryRows = supabase.from('published_slots')
      .select('slot_number, anchor_slot, spot_size, display_name, image_path, description, website_url, tags, published_at, expires_at')
      .gt('expires_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(250);
    if (query) queryRows.or(`display_name.ilike.%${query}%,description.ilike.%${query}%,tags.ilike.%${query}%`);
    if (tag) queryRows.ilike('tags', `%${tag}%`);
    if (joinedAfter) queryRows.gte('published_at', new Date(`${joinedAfter}T00:00:00`).toISOString());
    if (joinedBefore) queryRows.lt('published_at', new Date(`${joinedBefore}T23:59:59`).toISOString());
    const { data, error } = await queryRows;
    setDiscoveryBusy(false);
    if (error) { setDiscoveryResults([]); setDiscoveryMessage(error.message.includes('tags') ? 'Apply the latest database update to search tags.' : 'Could not search the canvas. Please try again.'); return; }
    const unique = new Map();
    for (const row of data || []) {
      const anchor = Number(row.anchor_slot || row.slot_number);
      if (!unique.has(anchor)) unique.set(anchor, { ...row, anchor_slot: anchor, imageUrl: supabase.storage.from('published-images').getPublicUrl(row.image_path).data.publicUrl });
    }
    const results = [...unique.values()];
    setDiscoveryResults(results);
    setDiscoveryMessage(results.length ? `${results.length} matching spot${results.length === 1 ? '' : 's'}.` : 'No published spots match those filters.');
  };

  const recordSpotView = useCallback(async slotNumber => {
    if (!supabase) return;
    let visitorId = window.localStorage.getItem('million-pixel-visitor-id');
    if (!visitorId) { visitorId = crypto.randomUUID(); window.localStorage.setItem('million-pixel-visitor-id', visitorId); }
    const { error } = await supabase.rpc('record_public_spot_view', { p_slot_number: slotNumber, p_visitor_id: visitorId });
    if (error) console.warn('Spot view could not be recorded. Apply migration 0004 to enable popularity stats.', error);
  }, []);

  const openPublishedSpot = image => {
    const anchorSlot = Number(image.anchor_slot || image.slot_number);
    const { x, y } = slotCoordinates(anchorSlot);
    const v = view.current;
    const scale = Math.max(v.scale, v.baseScale * 30);
    animateView({ scale, panX: -(x + .5 - MAP_SIZE / 2) * scale, panY: -(y + .5 - MAP_SIZE / 2) * scale });
    setSelectedSlot(anchorSlot); setSelectedSpotSize(Number(image.spot_size) || 1);
    setSelectedImage(image); setImageLikes({ count: 0, liked: false }); setDrawer('image');
    recordSpotView(anchorSlot); updateVisible();
  };

  const visibleBounds = useCallback(() => {
    const { width, height, baseScale, scale, panX, panY } = view.current;
    if (!width || !scale) return null;
    const left = (0 - width / 2 - panX) / scale + MAP_SIZE / 2;
    const right = (width - width / 2 - panX) / scale + MAP_SIZE / 2;
    const top = (0 - height / 2 - panY) / scale + MAP_SIZE / 2;
    const bottom = (height - height / 2 - panY) / scale + MAP_SIZE / 2;
    return {
      minX: Math.max(0, Math.floor(Math.min(left, right))), maxX: Math.min(999, Math.ceil(Math.max(left, right))),
      minY: Math.max(0, Math.floor(Math.min(top, bottom))), maxY: Math.min(999, Math.ceil(Math.max(top, bottom))),
      scale, baseScale
    };
  }, []);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const { width, height, scale, panX, panY } = view.current;
    if (!canvas || !ctx || !width || !height || !scale) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#141a15'; ctx.fillRect(0, 0, width, height);
    const toScreen = (x, y) => ({ x: width / 2 + panX + (x - MAP_SIZE / 2) * scale, y: height / 2 + panY + (y - MAP_SIZE / 2) * scale });
    const topLeft = toScreen(0, 0); const bottomRight = toScreen(MAP_SIZE, MAP_SIZE);
    ctx.fillStyle = '#1b241c'; ctx.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    ctx.strokeStyle = '#3c4a3b'; ctx.lineWidth = 1; ctx.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
    const bounds = visibleBounds();
    if (scale >= 11 && bounds) {
      const count = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
      if (count < 12000) {
        ctx.beginPath(); ctx.strokeStyle = scale > 20 ? '#344236' : '#29362b'; ctx.lineWidth = .65;
        for (let x = bounds.minX; x <= bounds.maxX + 1; x++) { const p = toScreen(x, 0).x; ctx.moveTo(p, topLeft.y); ctx.lineTo(p, bottomRight.y); }
        for (let y = bounds.minY; y <= bounds.maxY + 1; y++) { const p = toScreen(0, y).y; ctx.moveTo(topLeft.x, p); ctx.lineTo(bottomRight.x, p); }
        ctx.stroke();
      }
    }
    const anchors = published.filter(item => Number(item.anchor_slot) === Number(item.slot_number));
    if (!mosaicRef.current) { mosaicRef.current = document.createElement('canvas'); mosaicRef.current.width = MAP_SIZE; mosaicRef.current.height = MAP_SIZE; }
    if (mosaicDirty.current) {
      const mosaic = mosaicRef.current; const mosaicCtx = mosaic.getContext('2d');
      mosaicCtx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      for (const item of anchors) {
        let image = mosaicImageCache.current.get(item.imageUrl);
        if (!image) {
          image = new Image(); mosaicImageCache.current.set(item.imageUrl, image);
          image.onload = () => { mosaicDirty.current = true; render(); };
          image.onerror = () => { if (image.src !== item.imageUrl) image.src = item.imageUrl; };
          image.src = item.thumbnailUrl || item.imageUrl;
        }
        if (image.complete && image.naturalWidth) mosaicCtx.drawImage(image, Number(item.col_index), Number(item.row_index), Number(item.spot_size) || 1, Number(item.spot_size) || 1);
      }
      mosaicDirty.current = false;
    }
    ctx.save(); ctx.imageSmoothingEnabled = previewStyle !== 'pixel';
    ctx.drawImage(mosaicRef.current, topLeft.x, topLeft.y, (bottomRight.x - topLeft.x), (bottomRight.y - topLeft.y)); ctx.restore();
    for (const item of anchors) {
      const point = toScreen(Number(item.col_index), Number(item.row_index));
      const spotPixels = (Number(item.spot_size) || 1) * scale;
      if (point.x + spotPixels < 0 || point.y + spotPixels < 0 || point.x > width || point.y > height) continue;
      if (Number(item.anchor_slot) === Number(hoveredSlot) && scale >= 3) {
        ctx.save(); ctx.shadowColor = '#d8f5a6'; ctx.shadowBlur = Math.min(20, Math.max(7, scale * .3));
        ctx.strokeStyle = '#d8f5a6'; ctx.lineWidth = Math.max(1, Math.min(3, scale * .08)); ctx.strokeRect(point.x, point.y, spotPixels, spotPixels); ctx.restore();
      }
      if (scale >= 2) {
        let image = imageCache.current.get(item.imageUrl);
        if (!image) { image = new Image(); imageCache.current.set(item.imageUrl, image); image.onload = render; image.src = item.imageUrl; }
        if (image?.complete && image.naturalWidth) {
          const inset = scale >= 4 && previewStyle !== 'default' ? (previewStyle === 'pixel' ? 1 : 1.25) : 0;
          const tileX = point.x + inset; const tileY = point.y + inset;
          const tileSize = Math.max(1, spotPixels - inset * 2);
          if (previewStyle === 'collage' && scale >= 7) { ctx.save(); ctx.shadowColor = '#ef78c866'; ctx.shadowBlur = Math.min(9, scale * .16); ctx.fillStyle = '#d76fa5'; ctx.fillRect(point.x, point.y, spotPixels, spotPixels); ctx.restore(); }
          else if (inset) { ctx.fillStyle = previewStyle === 'pixel' ? '#182019' : '#26212b'; ctx.fillRect(point.x, point.y, spotPixels, spotPixels); }
          ctx.drawImage(image, tileX, tileY, tileSize, tileSize);
        }
      }
    }
    if (hoveredSlot && scale >= 16 && !published.some(item => Number(item.slot_number) === hoveredSlot)) {
      const { x, y } = slotCoordinates(hoveredSlot); const p = toScreen(x, y);
      ctx.save(); ctx.fillStyle = '#c4f06b'; ctx.shadowColor = '#c4f06b'; ctx.shadowBlur = 8;
      ctx.font = `${Math.min(18, Math.max(10, scale * .58))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦', p.x + scale / 2, p.y + scale / 2); ctx.restore();
    }
    if (selectedSlot) {
      const { x, y } = slotCoordinates(selectedSlot); const p = toScreen(x, y);
      ctx.strokeStyle = '#c4f06b'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 1, p.y + 1, Math.max(2, scale * selectedSpotSize - 2), Math.max(2, scale * selectedSpotSize - 2));
    }
  }, [published, selectedSlot, selectedSpotSize, hoveredSlot, previewStyle, visibleBounds]);

  const updateVisible = useCallback(() => {
    render();
    window.clearTimeout(loadTimer.current);
    loadTimer.current = window.setTimeout(() => {
      const bounds = visibleBounds();
      if (bounds) loadPublished(bounds);
    }, 120);
  }, [loadPublished, render, visibleBounds]);

  useEffect(() => { updateVisibleRef.current = updateVisible; }, [updateVisible]);

  useEffect(() => {
    refreshUsedSlotCount();
    const timer = window.setInterval(refreshUsedSlotCount, 60000);
    return () => window.clearInterval(timer);
  }, [refreshUsedSlotCount]);

  useEffect(() => {
    if (!supabase) return undefined;
    let ignore = false;
    const refreshActivity = async () => {
      const { data, error } = await supabase.from('published_slots')
        .select('slot_number,anchor_slot,display_name,published_at')
        .gt('expires_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(80);
      if (error || ignore) return;
      const unique = new Map();
      for (const spot of data || []) {
        const anchor = Number(spot.anchor_slot || spot.slot_number);
        if (!unique.has(anchor)) unique.set(anchor, { ...spot, anchor_slot: anchor });
      }
      setActivityFeed([...unique.values()].slice(0, 8));
    };
    refreshActivity(); loadDiscovery(); loadChallenges();
    const channel = supabase.channel('million-pixel-public-activity')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'published_slots' }, () => {
        refreshActivity(); loadDiscovery(); refreshUsedSlotCount(); updateVisibleRef.current?.();
      }).subscribe();
    const timer = window.setInterval(() => { refreshActivity(); loadDiscovery(); loadChallenges(); }, 45000);
    return () => { ignore = true; window.clearInterval(timer); supabase.removeChannel(channel); };
  }, [loadDiscovery, loadChallenges, refreshUsedSlotCount]);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) resumePendingClaim();
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) { setProfile(null); setMyClaims([]); }
      else resumePendingClaim();
    });
    return () => authListener.subscription.unsubscribe();
  }, [resumePendingClaim]);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    supabase.from('profiles').select('is_admin,referral_code,credit_balance').eq('user_id', session.user.id).single()
      .then(({ data, error }) => { if (error) console.error(error); setProfile(data); });
    supabase.from('slot_claims').select('id,slot_number,spot_size,display_name,status,created_at,expires_at')
      .eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(30)
      .then(({ data, error }) => { if (error) console.error(error); setMyClaims(data || []); });
  }, [session]);

  useEffect(() => {
    if (!selectedImage || !supabase) return undefined;
    let ignore = false;
    const anchorSlot = selectedImage.anchor_slot || selectedImage.slot_number;
    supabase.rpc('get_slot_like_summary', { p_slot_number: anchorSlot }).then(({ data, error }) => {
      if (error) { if (!ignore) notify('Could not load likes for this image.'); return; }
      const summary = Array.isArray(data) ? data[0] : data;
      if (!ignore) setImageLikes({ count: Number(summary?.like_count || 0), liked: Boolean(summary?.liked_by_viewer) });
    });
    return () => { ignore = true; };
  }, [selectedImage?.anchor_slot, selectedImage?.slot_number, session?.user.id, notify]);

  useEffect(() => {
    const canvas = replayCanvasRef.current;
    if (!replayOpen || !canvas || !replaySpots.length) return undefined;
    canvas.width = 1080; canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    const images = new Map();
    const durationMs = Math.min(14000, Math.max(6000, replaySpots.length * 220));
    const started = performance.now();
    let frameId; let lastUiUpdate = 0; let finished = false; let completed = false;
    let recorder; const chunks = [];
    try {
      const stream = canvas.captureStream(30);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm';
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        if (!completed || !chunks.length) return;
        const url = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' }));
        const link = document.createElement('a'); link.href = url; link.download = `million-pixel-weekly-replay-${new Date().toISOString().slice(0, 10)}.webm`; link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 30000);
        setReplayMessage('Your weekly replay video has been downloaded.');
      };
      recorder.start();
    } catch { setReplayMessage('Video recording is unavailable in this browser. You can still watch the animated replay here.'); }
    const draw = now => {
      if (finished) return;
      const progress = Math.min(1, (now - started) / durationMs);
      const shown = Math.min(replaySpots.length, Math.floor(progress * replaySpots.length) + (progress > 0 ? 1 : 0));
      ctx.fillStyle = '#101612'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#c4f06b'; ctx.font = '700 32px system-ui'; ctx.fillText('MILLION PIXEL', 64, 72);
      ctx.fillStyle = '#f1f4ef'; ctx.font = '700 48px system-ui'; ctx.fillText('This week on the canvas', 64, 132);
      ctx.fillStyle = '#a1aaa2'; ctx.font = '22px system-ui'; ctx.fillText(`${shown.toLocaleString()} of ${replaySpots.length.toLocaleString()} new spots`, 64, 171);
      const left = 60; const top = 218; const size = 960; const unit = size / MAP_SIZE;
      ctx.fillStyle = '#1b241c'; ctx.fillRect(left, top, size, size); ctx.strokeStyle = '#3c4a3b'; ctx.lineWidth = 2; ctx.strokeRect(left, top, size, size);
      for (const spot of replaySpots.slice(0, shown)) {
        let img = images.get(spot.imageUrl);
        if (!img) { img = new Image(); images.set(spot.imageUrl, img); img.src = spot.imageUrl; }
        if (!img.complete || !img.naturalWidth) continue;
        ctx.drawImage(img, left + Number(spot.col_index) * unit, top + Number(spot.row_index) * unit, Math.max(unit, (Number(spot.spot_size) || 1) * unit), Math.max(unit, (Number(spot.spot_size) || 1) * unit));
      }
      ctx.fillStyle = '#f1f4ef'; ctx.font = '600 24px system-ui'; ctx.fillText('One million little places · New this week', 64, 1238);
      ctx.fillStyle = '#849087'; ctx.font = '18px system-ui'; ctx.fillText(new Date().toLocaleDateString(), 64, 1280);
      if (now - lastUiUpdate > 120) { setReplayProgress(progress); lastUiUpdate = now; }
      if (progress >= 1) {
        finished = true; completed = true; setReplayProgress(1);
        if (recorder?.state === 'recording') recorder.stop();
        return;
      }
      frameId = requestAnimationFrame(draw);
    };
    frameId = requestAnimationFrame(draw);
    return () => { finished = true; cancelAnimationFrame(frameId); if (recorder?.state === 'recording') recorder.stop(); };
  }, [replayOpen, replaySpots]);

  useEffect(() => {
    const canvas = canvasRef.current; const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const resize = () => {
      const rect = wrap.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(rect.width * dpr)); canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      const v = view.current; v.width = rect.width; v.height = rect.height; v.baseScale = Math.min(rect.width, rect.height) / MAP_SIZE;
      if (!v.scale) v.scale = v.baseScale;
      updateVisibleRef.current?.();
    };
    const observer = new ResizeObserver(resize); observer.observe(wrap); resize();
    return () => observer.disconnect();
  }, []);

  useEffect(() => { render(); }, [render]);

  useEffect(() => {
    if (!profile?.is_admin || drawer !== 'admin') return;
    let ignore = false;
    const load = async () => {
      const { data, error } = await supabase.from('slot_claims').select('*').eq('status', 'pending').order('created_at', { ascending: true });
      if (error) { notify(error.message); return; }
      const decorated = await Promise.all((data || []).map(async claim => {
        const art = await supabase.storage.from('submission-files').createSignedUrl(claim.artwork_path, 300);
        const proof = claim.proof_path
          ? await supabase.storage.from('submission-files').createSignedUrl(claim.proof_path, 300)
          : null;
        return { ...claim, artworkUrl: art.data?.signedUrl, proofUrl: proof?.data?.signedUrl };
      }));
      if (!ignore) setPendingClaims(decorated);
    };
    load(); return () => { ignore = true; };
  }, [profile, drawer, notify]);

  const signIn = async event => {
    event.preventDefault(); setBusy(true); setAuthMessage('');
    if (!supabase) { setAuthMessage('Add the Supabase project URL and publishable key first.'); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setAuthMessage(error ? error.message : 'Check your email for your secure sign-in link.'); setBusy(false);
  };

  const signInWithPassword = async event => {
    event.preventDefault(); setBusy(true); setAuthMessage('');
    if (!supabase) { setAuthMessage('Add the Supabase project URL and publishable key first.'); setBusy(false); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setAuthMessage(error.message);
    else {
      setPassword(''); setAuthMessage('Signed in successfully.');
      if (!resumePendingClaim()) { setDrawer(selectedImage ? 'image' : ''); setFormOpen(false); }
    }
    setBusy(false);
  };

  const signUp = async event => {
    event.preventDefault(); setBusy(true); setAuthMessage('');
    if (!supabase) { setAuthMessage('Add the Supabase project URL and publishable key first.'); setBusy(false); return; }
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) setAuthMessage(error.message);
    else if (data.session) { setAuthMessage('Your account is ready.'); setPassword(''); }
    else setAuthMessage('Account created. Check your email to confirm it, then return here to continue.');
    setBusy(false);
  };

  const signOut = async () => { await supabase.auth.signOut(); setDrawer(''); notify('Signed out.'); };

  const animateView = (target, duration = 240) => {
    const v = view.current;
    if (viewAnimation.current) cancelAnimationFrame(viewAnimation.current);
    const start = { scale: v.scale, panX: v.panX, panY: v.panY };
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - (1 - progress) ** 3;
      v.scale = start.scale + (target.scale - start.scale) * eased;
      v.panX = start.panX + (target.panX - start.panX) * eased;
      v.panY = start.panY + (target.panY - start.panY) * eased;
      updateVisible();
      if (progress < 1) viewAnimation.current = requestAnimationFrame(tick);
      else viewAnimation.current = null;
    };
    viewAnimation.current = requestAnimationFrame(tick);
  };

  const zoomAt = (factor, x, y, duration = 220) => {
    const v = view.current; const old = v.scale;
    if (!old) return;
    const next = Math.max(v.baseScale, Math.min(v.baseScale * 150, old * factor));
    const worldX = (x - v.width / 2 - v.panX) / old;
    const worldY = (y - v.height / 2 - v.panY) / old;
    animateView({ scale: next, panX: x - v.width / 2 - worldX * next, panY: y - v.height / 2 - worldY * next }, duration);
  };

  const changeZoom = factor => zoomAt(factor, view.current.width / 2, view.current.height / 2);

  const resetView = () => { const v = view.current; animateView({ scale: v.baseScale, panX: 0, panY: 0 }, 300); setSelectedSlot(null); };

  const requestPixelClaim = slot => {
    setSelectedSlot(slot);
    setSelectedSpotSize(1);
    if (!session?.user) {
      if (!supabase) { setDrawer('setup'); return; }
      claimResumeRef.current = false;
      window.localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ slot, size: 1 }));
      setFormOpen(false); setAuthMode('signin'); setAuthMessage(''); setDrawer('signin');
      return;
    }
    setFormOpen(true);
  };

  const zoomToSlot = slot => {
    const v = view.current; const { x, y } = slotCoordinates(slot); const scale = Math.max(v.scale, v.baseScale * 30);
    animateView({ scale, panX: -(x + selectedSpotSize / 2 - MAP_SIZE / 2) * scale, panY: -(y + selectedSpotSize / 2 - MAP_SIZE / 2) * scale });
    requestPixelClaim(slot); updateVisible();
  };

  const focusSlot = slot => {
    const v = view.current; const { x, y } = slotCoordinates(slot); const scale = Math.max(v.scale, v.baseScale * 30);
    animateView({ scale, panX: -(x + .5 - MAP_SIZE / 2) * scale, panY: -(y + .5 - MAP_SIZE / 2) * scale });
    setSelectedSlot(slot); updateVisible();
  };

  const goToPixel = async (event, targetSlot) => {
    event?.preventDefault?.();
    const slot = Number(targetSlot ?? pixelSearch);
    if (!Number.isInteger(slot) || slot < 1 || slot > MAP_SIZE * MAP_SIZE) {
      notify('Enter a pixel number from 1 to 1,000,000.'); return;
    }
    if (!supabase) { notify('Connect Supabase before searching for a pixel.'); return; }
    setSearchingPixel(true);
    let { data, error } = await supabase.from('published_slots')
      .select('slot_number, col_index, row_index, anchor_slot, spot_size, display_name, image_path, description, website_url, published_at, expires_at')
      .eq('slot_number', slot).gt('expires_at', new Date().toISOString()).maybeSingle();
    if (error) {
      ({ data, error } = await supabase.from('published_slots')
        .select('slot_number, col_index, row_index, display_name, image_path, description, published_at, expires_at')
        .eq('slot_number', slot).gt('expires_at', new Date().toISOString()).maybeSingle());
    }
    setSearchingPixel(false);
    if (error) { notify('Could not find that pixel. Please try again.'); return; }
    if (!data) {
      focusSlot(slot);
      setSelectedImage(null); setDrawer('');
      notify(`Pixel #${slot.toLocaleString()} has no published image yet.`);
      return;
    }
    const image = { ...data, anchor_slot: data.anchor_slot || data.slot_number, spot_size: Number(data.spot_size) || 1, imageUrl: supabase.storage.from('published-images').getPublicUrl(data.image_path).data.publicUrl };
    openPublishedSpot(image);
  };

  const handleWheel = event => {
    event.preventDefault(); const rect = canvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left; const y = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? .035 : .0015));
    zoomAt(factor, x, y, 180);
  };

  const mapPointerDown = event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (viewAnimation.current) { cancelAnimationFrame(viewAnimation.current); viewAnimation.current = null; }
    activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (activePointers.current.size === 2) {
      const [first, second] = [...activePointers.current.values()];
      const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
      const rect = canvasRef.current.getBoundingClientRect();
      pinchState.current = { distance: Math.hypot(first.x - second.x, first.y - second.y), scale: view.current.scale, panX: view.current.panX, panY: view.current.panY, center: { x: center.x - rect.left, y: center.y - rect.top } };
      if (drag.current) drag.current.moved = true;
    }
    drag.current = { x: event.clientX, y: event.clientY, panX: view.current.panX, panY: view.current.panY, moved: activePointers.current.size > 1 };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const mapPointerMove = event => {
    if (activePointers.current.has(event.pointerId)) activePointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchState.current && activePointers.current.size >= 2) {
      const [first, second] = [...activePointers.current.values()]; const pinch = pinchState.current;
      const rect = canvasRef.current.getBoundingClientRect();
      const center = { x: (first.x + second.x) / 2 - rect.left, y: (first.y + second.y) / 2 - rect.top };
      const distance = Math.hypot(first.x - second.x, first.y - second.y);
      const nextScale = Math.max(view.current.baseScale, Math.min(view.current.baseScale * 150, pinch.scale * distance / Math.max(1, pinch.distance)));
      const worldX = (pinch.center.x - view.current.width / 2 - pinch.panX) / pinch.scale;
      const worldY = (pinch.center.y - view.current.height / 2 - pinch.panY) / pinch.scale;
      view.current.scale = nextScale; view.current.panX = center.x - view.current.width / 2 - worldX * nextScale; view.current.panY = center.y - view.current.height / 2 - worldY * nextScale;
      if (drag.current) drag.current.moved = true;
      updateVisible(); return;
    }
    const start = drag.current;
    if (!start) {
      const rect = canvasRef.current.getBoundingClientRect(); const v = view.current;
      const x = (event.clientX - rect.left - v.width / 2 - v.panX) / v.scale + MAP_SIZE / 2;
      const y = (event.clientY - rect.top - v.height / 2 - v.panY) / v.scale + MAP_SIZE / 2;
      const slot = x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE
        ? Math.floor(y) * MAP_SIZE + Math.floor(x) + 1 : null;
      setHoveredSlot(current => current === slot ? current : slot);
      setHoveredPoint(slot ? { x: event.clientX - rect.left, y: event.clientY - rect.top } : null);
      return;
    }
    const dx = event.clientX - start.x; const dy = event.clientY - start.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
    if (start.moved) { view.current.panX = start.panX + dx; view.current.panY = start.panY + dy; updateVisible(); }
  };
  const mapPointerUp = event => {
    activePointers.current.delete(event.pointerId);
    if (pinchState.current) { pinchState.current = null; drag.current = null; updateVisible(); return; }
    const start = drag.current; if (!start) return;
    if (activePointers.current.size === 0) drag.current = null;
    if (!start.moved) {
      const rect = canvasRef.current.getBoundingClientRect(); const v = view.current;
      const x = (event.clientX - rect.left - v.width / 2 - v.panX) / v.scale + MAP_SIZE / 2;
      const y = (event.clientY - rect.top - v.height / 2 - v.panY) / v.scale + MAP_SIZE / 2;
      if (x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE) {
        const slot = Math.floor(y) * MAP_SIZE + Math.floor(x) + 1;
        const publishedImage = published.find(item => Number(item.slot_number) === slot);
        if (publishedImage) openPublishedSpot(publishedImage);
        else if (v.scale < v.baseScale * 10) notify('Zoom in to choose an individual pixel.');
        else requestPixelClaim(slot);
      }
    }
    drag.current = null;
  };

  const submitClaim = async event => {
    event.preventDefault();
    if (!session?.user || !selectedSlot) { notify('Sign in and choose a pixel first.'); return; }
    const { artwork, proof, description, websiteUrl, tags, referralCode } = form;
    if (claimAmountDue > 0 && (!['instapay', 'vodafone_cash'].includes(form.paymentMethod) || form.paymentReference.trim().length < 3)) { notify('Choose a payment method and enter the transaction reference from your receipt.'); return; }
    if (!artwork || (claimAmountDue > 0 && !proof)) { notify(claimAmountDue > 0 ? 'Choose your image and payment proof before submitting.' : 'Choose your image before submitting.'); return; }
    const { x, y } = slotCoordinates(selectedSlot);
    if (x + selectedSpotSize > MAP_SIZE || y + selectedSpotSize > MAP_SIZE) { notify('Choose a spot that has enough free space for this size.'); return; }
    if (websiteUrl.trim() && !/^https?:\/\//i.test(websiteUrl.trim())) { notify('Your link must start with https:// or http://.'); return; }
    if (!allowedArtwork.includes(artwork.type)) { notify('Artwork must be PNG, JPG, GIF, or WebP.'); return; }
    if (proof && !(proof.type.startsWith('image/') || proof.type === 'application/pdf')) { notify('Payment proof must be an image or PDF.'); return; }
    if (artwork.size > MAX_FILE_BYTES || (proof && proof.size > MAX_FILE_BYTES)) { notify('Each file must be 3 MB or smaller.'); return; }
    setBusy(true);
    try {
      const userId = session.user.id; const token = crypto.randomUUID();
      const artworkPath = `${userId}/${token}-artwork.${extensionOf(artwork)}`;
      const proofPath = proof ? `${userId}/${token}-proof.${extensionOf(proof)}` : '';
      const artUpload = await supabase.storage.from('submission-files').upload(artworkPath, artwork, { contentType: artwork.type, upsert: false });
      if (artUpload.error) throw artUpload.error;
      if (proof) {
        const proofUpload = await supabase.storage.from('submission-files').upload(proofPath, proof, { contentType: proof.type, upsert: false });
        if (proofUpload.error) throw proofUpload.error;
      }
      const { error } = await supabase.from('slot_claims').insert({
        slot_number: selectedSlot, spot_size: selectedSpotSize, website_url: websiteUrl.trim() || null,
        user_id: userId, display_name: form.displayName.trim(), contact: form.contact.trim(),
        description: description.trim(), tags: tags.trim().slice(0, 160), artwork_path: artworkPath, proof_path: proofPath, status: 'pending',
        referral_code: referralCode.trim() || null, credits_requested: creditForThisClaim,
        payment_method: claimAmountDue > 0 ? form.paymentMethod : 'credits',
        payment_reference: claimAmountDue > 0 ? form.paymentReference.trim() : null
      });
      if (error) {
        if (error.code === '23505') throw new Error(error.message.includes('slot_claims_payment_reference') ? 'This payment reference is already attached to a submission. Please check My submissions.' : 'That pixel was just reserved. Please choose another.');
        throw error;
      }
      setMyClaims(current => [{ id: token, slot_number: selectedSlot, spot_size: selectedSpotSize, display_name: form.displayName.trim(), status: 'pending', created_at: new Date().toISOString() }, ...current]);
      if (profile) setProfile({ ...profile, credit_balance: Math.max(0, availableCredits - creditForThisClaim) });
      setFormOpen(false); setForm({ displayName: '', contact: '', description: '', websiteUrl: '', tags: '', referralCode: '', paymentMethod: 'instapay', paymentReference: '', artwork: null, proof: null }); setDrawer('account'); notify('Submitted for manual review.');
    } catch (error) { console.error(error); notify(error.message || 'Submission failed. Please try again.'); }
    finally { setBusy(false); }
  };

  const reviewClaim = async (claimId, decision) => {
    setBusy(true);
    const { error } = await supabase.functions.invoke('admin-review', { body: { claimId, decision } });
    setBusy(false);
    if (error) { notify(error.message || 'Review action failed.'); return; }
    setPendingClaims(items => items.filter(item => item.id !== claimId));
    if (decision === 'approve') { updateVisible(); refreshUsedSlotCount(); notify('Approved and published for 30 days.'); }
    else { notify('Rejected. The pixel is available again.'); }
  };

  const toggleImageLike = async () => {
    if (!session?.user) { setAuthMode('signin'); setAuthMessage('Sign in to like this image.'); setDrawer('signin'); return; }
    if (!selectedImage || !supabase || likeLock.current) return;
    likeLock.current = true;
    setLikeBusy(true);
    const anchorSlot = selectedImage.anchor_slot || selectedImage.slot_number;
    const request = imageLikes.liked
      ? supabase.from('slot_likes').delete().eq('slot_number', anchorSlot).eq('user_id', session.user.id)
      : supabase.from('slot_likes').insert({ slot_number: anchorSlot, user_id: session.user.id });
    const { error } = await request;
    setLikeBusy(false);
    if (error) { likeLock.current = false; notify(error.message || 'Could not update your like.'); return; }
    const { data, error: summaryError } = await supabase.rpc('get_slot_like_summary', { p_slot_number: anchorSlot });
    if (summaryError) { likeLock.current = false; notify(summaryError.message || 'Could not refresh the like count.'); return; }
    const summary = Array.isArray(data) ? data[0] : data;
    setImageLikes({ count: Number(summary?.like_count || 0), liked: Boolean(summary?.liked_by_viewer) });
    likeLock.current = false;
  };

  const currentScale = view.current.scale && view.current.baseScale ? view.current.scale / view.current.baseScale : 1;
  const selectedPublished = selectedSlot && published.some(item => Number(item.slot_number) === selectedSlot);
  const hoveredPublished = hoveredSlot ? published.find(item => Number(item.slot_number) === hoveredSlot) : null;

  return (
    <>
      <header className="topbar" id="top">
        <div className="topbar-row">
          <a className="brand" href="#top"><span className="brand-mark">M</span><span>million<span className="brand-light">pixel</span></span></a>
          <div className="top-actions">
            <div className="place-count"><div className="place-title"><span className="live-dot" />1,000,000 little places</div><div className="slot-counts"><span>Occupied: <b>{usedSlotCount == null ? '—' : usedSlotCount.toLocaleString()}</b></span><span>Free: <b>{usedSlotCount == null ? '—' : Math.max(0, MAP_SIZE * MAP_SIZE - usedSlotCount).toLocaleString()}</b></span></div></div>
            {!hasSupabaseConfig ? <button className="button button-small button-outline" onClick={() => setDrawer('setup')}>Setup needed</button> : session ? <>
              {profile?.is_admin && <button className="button button-small button-outline" onClick={() => setDrawer('admin')}>Review queue</button>}
              <button className="button button-small button-outline" onClick={() => setDrawer('account')}>{session.user.email}</button>
            </> : <button className="button button-small button-outline" onClick={() => { setAuthMode('signin'); setAuthMessage(''); setDrawer('signin'); }}>Sign in</button>}
          </div>
        </div>
        <section className="intro nav-hero"><div className="nav-hero-copy"><div className="eyebrow">A tiny space on a big canvas</div><h1>Make a little<br /><span>space yours.</span></h1></div><p>Choose a pixel, share your image, and leave your mark on a living canvas.</p><div className="intro-actions"><button className="button button-primary" onClick={() => { document.getElementById('canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); changeZoom(8); }}>Explore the canvas <span>↘</span></button><span className="intro-hint">Every submission is reviewed before it goes live.</span></div></section>
        {featuredChallenge && <div className="featured-challenge"><div><span className="eyebrow">Community vote · {featuredChallenge.title}</span><b>Monthly spotlight</b><small>Spot #{Number(featuredChallenge.slot_number).toLocaleString()} · {Number(featuredChallenge.vote_count).toLocaleString()} votes</small></div><img src={supabase.storage.from('published-images').getPublicUrl(featuredChallenge.image_path).data.publicUrl} alt={`Top voted spot in ${featuredChallenge.title}`} /><button onClick={() => document.getElementById('community-challenges')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>See the challenge ↘</button></div>}
      </header>

      <main>
        {!hasSupabaseConfig && <div className="setup-alert"><b>Supabase setup needed</b><span>Add your project URL and publishable key to <code>.env.local</code>, then run the database migration. See the README.</span></div>}

        <section className="workspace" id="canvas">
          <div className="canvas-heading"><div><div className="eyebrow">The canvas <span className="prototype-tag">LIVE PROJECT</span></div><h2>One million possibilities</h2></div><div className="canvas-count"><strong>1,000,000</strong><span>numbered slots</span></div></div>
          <div className="canvas-shell"><div className="canvas-toolbar"><div className="map-legend"><span className="legend-item"><i className="legend-free" /> Available</span><span className="legend-item"><i className="legend-live" /> Published</span><span className="legend-item"><i className="legend-selected" /> Selected</span></div><div className="zoom-controls"><button onClick={() => changeZoom(1 / 1.55)} aria-label="Zoom out">−</button><span>{currentScale.toFixed(currentScale < 10 ? 1 : 0)}×</span><button onClick={() => changeZoom(1.55)} aria-label="Zoom in">+</button><button className="reset-button" onClick={resetView}>Reset</button></div></div>
            <form className="discovery-search" onSubmit={searchCanvas}>
              <label className="discovery-keyword">Search creators or stories<input value={discoveryQuery} onChange={event => setDiscoveryQuery(event.target.value)} placeholder="Name or keyword" /></label>
              <label>Tag<input value={discoveryTag} onChange={event => setDiscoveryTag(event.target.value)} placeholder="e.g. art" /></label>
              <label>On canvas after<input type="date" value={joinedAfter} onChange={event => setJoinedAfter(event.target.value)} /></label>
              <label>On canvas before<input type="date" value={joinedBefore} onChange={event => setJoinedBefore(event.target.value)} /></label>
              <button className="discovery-submit" type="submit" disabled={discoveryBusy}>{discoveryBusy ? 'Searching…' : 'Search canvas'}</button>
            </form>
            {discoveryMessage && <div className="discovery-message" role="status">{discoveryMessage}</div>}
            {discoveryResults.length > 0 && <div className="discovery-results">{discoveryResults.map(spot => <button type="button" className="discovery-result" key={spot.anchor_slot} onClick={() => openPublishedSpot(spot)}><img src={spot.imageUrl} alt="" /><span><b>{spot.display_name}</b><small>Spot #{spot.anchor_slot.toLocaleString()} · {spot.tags || 'No tags'} · {new Date(spot.published_at).toLocaleDateString()}</small></span><i>↗</i></button>)}</div>}
            <div className="canvas-preview-row"><div className="canvas-preview-options" role="group" aria-label="Image preview style"><span>Preview</span><button type="button" className={previewStyle === 'default' ? 'active' : ''} aria-pressed={previewStyle === 'default'} onClick={() => setPreviewStyle('default')}>Default</button><button type="button" className={previewStyle === 'pixel' ? 'active' : ''} aria-pressed={previewStyle === 'pixel'} onClick={() => setPreviewStyle('pixel')}>Pixel mosaic</button><button type="button" className={previewStyle === 'collage' ? 'active' : ''} aria-pressed={previewStyle === 'collage'} onClick={() => setPreviewStyle('collage')}>Art collage</button></div><form className="pixel-finder" onSubmit={goToPixel}><label htmlFor="pixel-number">Go to pixel</label><input id="pixel-number" type="number" min="1" max="1000000" step="1" value={pixelSearch} onChange={event => setPixelSearch(event.target.value)} placeholder="Enter number" required /><button type="submit" disabled={searchingPixel}>{searchingPixel ? 'Finding…' : 'Go'}</button></form></div>
            <div className="canvas-wrap" ref={wrapRef} onWheel={handleWheel} onPointerDown={mapPointerDown} onPointerMove={mapPointerMove} onPointerLeave={() => { if (!activePointers.current.size) { setHoveredSlot(null); setHoveredPoint(null); } }} onPointerUp={mapPointerUp} onPointerCancel={event => { activePointers.current.delete(event.pointerId); pinchState.current = null; drag.current = null; }}>
              <canvas ref={canvasRef} aria-label="Interactive map of one million numbered slots. Zoom in to select a slot." />
              {hoveredSlot && hoveredPoint && hoveredPublished && <div className="spot-hover-card" style={{ left: `${Math.min(hoveredPoint.x + 16, view.current.width - 242)}px`, top: `${Math.min(Math.max(hoveredPoint.y + 16, 8), view.current.height - 215)}px` }}><img src={hoveredPublished.imageUrl} alt="" /><div><b>{hoveredPublished.display_name}</b><span>Spot #{Number(hoveredPublished.anchor_slot || hoveredPublished.slot_number).toLocaleString()} · {Number(hoveredPublished.spot_size) || 1}×{Number(hoveredPublished.spot_size) || 1}</span><p>{hoveredPublished.description?.trim() || 'A place on the Million Pixel canvas.'}</p>{hoveredPublished.website_url && <a href={hoveredPublished.website_url} target="_blank" rel="noreferrer">Visit link ↗</a>}<small>{hoveredPublished.published_at ? `Published ${new Date(hoveredPublished.published_at).toLocaleDateString()}` : 'Published image'}</small></div></div>}
              {hoveredSlot && hoveredPoint && !hoveredPublished && <div className="slot-hover-label" style={{ left: `${Math.min(hoveredPoint.x + 12, view.current.width - 150)}px`, top: `${Math.max(hoveredPoint.y - 34, 8)}px` }}><b>Pixel #{hoveredSlot.toLocaleString()}</b><span>Available · click to choose</span></div>}
              {currentScale < 1.3 && <div className="canvas-empty"><span>✳</span><b>Find your pixel</b><small>Zoom in and tap an open slot</small></div>}
            </div>
            <div className="canvas-footer"><span>Pinch or scroll to zoom · Drag to move · Zoom in to select</span><button className="text-button" onClick={() => { const slot = Math.floor(Math.random() * MAP_SIZE * MAP_SIZE) + 1; zoomToSlot(slot); }}>Pick a spot for me ↗</button></div>
          </div>
          <div className="discovery-grid">
            <article className="discovery-card"><div className="discovery-card-heading"><div><span className="eyebrow">Fresh on the canvas</span><h3>Live activity</h3></div><span className="activity-live"><i /> LIVE</span></div>
              {activityFeed.length ? <ul>{activityFeed.map(item => <li key={item.anchor_slot}><button type="button" onClick={() => goToPixel(undefined, item.anchor_slot)}><b>{item.display_name}</b>’s spot <strong>#{Number(item.anchor_slot).toLocaleString()}</strong> went live<small>{new Date(item.published_at).toLocaleString()}</small></button></li>)}</ul> : <p className="discovery-empty">Newly approved spots will appear here.</p>}
            </article>
            <article className="discovery-card"><div className="discovery-card-heading"><div><span className="eyebrow">Most clicked</span><h3>Hotspots</h3></div><span className="discovery-spark">↗</span></div>
              {leaderboard.filter(item => item.leader_type === 'hotspot' && Number(item.view_count) > 0).length ? <ol>{leaderboard.filter(item => item.leader_type === 'hotspot' && Number(item.view_count) > 0).slice(0, 5).map((item, index) => <li key={item.anchor_slot}><button type="button" onClick={() => goToPixel(undefined, item.anchor_slot)}><i>{String(index + 1).padStart(2, '0')}</i><span><b>Spot #{Number(item.anchor_slot).toLocaleString()}</b><small>{item.display_name}</small></span><strong>{Number(item.view_count).toLocaleString()} views</strong></button></li>)}</ol> : <p className="discovery-empty">Popular spots will appear as visitors explore.</p>}
            </article>
            <article className="discovery-card"><div className="discovery-card-heading"><div><span className="eyebrow">Community favorites</span><h3>Top creators</h3></div><span className="discovery-spark">✦</span></div>
              {leaderboard.filter(item => item.leader_type === 'creator').length ? <ol>{leaderboard.filter(item => item.leader_type === 'creator').slice(0, 5).map((item, index) => <li key={`${item.display_name}-${index}`}><div><i>{String(index + 1).padStart(2, '0')}</i><span><b>{item.display_name}</b><small>{Number(item.spot_count).toLocaleString()} spot{Number(item.spot_count) === 1 ? '' : 's'}</small></span><strong>♥ {Number(item.like_count).toLocaleString()}</strong></div></li>)}</ol> : <p className="discovery-empty">Creators will be ranked as images earn likes.</p>}
            </article>
          </div>
          <div className="replay-action"><div><span className="eyebrow">Share the progress</span><b>Canvas time-lapse</b><small>Reveal this week’s newly published spots in a 9:16 replay video.</small></div><button type="button" className="button button-outline" onClick={createWeeklyReplay}>Create weekly replay ↗</button></div>
          <section className="community-challenges" id="community-challenges"><div className="section-heading"><div><span className="eyebrow">Made by the community</span><h3>Monthly challenges</h3></div><small>Vote once per challenge; you can change your vote.</small></div><div className="challenge-grid">{challengeGroups.map(challenge => <article className="challenge-card" key={challenge.challenge_id}><div className="challenge-card-head"><div><h4>{challenge.title}</h4><p>{challenge.description}</p></div><span>Ends {new Date(challenge.ends_at).toLocaleDateString()}</span></div>{challenge.candidates.length ? <ol>{challenge.candidates.map(candidate => { const imageUrl = supabase.storage.from('published-images').getPublicUrl(candidate.image_path).data.publicUrl; return <li key={candidate.slot_number}><img src={imageUrl} alt="" /><div><b>{candidate.display_name}</b><small>Spot #{Number(candidate.slot_number).toLocaleString()} · {Number(candidate.vote_count).toLocaleString()} votes</small></div><button type="button" disabled={challengeBusy === `${challenge.challenge_id}:${candidate.slot_number}`} onClick={() => voteForChallenge(challenge.challenge_id, candidate.slot_number)}>{challengeBusy === `${challenge.challenge_id}:${candidate.slot_number}` ? 'Saving…' : 'Vote'}</button></li>; })}</ol> : <p className="challenge-empty">Add the tag <b>{challenge.tag_key}</b> to a spot to enter this challenge.</p>}</article>)}</div></section>
        </section>

        <section className="how-it-works"><div className="eyebrow">Simple by design</div><div className="steps"><article><span>01</span><h3>Choose a slot</h3><p>Explore the canvas and pick a free numbered pixel.</p></article><article><span>02</span><h3>Send your image</h3><p>Add your name and contact, plus payment proof for review.</p></article><article><span>03</span><h3>Go live</h3><p>Once approved, your image appears on the canvas for 30 days.</p></article></div></section>
        <section className="demo-note"><span className="note-icon">ⓘ</span><div><b>InstaPay &amp; Vodafone Cash · 50 EGP per spot</b><p>Transfer using your preferred app, then upload your receipt. Payments are checked manually before publishing. Your receipt is private and only available to you and authorized reviewers.</p></div></section>
      </main>

      <div className={`scrim ${drawer || formOpen ? 'open' : ''}`} onClick={() => { if (drawer === 'signin') { window.localStorage.removeItem(PENDING_CLAIM_KEY); claimResumeRef.current = false; } setDrawer(''); setFormOpen(false); }} />
      {formOpen && <aside className="drawer open"><button className="close-button" onClick={() => { window.localStorage.removeItem(PENDING_CLAIM_KEY); claimResumeRef.current = false; setFormOpen(false); }} aria-label="Close">×</button><div className="eyebrow">Your little corner</div><h2>Claim a pixel</h2><p className="drawer-lead">Spot <strong>#{selectedSlot?.toLocaleString()}</strong> · <strong>{selectedSpotSize}×{selectedSpotSize}</strong> is ready for a submission.</p>
        {!session ? <><p className="drawer-lead">Sign in or create an account to claim this pixel.</p><AuthForm email={email} setEmail={setEmail} password={password} setPassword={setPassword} mode={authMode} setMode={setAuthMode} onSubmit={signInWithPassword} onSignUp={signUp} onMagicLink={signIn} busy={busy} message={authMessage} /></> : selectedPublished ? <p>This pixel is already published. Please choose another.</p> : <form onSubmit={submitClaim}>
          <label className="field-label">Your name<input required maxLength="60" value={form.displayName} onChange={e => setForm({ ...form, displayName: e.target.value })} placeholder="How should we credit you?" /></label>
          <label className="field-label">Email or phone<input required maxLength="120" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} placeholder="So we can reach you" /></label>
          <label className="field-label">Your image story <span>Optional · 500 characters max</span><textarea maxLength="500" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Tell people what this image means to you. It can be a new image or a profile picture." /></label>
          <div className="story-counter">{form.description.length}/500</div>
          <label className="field-label">Website or social link <span>Optional</span><input type="url" maxLength="300" value={form.websiteUrl} onChange={e => setForm({ ...form, websiteUrl: e.target.value })} placeholder="https://your-site.com" /></label>
          <label className="field-label">Tags <span>Optional · separate with commas</span><input type="text" maxLength="160" value={form.tags} onChange={e => setForm({ ...form, tags: e.target.value })} placeholder="art, photography, gaming" /></label>
          <label className="field-label">Referral code <span>Optional · shared by a friend</span><input type="text" maxLength="32" value={form.referralCode} onChange={e => setForm({ ...form, referralCode: e.target.value.toUpperCase() })} placeholder="MP-XXXXXXXXXXXX" /></label>
          <label className="field-label">Your image <span>PNG, JPG, GIF, WebP · 3 MB max</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" required onChange={e => setForm({ ...form, artwork: e.target.files?.[0] || null })} /></label>
          {availableCredits > 0 && <label className="check-row credit-toggle"><input type="checkbox" checked={useCredits} onChange={event => setUseCredits(event.target.checked)} /><span>Use available credits ({formatEGP(availableCredits * SPOT_PRICE_EGP)})</span></label>}
          <div className="payment-box"><div><span>Amount due · 30 days</span><b>{formatEGP(claimAmountDue * SPOT_PRICE_EGP)}</b></div><small>{formatEGP(SPOT_PRICE_EGP)} per spot. {claimAmountDue === 0 ? 'Credits cover this spot; no transfer or receipt is needed.' : 'Account credits are deducted from the amount shown.'} Referral rewards are 15% in account credits after approval.</small></div>
          {claimAmountDue > 0 && <EgyptPayment form={form} setForm={setForm} amount={claimAmountDue * SPOT_PRICE_EGP} slot={selectedSlot} notify={notify} />}
          <label className="check-row"><input type="checkbox" required /><span>I understand my image will be displayed publicly if approved.</span></label>
          <button className="button button-primary button-wide" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Send for review ↗'}</button>
          <p className="form-disclaimer">Files are stored in Supabase Storage; payment proof remains in a private bucket.</p>
        </form>}
      </aside>}

      {drawer && <aside className="drawer open"><button className="close-button" onClick={() => { if (drawer === 'signin') { window.localStorage.removeItem(PENDING_CLAIM_KEY); claimResumeRef.current = false; } setDrawer(''); }} aria-label="Close">×</button>
        {drawer === 'setup' && <><div className="eyebrow">Configuration</div><h2>Connect Supabase</h2><p className="drawer-lead">Follow the project README to create a Supabase project, apply the migration, set the two Vite environment variables, and deploy the admin-review Edge Function.</p></>}
        {drawer === 'signin' && <><div className="eyebrow">Welcome</div><h2>{authMode === 'signup' ? 'Create your account' : 'Sign in'}</h2><p className="drawer-lead">{authMode === 'signup' ? 'Create an account to claim a pixel and share your image.' : 'Sign in to claim a pixel, like images, or manage your submissions.'}</p><AuthForm email={email} setEmail={setEmail} password={password} setPassword={setPassword} mode={authMode} setMode={setAuthMode} onSubmit={signInWithPassword} onSignUp={signUp} onMagicLink={signIn} busy={busy} message={authMessage} /></>}
        {drawer === 'account' && <><div className="eyebrow">Your account</div><h2>My submissions</h2><p className="drawer-lead">Signed in as <strong>{session?.user.email}</strong></p><div className="referral-account-card"><span className="eyebrow">Your referral link</span><b>{profile?.referral_code || 'Generating your code…'}</b><small>Both of you earn 15% of a referred spot’s price in credits after it is approved.</small><button type="button" onClick={copyReferralLink} disabled={!profile?.referral_code}>Copy invite link</button><div>Credit balance <strong>{formatEGP(availableCredits * SPOT_PRICE_EGP)}</strong></div></div><div className="claim-list">{myClaims.length ? myClaims.map(claim => <div className="claim-row" key={claim.id}><b>Spot #{claim.slot_number.toLocaleString()} · {Number(claim.spot_size) || 1}×{Number(claim.spot_size) || 1}</b><span className={`status-pill ${claim.status}`}>{claim.status}</span><small>{claim.display_name} · {new Date(claim.created_at).toLocaleDateString()}</small></div>) : <div className="queue-empty">No submissions yet. Choose an open pixel on the map.</div>}</div><button className="button button-outline button-wide" onClick={signOut}>Sign out</button></>}
        {drawer === 'image' && selectedImage && <><div className="eyebrow">Published spot · #{Number(selectedImage.anchor_slot || selectedImage.slot_number).toLocaleString()}</div><h2>{selectedImage.display_name}</h2><div className="image-detail-photo"><img src={selectedImage.imageUrl} alt={`Image published by ${selectedImage.display_name}`} onDoubleClick={toggleImageLike} title="Double-click to like" /></div><div className="spot-profile-meta"><span>{Number(selectedImage.spot_size) || 1}×{Number(selectedImage.spot_size) || 1} featured area</span><span>Published {selectedImage.published_at ? new Date(selectedImage.published_at).toLocaleDateString() : 'date unavailable'}</span></div>{selectedImage.website_url && <a className="spot-profile-link" href={selectedImage.website_url} target="_blank" rel="noreferrer">Visit website or social profile ↗</a>}<div className="image-story">{selectedImage.description?.trim() ? selectedImage.description : <span className="empty-story">No story was added for this image.</span>}</div><button className={`image-like-button ${imageLikes.liked ? 'liked' : ''}`} type="button" onClick={toggleImageLike} disabled={likeBusy} aria-pressed={imageLikes.liked}><span aria-hidden="true">{imageLikes.liked ? '♥' : '♡'}</span><b>{imageLikes.liked ? 'Liked' : 'Like'}</b><span className="like-count">{imageLikes.count.toLocaleString()}</span></button>{!session?.user && <p className="image-like-hint">Sign in to like this image.</p>}</>}
        {drawer === 'admin' && <><div className="eyebrow">Protected review queue</div><h2>Review submissions</h2><p className="drawer-lead">Only accounts granted admin access can review proof and publish images.</p><div className="queue-heading">Pending review <small>{pendingClaims.length} requests</small></div>{pendingClaims.length ? pendingClaims.map(claim => <article className="submission-card" key={claim.id}><div className="submission-card-head"><strong>Pixel #{claim.slot_number.toLocaleString()} · {claim.display_name}</strong><span className="status-pill">Pending</span></div><div className="submission-meta">{claim.contact}<br />Submitted {new Date(claim.created_at).toLocaleString()}<br />Amount due: {claim.payment_amount_egp != null ? formatEGP(claim.payment_amount_egp) : `${Number(claim.amount_due ?? 1).toFixed(2)} (legacy claim)`}{claim.payment_method && <><br />Method: {PAYMENT_METHODS[claim.payment_method] || claim.payment_method}</>}{claim.payment_reference && <><br />Transaction reference: {claim.payment_reference}</>}</div>{claim.description?.trim() && <p className="submission-story">{claim.description}</p>}<div className="submission-preview">{claim.artworkUrl && <img src={claim.artworkUrl} alt="Submitted artwork" />}{claim.proofUrl ? <a href={claim.proofUrl} target="_blank" rel="noreferrer">Open private payment proof ↗</a> : <span className="submission-meta">Paid fully with account credits</span>}</div><div className="queue-actions"><button disabled={busy} onClick={() => reviewClaim(claim.id, 'approve')}>Approve & publish</button><button className="reject-button" disabled={busy} onClick={() => reviewClaim(claim.id, 'reject')}>Reject</button></div></article>) : <div className="queue-empty">No pending submissions.</div>}</>}
      </aside>}
      {replayOpen && <div className="replay-overlay"><aside className="replay-modal"><button className="close-button" onClick={() => setReplayOpen(false)} aria-label="Close replay">×</button><div className="eyebrow">Share the progress</div><h2>This week on the canvas</h2><p className="drawer-lead">A vertical 9:16 replay of spots published in the last seven days.</p><canvas className="replay-canvas" ref={replayCanvasRef} /><div className="replay-progress"><i style={{ width: `${replayProgress * 100}%` }} /></div><p className="replay-status">{replayMessage}</p><button type="button" className="button button-outline button-wide" onClick={() => { setReplayOpen(false); createWeeklyReplay(); }}>Make another replay</button></aside></div>}
      {toast && <div className="toast show" role="status">{toast}</div>}
    </>
  );
}

function EgyptPayment({ form, setForm, amount, slot, notify }) {
  const copyNumber = async () => {
    try { await navigator.clipboard.writeText(PAYMENT_NUMBER); notify('Receiving number copied.'); }
    catch { notify(`Receiving number: ${PAYMENT_NUMBER}`); }
  };
  return <section className="egypt-payment" aria-labelledby="egypt-payment-title">
    <h3 id="egypt-payment-title">Pay in Egypt</h3>
    <fieldset className="payment-methods"><legend>Choose your transfer method</legend>
      {['instapay', 'vodafone_cash'].map(method => <label key={method} className={form.paymentMethod === method ? 'selected' : ''}>
        <input type="radio" name="payment-method" value={method} checked={form.paymentMethod === method} onChange={() => setForm({ ...form, paymentMethod: method, paymentReference: '', proof: null })} />
        <span>{PAYMENT_METHODS[method]}</span>
      </label>)}
    </fieldset>
    <div className="payment-recipient"><span>{form.paymentMethod === 'instapay' ? 'InstaPay receiving mobile number' : 'Vodafone Cash wallet number'}</span><div><strong dir="ltr">{PAYMENT_NUMBER}</strong><button type="button" onClick={copyNumber}>Copy number</button></div></div>
    <ol className="payment-instructions"><li>Open {PAYMENT_METHODS[form.paymentMethod]} and choose {form.paymentMethod === 'instapay' ? 'Send money → Mobile number' : 'Transfer money'}.</li><li>Enter the receiving number and verify the recipient shown in the app.</li><li>Transfer <strong>{formatEGP(amount)}</strong>. If a note is available, enter <strong>Spot #{slot?.toLocaleString()}</strong>.</li><li>Keep the successful transfer receipt and add it below.</li></ol>
    <p className="payment-review-note">Your bank or wallet may charge a transfer fee. Your spot stays pending until the payment and image are reviewed.</p>
    <label className="field-label">Transaction reference<input type="text" required minLength="3" maxLength="100" value={form.paymentReference} onChange={event => setForm({ ...form, paymentReference: event.target.value })} placeholder="Reference or transaction ID on your receipt" autoComplete="off" /></label>
    <label className="field-label">Successful transfer receipt <span>Image or PDF · 3 MB max</span><input key={form.paymentMethod} type="file" accept="image/*,application/pdf" required onChange={event => setForm({ ...form, proof: event.target.files?.[0] || null })} /></label>
  </section>;
}

function AuthForm({ email, setEmail, password, setPassword, mode, setMode, onSubmit, onSignUp, onMagicLink, busy, message }) {
  const requestMagicLink = event => {
    event.preventDefault();
    onMagicLink(event);
  };
  return <>
    <form onSubmit={mode === 'signup' ? onSignUp : onSubmit}>
      <label className="field-label">Email address<input type="email" value={email} required onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label>
      <label className="field-label">Password<input type="password" value={password} required minLength="6" onChange={event => setPassword(event.target.value)} placeholder={mode === 'signup' ? 'Create a password (6+ characters)' : 'Your account password'} /></label>
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in with password'}</button>
    </form>
    {mode === 'signin' && <form onSubmit={requestMagicLink}><input type="hidden" value={email} readOnly /><button className="button button-outline button-wide" disabled={busy || !email.trim()}>{busy ? 'Please wait…' : 'Email me a sign-in link instead'}</button></form>}
    <button className="auth-switch" type="button" disabled={busy} onClick={() => setMode(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account'}</button>
    {message && <p className="auth-message">{message}</p>}
  </>;
}

export default App;
