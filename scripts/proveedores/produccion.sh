#!/bin/sh
# Carga a PRODUCCION del catalogo de Isaac y de Karen, y pasada horaria del vigilante. NO contiene secretos ni datos reales.
# Este script NO se ejecuta solo ni en CI: lo corre el dueno (o quien el autorice) con `!` en su terminal. No hace push ni toca Vercel ni la configuracion de Supabase.
#
#   DATABASE_URL     URL del rol propietario (postgres) de PRODUCCION. Del gestor de secretos del dueno (por ejemplo: read -rs DATABASE_URL; export DATABASE_URL). Nunca se imprime.
#   RTM_PROV_ENV     archivo local con INVENTARIO_PROVEEDORES_FUENTE=<direccion privada de la tienda de Karen> (permisos 0600, fuera del repo). Para karen-* y horaria.
#
# Uso:  sh scripts/proveedores/produccion.sh <paso>
#   isaac-verificar    ensayo del catalogo Remate de Isaac (transaccion revertida): dice que crearia y que queda por confirmar
#   isaac-aplicar      registra los modelos y sabores de Isaac, su stock disponible y el costo supuesto de Waka Blast 45K (idempotente)
#   karen-verificar    lee la tienda (1 pasada, respeta robots y el tope de 40 peticiones al dia) y dice que registraria en el catalogo; no escribe
#   karen-aplicar      pasada completa del vigilante con --catalogo: estado y eventos, fotos faltantes y todo modelo/sabor (disponible o agotado) al catalogo con existencia 0
#   horaria            lo mismo que karen-aplicar pero con la guarda de una pasada por hora (es lo que programa launchd)
# Orden recomendado: respaldo previo (lo hace `npm run desplegar`), isaac-verificar, isaac-aplicar, karen-verificar, karen-aplicar, y programar `horaria`.
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
paso="${1:-}"
necesita_url() { : "${DATABASE_URL:?Falta DATABASE_URL (rol propietario de produccion)}"; RTM_DB_URL="$DATABASE_URL"; export RTM_DB_URL; }
necesita_tienda() { : "${RTM_PROV_ENV:?Falta RTM_PROV_ENV (archivo local con la fuente privada de la tienda)}"; }
case "$paso" in
  isaac-verificar) necesita_url; node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac --verificar ;;
  isaac-aplicar)
    necesita_url
    node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac --verificar
    printf 'Se va a ESCRIBIR el catalogo de Isaac en PRODUCCION. Hay respaldo previo? Escribe CARGAR para continuar: '
    read -r conf
    [ "$conf" = "CARGAR" ] || { echo "Cancelado: no se escribio nada."; exit 1; }
    node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac --aplicar
    echo "Segunda corrida (debe decir 0 modelos creados y 0 skus creados):"
    node scripts/proveedores/cargar-catalogo-proveedor.mjs --fuente=isaac --aplicar
    ;;
  karen-verificar) necesita_url; necesita_tienda; npx tsx scripts/proveedores/vigilar-karen.mjs --verificar --catalogo --sin-fotos --env-file="$RTM_PROV_ENV" ;;
  karen-aplicar)
    necesita_url; necesita_tienda
    printf 'Se va a ESCRIBIR en PRODUCCION (estado de Karen, fotos y catalogo). Escribe CARGAR para continuar: '
    read -r conf
    [ "$conf" = "CARGAR" ] || { echo "Cancelado: no se escribio nada."; exit 1; }
    npx tsx scripts/proveedores/vigilar-karen.mjs --aplicar --catalogo --forzar --env-file="$RTM_PROV_ENV"
    ;;
  horaria) necesita_url; necesita_tienda; npx tsx scripts/proveedores/vigilar-karen.mjs --aplicar --catalogo --env-file="$RTM_PROV_ENV" ;;
  *) echo "Uso: sh scripts/proveedores/produccion.sh isaac-verificar|isaac-aplicar|karen-verificar|karen-aplicar|horaria"; exit 2 ;;
esac
