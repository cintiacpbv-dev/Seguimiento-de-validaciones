// Conexión a Supabase.
// Los dos valores están en Supabase → Project Settings → API.
// La clave "anon" (o "publishable") está pensada para usarse en el navegador:
// los datos quedan protegidos por el inicio de sesión y las políticas RLS
// definidas en supabase/schema.sql.
//
// Si se dejan vacíos, la página funciona en modo demostración con datos de
// ejemplo que se guardan solo en este navegador.
export const SUPABASE_URL = 'https://wmlahknycadaxwcplujt.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndtbGFoa255Y2FkYXh3Y3BsdWp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNzExOTUsImV4cCI6MjEwMjg0NzE5NX0.EJGlh5W4HV7aPxZEi_tHSocroQxE4Zcj0G0BFKrFVfo';
