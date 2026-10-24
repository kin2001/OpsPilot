import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// The invite route captures and clears URL credentials before explicitly setting the session.
export const createSupabaseClient = (url: string, publishableKey: string) =>
  createClient<Database>(url, publishableKey, { auth: { detectSessionInUrl: false } });
