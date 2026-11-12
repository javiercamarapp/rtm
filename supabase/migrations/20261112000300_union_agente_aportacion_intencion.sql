-- Union: operacion.registrar_aportacion (20261111000200, produccion) ahora exige declarar la intencion ('capital' o 'reembolso') en el quinto argumento;
-- agente.ejecutar (20261110002700, main) le pasaba la clasificacion vieja 'reembolsable' y una aportacion por Telegram fallaba.
-- Regla del dueño (adenda 32): aportacion de capital SOLO si el socio lo declara; todo lo demas es reembolso. Por omision queda 'reembolso'.
create or replace function agente.ejecutar(p_clave_idem text, p_tipo text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_res jsonb; v_socio text; v_existia boolean; v_sku jsonb;
begin
  perform notificacion.exigir_sistema();
  perform set_config('rtm.canal', 'telegram', true);
  v_existia := exists (select 1 from seguridad.operacion where clave = p_clave_idem and resultado is not null);
  if p_tipo = 'gasto' then
    v_socio := initcap(p_args ->> 'pagado_por');
    if v_socio not in ('Angelo', 'Javier') then raise exception 'un gasto de la sociedad pagado en efectivo de la caja aun no se captura por Telegram: dile al agente quien lo pago' using errcode = 'P0460'; end if;
    v_res := operacion.registrar_gasto_socio(p_clave_idem, v_socio, (p_args ->> 'monto_cent')::bigint, p_args ->> 'categoria', coalesce(p_args ->> 'naturaleza', 'variable'), null, null, p_args ->> 'nota', p_args ->> 'origen');
  elsif p_tipo = 'aportacion' then
    v_res := operacion.registrar_aportacion(p_clave_idem, initcap(p_args ->> 'socio'), (p_args ->> 'monto_cent')::bigint, coalesce(p_args ->> 'concepto', 'Aportacion por Telegram'),
      case lower(coalesce(p_args ->> 'intencion', p_args ->> 'clasificacion', '')) when 'capital' then 'capital' else 'reembolso' end);
  elsif p_tipo = 'toma_omar' then
    v_sku := coalesce(p_args -> 'sku', jsonb_build_object('sku_id', (select k.id from catalogo.sku k where k.modelo_id = (p_args ->> 'modelo_id')::bigint and k.sabor_id = (p_args ->> 'sabor_id')::bigint)));
    v_res := operacion.registrar_toma_omar(p_clave_idem, v_sku, (p_args ->> 'piezas')::int, null, null, 'telegram_omar');
  else
    raise exception 'tipo de indicacion no soportado por Telegram todavia: %', p_tipo using errcode = 'P0460';
  end if;
  return v_res || jsonb_build_object('repetido', v_existia);
end $$;
