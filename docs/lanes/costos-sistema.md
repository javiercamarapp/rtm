# Costos de mantenimiento del sistema (clave `costos-sistema`)

Rama `lane/costos-sistema`. Fuentes: informe 17 (especificacion), 20 (decisiones de cobro) y 21 (cascada de reparto). Donde chocan, mandan 20 y 21, luego 17. Todo es local: sin red, sin base de datos, sin llaves.

## Que se construyo

| Pieza | Archivo | Capa |
|---|---|---|
| Redondeo unico `ceilDiv`, `techoCent`, `techoPct`, `techoPctDeFraccion` | `src/dominio/dinero/techo.ts` | dominio |
| Calculo de un cargo (base x porcentaje x tipo de cambio, un solo techo) | `src/dominio/costos/cargo.ts` | dominio |
| Participacion por consumo y regla del mayor (cuota del documento vs consumo real) | `src/dominio/costos/atribucion.ts` | dominio |
| Libro de IA de OpenRouter, comision de recarga con interruptor | `src/dominio/costos/openrouter.ts` | dominio |
| Conciliacion libro vs lectura externa (`/key`) | `src/dominio/costos/conciliacion.ts` | dominio |
| Lectura del JSON mensual de Claude y su participacion | `src/dominio/costos/claude.ts` | dominio |
| Cargo, reversa, asientos, cuenta por pagar, resumen | `registro.ts`, `eventos.ts`, `cuenta.ts`, `resumen.ts`, `reparto.ts`, `tipos.ts`, `errores.ts` | dominio |
| Casos de uso y puertos (`PuertoRepositorioCostos`, `PuertoTipoCambio`, `PuertoIds`) | `src/aplicacion/costos/` | aplicacion |
| Repositorio en memoria (solo insercion) y adaptador del FIX de Banxico | `src/infra/costos/` | infra |
| Script local de prorrateo de Claude | `scripts/costos/prorratear-claude.mjs` | script |

## Reglas implementadas

- **Un solo redondeo, hacia arriba.** `monto_cent = techoCent(base_micro x pct_ppm x tc_micro, 10^16)`. Unidades: base en millonesimas de la moneda original (el libro de IA ya trae `usd_micro` y no se redondea a centavos antes), porcentaje en ppm, tipo de cambio en millonesimas de MXN por unidad. El techo de negativos (notas de credito) tambien va hacia +infinito.
- **Participacion por consumo** = consumo de RTM / consumo total, con `techoPctDeFraccion` (se calcula con la fraccion exacta, no con un ppm truncado: 18.0000001 % sube a 19 %, 18.00 % se queda en 18 %).
- **Regla del mayor** (Vercel, Supabase): se cobra el mayor entre la cuota del documento ("como seria") y la participacion real ("como deberia ser"); el cargo guarda `como_seria_cent`, `como_deberia_cent`, el cobrado y la diferencia (`reglaDelMayor` la devuelve). En empate gana el consumo real.
- **Comision de recarga** de OpenRouter: consumo x 5.5 % (55 000 ppm, tasa exacta) en linea aparte; con `incluir = false` queda como memo (`enAsiento: false`, el caso de uso no la registra como cobrable).
- **Tipo de cambio fechado**: `PuertoTipoCambio.delDia(fecha)`. El adaptador de Banxico (serie SF43718) recibe `fetchFn` y `token` por parametro, usa el ultimo FIX publicado si el dia es inhabil, ignora `N/E`, y devuelve `null` si no hay dato: nunca se inventa. Un tipo de cambio de mas de 4 dias de antiguedad deja el cargo `provisional`; el del recibo (`tcManual`) gana.
- **Mecanica contable (decision 20, punto 7).** Cada cargo cobrable es gasto de la sociedad ("Costos de mantenimiento del sistema", cuentas 6210 a 6240), pagado por Javier: `Dr 62xx / Cr 2320` (cuenta por pagar de la sociedad a Javier, "Reembolso de costos del sistema"). No existe "Angelo debe a Javier". El reembolso es un movimiento aparte e idempotente (`Dr 2320 / Cr 1150|1160`, fondos de la sociedad), valida contra lo pendiente y nunca edita un cargo. La mitad de Angelo (`repartoMitades`, techo) es solo informativa: explica el efecto sobre la utilidad.
- **Anular** = insertar una reversa que copia los montos guardados con signo contrario (sin recalcular) y lados invertidos; el original queda intacto; una reversa no se anula.
- **Idempotencia**: cargo por `clave_idem` y por (servicio, mes, sha256 de evidencia); misma clave con otro contenido es `clave_idem_reutilizada`. Los folios K, R y E se consumen solo cuando el registro ya es valido (sin huecos).
- **Totales**: `resumenDelMes` entrega siempre `exactoE6` y `redondeadoCent` por separado (mas `exactoPuroE6`, el exacto con el porcentaje antes del techo al punto, para mostrar "exacto con 17.6 %"), la diferencia, y `alMenos` con la lista de faltantes. El redondeado es la suma de los cargos ya redondeados.

