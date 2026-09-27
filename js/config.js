// Conexión a Supabase.
// Los dos valores están en Supabase → Project Settings → API.
// La clave "anon" (o "publishable") está pensada para usarse en el navegador:
// los datos quedan protegidos por el inicio de sesión y las políticas RLS
// definidas en supabase/schema.sql.
//
// Si se dejan vacíos, la página funciona en modo demostración con datos de
// ejemplo que se guardan solo en este navegador.
export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';
