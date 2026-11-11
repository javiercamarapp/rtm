# RTM

Software de la bodega de Mérida (mayoreo de vapes entre Angelo y Javier). Esta carpeta contiene las **fases F0, F1 y F2**: acceso por enlace al correo (más el plan alterno `auth/confirm`), armazón visual, sistema de diseño, esquema de seguridad, catálogo, clientes, costos, precios e inventario en Postgres, importador y las guardas (F0 y F1), y en F2 compras con cuenta del proveedor, pedidos surtidos pieza por pieza con nota y PDF, pagos y cuentas por cobrar, paquetes, el modelo de Omar por funciones y el núcleo de avisos. Todo es **local**: sin remoto, sin despliegues, sin cuentas de pago.

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

## Importar listas (F1)

```bash
npm run importar:verificar    # lee las fuentes reales y comprueba 43 costos, 19 clientes, 179 lineas, 12 en cero y 17 de Karen (no toca la base)
npm run importar              # aplica a la base LOCAL, idempotente (decisiones del dueno en ~/.rtm-datos/decisiones-importacion.json)
npm run importar:idempotencia # dos aplicaciones en una transaccion revertida
npm run capturas:f1           # capturas con datos ilustrativos (reinicia la base y vuelve a importar las listas reales)
```

Los datos reales se leen de los archivos fuente en tiempo de ejecucion; nunca se versionan.

## Datos de demostración y capturas (F2)

```bash
node scripts/capturas/preparar-demo.mjs   # reinicia la base y carga fixtures ILUSTRATIVOS de F1 y F2 (nunca datos reales)
npm run capturas:f2                       # capturas de F2 en docs/capturas/f2; al final reinicia y restaura las listas reales
```

Los hechos de negocio (pedidos, pagos, compras, movimientos) son de solo inserción y no se pueden borrar: por eso `npm run verificar` corre las pruebas de pantallas sobre una base reiniciada y la restaura al terminar. Un pedido, un pago o una compra de prueba nunca se escribe en la base de uso real.

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

Informes: `docs/F0-informe.md`, `docs/F1-informe.md` y `docs/F2-informe.md`.
