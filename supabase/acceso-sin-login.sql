-- Quita el inicio de sesión: permite ver y editar con la clave pública (anon).
-- Ejecutar una vez en Supabase → SQL Editor si ya habías corrido una versión
-- anterior de schema.sql. (Un schema.sql actualizado ya incluye esto.)

grant select                         on public.etapas, public.historial           to anon;
grant select, insert, update, delete on public.validaciones, public.observaciones to anon;

alter policy "etapas: lectura"                on public.etapas        to anon, authenticated;
alter policy "historial: lectura"             on public.historial     to anon, authenticated;
alter policy "validaciones: acceso completo"  on public.validaciones  to anon, authenticated;
alter policy "observaciones: acceso completo" on public.observaciones to anon, authenticated;
