// Datos de conexión a Supabase. La "anon/publishable key" es segura de
// exponer en el navegador SIEMPRE que la Row Level Security (RLS) esté
// activada en todas las tablas — ya la activamos en el esquema SQL.
//
// SUPABASE_URL: armada a partir del "Project ID" que me pasaste
// (npujiyuuvxlkaupjvroh). Si al abrir la página el login no conecta,
// confirmá en Supabase -> Settings -> Data API el valor exacto de
// "Project URL" y avisame si es distinto a este.
window.EL_RESERO_CONFIG = {
  SUPABASE_URL: "https://npujiyuuvxlkaupjvroh.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_RUK7Rax0DKodl2IFi9Eqag_fHCaM6-c"
};
