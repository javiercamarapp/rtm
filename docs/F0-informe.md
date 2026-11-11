# Informe de la fase F0

Fecha: 10-nov-2026. Alcance: repo y Supabase locales, tokens, armazón visual, acceso idéntico a Likida Bitácoras, guardas y `npm run verificar`. Todo local: sin remoto, sin push, sin Vercel, sin cuentas de pago, sin proyectos en la nube.

## Lo que se hizo

- **Proyecto**: Next.js 16 (Turbopack, `proxy.ts`), TypeScript estricto, Supabase local (CLI 2.115) con solo base, Auth, API y buzón Mailpit en los puertos 55320 a 55329, para no chocar con otros proyectos.
- **Capas** (`src/dominio`, `aplicacion`, `infra`, `composicion`, `app`, `ui`, `config`) con fronteras comprobadas dos veces: `eslint-plugin-boundaries` y una prueba que recorre los imports. El dominio es puro (lint prohíbe red, base, `Date.now()`, `new Date()` sin argumento, `Math.random`, `process.env` y cualquier paquete).
- **Dinero** en centavos `bigint`, redondeo medio arriba y costo promedio ponderado móvil (cifras de G5: 915,462 centavos por 100 piezas, residuo exacto al vaciar, 1,000 secuencias aleatorias). Formato único (`$1,234.50`, `1,524 pz`, signo U+2212). Calendarios de Mérida con reloj inyectado (G8: 02:00 UTC del sábado 14 es viernes 13).
- **Migración inicial** (`supabase/migrations/20261110000100_seguridad_base.sql`): `seguridad.{correo_permitido,usuario,limite_intento,auditoria,operacion,contador_folio,interruptor}`, auditoría solo inserción con cadena de hash, idempotencia (409 con otro payload), folios sin huecos, `negocio.hoy()` en UTC-6, registro cerrado por trigger sobre `auth.users`, solo `api` y `omar` expuestos, RLS forzada y cero privilegios para `anon`/`authenticated`.
- **Sistema de diseño**: tokens claro y oscuro de la sección 8, acento con las dos variantes (neutro y lila) conmutables por `data-acento` (vista lado a lado en `/diseno`), Figtree, EB Garamond (una palabra en cursiva) y JetBrains Mono como archivos locales, módulo único de movimiento (`full | reduced | off`), botón sol/luna con script bloqueante en `<head>` (sin parpadeo), logo SVG por código y favicon que sigue el tema.
- **Armazón**: sidebar de 216 px con las seis secciones de M1 y estados vacíos, barra de 48 px con Pulso de cuatro chips ("Sin dato"), panel flotante de radio 22 con inset de 10 px, tarjeta "Primeros pasos" y pie fijo. En teléfono el sidebar pasa a cajón.
- **Acceso**: copia fiel de `login`, `login.css`, `artwork.tsx`, `particle-engine.js` y sus pruebas (huella sha256 idéntica al original salvo la lista cerrada: se borra Google y el separador "o" del CSS), marca y textos RTM, enlace mágico con Supabase Auth, registro cerrado en el servidor, límite de intentos sobre Postgres (IP 10 por 5 min, correo 3 por 10 min, global 60 por 10 min, piso de 1,500 ms, HMAC con pimienta) y fuentes locales.
- **Guardas**: lint de fronteras, guardas estáticas con baseline 0 (hex fuera de tokens, `style={{}}`, `confirm`, `<table>`, tamaños < 11 px, formato regional fuera del módulo de formato, dominio impuro, fuentes por red, Redis/Upstash/Google) con exención por huella para los archivos copiados, escáner de secretos y correos que también compara contra la lista privada local y el historial sin imprimir nada.

## Cómo se verificó

`npm run verificar` encadena: tipos, lint y fronteras, guardas, escáner de secretos, vitest (unitarias y contratos), pgTAP y Playwright (Chromium) contra el Supabase local y la app de producción local. Si el verificador levantó Supabase, lo deja detenido. Resultado final en la sección siguiente.

