# Informe del carril cuadrar-cuentas

Rama `lane/cuadrar-cuentas` (base `rediseno/premium`). 0 builds de Vercel, 0 despliegues, sin push, sin tocar `~/rtm` ni `~/rtm-deploy`, sin datos reales (catalogo, clientes y cifras ilustrativas creados por la propia prueba). Base local propia: proyecto Supabase `rtm-cuadre` en puertos 583xx y app en el 3190 (el `supabase/config.toml` con esos puertos esta marcado `assume-unchanged` y no se commitea).

## Que se hizo

Se recorrio por la interfaz real, en Chromium 1440x900 y sobre una base vacia, el flujo completo de cuadrar cuentas: apertura (aportaciones, inventario, cajas, cuenta por cobrar, deuda con Isaac) con firma de los dos socios desde dos sesiones; importar movimientos (ensayo sin escribir, importacion, reimportacion da cero, clasificar); compra a Isaac hasta la recepcion; pedido con nota enviado con guia; cobro parcial y final; pago de la sociedad a Isaac y pago de un socio; aportacion, gasto de socio y reembolso; y la verificacion final en Contabilidad, Cuentas por cobrar, Socios, Reportes e Inventario.

## Hallazgos y correcciones (un commit por causa)

1. **Defecto grave de maquetacion en `rediseno/premium`.** `premium.css` hacia `.rtm-region { display: contents }` para las regiones internas de una pagina, pero tambien alcanzaba al contenedor del armazon (barra y panel). Resultado: TODAS las paginas se pintaban comprimidas dentro del sidebar (el panel quedaba de 216 px de ancho bajo el menu). Corregido limitando la regla a `.rtm-panel .rtm-region`. Se detecto mirando las capturas, no por las pruebas.
2. **`/api/salud` respondia 307.** No existe ninguna referencia a `/api/salud` en el repo, la documentacion ni los scripts: la ruta de la app es `/api/health` (publica, 200). El proxy mandaba toda ruta desconocida sin sesion a `/login`, y un monitor que consulte `/api/salud` lo leia como caida. Se agrego el alias publico `/api/salud`, las demas rutas `/api/*` sin sesion responden 401 JSON (en vez de redirigir), y el humo de despliegue (`scripts/despliegue/humo.mjs`) verifica el alias. Verificado por curl y por la prueba 0 del recorrido (health 200, salud 200, ruta inexistente 401).
3. **El encabezado decia "Por cobrar: Sin dato" con una apertura firmada**, aunque Cuentas por cobrar mostraba 7,500.00. El chip se arma con la lectura de Cuentas por cobrar y solo miraba pedidos; ahora cuenta tambien la apertura (`src/dominio/operacion/pulso.ts`, con prueba vitest). Ademas, migracion aditiva `20261113000100_pulso_incluye_apertura.sql` para que `api.pulso()` (el inicio) sume la misma cifra, con pgTAP `a4_001` (4 afirmaciones, incluida la igualdad con `api.cuentas_por_cobrar`).
4. **Cuentas por cobrar: "Antiguedad de saldos por cliente" decia "Sin saldos que mostrar"** con un saldo de apertura de 7,500.00. El cuadro solo agregaba pedidos; ahora incluye los saldos de apertura por su fecha de adeudo.

## Comandos corridos y resultado real

| Comando | Resultado |
|---|---|
| `npx playwright test --config playwright.cuadre.config.ts` (servidor `next dev -p 3190`, base reiniciada) | 10 de 10 pasaron (1.8 min) |
| `npx vitest run` | 112 archivos, 1,715 pruebas pasaron, 2 esperadas como fallo |
| `npx tsc --noEmit` | sin errores |
| `npx eslint src test scripts` | sin hallazgos |
| `npm run guardas` | 0 violaciones |
| `npm run secretos` | 0 hallazgos |
| `supabase test db` (base reiniciada) | 2,210 pruebas; todo pasa salvo la 13 de `024_omar_cuenta_sin_folio` ("ajuste de -60.00", da -100.00). Es un fallo preexistente: se reprodujo SIN la migracion nueva. No se toco |

Nota: `supabase test db` solo es valido sobre una base recien reiniciada; corrido encima de los datos de demostracion produce fallos falsos (se vio y se descarto).

## Capturas

`docs/capturas/cuadre/` (35 imagenes numeradas, tomadas despues de las correcciones, claro, 1440x900). Revisadas a ojo: apertura (vacia, resumen, validacion, firmada), Cuentas por cobrar tras apertura y tras cobro, Isaac tras apertura y tras pagos, Socios, Cascada, Comprobaciones ("Todo cuadra", 25 de 25, 0 bloqueantes en rojo), Balance (activo igual a pasivo mas capital), Caja, Reportes (reporte semanal preparado, "Preliminar - Parcial" por ser periodo en curso), Movimientos.

## Para repetirlo

`supabase start` (proyecto rtm-cuadre) y `supabase db reset`; `node scripts/entorno/generar-env-local.mjs` y cambiar `3100` por `3190` en `.env.local`; `npx next dev -p 3190`; `npx playwright test --config playwright.cuadre.config.ts`. Revisar `uptime` antes (la Mac estuvo en carga 110 a 120 por otras sesiones y los contenedores se detuvieron una vez).

## Pendientes y observaciones (sin inventar reglas de dinero)

- **Persona de bodega (Omar) obligatoria para enviar un pedido.** Sin una fila en `catalogo.persona_bodega`, "Marcar enviado" falla con "no hay persona de bodega configurada (Omar Yacaman)" dentro de un mensaje generico ("Ese paso ya no aplica..."). No se pudo verificar si la base de produccion la tiene (no se toca la nube). La guia lo pone como requisito previo; conviene confirmarlo con Javier antes del primer pedido real.
- **Cuenta de socios dice "No cuadra"** tras una compra a credito con pagos de la sociedad y de un socio (demostracion: "Diferencia por la compra" y "Puso Angelo" con un valor negativo). Es el aviso "salio dinero de la sociedad que no pusieron los socios"; no se cambio ninguna regla de reparto. Queda como pregunta para el dueno: cuando una compra se financia a credito con Isaac, cual debe ser la lectura de "puso cada socio".
- "Entre socios" sigue en "Sin dato" justo despues de la apertura (la cifra mide la diferencia por compras entre socios); es consistente pero puede sorprender.
- La pestana "10. Firma" del asistente de apertura se corta en pantallas de 1440 px (la tira de pestanas se desplaza). Cosmetico.
- El recorrido solo cubre laptop 1440 y tema claro; movil y oscuro no se probaron en este carril.
- Hay otro agente que hizo un commit en este mismo worktree (`51e7d8d`, docs y recorrido a medias); esta version del informe y de la guia lo reemplaza y esta verificada.

## Consumo

Builds de Vercel: 0. Despliegues: 0. Push: ninguno. Paquetes npm agregados: ninguno (`node_modules` clonado de `~/rtm-rediseno`).
