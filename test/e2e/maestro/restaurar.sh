#!/bin/sh
# Restaura el estado base de la campana maestra: db reset limpio + semilla + costo de Waka Duo 25K + carga privada + cuentas de prueba (Omar).
# Uso: sh test/e2e/maestro/restaurar.sh <carpeta-carga-privada>. SOLO LOCAL; la base de datos es la del Supabase local de este arbol.
set -e
RAIZ="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$RAIZ"
P="$1"; [ -d "$P" ] || { echo "falta la carpeta privada"; exit 2; }
supabase db reset >/dev/null 2>&1
URL="$(supabase status -o json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).DB_URL))')"
CLAVE="$(sed -n 's#^SERVIDOR_DATABASE_URL=postgresql://servidor:\([^@]*\)@.*#\1#p' .env.local)"
psql "$URL" -q -c "alter role servidor login password '$CLAVE'" >/dev/null
psql "$URL" -q -f scripts/cargador/semilla-local.sql >/dev/null
psql "$URL" -q >/dev/null <<'SQL'
begin;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-7777777777a2', true);
select catalogo.asegurar_modelo('Waka','Waka Duo 25K',25000,'ambas');
select catalogo.fijar_costo('e2e:seed:isaac:waka-duo-25k','Isaac','Waka Duo 25K',18500,'2026-11-10','documento_angelo_2026-11-10',null,false,true);
commit;
SQL
DATABASE_URL="$URL" node scripts/cargador/cargar.mjs --archivos "$P" --hasta-lote 5 | tail -1
DATABASE_URL="$URL" node scripts/cargador/cuadre.mjs --objetivo "$P/objetivo.json" | grep -E "^RESULTADO|Libro conciliado"
# Omar (solo en la lista de permitidos + usuario local confirmado)
psql "$URL" -q -c "insert into seguridad.correo_permitido (correo, rol, socio_nombre, activo) values ('maestro.omar@example.test','omar',null,true) on conflict do nothing" >/dev/null
node test/e2e/maestro/crear-usuario.mjs maestro.omar@example.test
