import SocialShare from './SocialShare.jsx';
import { useCallback, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from './supabase.js';
import CommunityGames, { spotPrestige, achievementLabels } from './CommunityGames.jsx';
import CanvasExpeditions, { DISTRICTS, districtForSlot, randomOpenSlot } from './CanvasExpeditions.jsx';



const MAP_SIZE = 1000;
const LANDMARKS = [{ slot: 1, name: 'The beginning' }, { slot: 499500, name: 'Heart of the canvas' }, { slot: 500501, name: 'Center crossroads' }, { slot: 1000000, name: 'The final pixel' }, { slot: 777778, name: 'Lucky 777' }];
function landmarkName(slot) { return LANDMARKS.find(item => item.slot === Number(slot))?.name; }
function relativeTime(date, now) {
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes}m ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}
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
  const [activityNow, setActivityNow] = useState(Date.now());
  const [gameData, setGameData] = useState(null);
  const [expeditionData, setExpeditionData] = useState(null);
  const [expeditionError, setExpeditionError] = useState('');
  const [districtFog, setDistrictFog] = useState(true);
  const [puzzleMode, setPuzzleMode] = useState(false);
  const [puzzleBusy, setPuzzleBusy] = useState(false);
  const refreshExpeditions = useCallback(async () => {
    if (!supabase) return;
    try { const { data, error } = await supabase.rpc('get_canvas_expeditions'); if (error) { setExpeditionError('Season and quest data is temporarily unavailable.'); return; } setExpeditionData(data); setExpeditionError(''); }
    catch { setExpeditionError('Season and quest data is temporarily unavailable.'); }
  }, []);

  const [gameError, setGameError] = useState('');
  const [heatmap, setHeatmap] = useState(false);
  const [territories, setTerritories] = useState(false);
  const [huntMode, setHuntMode] = useState(false);
  const [huntBusy, setHuntBusy] = useState(false);
  const gameVisitor = useRef(null);
  const hoveredGameSpots = useRef(new Set());
  const getGameVisitor = () => {
    if (gameVisitor.current) return gameVisitor.current;
    try { let value = localStorage.getItem('million-pixel-visitor-id'); if (!value) { value = crypto.randomUUID(); localStorage.setItem('million-pixel-visitor-id', value); } gameVisitor.current = value; }
    catch { gameVisitor.current = crypto.randomUUID(); }
    return gameVisitor.current;
  };
  const refreshGames = useCallback(async () => {
    if (!supabase) return;
    try { const { data, error } = await supabase.rpc('get_canvas_games'); if (error) { setGameError('Community features are temporarily unavailable.'); return; } setGameData(data); setGameError(''); }
    catch { setGameError('Community features are temporarily unavailable.'); }
  }, []);

  const sharedSpotOpened = useRef(false);
  useEffect(() => { const timer = setInterval(() => setActivityNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const [showSamples, setShowSamples] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem('million-pixel-guide-v1')) return;
      localStorage.setItem('million-pixel-guide-v1', 'seen');
    } catch { /* The guide also works with storage disabled. */ }
    setShowGuide(true);
  }, []);
  useEffect(() => {
    if (!showGuide) return;
    const timer = setTimeout(() => setShowGuide(false), 3000);
    return () => clearTimeout(timer);
  }, [showGuide]);
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    setExpeditionData(null); refreshExpeditions();
    const timer = setInterval(refreshExpeditions, 30000); return () => clearInterval(timer);
  }, [session?.user?.id, refreshExpeditions]);
  useEffect(() => {
    setGameData(null); refreshGames();
    const timer = setInterval(refreshGames, 30000);
    return () => clearInterval(timer);
  }, [session?.user?.id, refreshGames]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const [reviewServiceMessage,setReviewServiceMessage]=useState('');
  const [authMode, setAuthMode] = useState('signin');
  const [published, setPublished] = useState([]);
  const [usedSlotCount, setUsedSlotCount] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedSpotSize, setSelectedSpotSize] = useState(1);
  const [hoveredSlot, setHoveredSlot] = useState(null);
  const [hoveredPoint, setHoveredPoint] = useState(null);
  useEffect(() => {
    if (!hoveredSlot || !supabase || !published.some(item => Number(item.slot_number) === hoveredSlot) || hoveredGameSpots.current.has(hoveredSlot)) return;
    const timer = setTimeout(() => { hoveredGameSpots.current.add(hoveredSlot); supabase.rpc('record_canvas_interaction', { p_slot: hoveredSlot, p_visitor: getGameVisitor(), p_kind: 'hover' }); }, 800);
    return () => clearTimeout(timer);
  }, [hoveredSlot, published]);

  const [previewStyle, setPreviewStyle] = useState('default');
  const [browseView, setBrowseView] = useState('gallery');
  const [gallerySpots, setGallerySpots] = useState([]);
  const [galleryPage, setGalleryPage] = useState(0);
  const [galleryMore, setGalleryMore] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [galleryRetry, setGalleryRetry] = useState(0);
  const [galleryQuery, setGalleryQuery] = useState('');
  const swipeStart = useRef(null);
  useEffect(() => {
    if (!supabase) return;
    let ignore = false; setGalleryBusy(true); setGalleryError('');
    supabase.from('published_slots').select('slot_number,anchor_slot,spot_size,col_index,row_index,display_name,image_path,description,website_url,published_at,expires_at')
      .gt('expires_at', new Date().toISOString()).order('published_at', { ascending: false }).order('slot_number').range(galleryPage * 48, galleryPage * 48 + 47)
      .then(({ data, error }) => {
        if (ignore) return;
        setGalleryBusy(false);
        if (error) { setGalleryError('Images could not be loaded. Please try again.'); return; }
        const rows = (data || []).map(item => ({ ...item, anchor_slot: Number(item.anchor_slot || item.slot_number), imageUrl: supabase.storage.from('published-images').getPublicUrl(item.image_path).data.publicUrl }));
        setGallerySpots(previous => [...new Map([...(galleryPage ? previous : []), ...rows].filter(item => new Date(item.expires_at).getTime() > Date.now()).map(item => [item.anchor_slot, item])).values()]);
        setGalleryMore((data || []).length === 48);
      });
    return () => { ignore = true; };
  }, [galleryPage, galleryRetry]);
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
    setSelectedSpotSize([1, 2, 3, 4].includes(savedSize) ? savedSize : 1);
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
    await supabase.rpc('record_canvas_interaction', { p_slot: slotNumber, p_visitor: visitorId, p_kind: 'click' });
    const { data: authState } = await supabase.auth.getSession();
    if (authState?.session) await supabase.rpc('record_canvas_exploration', { p_slot: slotNumber });
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
    // Coarse coordinates stay visible before individual pixels become readable.
    if (scale < 11 && bounds) {
      const step = scale < 1 ? 50 : scale < 3 ? 10 : 5;
      ctx.beginPath(); ctx.strokeStyle = '#344b3d'; ctx.lineWidth = .6;
      for (let x = Math.ceil(bounds.minX / step) * step; x <= bounds.maxX; x += step) { const px = toScreen(x, 0).x; ctx.moveTo(px, topLeft.y); ctx.lineTo(px, bottomRight.y); }
      for (let y = Math.ceil(bounds.minY / step) * step; y <= bounds.maxY; y += step) { const py = toScreen(0, y).y; ctx.moveTo(topLeft.x, py); ctx.lineTo(bottomRight.x, py); }
      ctx.stroke();
      ctx.font = '10px monospace'; ctx.fillStyle = '#829785';
      for (let x = Math.ceil(bounds.minX / (step * 4)) * step * 4; x <= bounds.maxX; x += step * 4) ctx.fillText(`X ${x}`, toScreen(x, 0).x + 4, Math.max(14, topLeft.y + 14));
    }


    if (districtFog) {
      for (const district of DISTRICTS) {
        if ((expeditionData?.approved_placements || 0) >= district.required) continue;
        const p = toScreen(district.x, district.y), size = 500 * scale;
        ctx.fillStyle = 'rgba(5,10,14,.88)'; ctx.fillRect(p.x, p.y, size, size);
        ctx.strokeStyle = '#71818a'; ctx.lineWidth = 1; ctx.strokeRect(p.x, p.y, size, size);
        if (size > 150) { ctx.save(); ctx.textAlign = 'center'; ctx.fillStyle = '#acbbc2'; ctx.font = 'bold 14px sans-serif'; ctx.fillText(`District ${district.zone} · Locked`, p.x + size / 2, p.y + size / 2); ctx.font = '11px sans-serif'; ctx.fillText(`${district.required.toLocaleString()} approved placements`, p.x + size / 2, p.y + size / 2 + 21); ctx.restore(); }
      }
    }
    if (heatmap) {
      const peak = Math.max(1, ...(gameData?.heatmap || []).map(item => Number(item.interactions)));
      for (const item of gameData?.heatmap || []) {
        const { x, y } = slotCoordinates(item.slot); const p = toScreen(x + .5, y + .5); const radius = Math.max(14, Math.min(70, scale * 4));
        const intensity = Math.sqrt(Number(item.interactions) / peak); const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
        glow.addColorStop(0, `rgba(255,100,54,${.3 + intensity * .5})`); glow.addColorStop(1, 'rgba(255,160,50,0)'); ctx.fillStyle = glow; ctx.fillRect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      }
    }
    if (territories) {
      for (const cell of gameData?.territory || []) {
        const { x, y } = slotCoordinates(cell.slot), p = toScreen(x, y); let hue = 0; for (const char of cell.guild_id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
        ctx.fillStyle = `hsla(${hue},75%,65%,.45)`; ctx.fillRect(p.x, p.y, Math.max(3, scale), Math.max(3, scale));
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
    if (hoveredSlot && !published.some(item => Number(item.slot_number) === hoveredSlot)) {
      const { x, y } = slotCoordinates(hoveredSlot); const p = toScreen(x, y);
      ctx.save(); ctx.fillStyle = '#c4f06b'; ctx.shadowColor = '#c4f06b'; ctx.shadowBlur = 8;
      ctx.font = `${Math.min(18, Math.max(10, scale * .58))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('✦', p.x + scale / 2, p.y + scale / 2); ctx.restore();
    }

    if (territories) {
      const owners = new Map((gameData?.territory || []).map(cell => [Number(cell.slot), cell.guild_id]));
      for (const cell of gameData?.territory || []) {
        const { x, y } = slotCoordinates(cell.slot), p = toScreen(x, y); let hue = 0; for (const char of cell.guild_id) hue = (hue * 31 + char.charCodeAt(0)) % 360;
        ctx.strokeStyle = `hsl(${hue},80%,70%)`; ctx.lineWidth = 2; ctx.beginPath();
        if (x === 0 || owners.get(cell.slot - 1) !== cell.guild_id) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y + scale); }
        if (x === 999 || owners.get(cell.slot + 1) !== cell.guild_id) { ctx.moveTo(p.x + scale, p.y); ctx.lineTo(p.x + scale, p.y + scale); }
        if (owners.get(cell.slot - 1000) !== cell.guild_id) { ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + scale, p.y); }
        if (owners.get(cell.slot + 1000) !== cell.guild_id) { ctx.moveTo(p.x, p.y + scale); ctx.lineTo(p.x + scale, p.y + scale); }
        ctx.stroke();
      }
    }

    if (puzzleMode && expeditionData?.riddle?.slot) {
      const { x, y } = slotCoordinates(expeditionData.riddle.slot), p = toScreen(x + .5, y + .5);
      ctx.save(); ctx.fillStyle = '#f0db9a'; ctx.shadowColor = '#e5c65c'; ctx.shadowBlur = 10; ctx.font = `${Math.max(14, Math.min(28, scale * .8))}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', p.x, p.y); ctx.restore();
    }
    if (gameData?.champion) {
      const { x, y } = slotCoordinates(gameData.champion); const p = toScreen(x, y); ctx.save(); ctx.strokeStyle = '#87fff0'; ctx.shadowColor = '#42ffdd'; ctx.shadowBlur = 16; ctx.lineWidth = 3;
      ctx.strokeRect(p.x - 2, p.y - 2, Math.max(8, scale + 4), Math.max(8, scale + 4)); ctx.restore();
    }
    for (const landmark of LANDMARKS) {
      const { x, y } = slotCoordinates(landmark.slot); const p = toScreen(x + .5, y + .5);
      if (p.x < 0 || p.y < 0 || p.x > width || p.y > height) continue;
      ctx.save(); ctx.strokeStyle = '#f4c776'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(5, Math.min(12, scale / 2)), 0, Math.PI * 2); ctx.stroke(); ctx.restore();
    }
    if (selectedSlot) {
      const { x, y } = slotCoordinates(selectedSlot); const p = toScreen(x, y);
      ctx.strokeStyle = '#c4f06b'; ctx.lineWidth = 2; ctx.strokeRect(p.x + 1, p.y + 1, Math.max(2, scale * selectedSpotSize - 2), Math.max(2, scale * selectedSpotSize - 2));
    }
  }, [published, selectedSlot, selectedSpotSize, hoveredSlot, previewStyle, visibleBounds, heatmap, territories, gameData, districtFog, expeditionData, puzzleMode]);

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
        .select('slot_number,anchor_slot,display_name,published_at,image_path,description,website_url')
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'published_slots' }, () => {
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

  const requestPixelClaim = (slot, size = 1) => {
    if (!Number.isInteger(slot) || slot < 1 || slot > 1000000 || ![1,3].includes(size)) { notify('Choose a valid spot.'); return; }
    const point = slotCoordinates(slot);
    if (point.x + size > 1000 || point.y + size > 1000) { notify('This image needs more room at the canvas edge.'); return; }
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) {
      const district = districtForSlot(slot + dy * 1000 + dx);
      if ((expeditionData?.approved_placements || 0) < district.required) { notify(`District ${district.zone} unlocks at ${district.required.toLocaleString()} approved tile placements. Choose an open district.`); return; }
    }
    setSelectedSlot(slot);
    setSelectedSpotSize(size);
    if (!session?.user) {
      if (!supabase) { setDrawer('setup'); return; }
      claimResumeRef.current = false;
      window.localStorage.setItem(PENDING_CLAIM_KEY, JSON.stringify({ slot, size }));
      setFormOpen(false); setAuthMode('signin'); setAuthMessage(''); setDrawer('signin');
      return;
    }
    setFormOpen(true);
  };

  const zoomToSlot = slot => {
    setBrowseView('map');
    const v = view.current; const { x, y } = slotCoordinates(slot); const scale = Math.max(v.scale, v.baseScale * 30);
    animateView({ scale, panX: -(x + selectedSpotSize / 2 - MAP_SIZE / 2) * scale, panY: -(y + selectedSpotSize / 2 - MAP_SIZE / 2) * scale });
    requestPixelClaim(slot); updateVisible();
  };

  const focusSlot = (slot, zoom = 30) => {
    setBrowseView('map');
    const v = view.current; const { x, y } = slotCoordinates(slot); const scale = v.baseScale * Math.min(150, Math.max(1, zoom));
    animateView({ scale, panX: -(x + .5 - MAP_SIZE / 2) * scale, panY: -(y + .5 - MAP_SIZE / 2) * scale });
    setSelectedSlot(slot); updateVisible();
  };

  const goToPixel = async (event, targetSlot) => { setPuzzleMode(false); setHuntMode(false);
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

  const searchGoldenPixel = async slot => {
    if (huntBusy) return;
    if (!session?.user) { setAuthMode('signin'); setAuthMessage('Sign in to collect a golden pixel.'); setDrawer('signin'); return; }
    setHuntBusy(true);
    try { const { data, error } = await supabase.rpc('find_canvas_golden_pixel', { p_slot: slot }); if (error) notify(error.message); else if (data) { notify('Golden pixel found! Your Golden Explorer badge is saved.'); refreshGames(); } else notify(`Spot #${slot.toLocaleString()}: keep looking inside the clue area.`); }
    catch { notify('Could not check this pixel. Please try again.'); } finally { setHuntBusy(false); }
  };

  const visitRiddlePixel = async slot => {
    if (puzzleBusy) return;
    if (!session) { setAuthMode('signin'); setAuthMessage('Sign in to save your puzzle progress.'); setDrawer('signin'); return; }
    setPuzzleBusy(true);
    try { const { data, error } = await supabase.rpc('visit_canvas_riddle', { p_slot: slot }); if (error) notify(error.message); else if (data) { notify('Clue discovered! Return to the puzzle trail to answer.'); refreshExpeditions(); setPuzzleMode(false); document.getElementById('canvas-expeditions')?.scrollIntoView({ behavior: 'smooth' }); } else notify('Look for the question mark on your current clue pixel.'); }
    catch { notify('Could not save this visit. Please try again.'); } finally { setPuzzleBusy(false); }
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
    if (event.target.closest?.('.spot-hover-card')) return;
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
      if (event.pointerType !== 'mouse') return;
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
        if (puzzleMode) { if (view.current.scale < view.current.baseScale * 40) { notify('Zoom in further to read the clue marker.'); return; } visitRiddlePixel(slot); return; }
        if (huntMode) { if (view.current.scale < view.current.baseScale * 40) { notify('Zoom in further to search for a golden pixel.'); return; } searchGoldenPixel(slot); return; }
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

  const checkReviewService = async () => {
    setBusy(true);setReviewServiceMessage('Checking review service…');
    try {let {data,error}=await supabase.functions.invoke('admin-review',{body:{decision:'check'}});
      if(error?.context?.status===401){const refreshed=await supabase.auth.refreshSession();if(!refreshed.error)({data,error}=await supabase.functions.invoke('admin-review',{body:{decision:'check'}}));}
      if(error){let message=error.message;if(error.context){try{const details=await error.context.json();message=details.error||details.message||message;}catch{}}throw new Error(message);}
      setReviewServiceMessage(data?.canReview?'Review service connected. Your admin access is verified.':'Could not verify review access.');
    }catch(e){setReviewServiceMessage(e.message||'Review service unavailable.');}finally{setBusy(false);}
  };
  const reviewClaim = async (claimId, decision) => {
    setBusy(true);
    let { data, error } = await supabase.functions.invoke('admin-review', { body: { claimId, decision } });
    if(error?.context?.status===401){const refreshed=await supabase.auth.refreshSession();if(!refreshed.error)({data,error}=await supabase.functions.invoke('admin-review',{body:{claimId,decision}}));}
    setBusy(false);
    if (error || data?.error) { let message=data?.error||error?.message||'Review action failed.'; if(error?.context){try{const payload=await error.context.json();message=payload.error||payload.message||message;}catch{}} notify(message);return; }
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

  const claimAvailableSpot = () => {
    let slot = randomOpenSlot(expeditionData?.approved_placements || 0);
    const occupied = new Set(published.map(item => Number(item.slot_number)));
    while (occupied.has(slot) && occupied.size < MAP_SIZE * MAP_SIZE) slot = slot % (MAP_SIZE * MAP_SIZE) + 1;
    setShowSamples(false);
    zoomToSlot(slot);
  };
  const claimedPercent = usedSlotCount == null ? null : usedSlotCount / 10000;
  const galleryResults = gallerySpots.filter(item => `${item.display_name} ${item.description || ''} ${item.anchor_slot}`.toLowerCase().includes(galleryQuery.trim().toLowerCase())).sort((a, b) => Number(b.anchor_slot === gameData?.champion) - Number(a.anchor_slot === gameData?.champion));
  const viewerSpots = selectedImage && !galleryResults.some(item => Number(item.anchor_slot) === Number(selectedImage.anchor_slot || selectedImage.slot_number)) ? [selectedImage, ...galleryResults] : galleryResults;
  const viewerIndex = selectedImage ? viewerSpots.findIndex(item => Number(item.anchor_slot || item.slot_number) === Number(selectedImage.anchor_slot || selectedImage.slot_number)) : -1;
  const browseImage = direction => {
    if (viewerSpots.length < 2) return;
    openPublishedSpot(viewerSpots[(viewerIndex + direction + viewerSpots.length) % viewerSpots.length]);
  };
  useEffect(() => {
    if (drawer !== 'image') return;
    const onKey = event => {
      if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); browseImage(event.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [drawer, selectedImage, gallerySpots, galleryQuery]);

  const spotlightCandidates = [...activityFeed].sort((a, b) => a.anchor_slot - b.anchor_slot);
  const spotlight = spotlightCandidates.length ? spotlightCandidates[Math.floor(activityNow / 86400000) % spotlightCandidates.length] : null;
  const copySpotLink = async slot => {
    const url = new URL(window.location.origin); url.searchParams.set('spot', String(slot));
    try { await navigator.clipboard.writeText(url.href); notify('Direct spot link copied.'); }
    catch { notify(`Share this link: ${url.href}`); }
  };
  const downloadSpotBadge = (spot, owned = false) => {
    const slot = Number(spot.anchor_slot || spot.slot_number); const { x, y } = slotCoordinates(slot);
    const card = document.createElement('canvas'); card.width = 1200; card.height = 630; const ctx = card.getContext('2d');
    ctx.fillStyle = '#142019'; ctx.fillRect(0, 0, 1200, 630);
    ctx.fillStyle = '#ccf599'; ctx.font = 'bold 28px sans-serif'; ctx.fillText('M  millionpixel', 65, 70);
    ctx.fillStyle = '#b0c0ab'; ctx.font = '22px sans-serif'; ctx.fillText(owned ? 'A LITTLE SPACE. MY STORY.' : 'A LITTLE SPACE. A NEW STORY.', 65, 140);
    ctx.fillStyle = '#f4f6ed'; ctx.font = 'bold 48px sans-serif'; ctx.fillText(owned ? 'I claimed' : 'Discover', 65, 220);
    ctx.fillStyle = '#ccf599'; ctx.font = 'bold 66px sans-serif'; ctx.fillText(`Spot #${slot.toLocaleString()}`, 65, 300);
    ctx.fillStyle = '#f4f6ed'; ctx.font = '26px sans-serif';
    let name = spot.display_name || 'A story on the canvas'; while (ctx.measureText(name).width > 555 && name.length) name = name.slice(0, -1);
    ctx.fillText(name, 65, 355); ctx.fillStyle = '#acbba6'; ctx.font = '22px sans-serif'; ctx.fillText(`Column ${x + 1} · Row ${y + 1}`, 65, 410);
    const mapX = 740, mapY = 140, size = 360;
    ctx.fillStyle = '#22382b'; ctx.fillRect(mapX, mapY, size, size); ctx.strokeStyle = '#41634b'; ctx.lineWidth = 1;
    for (let i = 0; i <= 10; i++) { ctx.beginPath(); ctx.moveTo(mapX + i * 36, mapY); ctx.lineTo(mapX + i * 36, mapY + size); ctx.moveTo(mapX, mapY + i * 36); ctx.lineTo(mapX + size, mapY + i * 36); ctx.stroke(); }
    const px = mapX + (x + .5) / 1000 * size, py = mapY + (y + .5) / 1000 * size;
    ctx.strokeStyle = '#ccf599'; ctx.beginPath(); ctx.moveTo(px, mapY); ctx.lineTo(px, mapY + size); ctx.moveTo(mapX, py); ctx.lineTo(mapX + size, py); ctx.stroke();
    ctx.fillStyle = '#ccf599'; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
    ctx.font = '18px sans-serif'; ctx.fillStyle = '#b0c0ab'; ctx.fillText('YOUR LOCATION ON THE 1,000 × 1,000 CANVAS', 740, 535);
    ctx.font = '20px sans-serif'; ctx.fillText(`${window.location.host}/?spot=${slot}`, 65, 550);
    card.toBlob(blob => { if (!blob) { notify('Could not create the card. Please try again.'); return; } const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `millionpixel-spot-${slot}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); notify('Your sharing card is downloaded.'); }, 'image/png');
  };
  useEffect(() => {
    const slot = Number(new URLSearchParams(window.location.search).get('spot'));
    if (sharedSpotOpened.current || !supabase || !Number.isInteger(slot) || slot < 1 || slot > 1000000) return;
    sharedSpotOpened.current = true;
    setShowSamples(false);
    goToPixel(undefined, slot);
  }, []);


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
        <nav className="quest-navigation" aria-label="Canvas activities"><a href="#canvas">Images</a><a href="#canvas-expeditions">Seasons & quests</a><a href="#canvas-games">Guilds & battles</a></nav><section className="intro nav-hero"><div className="nav-hero-copy"><div className="eyebrow">A tiny space on a big canvas</div><h1>Make a little<br /><span>space yours.</span></h1></div><p>Choose a pixel, share your image, and leave your mark on a living canvas.</p><div className="intro-actions"><button className="button button-primary claim-primary" onClick={claimAvailableSpot}>Claim your spot · 50 EGP <span>↗</span></button><span className="intro-hint review-promise">✓ Every submission is reviewed before it goes live.<br />One spot · 30 days · receipt checked privately</span><button className="text-button" onClick={() => document.getElementById('how-it-works')?.scrollIntoView({ behavior: 'smooth' })}>How it works ↓</button></div></section>
        <section className="activity-ticker" aria-label="Recently published spots"><span className="ticker-title"><i className="live-dot" /> RECENTLY LIVE</span><div className="ticker-items">{activityFeed.length ? activityFeed.map(item => <button key={item.anchor_slot} onClick={() => { setShowSamples(false); goToPixel(undefined, item.anchor_slot); }}><b>#{Number(item.anchor_slot).toLocaleString()}</b> by {item.display_name}<time dateTime={item.published_at}>{relativeTime(item.published_at, activityNow)}</time></button>) : <span>Approved images will appear here as the canvas grows.</span>}</div><small>Approved submissions</small></section>
        {expeditionData?.hall?.[0]?.winner && <div className="season-promotion"><b>🏆 Hall of Fame · District {expeditionData.hall[0].winner}</b><span>Winner of the {expeditionData.hall[0].season.slice(0,7)} canvas season</span><a href="#canvas-expeditions">Explore the season archive ↗</a></div>}
        {expeditionData?.riddle_winner && <div className="season-promotion"><b>✧ First puzzle solver: {expeditionData.riddle_winner.name}</b>{expeditionData.riddle_winner.slot && <button className="text-button" onClick={() => goToPixel(undefined, expeditionData.riddle_winner.slot)}>See their spot ↗</button>}</div>}
        {featuredChallenge && <div className="featured-challenge"><div><span className="eyebrow">Community vote · {featuredChallenge.title}</span><b>Monthly spotlight</b><small>Spot #{Number(featuredChallenge.slot_number).toLocaleString()} · {Number(featuredChallenge.vote_count).toLocaleString()} votes</small></div><img src={supabase.storage.from('published-images').getPublicUrl(featuredChallenge.image_path).data.publicUrl} alt={`Top voted spot in ${featuredChallenge.title}`} /><button onClick={() => document.getElementById('community-challenges')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>See the challenge ↘</button></div>}
      </header>

      <main>
        {!hasSupabaseConfig && <div className="setup-alert"><b>Supabase setup needed</b><span>Add your project URL and publishable key to <code>.env.local</code>, then run the database migration. See the README.</span></div>}

        <section className={`workspace ${browseView === 'gallery' ? 'gallery-mode' : ''}`} id="canvas">
          <div className="canvas-heading"><div><div className="eyebrow">The canvas <span className="prototype-tag">LIVE PROJECT</span></div><h2>One million possibilities</h2></div><div className="canvas-count"><strong>1,000,000</strong><span>numbered slots</span></div></div>
          <div className="browse-view-bar"><div role="group" aria-label="Browse view"><button className={browseView === 'gallery' ? 'active' : ''} aria-pressed={browseView === 'gallery'} onClick={() => setBrowseView('gallery')}>▦ Image gallery</button><button className={browseView === 'map' ? 'active' : ''} aria-pressed={browseView === 'map'} onClick={() => setBrowseView('map')}>⊞ Numbered canvas</button></div><span>Open an image · Swipe left or right to explore</span></div>
          {browseView === 'gallery' && <section className="photo-gallery" aria-label="Published image gallery"><div className="gallery-search"><label htmlFor="gallery-search">Explore the images</label><input id="gallery-search" type="search" value={galleryQuery} onChange={event => setGalleryQuery(event.target.value)} placeholder="Search loaded images by creator, story or spot…" /><span>{usedSlotCount == null ? 'Loading…' : `${usedSlotCount.toLocaleString()} published spots`}</span></div><div className="masonry-photos">{galleryResults.map(spot => <article className={`gallery-photo ${Number(spot.anchor_slot) === gameData?.champion ? 'battle-champion' : ''} ${(gameData?.decorations || []).some(item => item.slot === Number(spot.anchor_slot) && item.golden_explorer) ? 'golden-photo' : ''}`} key={spot.anchor_slot}><button className="gallery-photo-open" onClick={() => openPublishedSpot(spot)} aria-label={`Open image by ${spot.display_name}, Spot #${spot.anchor_slot}`}><img src={spot.imageUrl} alt={spot.description?.trim() || `Image by ${spot.display_name}`} loading="lazy" /><span className="gallery-photo-overlay"><b>{spot.display_name}</b><small>Spot #{Number(spot.anchor_slot).toLocaleString()} · Open ↗</small>{spotPrestige(spot.anchor_slot) && <small>{spotPrestige(spot.anchor_slot)}</small>}{Number(spot.anchor_slot) === gameData?.champion && <small>⚡ Battle champion</small>}</span></button></article>)}</div>{galleryError && <p role="alert">{galleryError} <button className="text-button" onClick={() => setGalleryRetry(value => value + 1)}>Retry loading</button></p>}{!galleryBusy && !galleryError && !galleryResults.length && <p className="gallery-empty">{galleryQuery ? 'No matching images in the loaded gallery. Try another search or load more below.' : 'The first stories are on their way. Claim a spot and help fill this gallery.'}</p>}{galleryBusy && <p role="status" className="gallery-empty">Loading images…</p>}{galleryMore && <button className="button button-outline gallery-load" disabled={galleryBusy} onClick={() => setGalleryPage(page => page + 1)}>{galleryBusy ? 'Loading…' : 'Load more images ↓'}</button>}<p className="gallery-footnote">Only approved, active images are shown. Each image keeps its own proportions.</p></section>}
          <section className="founding-progress" aria-label="Canvas progress" aria-busy={usedSlotCount == null}><div><span className="eyebrow">THE FOUNDING CHAPTER</span><h3>{claimedPercent == null ? 'Loading canvas progress…' : `${claimedPercent.toLocaleString('en-US', { maximumFractionDigits: 4 })}% claimed`}</h3><p>The first 100 spots start the story. Make one yours.</p></div><div className="founding-meter"><div className="meter-caption"><b>Founding 100 spots</b><span>{usedSlotCount == null ? '—' : Math.min(100, usedSlotCount)} / 100</span></div><progress aria-label="Published spots toward the first 100" max="100" value={Math.min(100, usedSlotCount || 0)} /><small>{usedSlotCount == null ? 'Checking availability…' : `${usedSlotCount.toLocaleString()} published · ${(1000000 - usedSlotCount).toLocaleString()} available across the full canvas`}</small></div></section>
          {spotlight && <article className="daily-spotlight"><img src={supabase.storage.from('published-images').getPublicUrl(spotlight.image_path).data.publicUrl} alt={`Spotlight artwork by ${spotlight.display_name}`} /><div><span className="eyebrow">TODAY’S COMMUNITY SPOTLIGHT</span><h3>{spotlight.display_name}</h3><p>Spot #{Number(spotlight.anchor_slot).toLocaleString()} · Published {new Date(spotlight.published_at).toLocaleDateString()}</p><small>A daily rotation among recent approved spots.</small></div><button className="button button-outline" onClick={() => { setShowSamples(false); goToPixel(undefined, spotlight.anchor_slot); }}>Meet this creator ↗</button></article>}
          <div className="explore-shortcuts" role="group" aria-label="Quick canvas navigation"><span>EXPLORE</span><button onClick={() => { setShowSamples(false); resetView(); }}>Overview</button><button onClick={() => { setShowSamples(false); focusSlot(500501); }}>Center</button><button onClick={() => { setShowSamples(false); const spot = activityFeed[Math.floor(Math.random() * activityFeed.length)]; if (spot) goToPixel(undefined, spot.anchor_slot); else focusSlot(Math.floor(Math.random() * 1000000) + 1); }}>Random spot</button><span className="landmark-label">LANDMARKS</span>{LANDMARKS.map(item => <button key={item.slot} title={item.name} onClick={() => { setShowSamples(false); goToPixel(undefined, item.slot); }}>✦ #{String(item.slot).padStart(6, '0')}</button>)}<small>All spots · 50 EGP / 30 days</small></div>
          <div className={`canvas-shell ${browseView === 'gallery' ? 'map-collapsed' : ''}`} aria-hidden={browseView === 'gallery'} inert={browseView === 'gallery' ? true : undefined}><div className="canvas-toolbar"><div className="map-legend"><span className="legend-item"><i className="legend-free" /> Available</span><span className="legend-item"><i className="legend-live" /> Published</span><span className="legend-item"><i className="legend-selected" /> Selected</span></div><div className="zoom-controls"><button onClick={() => changeZoom(1 / 1.55)} aria-label="Zoom out">−</button><span>{currentScale.toFixed(currentScale < 10 ? 1 : 0)}×</span><button onClick={() => changeZoom(1.55)} aria-label="Zoom in">+</button><button className="reset-button" onClick={resetView}>Reset</button></div></div>
            <form className="discovery-search" onSubmit={searchCanvas}>
              <label className="discovery-keyword">Search creators or stories<input value={discoveryQuery} onChange={event => setDiscoveryQuery(event.target.value)} placeholder="Name or keyword" /></label>
              <label>Tag<input value={discoveryTag} onChange={event => setDiscoveryTag(event.target.value)} placeholder="e.g. art" /></label>
              <label>On canvas after<input type="date" value={joinedAfter} onChange={event => setJoinedAfter(event.target.value)} /></label>
              <label>On canvas before<input type="date" value={joinedBefore} onChange={event => setJoinedBefore(event.target.value)} /></label>
              <button className="discovery-submit" type="submit" disabled={discoveryBusy}>{discoveryBusy ? 'Searching…' : 'Search canvas'}</button>
            </form>
            {discoveryMessage && <div className="discovery-message" role="status">{discoveryMessage}</div>}
            {discoveryResults.length > 0 && <div className="discovery-results">{([...discoveryResults].sort((a, b) => Number(b.anchor_slot === gameData?.champion) - Number(a.anchor_slot === gameData?.champion))).map(spot => <button type="button" className="discovery-result" key={spot.anchor_slot} onClick={() => openPublishedSpot(spot)}><img src={spot.imageUrl} alt="" /><span><b>{spot.display_name}</b><small>Spot #{spot.anchor_slot.toLocaleString()} · {spot.tags || 'No tags'} · {new Date(spot.published_at).toLocaleDateString()}</small></span><i>↗</i></button>)}</div>}
            <div className="canvas-preview-row"><div className="canvas-preview-options" role="group" aria-label="Image preview style"><span>Preview</span><button type="button" className={previewStyle === 'default' ? 'active' : ''} aria-pressed={previewStyle === 'default'} onClick={() => setPreviewStyle('default')}>Default</button><button type="button" className={previewStyle === 'pixel' ? 'active' : ''} aria-pressed={previewStyle === 'pixel'} onClick={() => setPreviewStyle('pixel')}>Pixel mosaic</button><button type="button" className={previewStyle === 'collage' ? 'active' : ''} aria-pressed={previewStyle === 'collage'} onClick={() => setPreviewStyle('collage')}>Art collage</button></div><form className="pixel-finder" onSubmit={goToPixel}><label htmlFor="pixel-number">Go to pixel</label><input id="pixel-number" type="number" min="1" max="1000000" step="1" value={pixelSearch} onChange={event => setPixelSearch(event.target.value)} placeholder="Enter number" required /><button type="submit" disabled={searchingPixel}>{searchingPixel ? 'Finding…' : 'Go'}</button></form></div>
            {(heatmap || territories || huntMode || puzzleMode) && <div className="map-game-status" role="status">{heatmap && <span>● Weekly interaction heatmap · relative intensity</span>}{territories && <span>▦ Guild territories · colored by guild</span>}{puzzleMode && <span>? Puzzle trail · tap your clue marker</span>}{huntMode && <span>✧ {huntBusy ? 'Checking pixel…' : 'Golden hunt mode: tap a pixel to search'}</span>}<button onClick={() => { setHeatmap(false); setTerritories(false); setHuntMode(false); setPuzzleMode(false); }}>Clear overlays</button></div>}
            <div className="canvas-wrap" ref={wrapRef} onWheel={handleWheel} onPointerDown={mapPointerDown} onPointerMove={mapPointerMove} onPointerLeave={() => { if (!activePointers.current.size) { setHoveredSlot(null); setHoveredPoint(null); } }} onPointerUp={mapPointerUp} onPointerCancel={event => { activePointers.current.delete(event.pointerId); pinchState.current = null; drag.current = null; }}>
              <canvas ref={canvasRef} aria-label="Interactive map of one million numbered slots. Zoom in to select a slot." />
              {hoveredSlot && hoveredPoint && hoveredPublished && <div className="spot-hover-card" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} style={{ left: `${Math.max(8, Math.min(hoveredPoint.x - 12, view.current.width - 300))}px`, top: `${Math.min(Math.max(hoveredPoint.y + 16, 8), view.current.height - 250)}px` }}><img src={hoveredPublished.imageUrl} alt="" /><div><b>{hoveredPublished.display_name}</b><span>Spot #{Number(hoveredPublished.anchor_slot || hoveredPublished.slot_number).toLocaleString()} · {Number(hoveredPublished.spot_size) || 1}×{Number(hoveredPublished.spot_size) || 1}</span><p>{hoveredPublished.description?.trim() || 'A place on the Million Pixel canvas.'}</p>{hoveredPublished.website_url && <a href={hoveredPublished.website_url} target="_blank" rel="noreferrer">Visit link ↗</a>}<button className="hover-open" onClick={() => openPublishedSpot(hoveredPublished)}>Open spot ↗</button><small>{hoveredPublished.published_at ? `Published ${new Date(hoveredPublished.published_at).toLocaleDateString()}` : 'Published image'}</small></div></div>}
              {hoveredSlot && hoveredPoint && !hoveredPublished && <div className="slot-hover-label" style={{ left: `${Math.min(hoveredPoint.x + 12, view.current.width - 150)}px`, top: `${Math.max(hoveredPoint.y - 34, 8)}px` }}><b>Pixel #{hoveredSlot.toLocaleString()}</b><span>{landmarkName(hoveredSlot) ? `✦ ${landmarkName(hoveredSlot)} · 50 EGP` : ((expeditionData?.approved_placements || 0) < districtForSlot(hoveredSlot).required ? `District ${districtForSlot(hoveredSlot).zone} · Locked` : 'Available · click to choose')}</span></div>}
              {currentScale < 1.3 && showSamples && usedSlotCount != null && usedSlotCount < 100 && <div className="sample-gallery" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onWheel={event => event.stopPropagation()}><div className="sample-gallery-head"><div><span className="eyebrow">IMAGINE WHAT WE CAN MAKE</span><h3>A little inspiration. A million possibilities.</h3></div><button onClick={() => setShowSamples(false)} aria-label="Close sample gallery and explore real canvas">×</button></div><div className="sample-art-grid">{Array.from({length: 8}, (_, index) => <SampleArt key={index} index={index} />)}</div><div className="sample-gallery-foot"><p><b>Sample artwork</b> · Illustrations only. These are not purchases or reserved spots.</p><button className="text-button" onClick={() => setShowSamples(false)}>Explore the real canvas ↗</button></div></div>}
              {showGuide && <div className="claim-guide" role="status" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}><span className="guide-square">＋</span><span className="guide-arrow">→</span><div><b>Choose a square. Share your story.</b><small>Click an available pixel → sign in → upload your image.</small></div><button onClick={() => setShowGuide(false)} aria-label="Dismiss quick guide">×</button></div>}
            </div>
            <div className="canvas-footer"><button className="text-button" onClick={() => setShowGuide(true)}>Quick guide</button><span>Pinch or scroll to zoom · Drag to move · Zoom in to select</span><button className="text-button" onClick={() => { const slot = randomOpenSlot(expeditionData?.approved_placements || 0); zoomToSlot(slot); }}>Pick a spot for me ↗</button></div>
          </div>
          <CanvasExpeditions data={expeditionData} error={expeditionError} refresh={refreshExpeditions} supabase={supabase} session={session} notify={notify} onSignIn={() => { setAuthMode('signin'); setAuthMessage('Sign in to save your quest progress.'); setDrawer('signin'); }} onFocus={(slot, zoom = 30, mode) => { setPuzzleMode(mode === 'riddle'); setShowSamples(false); setHuntMode(false); setBrowseView('map'); if (slot == null) resetView(); else focusSlot(slot, zoom); document.getElementById('canvas')?.scrollIntoView({ behavior: 'smooth' }); }} fog={districtFog} setFog={setDistrictFog} puzzleMode={puzzleMode} setPuzzleMode={setPuzzleMode} onMosaicClaim={(file, slot) => { if (!Number.isInteger(slot) || slot < 1 || slot > 1000000) { notify('Enter a valid top-left spot number.'); return; } setPuzzleMode(false); setHuntMode(false); setForm(current => ({ ...current, artwork: file })); setBrowseView('map'); setShowSamples(false); focusSlot(slot, 45); requestPixelClaim(slot, 3); }} />
          <CommunityGames data={gameData} error={gameError} supabase={supabase} session={session} profile={profile} refresh={refreshGames} notify={notify} onFocus={(slot, zoom, open) => { setPuzzleMode(false); setShowSamples(false); setBrowseView('map'); if (slot == null) resetView(); else if (open) goToPixel(undefined, slot); else focusSlot(slot, zoom); document.getElementById('canvas')?.scrollIntoView({ behavior: 'smooth' }); }} huntMode={huntMode} setHuntMode={setHuntMode} heatmap={heatmap} setHeatmap={setHeatmap} territories={territories} setTerritories={setTerritories} onSignIn={() => { setAuthMode('signin'); setAuthMessage('Sign in to join the canvas community.'); setDrawer('signin'); }} />
          
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

        <section className="how-it-works" id="how-it-works"><div className="eyebrow">Simple by design</div><div className="steps"><article><span>01</span><h3>Choose a slot</h3><p>Explore the canvas and pick a free numbered pixel.</p></article><article><span>02</span><h3>Send your image</h3><p>Add your name and contact, plus payment proof for review.</p></article><article><span>03</span><h3>Go live</h3><p>Once approved, your image appears on the canvas for 30 days.</p></article></div></section>
        <section className="demo-note"><span className="note-icon">ⓘ</span><div><b>InstaPay &amp; Vodafone Cash · 50 EGP per spot</b><p>Transfer using your preferred app, then upload your receipt. Payments are checked manually before publishing. Your receipt is private and only available to you and authorized reviewers.</p></div></section>
        <section className="trust-faq"><div><span className="eyebrow">KNOW BEFORE YOU CLAIM</span><h2>Small spot. Clear expectations.</h2><p>Every image and payment is reviewed by a person before publication.</p></div><div className="faq-list"><details><summary>What does 50 EGP include?</summary><p>One numbered spot with your image and story, displayed for 30 days after approval. This is a display placement, not ownership of land or a permanent listing.</p></details><details><summary>How do payment and approval work?</summary><p>Choose a spot, sign in, upload your image and transfer 50 EGP through InstaPay or Vodafone Cash. Add your transaction reference and receipt. Your spot goes live after a reviewer approves the submission and payment.</p></details><details><summary>Who can see my image and payment receipt?</summary><p>Published images and stories are visible to everyone. Your payment receipt stays private to you and authorized reviewers. Do not include private payment information in your public story.</p></details><details><summary>Are the sample illustrations real claims?</summary><p>No. The inspiration gallery is clearly marked sample artwork. It does not reserve spots or increase the published count. Close it to explore the real canvas.</p></details></div></section>
        <footer className="founder-footer"><details><summary>A note from the creator <span>＋</span></summary><p>I built Million Pixel around a simple idea: a small space can hold a meaningful story. The vision is a shared canvas shaped by the people who join it, one image at a time. Thank you for helping write its first chapter.</p></details><span>One million places. Individual stories.</span></footer>
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
          <label className="field-label">Your image <span>{form.artwork ? `Selected: ${form.artwork.name}` : 'PNG, JPG, GIF, WebP · 3 MB max'}</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" required={!form.artwork} onChange={e => setForm({ ...form, artwork: e.target.files?.[0] || null })} /></label>
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
        {drawer === 'account' && <><div className="eyebrow">Your account</div><h2>My submissions</h2><p className="drawer-lead">Signed in as <strong>{session?.user.email}</strong></p><div className="referral-account-card"><span className="eyebrow">Your referral link</span><b>{profile?.referral_code || 'Generating your code…'}</b><small>Both of you earn 15% of a referred spot’s price in credits after it is approved.</small><button type="button" onClick={copyReferralLink} disabled={!profile?.referral_code}>Copy invite link</button><div>Credit balance <strong>{formatEGP(availableCredits * SPOT_PRICE_EGP)}</strong></div></div><div className="claim-list">{myClaims.length ? myClaims.map(claim => <div className="claim-row" key={claim.id}><b>Spot #{claim.slot_number.toLocaleString()} · {Number(claim.spot_size) || 1}×{Number(claim.spot_size) || 1}</b><span className={`status-pill ${claim.status}`}>{claim.status}</span><small>{claim.display_name} · {new Date(claim.created_at).toLocaleDateString()}</small>{claim.status === 'published' && <button className="text-button" onClick={() => downloadSpotBadge(claim, true)}>Download my spot badge · PNG ↗</button>}</div>) : <div className="queue-empty">No submissions yet. Choose an open pixel on the map.</div>}</div><button className="button button-outline button-wide" onClick={signOut}>Sign out</button></>}
        {drawer === 'image' && selectedImage && <><div className="eyebrow">Published spot · #{Number(selectedImage.anchor_slot || selectedImage.slot_number).toLocaleString()}</div><h2>{selectedImage.display_name}</h2><div className="achievement-chips">{spotPrestige(selectedImage.anchor_slot || selectedImage.slot_number) && <span>{spotPrestige(selectedImage.anchor_slot || selectedImage.slot_number)}</span>}{achievementLabels((gameData?.decorations || []).find(item => item.slot === Number(selectedImage.anchor_slot || selectedImage.slot_number))).map(label => <span key={label}>{label}</span>)}{Number(selectedImage.anchor_slot || selectedImage.slot_number) === gameData?.champion && <span>⚡ Battle champion · 24-hour border</span>}</div><div className="viewer-navigation" role="group" aria-label="Browse published images"><button className="button button-outline" disabled={viewerSpots.length < 2} onClick={() => browseImage(-1)} aria-label="Previous image">← Previous</button><span aria-live="polite">{Math.max(1, viewerIndex + 1)} / {viewerSpots.length}</span><button className="button button-outline" disabled={viewerSpots.length < 2} onClick={() => browseImage(1)} aria-label="Next image">Next →</button></div><div className="image-detail-photo swipe-photo" onTouchStart={event => { const touch = event.touches[0]; swipeStart.current = event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY } : null; }} onTouchMove={event => { if (event.touches.length > 1) swipeStart.current = null; }} onTouchCancel={() => { swipeStart.current = null; }} onTouchEnd={event => { const start = swipeStart.current; swipeStart.current = null; const touch = event.changedTouches[0]; if (!start || !touch) return; const dx = touch.clientX - start.x, dy = touch.clientY - start.y; if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.4) browseImage(dx < 0 ? 1 : -1); }}><img src={selectedImage.imageUrl} alt={`Image published by ${selectedImage.display_name}`} onDoubleClick={toggleImageLike} title="Double-click to like" /></div><div className="spot-profile-meta">{landmarkName(selectedImage.anchor_slot || selectedImage.slot_number) && <span className="landmark-badge">✦ {landmarkName(selectedImage.anchor_slot || selectedImage.slot_number)}</span>}<span>{Number(selectedImage.spot_size) || 1}×{Number(selectedImage.spot_size) || 1} featured area</span><span>Published {selectedImage.published_at ? new Date(selectedImage.published_at).toLocaleDateString() : 'date unavailable'}</span></div>{selectedImage.website_url && <a className="spot-profile-link" href={selectedImage.website_url} target="_blank" rel="noreferrer">Visit website or social profile ↗</a>}<div className="image-story">{selectedImage.description?.trim() ? selectedImage.description : <span className="empty-story">No story was added for this image.</span>}</div><button className={`image-like-button ${imageLikes.liked ? 'liked' : ''}`} type="button" onClick={toggleImageLike} disabled={likeBusy} aria-pressed={imageLikes.liked}><span aria-hidden="true">{imageLikes.liked ? '♥' : '♡'}</span><b>{imageLikes.liked ? 'Liked' : 'Like'}</b><span className="like-count">{imageLikes.count.toLocaleString()}</span></button>{!session?.user && <p className="image-like-hint">Sign in to like this image.</p>}<SocialShare lang="en" title={selectedImage.caption||selectedImage.display_name+' on MillionPixel'} url={location.origin+'/?spot='+Number(selectedImage.anchor_slot||selectedImage.slot_number)}/><div className="spot-share-actions"><button className="button button-outline" onClick={() => downloadSpotBadge(selectedImage, myClaims.some(claim => claim.status === 'published' && Number(claim.slot_number) === Number(selectedImage.anchor_slot || selectedImage.slot_number)))}>Download sharing card · PNG</button><button className="text-button" onClick={() => copySpotLink(selectedImage.anchor_slot || selectedImage.slot_number)}>Copy direct spot link ↗</button></div></>}
        {drawer === 'admin' && <><div className="eyebrow">Protected review queue</div><h2>Review submissions</h2><button className="button button-outline" disabled={busy} onClick={checkReviewService}>Check review connection</button>{reviewServiceMessage && <p role="status">{reviewServiceMessage}</p>}<p className="drawer-lead">Only accounts granted admin access can review proof and publish images.</p><div className="queue-heading">Pending review <small>{pendingClaims.length} requests</small></div>{pendingClaims.length ? pendingClaims.map(claim => <article className="submission-card" key={claim.id}><div className="submission-card-head"><strong>Pixel #{claim.slot_number.toLocaleString()} · {claim.display_name}</strong><span className="status-pill">Pending</span></div><div className="submission-meta">{claim.contact}<br />Submitted {new Date(claim.created_at).toLocaleString()}<br />Amount due: {claim.payment_amount_egp != null ? formatEGP(claim.payment_amount_egp) : `${Number(claim.amount_due ?? 1).toFixed(2)} (legacy claim)`}{claim.payment_method && <><br />Method: {PAYMENT_METHODS[claim.payment_method] || claim.payment_method}</>}{claim.payment_reference && <><br />Transaction reference: {claim.payment_reference}</>}</div>{claim.description?.trim() && <p className="submission-story">{claim.description}</p>}<div className="submission-preview">{claim.artworkUrl && <img src={claim.artworkUrl} alt="Submitted artwork" />}{claim.proofUrl ? <a href={claim.proofUrl} target="_blank" rel="noreferrer">Open private payment proof ↗</a> : <span className="submission-meta">Paid fully with account credits</span>}</div><div className="queue-actions"><button disabled={busy} onClick={() => reviewClaim(claim.id, 'approve')}>Approve & publish</button><button className="reject-button" disabled={busy} onClick={() => reviewClaim(claim.id, 'reject')}>Reject</button></div></article>) : <div className="queue-empty">No pending submissions.</div>}</>}
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

function SampleArt({ index }) {
  const palettes = [['#e9ad6b','#633f73','#f6db91'],['#b3d7c8','#154d50','#e6efac'],['#f399a0','#3c3873','#ffd278'],['#547bc8','#192849','#a3d6e9'],['#d1c5eb','#613d86','#ee945c'],['#ded8ad','#374d3e','#c38b55'],['#e9ae8c','#a34e61','#fae6b8'],['#7fc4be','#224969','#d9efb4']];
  const [bg, ink, accent] = palettes[index];
  return <svg viewBox="0 0 160 160" role="img" aria-label={`Sample illustration ${index + 1}: ${index % 2 ? 'abstract shapes' : 'imaginary landscape'}`}><rect width="160" height="160" fill={bg} />{index % 2 === 0 ? <><circle cx="110" cy="48" r="27" fill={accent} /><path d="M0 125L47 53L90 113L122 81L160 130V160H0Z" fill={ink} /><path d="M0 145Q45 92 82 138T160 128V160H0Z" fill={accent} opacity=".7" /></> : <><circle cx="80" cy="80" r="58" fill={ink} /><path d="M23 80H137M80 23V137" stroke={bg} strokeWidth="17" /><circle cx="80" cy="80" r="24" fill={accent} /><rect x="17" y="17" width="16" height="16" fill={accent} /></>}</svg>;
}

export default App;
