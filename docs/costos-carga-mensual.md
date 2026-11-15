# Carga mensual de costos del sistema

Comando: `node scripts/costos/cargar-mes.mjs --mes AAAA-MM --verificar` (solo lectura) y luego `--aplicar` (lo corre el dueno con `!`; necesita `DATABASE_URL` del rol propietario, que el script nunca imprime). Antes se aplica la migracion 20261116000100 por el flujo de despliegue.

Ruta oficial: el script llama `costos.registrar_cargo` (la misma de la pagina; un cargo cobrable nace como gasto de la sociedad pagado por Javier), `costos.registrar_tipo_cambio`, `costos.registrar_dato_faltante` y `costos.resolver_dato_faltante`. Idempotente: un cargo vivo igual se omite; si difiere avisa y solo con `--reemplazar` anula (reversa) y vuelve a registrar.

## Reglas vigentes (decisiones del dueno, 14-nov)
- Vercel vale 0 por ahora (plan sin costo): sin cargo y sin dato faltante.
- Claude Max: fijo en US$20 al mes (20 de 200 prorrateados), fase construccion y opcional, aparte del total de operar; nota "declarado por el dueno: 20.00 USD de 200 prorrateados". No se usa el conteo de tokens por carpeta (da 0). `--claude-usd N` lo cambia.
- Supabase: cuota del documento (US$25) como minimo, con dato faltante abierto hasta declarar `--supabase-horas RTM:TOTAL --supabase-factura-usd N` (entonces cobra el mayor).
- OpenRouter, comision (5.5 %) y transcripcion (rol `audio`) salen del libro `ia.llamada`; si esta vacio, dato faltante salvo `--openrouter-usd N` (queda capturado y provisional).
- Dominio: `--dominio-anual-usd N` (devengo de un doceavo); sin costo declarado, dato faltante. Higgsfield: `--higgsfield-usd N`. Resend, Telegram y GitHub: sin cargo.
- Tipo de cambio: `--tc N --tc-fecha AAAA-MM-DD`, o el ultimo de la base, o Banxico con `BANXICO_TOKEN`. `--tc-sugerido` solo imprime la instruccion. SIN tipo de cambio nada en dolares se cobra: queda como dato faltante y la pagina muestra "al menos".
