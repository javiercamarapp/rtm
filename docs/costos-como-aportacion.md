# Costos del sistema como aportacion de capital de Javier

Decision del dueno (14-nov): "Vercel y Supabase estan conectados con mi cuenta; cada mes todos los cobros se anaden a mi valuacion como aportacion porque yo pago eso, y se lleva registro, se tiene fecha de todo."

## Excepcion explicita a la regla del dinero propio
La regla general (CLAUDE.md, 13-nov) es: dinero propio de un socio = reembolso, salvo declaracion expresa de capital. Aqui Javier SI declara capital. La declaracion vive en `costos.parametro` clave `costos_como_capital` (socios declarados, intencion "costos del sistema pagados por el socio", declarado por, fecha). Un socio no declarado (Angelo) conserva el camino anterior: gasto de la sociedad + cuenta por pagar reembolsable.

## Que pasa con cada cargo
`costos.registrar_cargo` (la misma ruta de la pagina y del script) para un cargo cobrable de un socio declarado:
1. `operacion.registrar_gasto_socio_capital` crea el gasto de la sociedad y la aportacion de capital del socio (`operacion.aportacion_socio`, clasificacion `capital`, ref gasto) con la intencion en el concepto.
2. Asiento de partida doble (por `contabilidad.lineas_de_evento`, sin cambios): Dr 62xx (gasto del servicio: 6210 nube, 6220 IA, 6230 software, 6240 dominio) / Cr 3120 (Aportaciones de Javier; 3110 para Angelo). Sin linea de caja: se paga con la tarjeta.
3. `costos.cargo` guarda `como_capital`, `aportacion_id`, `intencion`, fecha, servicio, monto MXN, tipo de cambio (valor, fecha y fuente), folio K y referencia al gasto (G).
4. Suma a la valuacion personal (capital aportado) y al capital contable del Balance por la ruta de siempre. El gasto baja la utilidad 50/50; el capital de Javier sube por el monto completo.
5. No genera cuenta por pagar: `costos.pendiente_socio` y la cuenta de costos excluyen lo declarado como capital.

Idempotencia: un segundo cargo vivo del mismo servicio y mes con otra clave se rechaza (`P0456`); correr el mes dos veces con el script no duplica (el plan lo detecta como ya registrado). Para corregir: anular (reversa enlazada, deshace aportacion y gasto) y registrar de nuevo (`--reemplazar`).

## Validacion de montos
`costos.validacion_mes(mes)` y la tarjeta "Validacion de montos" de /costos comparan tres vias: cargos capital del mes, aportaciones del libro de socios ligadas a esos cargos y lo asentado en el mayor (cuentas 3110/3120). Cuadra solo si las tres son iguales. "Explicar este numero" (`costos:aportacion:AAAA-MM` y `costos:aportacion:total`, `api.explicar_costos`) muestra los renglones con tipo de cambio. Las identidades de contabilidad (`contabilidad.comprobaciones`, C1 a C24 bloqueantes) y el libro conciliado de Socios quedan en verde (pgTAP 025).

## Montos vigentes
Claude Max: USD 20 fijos al mes (no 200). Dominio: logo de Vercel, devengo de un doceavo, 0 hasta que Javier de el costo anual. Vercel, Supabase, OpenRouter (sin libro), Resend, GitHub, Telegram, transcripcion y Higgsfield: 0 hasta que haya cargo real. OpenRouter con llamadas liquidadas en `ia.llamada` cobra el consumo real medido (gasto, no el saldo).

## Cuota base de las plataformas
`costos.cuota_base` (servicio, regla `menor` o `mayor`, cuota en USD, `vigente_desde`): filas nuevas, nunca se edita una anterior (`costos.fijar_cuota_base` o `cargar-mes.mjs --fijar-cuota vercel:menor:20:2026-12-01`). Regla sembrada: `menor` = se cobra lo menor entre la cuota base y el consumo real (la cuota es el tope). Con `mayor` la cuota es el piso. PENDIENTE: confirmar con el dueno el sentido exacto de "si es menos de la suscripcion normal, el costo base" (ver preguntas). La pagina muestra la regla vigente en el razonamiento de cada servicio.

## Sin tipo de cambio
No se inventa ni se convierte. Un cargo en USD sin tipo de cambio se guarda como pendiente (`costos.cargo_pendiente_tc`, estado) y la pagina lo lista en USD con "Sin tipo de cambio: falta capturarlo"; no entra a totales ni a la valuacion. Al capturar el tipo de cambio (formulario "Tipo de cambio" de la pagina, o `--tc N --tc-fecha AAAA-MM-DD`) y volver a correr el mes, nace como aportacion y el pendiente se resuelve.

## Comandos
- `node scripts/costos/cargar-mes.mjs --mes 2026-11 --verificar` (solo lectura) y `--aplicar` (lo corre Javier con `!`; `DATABASE_URL` nunca se imprime). Con tipo de cambio: `--tc N --tc-fecha AAAA-MM-DD`.
- Consumo real: `--vercel-consumo RTM:TOTAL --vercel-factura-usd N`, `--supabase-horas RTM:TOTAL --supabase-factura-usd N`, `--openrouter-usd N`, `--dominio-anual-usd N`, `--higgsfield-usd N`.
- Migracion: `20261118200000_costos_como_aportacion.sql` (aditiva; se aplica por el flujo de despliegue con respaldo previo, NO aplicada a produccion).
