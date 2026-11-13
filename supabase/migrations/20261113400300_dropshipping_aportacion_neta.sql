-- Dropshipping / 0300: Aportacion neta de cada socio y diferencia a igualar (decision del dueno, 13-nov).
-- aportado = lo que el socio ha puesto: capital (declarado, apertura y reinversion por acta) + dinero propio como reembolso (operacion.aportado_socio). No incluye los pagos directos a compras
-- ni lo pagado fuera de la sociedad: esos siguen en su cuenta aparte.
-- Ademas expone 'le_toca_aportar' (turno) e 'igualados'.
-- Los fondos de la sociedad que un socio tiene en su poder (cobros que cayeron en su cuenta) NO se presentan como que el socio "debe": reducen su APORTACION NETA
--   aportacion neta = aportado (capital declarado + reinversion por acta + dinero propio puesto como reembolso) - fondos de la sociedad en su poder.
-- Ambos socios seguiran metiendo dinero y deben aportar EQUITATIVAMENTE: la "diferencia a igualar" de cada socio es lo que le falta a su aportacion neta para alcanzar la mayor.
-- SOLO LECTURA y presentacion: no cambia ningun asiento ni cuenta (cuentas 1150 'fondos en poder del socio', 2310/2320 reembolsos, 3110/3120 capital). 'Libro conciliado' y el auxiliar
-- contra mayor no se tocan. Ver docs/dropshipping-fondos-en-poder-decision.md para el efecto contable de cada tratamiento (decision contable pendiente del dueno).

create function api.socios_aportacion_neta() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_cs jsonb := operacion.cuenta_socios();
begin
  perform seguridad.exigir_rol(array['socio']);
  return (
    with n as (
      select s.id, s.nombre, (v_cs->lower(s.nombre)->>'puso_capital_cent')::bigint + (v_cs->lower(s.nombre)->>'puso_reembolsable_cent')::bigint as aportado, (v_cs->lower(s.nombre)->>'puso_capital_cent')::bigint as capital,
             (v_cs->lower(s.nombre)->>'puso_reembolsable_cent')::bigint as reembolso, greatest(operacion.saldo_socio(s.id, 'fondos'), 0) as fondos
      from catalogo.socio s),
    c as (select n.*, n.aportado - n.fondos as neta from n),
    m as (select max(neta) as mx, sum(neta) as sn, sum(aportado) - sum(fondos) as sd from c)
    select jsonb_build_object('mayor_aportacion_neta_cent', m.mx,
      -- Turno: le toca aportar el siguiente pago al socio con MENOS aportacion neta (null = igualados). La diferencia a igualar NO es deuda ni reembolso: se resuelve con las siguientes
      -- aportaciones del que tiene menos; quien tiene mas dinero metido no gana mas participacion (la valuacion igualada es de otro modulo: feat/capital-por-mes).
      'le_toca_aportar', (select c2.nombre from c c2 where c2.neta < m.mx order by c2.neta, c2.id limit 1),
      'igualados', not exists (select 1 from c c3 where c3.neta < m.mx),
      'socios', (select jsonb_agg(jsonb_build_object('socio', c.nombre, 'aportado_cent', c.aportado, 'puso_capital_cent', c.capital, 'puso_reembolsable_cent', c.reembolso, 'fondos_en_poder_cent', c.fondos,
                   'aportacion_neta_cent', c.neta, 'diferencia_a_igualar_cent', m.mx - c.neta) order by c.id) from c),
      'identidad', jsonb_build_object('via1_cent', m.sn, 'via2_cent', m.sd, 'cuadra', m.sn = m.sd))
    from m);
end $$;

revoke execute on function api.socios_aportacion_neta() from public, anon;
-- GRANT a authenticated (exige rol socio dentro):
grant execute on function api.socios_aportacion_neta() to authenticated;
