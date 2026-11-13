#!/bin/sh
# Procedimiento de carga a PRODUCCION, paso a paso. NO contiene secretos ni datos reales: todo entra por variables de entorno y por la carpeta privada de fuentes.
# Este script NO se ejecuta solo ni en CI: lo corre el dueno (o quien el autorice), paso por paso, con `!` en su terminal. No hace push, no toca Vercel ni la configuracion de Supabase.
#
#   RTM_CARGA_DIR   carpeta PRIVADA con asientos.json, pedidos-isaac.json, alias-modelos.json y objetivo.json (fuera del repo, permisos 700)
#   DATABASE_URL    URL del rol propietario (postgres) de la base de PRODUCCION. Del gestor de secretos del dueno; nunca en el repo ni en el historial del shell
#                   (por ejemplo: read -rs DATABASE_URL; export DATABASE_URL). El script nunca la imprime.
#   DS_LLAVE_DESTINATARIO   (solo con --con-destinatarios) llave de cifrado de destinatarios, la misma del servidor de produccion.
#
# Uso:  sh scripts/cargador/produccion.sh <paso> [argumento]
#   1-verificar        ensayo sin escribir: plan, prerrequisitos y estado de la base (solo lectura; debe haber 0 pedidos y 0 asientos)
#   2-respaldo         respaldo cifrado previo (flujo existente: npm run respaldo -- previo-a-carga)
#   3-cargar <lote>    carga UN lote (1 a 5) y pide confirmacion escrita; correr 1, 2, 3, 4 y 5 en orden
#   4-conteos          conteos esperados contra los de la base (solo lectura)
#   5-cuadre           cuadre completo por dos vias contra las cifras objetivo (solo lectura)
#   6-idempotencia     segunda corrida completa: debe decir "0 pasos aplicados"
#   reversa            instrucciones de reversa (restaurar el respaldo); no ejecuta nada
set -eu
RAIZ=$(cd "$(dirname "$0")/../.." && pwd)
cd "$RAIZ"
: "${RTM_CARGA_DIR:?Falta RTM_CARGA_DIR (carpeta privada con las fuentes)}"
paso="${1:-}"
bandera_dest=""
[ "${CON_DESTINATARIOS:-}" = "si" ] && bandera_dest="--con-destinatarios"

necesita_url() { : "${DATABASE_URL:?Falta DATABASE_URL (rol propietario de produccion)}"; }

case "$paso" in
  1-verificar)
    necesita_url
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" --dry-run
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" --dry-run --verificar-estado
    echo "Si dice que la base esta lista, sigue con 2-respaldo. Si falta un prerrequisito (migracion, interruptores, persona de bodega), NO cargues."
    ;;
  2-respaldo)
    echo "Respaldo cifrado previo a la carga (requiere Docker activo y el proyecto ligado)."
    npm run respaldo -- previo-a-carga
    echo "Anota el nombre del archivo: es el punto de reversa. Prueba descifrarlo (respaldo.mjs --descifrar) antes de continuar."
    ;;
  3-cargar)
    necesita_url
    lote="${2:?Indica el lote (1 a 5)}"
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" --dry-run --lote "$lote"
    printf 'Se va a ESCRIBIR el lote %s en PRODUCCION. Hay respaldo previo? Escribe CARGAR para continuar: ' "$lote"
    read -r conf
    [ "$conf" = "CARGAR" ] || { echo "Cancelado: no se escribio nada."; exit 1; }
    # shellcheck disable=SC2086
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" --lote "$lote" $bandera_dest
    ;;
  4-conteos)
    necesita_url
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" --verificar-conteos
    ;;
  5-cuadre)
    necesita_url
    node scripts/cargador/cuadre.mjs --objetivo "$RTM_CARGA_DIR/objetivo.json"
    ;;
  6-idempotencia)
    necesita_url
    # shellcheck disable=SC2086
    node scripts/cargador/cargar.mjs --archivos "$RTM_CARGA_DIR" $bandera_dest
    echo "Debe decir: 0 pasos aplicados, N sin cambios."
    ;;
  reversa)
    cat <<'TXT'
REVERSA. Los hechos de negocio son de solo insercion: no se borran. La reversa es RESTAURAR el respaldo previo (pierde todo lo posterior a el):
  1. Detener las escrituras (no hay otro proceso escribiendo; el cargador ya termino o se interrumpio).
  2. node scripts/despliegue/respaldo.mjs --descifrar <archivo>-esquema.sql.enc /ruta/esquema.sql  (y el de datos), en una carpeta con permisos 700.
  3. Restaurar en el proyecto de produccion segun docs/DESPLIEGUE.md (Respaldos y restauracion); los usuarios de Auth se recrean con npm run acceso:alta:nube.
  4. Verificar: 0 pedidos y 0 asientos de la carga (sh scripts/cargador/produccion.sh 1-verificar).
  5. Si la carga fallo a la mitad, NO es necesario restaurar para reintentar: el cargador es reanudable (cada paso es una transaccion) y una segunda corrida completa los pasos que faltan sin duplicar.
  Un error de datos descubierto DESPUES de operar no se corrige restaurando: se corrige con las funciones del sistema (anular, ajuste de proveedor, asiento manual con motivo).
TXT
    ;;
  *)
    sed -n '2,22p' "$0"
    exit 2
    ;;
esac
