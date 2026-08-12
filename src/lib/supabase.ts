import { createClient } from "@supabase/supabase-js"

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

/** 環境変数が無い開発環境では、従来どおりローカル専用で動作する。 */
export const supabase = url && anonKey ? createClient(url, anonKey) : null
