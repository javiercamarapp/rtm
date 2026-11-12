# Informe del carril cuadrar-cuentas

Rama `lane/cuadrar-cuentas` (base `rediseno/premium`). 0 builds de Vercel, 0 despliegues, sin push, sin tocar `~/rtm` ni `~/rtm-deploy`, sin datos reales (catalogo, clientes y cifras ilustrativas creados por la propia prueba). Base local propia: proyecto Supabase `rtm-cuadre` en puertos 583xx y app en el 3190 (el `supabase/config.toml` con esos puertos esta marcado `assume-unchanged` y no se commitea).

## Que se hizo

Se recorrio por la interfaz real, en Chromium 1440x900 y sobre una base vacia, el flujo completo de cuadrar cuentas: apertura (aportaciones, inventario, cajas, cuenta por cobrar, deuda con Isaac) con firma de los dos socios desde dos sesiones; importar movimientos (ensayo sin escribir, importacion, reimportacion da cero, clasificar); compra a Isaac hasta la recepcion; pedido con nota enviado con guia; cobro parcial y final; pago de la sociedad a Isaac y pago de un socio; aportacion, gasto de socio y reembolso; y la verificacion final en Contabilidad, Cuentas por cobrar, Socios, Reportes e Inventario.

## Hallazgos y correcciones (un commit por causa)

1. **Defecto grave de maquetacion en `rediseno/premium`.** `premium.css` hacia `.rtm-region { display: contents }` para las regiones internas de una pagina, pero tambien alcanzaba al contenedor del armazon (barra y panel). Resultado: TODAS las paginas se pintaban comprimidas dentro del sidebar (el panel quedaba de 216 px de ancho bajo el menu). Corregido limitando la regla a `.rtm-panel .rtm-region`. Se detecto mirando las capturas, no por las pruebas.
2. **`/api/salud` respondia 307.** No existe ninguna referencia a `/api/salud` en el repo, la documentacion ni los scripts: la ruta de la app es `/api/health` (publica, 200). El proxy mandaba toda ruta desconocida sin sesion a `/login`, y un monitor que consulte `/api/salud` lo leia como caida. Se agrego el alias publico `/api/salud`, las demas rutas `/api/*` sin sesion responden 401 JSON (en vez de redirigir), y el humo de despliegue (`scripts/despliegue/humo.mjs`) verifica el alias. Verificado por curl y por la prueba 0 del recorrido (health 200, salud 200, ruta inexistente 401).
3. **El encabezado decia "Por cobrar: Sin dato" con una apertura firmada**, aunque Cuentas por cobrar mostraba 7,500.00. El chip se arma con la lectura de Cuentas por cobrar y solo miraba pedidos; ahora cuenta tambien la apertura (`src/dominio/operacion/pulso.ts`, con prueba vitest). Ademas, migracion aditiva `20261113000100_pulso_incluye_apertura.sql` para que `api.pulso()` (el inicio) sume la misma cifra, con pgTAP `a4_001` (4 afirmaciones, incluida la igualdad con `api.cuentas_por_cobrar`).
4. **Cuentas por cobrar: "Antiguedad de saldos por cliente" decia "Sin saldos que mostrar"** con un saldo de apertura de 7,500.00. El cuadro solo agregaba pedidos; ahora incluye los saldos de apertura por su fecha de adeudo.
5. **Las cajas de efectivo de la apertura no llegaban a Socios ni a la Cascada (hueco de dinero).** `operacion.saldo_efectivo` solo sumaba el libro de cajas; la categoria `caja` de la apertura se publica en la cuenta 1101 por persona. Con caja Angelo 5,000 + Javier 3,000, Contabilidad decia 9,000 y la Cascada 4,800. Corregido con la migracion aditiva `20261113000200_apertura_efectivo_en_cajas.sql` (nueva `operacion.apertura_efectivo`, `saldo_efectivo` suma la apertura firmada a la caja de cada persona) y una comprobacion nueva no bloqueante `CA1` (libro 1101 por la apertura contra cajas), con nombre fuera del patron `C<n>` para no alterar los reportes. pgTAP `a4_002` (10 afirmaciones: borrador no suma, firmada suma por persona, Cascada incluye, CA1 verde, reversa la quita). Despues del arreglo la Cascada dice 12,400.00 = 2,800.00 en poder de socios + 9,600.00 en cajas (8,000 apertura + 2,000 aportacion - 400 reembolso).
6. **Cuentas por cobrar con apertura: indicadores incongruentes.** Antiguedad media 0.0 dias y "0 pedidos" sin plazo pese a 7,500.00. Ahora la antiguedad media pondera tambien la apertura (23.0 dias en la demo), los saldos iniciales cuentan en "Sin plazo acordado" (7,500.00 · 1) y las notas lo dicen. Vencido y Por vencer siguen en 0.00 a proposito: los saldos de apertura no traen plazo y no se inventa un vencimiento.
7. **Pestanas cortadas a 1440 px** (Comprobaciones, 10. Firma): en pantalla ancha (900 px o mas) la tira de subpaginas se acomoda en dos renglones. Verificado en la captura 25 (Comprobaciones y Proyecciones visibles).
8. **Recorrido endurecido.** La prueba 9 ahora exige: ninguna de las 26 comprobaciones en rojo (sin `.catch`), efectivo de las cajas = 9,600.00 y el mismo numero en la Cascada, Cascada "Cuadra", y el estado real de Socios (aviso + `cuadra = false`). Tambien se descubrio y se corrigio una carrera: la prueba firmaba antes de que la resolucion del puente quedara guardada, y C20 salia en rojo (3990 con -111,755.00); ahora espera a que quede guardada.

