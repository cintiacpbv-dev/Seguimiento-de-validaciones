-- =====================================================================
--  Carga inicial de productos (ejecutar una sola vez, después de schema.sql)
--
--  Crea una validación de proceso por producto, en etapa "Planificación".
--  Los códigos de protocolo, fechas y observaciones se completan después
--  desde la página.
-- =====================================================================

insert into public.validaciones (producto, tipo_validacion)
select p.producto, 'Proceso'
from (values ('Doloral'), ('Prostasil'), ('Soluna'), ('Sitiderm'), ('Fluixx'), ('Nistazinc')) as p (producto)
where not exists (
  select 1 from public.validaciones v
  where lower(v.producto) = lower(p.producto) and v.tipo_validacion = 'Proceso'
);
