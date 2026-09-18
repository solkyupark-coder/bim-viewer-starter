import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const hasSupabase = Boolean(url && key);
export const supabase = hasSupabase ? createClient(url, key) : null;
export const BUCKET = 'models';
export const PHOTO_BUCKET = 'photos';
export const DRAWING_BUCKET = 'drawings';
export const APP_TITLE = process.env.NEXT_PUBLIC_TITLE || '기록';

export function publicUrl(path, bucket = BUCKET) {
  if (!supabase || !path) return '';
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
