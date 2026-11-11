# RTM

Software de la bodega de Mérida (mayoreo de vapes entre Angelo y Javier). Esta carpeta contiene la **fase F0**: acceso por enlace al correo, armazón visual, sistema de diseño, esquema de seguridad en Postgres y las guardas. Todo es **local**: sin remoto, sin despliegues, sin cuentas de pago.

Nombre provisional: vive en una sola constante (`src/config/marca.ts`).

## Requisitos

Node 22 o más, Docker activo y la CLI de Supabase (2.115). Los navegadores de prueba (Chromium y WebKit) se descargan una vez con `npx playwright install chromium webkit`.

## Levantar

```bash
npm install
npm run db:iniciar                          # Supabase local: solo base, Auth, API y buzon Mailpit (puertos 55320-55329)
node scripts/entorno/generar-env-local.mjs  # crea .env.local (permisos 600, fuera de git)
npm run dev                                 # http://127.0.0.1:3100
```

Los correos del enlace llegan al buzón local: http://127.0.0.1:55324

Dar de alta a las tres personas permitidas (lee la lista privada `~/.bodega-secrets/allowlist-correos.txt`, nunca imprime correos; Omar queda desactivado hasta M2):

```bash
npm run acceso:alta:probar   # solo valida y cuenta
npm run acceso:alta
```

## Probar

```bash
npm run verificar            # tipos, lint y fronteras, guardas, secretos, vitest, pgTAP y Playwright; deja Supabase detenido si lo levantó
npm run verificar -- --mantener
npm test                     # solo vitest (unitarias y contratos)
npm run db:probar            # solo pgTAP (requiere Supabase corriendo)
npm run e2e                  # solo las pruebas del acceso (construye y sirve la app en el puerto 3100)
npm run capturas             # regenera docs/capturas/f0 (Chromium y WebKit)
```

## Apagar

```bash
npm run db:detener           # supabase stop
pkill -f "next (dev|start)"  # si dejaste un servidor corriendo
```

## Estructura

`src/dominio` (puro: dinero en centavos `bigint`, formato, calendario con reloj inyectado, capacidades), `src/aplicacion` (casos de uso y puertos), `src/infra` (Supabase, límite de intentos en Postgres), `src/composicion` (cableado de puertos), `src/app` y `src/ui` (Next 16 y sistema de diseño), `supabase/` (configuración local, migraciones y pruebas pgTAP), `scripts/ci` (guardas, escáner de secretos y `verificar`), `test/` (contratos y Playwright), `docs/` (informe y capturas).

Informe de la fase: `docs/F0-informe.md`.
