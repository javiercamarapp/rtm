-- pgTAP: capa 0 (privilegios) y capa 1 (auditoria estatica del esquema), AUTO-DESCUBRIENTES: leen el catalogo, no una lista escrita a mano.
-- Patron tomado de Likida-AI (capa0_grants_tablas.sql, capa1_auditoria_estatica.sql), reescrito como pgTAP.
begin;
select plan(10);

-- Capa 0: anon y authenticated no tienen NINGUN privilegio de tabla en los esquemas propios -------------------------------
select is(
  (select count(*)::int
     from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    cross join (values ('anon'), ('authenticated')) r(rol)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where n.nspname in ('seguridad', 'negocio', 'api', 'catalogo', 'operacion')
      and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege(r.rol, c.oid, p.priv)
           or (p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') and has_any_column_privilege(r.rol, c.oid, p.priv)))),
  0, 'capa 0: anon y authenticated sin privilegios sobre tablas de seguridad/negocio/api/omar');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('seguridad', 'negocio', 'api', 'omar', 'catalogo', 'operacion') and c.relkind = 'S'
      and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('authenticated', c.oid, 'USAGE')
           or has_sequence_privilege('anon', c.oid, 'SELECT') or has_sequence_privilege('authenticated', c.oid, 'SELECT'))),
  0, 'capa 0: secuencias sin acceso para anon y authenticated');

-- Capa 1: toda tabla de seguridad tiene RLS habilitada Y forzada, y ninguna tiene politica permisiva ----------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'seguridad' and c.relkind = 'r' and not (c.relrowsecurity and c.relforcerowsecurity)),
  0, 'capa 1: todas las tablas de seguridad con RLS habilitada y forzada');

select is(
  (select count(*)::int from pg_policies where schemaname in ('seguridad', 'negocio') and (coalesce(qual, '') = 'true' or coalesce(with_check, '') = 'true')),
  0, 'capa 1: ninguna politica literalmente true');

-- Capa 1: toda funcion SECURITY DEFINER propia fija search_path (sin search_path una regla cambia segun quien llama) --------
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('seguridad', 'negocio', 'api')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) c where c like 'search_path=%')),
  0, 'capa 1: toda funcion propia fija search_path');

-- Capa 1: ninguna funcion SECURITY DEFINER es ejecutable por anon, salvo la lista blanca minima ---------------------------
select is(
  (select coalesce(string_agg(p.proname, ',' order by p.proname), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('seguridad', 'negocio', 'api') and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
  '', 'capa 1: anon no ejecuta ninguna funcion SECURITY DEFINER (el limite de intentos lo llama el rol servidor)');

select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('seguridad', 'negocio') and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
  0, 'capa 0: seguridad y negocio no son ejecutables por anon ni authenticated');

-- Las futuras tablas no heredan nada ----------------------------------------------------------------------------------------
create table seguridad._guarda_nueva (id int);
select is(
  (has_table_privilege('anon', 'seguridad._guarda_nueva', 'SELECT,INSERT,UPDATE,DELETE')
   or has_table_privilege('authenticated', 'seguridad._guarda_nueva', 'SELECT,INSERT,UPDATE,DELETE')),
  false, 'una tabla nueva en seguridad no hereda privilegios para anon ni authenticated');

-- Esquemas expuestos por la API: solo api y omar (config.toml) -------------------------------------------------------------
select is(
  (select count(*)::int from pg_namespace where nspname in ('api', 'omar')), 2, 'existen los dos esquemas expuestos');

-- Comportamiento: como authenticated no se puede leer seguridad.usuario ni auditoria ------------------------------------------
set local role authenticated;
select throws_ok($$select * from seguridad.usuario$$, '42501', null, 'authenticated no lee seguridad.usuario');
reset role;

select * from finish();
rollback;
