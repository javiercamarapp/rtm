# Informe del carril cuadrar-cuentas

Rama lane/cuadrar-cuentas (base rediseno/premium). 0 builds de Vercel, 0 despliegues, sin push, sin datos reales; base local propia (proyecto rtm-cuadre, puertos 583xx, app en 3190).

## Hallazgos y correcciones
1. /api/salud daba 307: no existe en la app (ninguna referencia en el repo ni en docs). El proxy mandaba toda ruta desconocida sin sesión a /login. Se agregó el alias público /api/salud, las rutas /api/* privadas responden 401 JSON, y el humo de despliegue verifica el alias. Verificado por curl y Playwright: health 200, salud 200, ruta inexistente 401.
2. Defecto grave visual: premium.css hacía display: contents a toda .rtm-region, incluida la del armazón; todas las páginas se pintaban comprimidas dentro del sidebar. Se limitó a `.rtm-panel .rtm-region`. Confirmado con capturas antes y después.
3. El encabezado mostraba "Por cobrar: Sin dato" y "Entre socios: Sin dato" con apertura firmada. Migración aditiva 20261113000100 + pgTAP a4_001 (6 afirmaciones, pasa).

## Recorrido (test/cuadre/flujo.spec.ts, 10 pruebas, pasó 10/10 antes de la migración 3)
Apertura y firma de los dos socios, saldos en Cuentas por cobrar/Isaac/Socios, importación idempotente y clasificación, compra a Isaac hasta recepción, pedido enviado con nota, cobro parcial y total, pago a Isaac, aportación, gasto y reembolso, comprobaciones (0 bloqueantes en rojo), cadena de auditoría sana. Capturas en docs/capturas/cuadre/ (generadas antes de la última migración; borradas para regenerarse, ver pendientes).

## pgTAP
supabase test db: la prueba nueva pasa. Falla 024_omar_cuenta_sin_folio (test 13, ajuste -60.00 vs -100.00); fallo preexistente en la base rediseno/premium, reproducido SIN mi migración. No lo toqué.

## Pendientes
- Con la carga de la Mac en 118 detuve todo (servidor y Supabase). Falta regenerar las capturas tras la migración 3 y volver a correr el flujo completo; el spec ya incluye "Preparar reporte". Reproducir: supabase start; db reset; next dev -p 3190; npx playwright test --config playwright.cuadre.config.ts.
- Huecos observados sin corregir: el aviso "No cuadra" de Cuenta de socios aparece cuando salió dinero de la sociedad sin que lo pusieran los socios (es información correcta, pero la guía debe explicarlo; ya lo hace). El spec no cubre móvil ni modo oscuro.
- supabase/config.toml con puertos propios está marcado assume-unchanged localmente (no se commitea).
- vitest completo, lint y typecheck no corridos (carga).
