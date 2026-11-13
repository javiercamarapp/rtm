# Despliegue de RTM (produccion)

Produccion: **https://rtm-nu.vercel.app** (proyecto Vercel `rtm`, equipo `likida`, SIN Git conectado). Base y acceso: proyecto Supabase `rtm` (ref `kaapcbypmjclqrkwwegp`, region us-east-2, plan Pro). Correo de acceso: Resend por SMTP (`smtp.resend.com:465`, remitente `RTM`, dominio verificado).

Regla de costos: **0 builds de Vercel**. El codigo se compila en la Mac (`vercel build --prod`) y se sube ya compilado (`vercel deploy --prebuilt --prod`). No se conecta GitHub a Vercel; un push a GitHub no despliega nada. Supabase cuesta alrededor de US$10 al mes.

## Como se despliega

Desde un worktree o checkout ligado a ambos proyectos (`vercel link --yes --project rtm --scope likida` y `supabase link --project-ref kaapcbypmjclqrkwwegp`), con el arbol limpio:

```bash
npm run desplegar:probar   # compuerta local + analisis de migraciones; no toca la nube
npm run desplegar          # todo el flujo
npm run desplegar -- --si-hay-cambios   # para el reloj de cada hora: no hace nada si este commit ya esta desplegado
npm run desplegar -- --dry-run          # imprime el plan y sale; no ejecuta nada ni escribe el registro
npm run desplegar -- --solo-alias https://rtm-xxxx-likida.vercel.app   # publica un despliegue ya existente bajo el alias (sin compuerta ni build)
npm run desplegar -- --completo         # ademas corre `npm run verificar` (pgTAP y pantallas); reinicia la base LOCAL: no usar si otra sesion la usa
```

Flujo de `scripts/despliegue/desplegar.mjs`:

1. Compuerta local: tipos, lint y fronteras, guardas, escaner de secretos y pruebas unitarias (`--completo` agrega `verificar`).
2. Compara las migraciones locales con la nube. Aborta si la nube tiene una migracion que no existe en la carpeta. Aborta si una migracion pendiente es destructiva (DROP TABLE/SCHEMA/COLUMN, TRUNCATE, DELETE FROM, cambio de tipo, RENAME, DISABLE RLS) o concede privilegios a `anon`/`authenticated`/`public`. Solo con orden expresa del dueno: `--permitir-destructivas`.
3. Si hay migraciones pendientes, hace un **respaldo cifrado previo** y las aplica (`supabase db push --linked`).
4. Registra a que despliegue apunta hoy el alias (`vercel inspect rtm-nu.vercel.app --json`); si no puede leerlo aborta (no habria a donde restaurar), salvo `--permitir-sin-previo`.
5. `vercel pull`, `vercel build --prod` y `vercel deploy --prebuilt --prod`. **Ojo: `deploy --prod` deja el despliegue READY pero NO mueve el alias `rtm-nu.vercel.app`** (proyecto sin Git); por eso los despliegues 5 a 8 quedaron sin servirse y el humo, que corria contra el alias, probaba la version vieja.
6. Humo contra la **URL unica** del despliegue nuevo (`https://rtm-xxxx-likida.vercel.app`). Antes se comprueba que esa URL responda 200 en `/login`; si esta protegida por Vercel o no esta lista, se aborta con el error y el alias no se toca. Humo (`scripts/despliegue/humo.mjs`): acceso con particulas y sin errores de consola, encabezados de seguridad, rutas protegidas, respuesta generica y limite de intentos, Resend sin envios para correos no permitidos, llave anon sin acceso a funciones ni tablas, registro cerrado, bundle publico sin secretos ni correos.
7. Si el humo pasa: `vercel alias set <URL unica> rtm-nu.vercel.app --scope likida`.
8. Verifica que el alias sirve lo nuevo: `vercel inspect` del alias debe dar el mismo despliegue y los assets de `/login` (hashes del build) deben ser identicos a los de la URL unica (se reintenta unos segundos por la propagacion). Despues corre el humo contra el alias.
9. Si algo falla despues del alias (set, verificacion o humo): `vercel alias set <despliegue anterior> rtm-nu.vercel.app`, se verifica la restauracion, se registra `revertido` y el script sale con error. Si el humo falla antes del alias (paso 6) se registra `humo-fallo` y el alias nunca se movio. **Las migraciones no se revierten** (son aditivas); el codigo anterior debe seguir funcionando con ellas, y si una migracion causo el fallo se corrige con otra migracion hacia adelante o se restaura el respaldo (ver abajo).

Cada corrida deja una linea en `~/.bodega-backups/despliegues.log` (hora, commit, rama, resultado `desplegado`/`revertido`/`humo-fallo`/`abortado`, builds de Vercel = 0, y `alias_anterior`/`alias_nuevo`). Nunca lleva secretos ni correos.

Pruebas de humo sueltas: `npm run humo -- https://rtm-nu.vercel.app` (agrega `--con-correo-real` para pedir un enlace al correo de Javier y confirmar el envio en Resend; manda un correo de verdad).

## Cambios de configuracion de Auth y API

`scripts/despliegue/config-nube.toml` es la fuente (registro cerrado, SMTP de Resend, vigencia del enlace de 30 minutos, topes de envio, esquemas expuestos `api` y `omar`). Se aplica con:

```bash
node scripts/despliegue/auth-nube.mjs https://rtm-nu.vercel.app
```

