# Costos del sistema: lo que necesita de base de datos

El modulo trabaja contra puertos con implementaciones en memoria. Esta lista es el contrato que debe cumplir el area de base de datos (no se creo ninguna migracion). Convenciones del repo: `bigint identity`, RLS forzada sin politicas permisivas, escritura solo por funciones `SECURITY DEFINER` con `search_path=''` y `seguridad.exigir_rol(['socio'])`, `[AO]` solo insercion (trigger T1), `[ME]` solo estado. Ni Omar ni anonimos leen `costos.*`.

## Esquemas y funciones

- Esquemas `costos` e `ia`.
- `costos.techo(num bigint, den bigint, paso bigint default 100)` y `costos.ceil_div(a bigint, b bigint)`: gemelas exactas de `src/dominio/dinero/techo.ts` (`ceilDiv`, `techoCent`), `IMMUTABLE`. Prueba de paridad por propiedad con fast-check (500 casos, incluidos negativos). `costos.techo_pct_fraccion(num, den)` gemela de `techoPctDeFraccion` (devuelve ppm).
- Folios sin huecos por tabla contador: `K` (cargo), `R` (reembolso), `E` (evento, ya existe).

## Tablas

```sql
costos.servicio(id, slug UNIQUE, nombre, categoria {nube,ia,software,dominio}, fase, ciclo, dia_renovacion, moneda,
  metodo_atribucion text NOT NULL, pagador_default {angelo,javier}, cobrable bool, opcional bool, activo,
  cuota_documento_orig_micro bigint NULL,  -- "como seria" (Vercel ~US$20, Supabase hasta US$25); NULL si no aplica la regla del mayor
  logo_slug NULL)                                                     -- [ME]

costos.tipo_cambio(fecha date, moneda, tc_micro bigint CHECK (> 0), fuente {banxico_fix,manual},
  UNIQUE(fecha, moneda, fuente))                                      -- [AO]

costos.cargo(id, folio, servicio_id, mes char(7), fecha_neg date, periodo_ini, periodo_fin, fase,
  base_orig_micro bigint,                 -- millonesimas de la moneda original (puede ser negativa en notas de credito y reversas); NO centavos
  moneda, pct_exacto_ppm int, pct_aplicado_ppm int CHECK (BETWEEN 0 AND 1000000),
  tc_micro bigint, tc_fecha date, tc_fuente,
  exacto_mxn_e6 bigint,                   -- centavos MXN x 1e6, con el porcentaje aplicado
  exacto_puro_mxn_e6 bigint,              -- idem con el porcentaje exacto (antes del techo al punto)
  monto_cent bigint,                      -- MXN redondeado al peso superior: es el gasto
  como_seria_cent bigint NULL, como_deberia_cent bigint NULL,   -- regla del mayor (decision 20, punto 2)
  pagado_por {angelo,javier} NOT NULL, cobrable bool,
  etiqueta {medido,recibo,capturado,atribuido,estimado_prorrateado,proyeccion},
  estado {provisional,confirmado,disputado,anulado}, evidencia_tipo {api,recibo,libro,captura,script_local},
  evidencia_sha256 text NULL, nota text, reversa_de bigint NULL REFERENCES costos.cargo, clave_idem text UNIQUE NOT NULL, evento_id)  -- [AO]
  CHECK (reversa_de IS NOT NULL OR monto_cent * 10000 >= costos.ceil_div(exacto_mxn_e6, 100))  -- nunca menor que el exacto
  CHECK (monto_cent % 100 = 0)
  CHECK (estado <> 'confirmado' OR evidencia_sha256 IS NOT NULL)
  UNIQUE(servicio_id, mes, evidencia_sha256) WHERE evidencia_sha256 IS NOT NULL AND reversa_de IS NULL
  UNIQUE(reversa_de) WHERE reversa_de IS NOT NULL                    -- un cargo se anula una sola vez

costos.reembolso(id, folio, a_socio {angelo,javier}, fondos_de {angelo,javier}, monto_cent bigint CHECK (> 0),
  fecha_neg, medio, comprobante_sha256 NULL, clave_idem text UNIQUE NOT NULL, evento_id)   -- [AO]; nunca modifica un cargo
  -- El trigger valida: Sum(reembolsos a ese socio) <= Sum(cargos cobrables que pago ese socio, con reversas).

costos.lectura_api(servicio_id, ventana, estado {ok,error,parcial}, payload_sha256, leida_at)       -- [AO]
costos.dato_faltante(servicio_id, mes, motivo, abierto_at, resuelto_at)                           -- [ME]
costos.conciliacion(servicio_id, mes, fuente_a, a_usd_micro, fuente_b, b_usd_micro, dif_ppm, estado {cuadra,fuera_de_tolerancia,explicada}, explicacion)  -- [ME]
costos.presupuesto(servicio_id, mes, monto_cent)   costos.parametro(clave, valor, cambiado_por, cambiado_at)
costos.claude_uso_mes(mes, metrica {entrada_salida_escritura_cache,solo_salida,todo_con_lectura_cache},
  tokens_rtm bigint, tokens_cuenta bigint, pct_exacto_ppm, pct_aplicado_ppm, sesiones, json_sha256, script_version, importado_por)  -- [AO]
ia.llamada(id, ts timestamptz, rol, modelo, tokens_in, tokens_out, costo_usd_micro bigint, generacion_openrouter, reserva_id,
  estado {liquidada,reservada,fallida})                                                            -- [AO]
```

