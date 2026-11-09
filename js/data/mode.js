'use strict';
// Which mode the app runs in (loaded as a classic script; see index.html for the load order).
// LOCAL (default): demo data in this browser, code-based sign-in - the original behavior.
// REMOTE: shared data in Supabase, personal email + password sign-in, permissions enforced by the database.
const REMOTE = !!(window.GAN_CONFIG && window.GAN_CONFIG.supabaseUrl && window.GAN_CONFIG.supabaseAnonKey);
