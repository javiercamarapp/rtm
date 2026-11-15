# Carga mensual de costos del sistema

Comando: `node scripts/costos/cargar-mes.mjs --mes AAAA-MM --verificar` (solo lectura) y luego `--aplicar` (lo corre el dueno con `!`; necesita `DATABASE_URL` del rol propietario, que el script nunca imprime).

Ruta oficial: el script llama `costos.registrar_cargo` (la misma de la pagina; un cargo cobrable nace como gasto de la sociedad pagado por Javier), `costos.registrar_tipo_cambio`, y desde la migracion 20261116000100 `costos.registrar_dato_faltante`, `costos.resolver_dato_faltante` e `costos.importar_claude_uso`. Idempotente: un cargo vivo igual se omite; si difiere avisa y solo con `--reemplazar` anula (reversa) y vuelve a registrar.

Fuentes y reglas: OpenRouter, comision (5.5 %) y transcripcion salen del libro `ia.llamada` (rol `audio` = transcripcion); Vercel y Supabase cobran la cuota del documento como minimo y dejan abierto el dato faltante (la API no desglosa por proyecto) hasta declarar `--vercel-consumo`/`--supabase-horas`; Claude Max usa `prorratear-claude.mjs` y el precio declarado `--claude-plan-usd`; dominio `--dominio-anual-usd`; Resend, Telegram y GitHub sin cargo. Sin tipo de cambio (`--tc`, base o `BANXICO_TOKEN`) los servicios en dolares quedan como dato faltante.