Lee la llave de Resend de `~/.bodega-secrets/resend.key` y el remitente de `~/.bodega-secrets/rtm-remitente.txt`; usa una carpeta temporal, asi que no toca `supabase/config.toml` (que es solo local). La plantilla del correo esta en `scripts/despliegue/plantillas/magic_link.html`.

## Datos iniciales y personas

- Listas de costos, clientes y precios (solo nombres y precios): `npx tsx scripts/importacion/importar.mts --sql-salida /ruta/privada/importacion.sql` genera un SQL idempotente (una transaccion) y se ejecuta con `supabase db query --linked -f /ruta/privada/importacion.sql`. Borra el archivo despues (contiene nombres de clientes). Se puede repetir sin duplicar.
- Personas con acceso: `npm run acceso:alta:nube` (lee `~/.bodega-secrets/allowlist-correos.txt`; Javier y Angelo socios, Omar desactivado; no imprime correos). Para agregar o cambiar a alguien se edita la lista privada y se vuelve a correr.

## Variables de entorno de produccion (Vercel, ambiente production)

| Variable | Tipo | Origen |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | publica | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | publica (llave anon, sin privilegios por diseno) | `supabase projects api-keys` |
| `NEXT_PUBLIC_APP_URL` | publica | `https://rtm-nu.vercel.app` |
| `LIMITE_PIMIENTA` | secreta | `~/.bodega-secrets/rtm-limite-pimienta.key` |
| `SERVIDOR_DATABASE_URL` | secreta | `~/.bodega-secrets/rtm-servidor-database.url` (rol `servidor` por el pooler, puerto 6543) |

Nunca se pone la llave de servicio (`service_role`) ni la de Resend en Vercel: la app no las usa. Las contrasenas viven en `~/.bodega-secrets/` (permisos 600): `supabase-rtm-servidor.pass`, `rtm-limite-pimienta.key`, `rtm-servidor-database.url`, `rtm-respaldo.key`, `rtm-remitente.txt`, `resend.key`.

## Respaldos y restauracion

- `npm run respaldo -- diario|semanal|previo-a-despliegue` hace un volcado logico (esquema y datos) cifrado con AES-256 a `~/.bodega-backups/` (carpeta 700, archivos 600). Retencion: 14 diarios, 8 semanales, 10 previos a despliegue. Requiere Docker activo.
- Programacion recomendada (a cargo de Javier, p. ej. con `launchd` o `cron`): diario a las 03:00 `cd <carpeta ligada> && npm run respaldo -- diario`, y los domingos `npm run respaldo -- semanal`. Ademas Supabase Pro conserva sus propios respaldos diarios (Dashboard > Database > Backups).
- Restaurar: `node scripts/despliegue/respaldo.mjs --descifrar <archivo>-esquema.sql.enc /ruta/esquema.sql` (y el de datos); en un proyecto vacio, aplicar con `psql` el esquema y luego los datos. Los usuarios de Auth no van en el volcado: se recrean con `npm run acceso:alta:nube`. Probar la restauracion en un proyecto desechable antes de depender de ella.
- Perder `~/.bodega-secrets/rtm-respaldo.key` vuelve ilegibles los respaldos: guardar una copia fuera de la Mac.

## Como se revierte

- Solo codigo: `vercel alias set <url de la version anterior> rtm-nu.vercel.app --scope likida` (`alias_anterior` en `despliegues.log` o `vercel list rtm --scope likida` dan las anteriores). El script lo hace solo si algo falla despues de mover el alias.
- Base de datos: no hay reversa automatica; se corrige hacia adelante con una migracion nueva, o se restaura un respaldo (ultimo recurso, pierde lo posterior al respaldo).
- Sitio expuesto por una falla de seguridad: retirar de inmediato con `vercel alias set` a una version sana, o `vercel remove` del despliegue, y avisar a Javier.

## Rotar secretos

- **Contrasena del rol `servidor`**: generar otra con `python3 -c "import secrets;print(secrets.token_hex(24))"`, `alter role servidor with password '...'` por `supabase db query --linked -f`, actualizar `~/.bodega-secrets/supabase-rtm-servidor.pass` y `rtm-servidor-database.url`, `vercel env add SERVIDOR_DATABASE_URL --environment production --sensitive --force < archivo`, y desplegar.
- **Pimienta del limite**: cambiarla reinicia los conteos (aceptable). Mismo procedimiento con `LIMITE_PIMIENTA`.
- **Llave de Resend**: crearla nueva en Resend, guardarla en `resend.key` y correr `auth-nube.mjs` (actualiza el SMTP); revocar la vieja.
- **Llaves anon y de servicio de Supabase**: se rotan en el Dashboard (Settings > API); si cambia la anon, actualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` y desplegar.

## Quien puede hacer que

- **Javier (dueno)**: todo; unico que cambia facturacion, Spend Management, planes, dominios, la lista de permitidos y quien tiene acceso a Vercel y Supabase; unico que autoriza `--permitir-destructivas` y borrar datos.
- **Angelo (socio)**: usa la aplicacion; no tiene acceso a Vercel ni a Supabase.
- **Omar**: sin acceso hasta M2 (cuenta desactivada).
- **Agentes de desarrollo**: pueden correr `npm run desplegar` con la autorizacion vigente del dueno (loop de actualizaciones); no cambian facturacion ni configuracion de otros proyectos, no cargan datos reales de ventas, compras o pagos y se detienen si una verificacion de seguridad falla.

## Notas

- `supabase config push` reporta `storage: updated` en cada corrida (el almacenamiento no se usa); no afecta a la aplicacion.
- El limite de intentos falla abierto si la base no responde (decision de F1); el humo lo verifica cada despliegue.
