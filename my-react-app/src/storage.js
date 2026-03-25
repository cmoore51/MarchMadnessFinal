import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = 'https://rbkdpnvflajltfryszag.supabase.co';
// Note: Ensure this key has 'service_role' or proper RLS policies enabled in Supabase
const SUPABASE_ANON_KEY = 'sb_publishable_DpEloHY4HjVQkmo0aIuyIQ_LY9Tuhj7';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const storage = {
  /**
   * Retrieves a value. Returns the raw value (Object/Array/String) 
   * so it matches your existing localStorage logic.
   */
  async get(key) {
    const { data, error } = await supabase
      .from('bracket_state')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) {
      console.error(`Supabase Get Error (${key}):`, error.message);
      return null;
    }
    
    // Return just the value (e.g. the assignments object) to keep 
    // it compatible with your App's state initialization.
    return data ? data.value : null;
  },

  /**
   * Updates or Inserts a key-value pair.
   */
  async set(key, value) {
    // Ensure we aren't saving 'undefined' which breaks JSONB
    const safeValue = value ?? null;

    const { error } = await supabase
      .from('bracket_state')
      .upsert({ key, value: safeValue }, { onConflict: 'key' });

    if (error) {
      console.error(`Supabase Set Error (${key}):`, error.message);
      return false;
    }
    return true;
  },

  async delete(key) {
    const { error } = await supabase
      .from('bracket_state')
      .delete()
      .eq('key', key);

    if (error) {
      console.error(`Supabase Delete Error (${key}):`, error.message);
      return false;
    }
    return true;
  },

  async list(prefix = '') {
    const { data, error } = await supabase
      .from('bracket_state')
      .select('key')
      .like('key', `${prefix}%`);

    if (error) {
      console.error("Supabase List Error:", error.message);
      return [];
    }
    return data.map(r => r.key);
  },
};