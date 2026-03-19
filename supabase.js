const SUPABASE_URL = 'https://rmvtyysvnhvfodozijrl.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_8TYF85xqZbhGAS3gefR4rA_IA1indx-'

const { createClient } = supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)