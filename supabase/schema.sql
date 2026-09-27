-- =====================================================================
--  Seguimiento de validaciones — esquema de base de datos (Supabase)
--
--  Cómo usarlo: Supabase → SQL Editor → New query → pegar este archivo
--  completo → Run. Se puede volver a ejecutar sin perder datos.
-- =====================================================================


-- ---------------------------------------------------------------------
--  Etapas del ciclo de validación
--  Se pueden renombrar, agregar o reordenar desde aquí (o desde el
--  Table Editor). La etapa con el mayor "orden" se considera el cierre.
-- ---------------------------------------------------------------------
create table if not exists public.etapas (
  nombre      text primary key,
  orden       smallint not null unique,
  descripcion text
);

insert into public.etapas (orden, nombre, descripcion) values
  (1, 'Planificación',            'Alcance, recursos y cronograma definidos'),
  (2, 'Protocolo en elaboración', 'Redacción del protocolo'),
  (3, 'Protocolo en revisión',    'Revisión por Garantía de Calidad / áreas involucradas'),
  (4, 'Protocolo aprobado',       'Protocolo firmado, listo para ejecutar'),
  (5, 'Ejecución',                'Fabricación, muestreo y ensayos de los lotes'),
  (6, 'Análisis de resultados',   'Evaluación estadística y de criterios de aceptación'),
  (7, 'Informe en elaboración',   'Redacción del informe final'),
  (8, 'Informe en revisión',      'Revisión del informe por Garantía de Calidad'),
  (9, 'Cerrada',                  'Informe aprobado, validación concluida')
on conflict do nothing;


-- ---------------------------------------------------------------------
--  Validaciones: una fila por producto y tipo de validación
-- ---------------------------------------------------------------------
create table if not exists public.validaciones (
  id                         uuid primary key default gen_random_uuid(),
  producto                   text not null check (length(trim(producto)) > 0),
  presentacion               text,            -- forma farmacéutica / concentración
  tipo_validacion            text not null default 'Proceso',
  codigo_protocolo           text,
  codigo_informe             text,
  etapa                      text not null default 'Planificación'
                               references public.etapas (nombre) on update cascade,
  estado                     text not null default 'En curso'
                               check (estado in ('En curso', 'En espera', 'Bloqueada', 'Cancelada')),
  prioridad                  text not null default 'Media'
                               check (prioridad in ('Alta', 'Media', 'Baja')),
  responsable                text,
  lotes_requeridos           smallint not null default 3 check (lotes_requeridos >= 0),
  lotes_ejecutados           smallint not null default 0 check (lotes_ejecutados >= 0),
  lotes                      text,            -- números de lote utilizados
  fecha_inicio               date,
  fecha_aprobacion_protocolo date,
  fecha_objetivo             date,            -- fecha comprometida de cierre
  fecha_cierre               date,
  fecha_revalidacion         date,            -- próxima revalidación / revisión periódica
  proxima_accion             text,
  enlace_documentos          text,            -- carpeta de SharePoint / Drive / DMS
  notas                      text,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  updated_by                 text
);

create index if not exists validaciones_producto_idx on public.validaciones (producto);


-- ---------------------------------------------------------------------
--  Observaciones pendientes de cada validación
-- ---------------------------------------------------------------------
create table if not exists public.observaciones (
  id               uuid primary key default gen_random_uuid(),
  validacion_id    uuid not null references public.validaciones (id) on delete cascade,
  descripcion      text not null check (length(trim(descripcion)) > 0),
  responsable      text,
  fecha_registro   date not null default current_date,
  fecha_compromiso date,
  estado           text not null default 'Abierta' check (estado in ('Abierta', 'Cerrada')),
  fecha_cierre     date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  updated_by       text
);

create index if not exists observaciones_validacion_idx on public.observaciones (validacion_id);


-- ---------------------------------------------------------------------
--  Historial de cambios (se completa solo, mediante triggers)
-- ---------------------------------------------------------------------
create table if not exists public.historial (
  id            bigint generated always as identity primary key,
  validacion_id uuid not null,   -- sin FK: el historial se conserva aunque se borre la validación
  tabla         text not null,
  registro_id   uuid not null,
  accion        text not null check (accion in ('alta', 'modificación', 'baja')),
  cambios       jsonb not null default '{}'::jsonb,
  usuario       text,
  fecha         timestamptz not null default now()
);

create index if not exists historial_validacion_idx on public.historial (validacion_id, fecha desc);


-- ---------------------------------------------------------------------
--  Funciones y triggers
-- ---------------------------------------------------------------------