## Comandos corridos y resultado real

| Comando | Resultado |
|---|---|
| `npx next build` y `npx next start -p 3190`, luego `npx playwright test --config playwright.cuadre.config.ts` (base reiniciada) | 10 de 10 pasaron (2.8 min), con las aserciones nuevas |
| `npx vitest run` | 112 archivos, 1,716 pruebas pasaron, 2 esperadas como fallo |
| `npx tsc --noEmit` | sin errores |
| `npm run lint` | sin hallazgos |
| `npm run guardas` | 0 violaciones |
| `npm run secretos` | 0 hallazgos |
| `supabase db reset` y `supabase test db` | 48 archivos, 2,220 pruebas; solo falla la 13 de `024_omar_cuenta_sin_folio` (da -100.00 en vez de -60.00). Preexistente: la prueba asume la fecha 2026-11-11 y `negocio.hoy()` es 2026-11-12; el carril no toca eso. La primera corrida de esta ronda encontro ademas 2 fallos en `010_api_f2` (permisos: las funciones nuevas nacian con EXECUTE publico); corregido con un revoke y reverificado |
| `contabilidad.comprobaciones()` al final del recorrido | 26 en total, 0 en rojo (C1..C22, CU1..CU3 y CA1) |

Nota: `supabase test db` solo es valido sobre una base recien reiniciada; corrido encima de los datos de demostracion produce fallos falsos (se vio y se descarto).

## Capturas

`docs/capturas/cuadre/` (35 imagenes numeradas, regeneradas en esta ronda, claro, 1440x900). Revisadas a ojo: apertura (vacia, resumen, validacion, firmada), Cuentas por cobrar tras apertura y tras cobro, Isaac tras apertura y tras pagos, Socios, Cascada, Comprobaciones ("Todo cuadra", 26 de 26), Balance (activo igual a pasivo mas capital), Caja, Reportes (reporte semanal preparado, "Preliminar - Parcial" por ser periodo en curso), Movimientos.

## Para repetirlo

`supabase start` (proyecto rtm-cuadre) y `supabase db reset`; `node scripts/entorno/generar-env-local.mjs` y cambiar `3100` por `3190` en `.env.local`; `npx next build` y `npx next start -p 3190` (NO `next dev`: el CSP de `next.config.ts` bloquea eval en desarrollo, la pagina no hidrata y el recorrido falla en el inicio de sesion); `npx playwright test --config playwright.cuadre.config.ts`. Revisar `uptime` antes (la Mac estuvo en carga 110 a 120 por otras sesiones y los contenedores se detuvieron una vez).

## Pendientes y observaciones (sin inventar reglas de dinero)

- **Persona de bodega (Omar) obligatoria para enviar un pedido.** Sin una fila en `catalogo.persona_bodega`, "Marcar enviado" falla con "no hay persona de bodega configurada (Omar Yacaman)" dentro de un mensaje generico ("Ese paso ya no aplica..."). No se pudo verificar si la base de produccion la tiene (no se toca la nube). La guia lo pone como requisito previo; conviene confirmarlo con Javier antes del primer pedido real.
- **Cuenta de socios dice "No cuadra"** en la demostracion (compra a credito con Isaac pagada por la sociedad y por un socio): via 1 -3,375.00 contra via 2 -475.00, aviso "Parte del costo no la pusieron los socios" por 5,800.00. No es un error de calculo: la cuenta compara lo puesto por cada socio con la mitad del costo y aqui la sociedad financio el costo. Es una regla de dinero pendiente del dueno (como leer "puso cada socio" con credito de proveedor); no se cambio. La guia ya no promete que cuadre y el recorrido fija este estado. La Cascada, que es otra identidad, si dice "Cuadra".
- **Pago de la sociedad a un proveedor no mueve las cajas de efectivo.** El libro lo descuenta de 1101 pero `registrar_pago_proveedor_sociedad` no escribe en las cajas de Socios. En la demo: Caja y liquidez muestra efectivo 8,600.00 y la Cascada 9,600.00; la diferencia de 1,000.00 es el pago a Isaac. Por eso CA1 compara solo lo de la apertura y no todo el libro contra las cajas. Falta decidir de que caja sale ese pago (el codigo dice "su cuenta o caja"); no se invento.
- "Entre socios" sigue en "Sin dato" justo despues de la apertura (la cifra mide la diferencia por compras entre socios); es consistente pero puede sorprender.
- El recorrido solo cubre laptop 1440 y tema claro; movil y oscuro no se probaron en este carril (el cambio de pestanas solo aplica desde 900 px; en movil sigue el desplazamiento horizontal).
- Hay otro agente que hizo un commit en este mismo worktree (`51e7d8d`, docs y recorrido a medias); esta version del informe y de la guia lo reemplaza y esta verificada.

## Consumo

Builds de Vercel: 0. Despliegues: 0. Push: ninguno. Paquetes npm agregados: ninguno (`node_modules` clonado de `~/rtm-rediseno`).
