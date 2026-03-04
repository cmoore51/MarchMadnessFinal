import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rbkdpnvflajltfryszag.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_DpEloHY4HjVQkmo0aIuyIQ_LY9Tuhj7';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export const storage = {
  async get(key) {
    const { data, error } = await supabase
      .from('bracket_state')
      .select('value')
      .eq('key', key)
      .single();
    if (error || !data) return null;
    return { key, value: data.value };
  },

  async set(key, value) {
    const { error } = await supabase
      .from('bracket_state')
      .upsert({ key, value }, { onConflict: 'key' });
    if (error) return null;
    return { key, value };
  },

  async delete(key) {
    const { error } = await supabase
      .from('bracket_state')
      .delete()
      .eq('key', key);
    if (error) return null;
    return { key, deleted: true };
  },

  async list(prefix = '') {
    const { data, error } = await supabase
      .from('bracket_state')
      .select('key')
      .like('key', `${prefix}%`);
    if (error || !data) return { keys: [] };
    return { keys: data.map(r => r.key) };
  },
};