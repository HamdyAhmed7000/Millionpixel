import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async request => {
  const origin=request.headers.get('Origin');
  const allowed=new Set(['https://millionpixel-pi.vercel.app','https://www.celltalk.info','https://celltalk.info','http://localhost:5173','http://localhost:5174','http://localhost:5175','http://localhost:5176',...(Deno.env.get('APP_ORIGIN')||'').split(',').map(x=>x.trim()).filter(x=>x&&x!=='*')]);
  const corsHeaders: Record<string,string> = {'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, traceparent, tracestate, baggage','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
  if(origin&&allowed.has(origin))corsHeaders['Access-Control-Allow-Origin']=origin;
  const json=(body:unknown,status:number)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,'Content-Type':'application/json'}});
  if(origin&&!allowed.has(origin))return json({error:'Origin not allowed'},403);
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey || !authorization) return json({ error: 'Not configured or not signed in' }, 401);

  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { data: userResult, error: authError } = await caller.auth.getUser();
  if (authError || !userResult.user) return json({ error: 'Invalid sign-in session' }, 401);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile, error: profileError } = await admin.from('profiles').select('is_admin').eq('user_id', userResult.user.id).maybeSingle();
  if (profileError || !profile?.is_admin) return json({ error: 'Admin access required' }, 403);

  let body: { claimId?: string; decision?: string };
  try { body = await request.json(); } catch (parseError) { return json({ error: 'Invalid JSON body' }, 400); }
  if(body.decision==='check') return json({ok:true,canReview:true},200);
  const claimId = body.claimId;
  if (!claimId || !/^[0-9a-f-]{36}$/i.test(claimId) || !['approve', 'reject'].includes(body.decision || '')) return json({ error: 'Invalid review request' }, 400);

  const { data: claim, error: claimError } = await admin.from('slot_claims').select('*').eq('id', claimId).eq('status', 'pending').maybeSingle();
  if (claimError || !claim) return json({ error: 'This claim is no longer pending' }, 409);

  if (body.decision === 'reject') {
    const { data: rejected, error } = await admin.from('slot_claims').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: userResult.user.id }).eq('id', claim.id).eq('status', 'pending').select('id').maybeSingle();
    if (error || !rejected) return json({ error: error?.message || 'This claim is no longer pending' }, 409);
    return json({ ok: true, decision: 'reject' }, 200);
  }

  const { data: file, error: downloadError } = await admin.storage.from('submission-files').download(claim.artwork_path);
  if (downloadError || !file) return json({ error: 'Could not read the private artwork upload' }, 500);
  const extension = claim.artwork_path.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'img';
  const publicPath = `${claim.slot_number}/${claim.id}-${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await admin.storage.from('published-images').upload(publicPath, file, {
    contentType: file.type || 'application/octet-stream', upsert: false
  });
  if (uploadError) return json({ error: `Could not publish image: ${uploadError.message}` }, 500);

  const { error: publishError } = await admin.rpc('publish_slot_claim', {
    p_claim_id: claim.id, p_public_image_path: publicPath, p_admin_user_id: userResult.user.id
  });
  if (publishError) {
    await admin.storage.from('published-images').remove([publicPath]);
    return json({ error: publishError.message }, 409);
  }
  return json({ ok: true, decision: 'approve', slot: claim.slot_number }, 200);
});
