# Capital por mes y por socio (rama feat/capital-por-mes)

Pedido del dueno (13-nov): tabla y reporte mensual por socio y por mes con valuacion, aportaciones de capital, utilidad generada, reinvertida y retirada, fondos de la sociedad en poder de cada socio (con motivo), aportacion neta, diferencia a igualar y cuenta con cada proveedor.

## Modelo vigente (decision del dueno, 13-nov): justicia en el dinero invertido
- La PARTICIPACION es siempre 50/50 (utilidad y propiedad). Aportar mas NO da mas participacion; no hay porcentajes de valuacion contra aportaciones.
- VALUACION personal de cada socio = capital aportado + su 50 % de la utilidad - fondos de la sociedad en su poder (`valuacion_cent`). Converge a ser igual cuando se igualan las aportaciones. `valuacion_libro_cent` es la misma antes de restar fondos (alimenta K1 y K7); `valuacion_si_igualados_cent` es informativa (su valuacion si pusiera la diferencia a igualar).
- APORTACION NETA, DIFERENCIA A IGUALAR y TURNO: `turno_aportar` es el socio con menos aportacion neta (null = Igualados). Texto: "Le toca aportar el siguiente pago: <socio> por <diferencia>". La diferencia NO es una deuda ni un reembolso a favor del otro: se resuelve con las siguientes aportaciones del que tiene menos. Al aportar el atrasado la diferencia baja; si la rebasa, el turno pasa al otro.
- REINVERSION IGUAL: cada mes reinvierten lo mismo. `api.acta_reinversion_sugerida(p_ini, p_fin)` da el monto comun (maximo comun de la utilidad disponible de cada socio, sin retiros), editable antes de firmar; el acta y su formulario viven en lane/historial-acta y deben usar ese valor como defecto (y 'Sugerido para el acta' de feat/dropshipping). El reporte mensual dice "Reinvertido este mes: igual para los dos" o una alerta informativa si el acta reinvirtio montos distintos (`reinversion_igual`).

## Piezas
- `api.capital_por_mes(p_desde, p_hasta)` (migracion 20261113500000): lectura, security definer, search_path vacio, exige rol socio. Auxiliares `operacion.cap_*` sin permiso para authenticated.
- `rep.capital_mensual(p_inicio)` (20261113500100): mismo calculo para el motor de reportes (solo rol servidor). NO modifica `rep.insumos_mensual`.
- Pantalla `/contabilidad/capital`, seccion en `/contabilidad/balance`, pagina 3 del reporte mensual (HTML y PDF).
- Identidades K1 a K9 (valuaciones personales + fondos en poder = capital contable del Balance; Balance cuadra; utilidad de los socios = Estado de resultados; fondos = 1150+1160; proveedores = Balance; aportacion neta = aportado - fondos; roll-forward de la valuacion; contra el auxiliar de socios y Libro conciliado cuando el corte es hoy).

## Como se integra con las otras ramas (solo leidas, no modificadas)
- feat/dropshipping: `api.socios_aportacion_neta()` define aportacion neta y diferencia a igualar; aqui se calculan con la MISMA definicion por mes dentro de `capital_por_mes` (sin crear esa funcion, no choca). Su utilidad reinvertida por pedido (`v_ds_utilidad.reinvertida`) debe sustituir al campo calculado `utilidad_reinvertida_proveedor` (hoy: saldo a favor reconocido con proveedores limitado por utilidad acumulada no retirada ni reinvertida por acta). Su `ds_reporte_mensual` es otra API; la pagina de capital del reporte mensual no la usa.
- lane/historial-acta: la valuacion personal usa su misma definicion (cuenta de capital + 50 % de la utilidad sin acta) con nombres propios (`cap_*`) para no chocar con `operacion.valor_socio`/`capital_socio`. La reinversion se ubica en el periodo del acta (periodo_fin), igual que su historial. Ambas ramas corrigen la reinversion del libro (20261113200100 y 20261113300200): dejar UNA.
- Hueco documentado: no existe en esta base una marca de "destino confirmado" para pagos de socios a proveedores; todo pago de socio a proveedor es "Por clasificar".

## Decisiones pendientes del dueno (no inventadas)
1. Como se confirma el destino de lo pagado por un socio a un proveedor (hoy todo queda por clasificar) y si el Balance debe reclasificar esa partida (hoy el Balance la sigue mostrando como saldo a favor contable).
2. Regla del centavo suelto: Estado de resultados (Angelo) y acta (quien mas aporta) redondean distinto; la valuacion muestra el residuo de 1 centavo como "redondeo".
3. Si la aportacion neta debe seguir contando como aportado el dinero propio puesto como reembolso (hoy si, igual que feat/dropshipping).
