-- Cola de fotos por confirmar del vigilante de Karen. ADITIVA: una tabla nueva y tres funciones. Nada de importes; solo socios leen.
-- El vigilante NUNCA asigna una foto dudosa ni unifica modelos: deja aqui el candidato y un socio decide.
create table proveedores.foto_pendiente (
  clave text primary key,                       -- identificador corto del modelo en la tienda (handle normalizado)
  titulo text not null,
  marca text not null,
  archivo text,                                 -- ruta publica ya descargada (public/proveedores/karen/<clave>.webp), si hubo descarga
  candidatos jsonb not null default '[]'::jsonb, -- ids de catalogo.modelo plausibles
  motivo text not null check (motivo in ('sin_coincidencia', 'varios_candidatos', 'solo_linea', 'marca_distinta')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
  creada_at timestamptz not null default now(),
  resuelta_at timestamptz
);
alter table proveedores.foto_pendiente enable row level security;
alter table proveedores.foto_pendiente force row level security;
revoke all on proveedores.foto_pendiente from public, anon, authenticated;

create function proveedores.registrar_foto_pendiente(p_clave text, p_titulo text, p_marca text, p_archivo text, p_candidatos jsonb, p_motivo text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  insert into proveedores.foto_pendiente (clave, titulo, marca, archivo, candidatos, motivo) values (p_clave, p_titulo, p_marca, p_archivo, coalesce(p_candidatos, '[]'::jsonb), p_motivo)
    on conflict (clave) do nothing;   -- idempotente: una decision ya tomada no se reabre
  return jsonb_build_object('clave', p_clave, 'registrada', found);
end $$;

create function proveedores.fotos_pendientes() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform seguridad.exigir_socio_o_sistema();
  return coalesce((select jsonb_agg(jsonb_build_object('clave', f.clave, 'titulo', f.titulo, 'marca', f.marca, 'archivo', f.archivo, 'candidatos', f.candidatos, 'motivo', f.motivo, 'creada_at', f.creada_at)
    order by f.creada_at, f.clave) from proveedores.foto_pendiente f where f.estado = 'pendiente'), '[]'::jsonb);
end $$;

create function api.prov_fotos_pendientes() returns jsonb language plpgsql stable security definer set search_path = ''
as $$ begin perform seguridad.exigir_rol(array['socio']); return proveedores.fotos_pendientes(); end $$;

revoke execute on function proveedores.registrar_foto_pendiente(text, text, text, text, jsonb, text), proveedores.fotos_pendientes() from public, anon, authenticated;
grant execute on function proveedores.registrar_foto_pendiente(text, text, text, text, jsonb, text), proveedores.fotos_pendientes() to servidor;
revoke execute on function api.prov_fotos_pendientes() from public, anon;
grant execute on function api.prov_fotos_pendientes() to authenticated;