Parametros (`costos.parametro`): `costos_regla_pagador`, `costos_cobrable_por_defecto`, `openrouter_incluir_comision`, `openrouter_comision_ppm=55000`, `conciliacion_tolerancia_ppm=20000`, `tc_fuente='banxico_fix'`, `claude_proyectos_rtm`, `fecha_inicio_mantenimiento`, `marcas_licencia_declaracion`. Cambio con reautenticacion.

## Eventos y asientos (`contabilidad.lineas_de_evento`)

Tipos nuevos de `operacion.evento`: `costo_cargo_registrado`, `costo_cargo_anual`, `costo_devengo_mensual`, `costo_recarga_ia`, `costo_consumo_ia`, `reembolso_costos`, `costo_conciliado`. Asientos identicos a `src/dominio/costos/eventos.ts` (paridad por propiedad y `Sum(debe) = Sum(haber)` en cada evento sembrado):

- `costo_cargo_registrado`: `Dr 62xx (6210 nube, 6220 IA, 6230 software, 6240 dominio) / Cr 2320` (cuenta por pagar de la sociedad a Javier; `2310` si pago Angelo). Monto negativo invierte los lados. Cargo no cobrable: sin lineas.
- `reembolso_costos`: `Dr 2320 / Cr 1150|1160` (fondos de la sociedad). Sustituye el `Dr 2320 / Cr 2310` del informe 17.
- Nombres: la cuenta de gasto se llama "Costos de mantenimiento del sistema" y la de pasivo "Reembolso de costos del sistema". Reconciliar los codigos con el plan de cuentas antes de M2 (2320 hoy figura como "Guias por pagar a Javier").

## Vistas y contratos de lectura (`api.*`)

- `v_costo_mes` (cargos con exacto, redondeado, `exacto_puro`, columnas "como seria / como deberia ser", cobrado y diferencia), `v_costos_por_pagar` (por socio: cargado, reembolsado, pendiente), `v_costos_resumen_mes` (operar, opcionales, construccion, total, "al menos" con faltantes).
- La cuenta entre socios usa la formula de posicion de siempre: el pago por cuenta de la sociedad aumenta la posicion de quien pago. La vista `v_costos_por_pagar` debe cuadrar con `cuenta_socios()`.
- Efecto del reembolso sobre la posicion: depende de la cascada de reparto (adenda 21, otro modulo). Este modulo solo cancela la cuenta por pagar.

## Tareas programadas (cron UTC, ya definidas en el informe 17, seccion 4)

`tc-diario` (`0 20 * * *`), `ia-instantanea`, `vercel-dia`, `alertas-dia`, `cierre-previo`, `recordatorios`, `cierre-definitivo`. Idempotentes por (servicio, ventana, mes); el cierre se decide con la fecha de negocio de Merida, no con la de UTC. Los lectores externos de Vercel y de `/key` de OpenRouter no estan en este modulo (necesitan llaves y red).
