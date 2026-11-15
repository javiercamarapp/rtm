# Carga mensual de costos del sistema

Comando: `node scripts/costos/cargar-mes.mjs --mes AAAA-MM --verificar` (solo lectura) y luego `--aplicar` (lo corre el dueno con `!`; necesita `DATABASE_URL` del rol propietario, que el script nunca imprime). Antes se aplica la migracion 20261116000100 por el flujo de despliegue.

Ruta oficial: el script llama `costos.registrar_cargo` (la misma de la pagina; un cargo cobrable de Javier nace como gasto de la sociedad + aportacion de capital declarada, ver docs/costos-como-aportacion.md), `costos.registrar_tipo_cambio`, `costos.registrar_dato_faltante` y `costos.resolver_dato_faltante`. Idempotente: un cargo vivo igual se omite; si difiere avisa y solo con `--reemplazar` anula (reversa) y vuelve a registrar.

## Reglas vigentes (decisiones del dueno, 14-nov)
- Vercel y Supabase valen 0 por ahora (sin consumo real declarado): sin cargo y sin dato faltante. Con consumo declarado se cobra lo menor (o mayor, segun `costos.cuota_base`) entre la cuota base y el consumo real.
- Claude Max: fijo en US$20 al mes (20 de 200 prorrateados), fase construccion y opcional, aparte del total de operar; `--claude-usd N` lo cambia.
- OpenRouter, comision (5.5 %) y transcripcion (rol `audio`) salen del libro `ia.llamada`; sin llamadas vale 0 (salvo `--openrouter-usd N`, capturado y provisional).
- Dominio: administrado en Vercel; `--dominio-anual-usd N` (devengo de un doceavo); sin costo declarado vale 0. Higgsfield: `--higgsfield-usd N`. Resend, Telegram y GitHub: sin cargo.
- Tipo de cambio: `--tc N --tc-fecha AAAA-MM-DD`, o el ultimo de la base, o Banxico con `BANXICO_TOKEN`. SIN tipo de cambio nada en dolares se cobra: queda pendiente en USD (`Sin tipo de cambio: falta capturarlo`).
