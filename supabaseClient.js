/**
 * Kharisma Hub — Supabase Client Integration
 * Connected to project: https://wirgqezinegebauddmgy.supabase.co
 */

const SUPABASE_URL = 'https://wirgqezinegebauddmgy.supabase.co';
// Anon key can be injected via window.__ENV, localStorage, or configured via Settings
let SUPABASE_ANON_KEY = (typeof window !== 'undefined' && (
  window.__ENV?.SUPABASE_ANON_KEY || 
  localStorage.getItem('kharisma_supabase_anon_key') || 
  ''
)) || '';

let supabaseClient = null;

function initSupabase() {
  if (typeof supabase !== 'undefined' && SUPABASE_URL && SUPABASE_ANON_KEY) {
    try {
      supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
      console.log('✅ Supabase connected successfully to:', SUPABASE_URL);
    } catch (err) {
      console.warn('⚠️ Supabase init warning:', err.message);
    }
  }
  return supabaseClient;
}

// Auto-initialize if credentials present
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    initSupabase();
  });
}

/**
 * Update or set Supabase credentials at runtime
 */
function setSupabaseCredentials(anonKey) {
  if (!anonKey) return false;
  SUPABASE_ANON_KEY = anonKey.trim();
  localStorage.setItem('kharisma_supabase_anon_key', SUPABASE_ANON_KEY);
  return initSupabase() !== null;
}

/**
 * Check if Supabase connection is active and configured
 */
function isSupabaseConnected() {
  return supabaseClient !== null;
}

// Export for module or global use
if (typeof window !== 'undefined') {
  window.KharismaSupabase = {
    url: SUPABASE_URL,
    get client() { return supabaseClient; },
    init: initSupabase,
    setKey: setSupabaseCredentials,
    isConnected: isSupabaseConnected
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SUPABASE_URL, initSupabase, setSupabaseCredentials, isSupabaseConnected };
}
