import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let adminClient: SupabaseClient | null | undefined;

function isConfiguredUrl(url: string | undefined): url is string {
  return Boolean(url && url.startsWith('https://') && !url.includes('YOUR_PROJECT_REF'));
}

export function getSupabaseAdmin(): SupabaseClient | null {
  if (adminClient !== undefined) return adminClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!isConfiguredUrl(url) || !key || key.includes('your_service_role')) {
    adminClient = null;
    return adminClient;
  }

  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return adminClient;
}

export async function uploadToSupabaseStorage(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'recordings';
  if (!supabase) return null;

  const { error } = await supabase.storage.from(bucket).upload(path, body, {
    contentType,
    upsert: true,
  });
  if (error) {
    console.error('[Supabase Storage] upload failed:', error.message);
    return null;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl || null;
}