Las ocho pruebas del acceso (Playwright, buzón Mailpit local, correos `@example.test`): envío del enlace, uso del enlace, rechazo de un correo no permitido (misma pantalla, ningún mensaje, `auth.users` sin cambios, piso de 1.5 s en ambas ramas), límite de intentos (tope por correo y por IP), enlace caducado (reenvío automático), doble uso, cierre de sesión y ruta protegida. Más tres de refuerzo: alta directa (`/otp` con `create_user:true` y `/signup`) rechazada por el GoTrue real, cuenta inactiva con enlace válido más `next` externo que cae a la raíz, y movimiento reducido (el arte pinta un solo cuadro).

Capturas: `docs/capturas/f0/` (26 imágenes y `manifest.md`), Chromium y WebKit, claro y oscuro, 1440x900 y 402x874.

## Desviaciones de la especificación

1. **`[auth.email].enable_signup`** queda en `true`. En el CLI 2.115 ese interruptor apaga el proveedor de correo completo ("Email logins are disabled") y con él el enlace mágico. El registro cerrado lo logran `[auth].enable_signup = false`, el trigger `seguridad.t_auth_solo_permitidos` sobre `auth.users` y `shouldCreateUser: false`; la prueba 9 confirma que el GoTrue real rechaza `/otp` con `create_user:true` y `/signup`.
2. **Tabla `seguridad.correo_permitido`** (no está en la spec). `seguridad.usuario` referencia `auth.users`, así que la lista de permitidos no puede vivir solo ahí (el huevo y la gallina); el trigger de alta copia el rol desde `correo_permitido`.
3. **Capa `composicion`**: la spec prohíbe que `app` importe `infra`, pero alguien tiene que cablear los puertos; se agregó esa capa (y `src/proxy.ts`, requerido por Next) como única que conoce ambas.
4. **Archivos del login** viven en `src/ui/login/` (arte y motor) y `src/app/login/` en lugar de `src/components/login/`, y `ruta_segura`, `motivo_login` y la lógica de `limite_correo` y `reenvio_enlace` se repartieron en dominio, aplicación e infraestructura para respetar las fronteras. La lista de rutas de `next` es la de RTM.
5. **`alta-usuarios.mjs` sí está versionado** (no contiene ningún correo; solo la ruta del archivo local). La instrucción decía "script de siembra local que no se versiona"; se interpretó como el archivo de correos. Si se quiere fuera del repo basta añadir la ruta a `.gitignore` y `git rm --cached`. La lista real no trae roles: el script los asigna por el nombre en la parte local del correo (exactamente uno de javier, angelo y omar) y se detiene si no encaja; Omar queda desactivado.
6. **Acceso a la base desde la web**: `registrar_intento_login` es ejecutable por `anon` (el límite corre antes de la sesión). Se mitiga con una clave HMAC con pimienta del servidor y formato validado por CHECK; no se usa `service_role` en la web. El rol `servidor` de la spec queda para el spike de F1.
7. **Capturas del teléfono a escala 2** (la spec dice 3) para mantener los archivos ligeros; las zonas seguras del iPhone no se simulan en F0.
8. **No incluidos en F0 (no pedidos)**: búsqueda y campana de la barra superior, sidebar colapsado a 64 px, animaciones A05/A16/A17/A18/A21/A23 (los componentes que las usan llegan después), `auth/confirm` con `token_hash` (plan alterno para iPhone con la app instalada: se prueba en teléfono real antes de activar a Omar).

## Lo que no se pudo

- Probar entrega real de correo (SPF, DKIM, DMARC) y Resend: requiere cuentas y es de M3.
- Probar el enlace en un iPhone real con la app instalada.
- Descargar Supabase CLI 3.x: se trabajó con la 2.115 indicada.

## Consumo aproximado

Alrededor de 125 llamadas a herramientas y 85 minutos de reloj de una sola sesión. Builds de Vercel: 0. Despliegues: 0. Se descargaron Chromium y WebKit de Playwright (~330 MB) y la imagen `supabase/pg_prove`.

## Avisos para el dueño

- Otro Supabase local (`likida-bitacoras`) estaba corriendo en la Mac; no se tocó. RTM usa puertos 55320 a 55329, así que conviven, pero hubo dos contenedores de base de datos a la vez mientras se trabajó.
- Las llaves que imprime `supabase start` son las de demostración de la CLI local; no se escribió ninguna en el repo.
- Los correos reales de la lista privada no se copiaron a ningún archivo, prueba, documento ni commit; el escáner lo comprueba también en el historial.
