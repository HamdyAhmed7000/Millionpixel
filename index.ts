import { createClient } from 'npm:@supabase/supabase-js@2';

Deno.serve(async request => {
  if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });
  const expectedSecret = Deno.env.get('CRON_SECRET');
  const receivedSecret = request.headers.get('x-cron-secret');
  if (!expectedSecret || receivedSecret !== expectedSecret) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return Response.json({ error: 'Function is not configured' }, { status: 500 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: expired, error } = await admin.rpc('expire_published_slots');
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const paths = [...new Set((expired || []).map((item: { image_path: string }) => item.image_path))];
  const failures: string[] = [];
  for (let start = 0; start < paths.length; start += 100) {
    const { error: removeError } = await admin.storage.from('published-images').remove(paths.slice(start, start + 100));
    if (removeError) failures.push(removeError.message);
  }
  return Response.json({ expiredCount: paths.length, cleanupErrors: failures }, { status: failures.length ? 207 : 200 });
});