## Script local de Claude

```bash
node scripts/costos/prorratear-claude.mjs --mes 2026-11 [--raiz ~/.claude/projects] [--salida .] [--proyecto <carpeta> ...]
```

- Recorre `~/.claude/projects/*/**/*.jsonl` (incluye subagentes) y de cada registro toca solo `timestamp`, `message.id` y `message.usage.*`. No lee, guarda ni imprime contenido de mensajes ni rutas de trabajo; sin red.
- Cuenta cada `message.id` una vez (el mayor valor de cada campo, por la transmision en partes); mes por hora de Merida (UTC-6); RTM = carpeta igual o con prefijo `<patron>-` (cubre los worktrees). Por omision el patron es la carpeta de RTM de esta Mac; `--proyecto` lo sustituye.
- Salida `claude-uso-AAAA-MM.json` (permisos 600) con tres metricas, cada una con `tokens_rtm`, `tokens_cuenta`, `pct_exacto_ppm` y `pct_aplicado_ppm` (techo al punto): `entrada_salida_escritura_cache` (la que se cobra), `solo_salida` y `todo_con_lectura_cache`. Imprime el sha256 del archivo. Sin mensajes en el mes: codigo 2, "Sin dato", no escribe archivo.
- `leerUsoClaude` y `participacionClaude` (dominio) validan e interpretan ese JSON; `registrarCargo` lo usa con `atribucion: { tipo: 'participacion', consumoRtm, consumoTotal }`.

## Como integrarlo

1. Cablear en `src/composicion/costos.ts` (no incluido, depende de la base): `RepositorioCostosEnMemoria` se reemplaza por el repositorio Postgres de `costos-sistema-necesita-db.md`, y `crearTipoCambioBanxico({ token, fetchFn: fetch })` con el token leido del almacen de secretos del servidor.
2. Las paginas (`/costos`) llaman a los casos de uso `registrarCargo`, `anularCargo`, `registrarReembolso` y `estadoDeCostos`; la interfaz solo formatea (las cifras vienen de aqui).
3. Los asientos salen de `lineasDeEvento`; la funcion SQL `contabilidad.lineas_de_evento` debe darles paridad.

## Pruebas

`test/unit/costos/` (techo, dominio, aplicacion, prorrateo de Claude) y `test/contratos/costos_sin_flotantes.test.ts`. Criterios de aceptacion:

| Criterio | Prueba |
|---|---|
| La suma de las partes redondeadas nunca es menor que el total exacto | `techo.test.ts` (propiedad), `dominio.test.ts` (caso 1) |
| El caso de tres cargos del informe 17 reproduce las cifras | `dominio.test.ts` y `aplicacion.test.ts` (30 + 236 + 78 = 344; mitad 172; posiciones 56,344.00; 14,307.50 a 14,135.50) |
| El prorrateo con transcripciones sinteticas da la participacion esperada y no lee contenido | `prorratear_claude.test.ts` (vigilante que falla ante cualquier otro campo; centinelas ausentes de archivo, stdout y stderr) |
| El reembolso nunca edita el cargo | `aplicacion.test.ts` (foto antes y despues, objetos congelados, solo insercion) |
| Se muestran total exacto y total redondeado por separado | `dominio.test.ts` (`exactoE6` y `redondeadoCent` distintos, diferencia 18.03) |

## Desviaciones y puntos a confirmar

Ver la lista completa en el informe de entrega de la rama; las mas relevantes: el reembolso es de la sociedad (Dr 2320 / Cr fondos 1150|1160) y no `Dr 2320 / Cr 2310`; un reembolso mayor a lo pendiente se rechaza; la base se guarda en millonesimas (`base_orig_micro`), no en centavos; `exacto` usa el porcentaje ya techado al punto y se agrega `exacto_puro` (con el porcentaje exacto) porque 17 mezcla ambas bases (Supabase 235.875 con 17 %, Claude 651.20 con 17.6 %).