-- Email del usuario que hace el cambio (o el rol, si se edita con la
-- clave de servicio o desde el SQL Editor).
create or replace function public.usuario_actual() returns text
language sql stable set search_path = '' as $$
  select coalesce(claims ->> 'email', claims ->> 'role', session_user::text)
  from (select nullif(current_setting('request.jwt.claims', true), '')::jsonb as claims) as jwt;
$$;

create or replace function public.marcar_actualizacion() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := public.usuario_actual();
  return new;
end;
$$;

-- Al cerrar una observación se registra la fecha de cierre; al reabrirla se borra.
create or replace function public.fecha_cierre_observacion() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.estado = 'Cerrada' and new.fecha_cierre is null then
    new.fecha_cierre := current_date;
  elsif new.estado = 'Abierta' then
    new.fecha_cierre := null;
  end if;
  return new;
end;
$$;

create or replace function public.registrar_historial() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_fila    jsonb := coalesce(v_new, v_old);
  v_cambios jsonb := '{}'::jsonb;
  v_campo   text;
begin
  if tg_op = 'UPDATE' then
    for v_campo in select jsonb_object_keys(v_new) loop
      if v_campo not in ('updated_at', 'updated_by', 'created_at')
         and (v_new -> v_campo) is distinct from (v_old -> v_campo) then
        v_cambios := v_cambios || jsonb_build_object(v_campo, jsonb_build_array(v_old -> v_campo, v_new -> v_campo));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then
      return new;
    end if;
  else
    v_cambios := jsonb_strip_nulls(v_fila) - 'id' - 'validacion_id' - 'created_at' - 'updated_at' - 'updated_by';
  end if;

  insert into public.historial (validacion_id, tabla, registro_id, accion, cambios, usuario)
  values (
    case when tg_table_name = 'validaciones' then v_fila ->> 'id' else v_fila ->> 'validacion_id' end :: uuid,
    tg_table_name,
    (v_fila ->> 'id')::uuid,
    case tg_op when 'INSERT' then 'alta' when 'UPDATE' then 'modificación' else 'baja' end,
    v_cambios,
    public.usuario_actual()
  );
  return coalesce(new, old);
end;
$$;

drop trigger if exists validaciones_actualizacion on public.validaciones;
create trigger validaciones_actualizacion
  before insert or update on public.validaciones
  for each row execute function public.marcar_actualizacion();

drop trigger if exists observaciones_actualizacion on public.observaciones;
create trigger observaciones_actualizacion
  before insert or update on public.observaciones
  for each row execute function public.marcar_actualizacion();

drop trigger if exists observaciones_fecha_cierre on public.observaciones;
create trigger observaciones_fecha_cierre
  before insert or update on public.observaciones
  for each row execute function public.fecha_cierre_observacion();

drop trigger if exists validaciones_historial on public.validaciones;
create trigger validaciones_historial
  after insert or update or delete on public.validaciones
  for each row execute function public.registrar_historial();

-- Las observaciones que se borran en cascada junto con su validación no
-- se registran una por una: alcanza con la baja de la validación.
drop trigger if exists observaciones_historial on public.observaciones;
create trigger observaciones_historial
  after insert or update or delete on public.observaciones
  for each row when (pg_trigger_depth() < 1)
  execute function public.registrar_historial();


-- ---------------------------------------------------------------------
--  Seguridad: solo usuarios con sesión iniciada pueden ver y editar.
--  Los usuarios se crean en Authentication → Users (ver README).
-- ---------------------------------------------------------------------
alter table public.etapas        enable row level security;
alter table public.validaciones  enable row level security;
alter table public.observaciones enable row level security;
alter table public.historial     enable row level security;

revoke all on public.etapas, public.validaciones, public.observaciones, public.historial from anon;
grant select                         on public.etapas, public.historial           to authenticated;
grant select, insert, update, delete on public.validaciones, public.observaciones to authenticated;

drop policy if exists "etapas: lectura" on public.etapas;
create policy "etapas: lectura" on public.etapas
  for select to authenticated using (true);

drop policy if exists "historial: lectura" on public.historial;
create policy "historial: lectura" on public.historial
  for select to authenticated using (true);

drop policy if exists "validaciones: acceso completo" on public.validaciones;
create policy "validaciones: acceso completo" on public.validaciones
  for all to authenticated using (true) with check (true);

drop policy if exists "observaciones: acceso completo" on public.observaciones;
create policy "observaciones: acceso completo" on public.observaciones
  for all to authenticated using (true) with check (true);


-- ---------------------------------------------------------------------
--  Tiempo real: la página se actualiza sola cuando otro usuario edita.
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.validaciones;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.observaciones;
    exception when duplicate_object then null;
    end;
  end if;
end;
$$;
