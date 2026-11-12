# Carril paquete-perdido: informe

Rama `lane/paquete-perdido` (worktree `~/rtm-lane-paquete`, desde `rediseno/premium` 6b5e269). Sin push, sin Vercel, sin Supabase en la nube, sin datos reales. Instancia local propia `rtm-paq` (puertos 643xx, servidor 3140); config.toml marcado assume-unchanged. Detenida al terminar.

## Que hace
Migracion aditiva `20261112400000_lane_paquete_perdido.sql`: incidentes de solo insercion (`paquete_incidente`, `_linea`, `_resolucion`), reportar en salida (pedido enviado) y entrada (orden en camino), resolver con responsable sociedad (perdida 50/50 via utilidad del periodo, se arrastra), socio (cuenta por cobrar, adenda 29, 1170/1180), proveedor (reclamo) o cliente (sin efecto). Salida: reponer (merma al costo promedio + guia del reenvio como gasto nuevo una sola vez) o bonificar (correccion de nota, reclasificacion 5100 a 5200). Entrada: recibe lo sano, lo perdido no entra a existencia, la diferencia se castiga/asigna con las funciones existentes. Avisos NT-080/081 por `operacion.avisar` (nada se envia sin token). `operacion.utilidad_periodo` envuelta para incluir el ajuste; Explicar `paquete:valor|absorbe:<id>` con dos vias; `omar.mis_paquetes` muestra estado `incidente` sin dinero. Pantallas en por-hacer y en-trayecto (dialogos, tabla con totales); allow-list de explicar ampliada. Tambien corregido un bug de la base de rediseno: `.rtm-region {display: contents}` rompia el armazon de todas las paginas.

## Comandos y resultados reales (verificados tras `supabase db reset --local`, que aplica las 44 migraciones desde cero incluida la mia)
- `supabase test db supabase/tests/database/028_paquete_perdido.test.sql`: 82/82 OK.
- `supabase test db` completo en base limpia: 47 archivos, 2,288 pruebas; unico fallo `024_omar_cuenta_sin_folio` test 13 (ajuste de -60.00, obtuvo -100.00). Verificado que es ANTERIOR al carril: con mi migracion retirada y la base reiniciada falla igual (mismo valor). No lo toque. (018 actualizado de 125 a 127 tipos de aviso.) Con la base contaminada por e2e fallan ademas 903, 906 y a3_001: efecto de datos de otras corridas, no del carril (en base limpia pasan).
- vitest completo: 114 archivos, 1,723 pasaron (+2 esperadas como fallo). Nuevos: `dialogos-incidente.test.tsx` (7) y `paquetes-incidente.test.tsx` (2).
- `tsc --noEmit`, `npm run lint`, `npm run guardas` (0 violaciones), `npm run secretos` (0 hallazgos): limpios. `next build`: OK.
- e2e laptop 1440 tras base limpia: `paquete-perdido.spec.ts` 2/2 y `f2.spec.ts` 4/4 OK (el fallo de saldo_puente era contaminacion de mis capturas, confirmado). `f3b-inventario.spec.ts` 10 OK en la corrida previa. e2e movil (iphone-16-pro, fold-cerrado, fold-abierto) 6/6 OK, sin desborde horizontal.
- Capturas en `docs/capturas/paquete-perdido/` (1440 y 390, claro y oscuro: por-hacer, en-trayecto, mi-bodega/paquetes). Revisadas: 1440 claro por-hacer, 1440 claro y oscuro en-trayecto, 390 oscuro de Omar. Defectos vistos y corregidos antes de la captura final: fila de totales desalineada (id de columna repetido) y placeholder del buscador de entradas. La pagina por-hacer en 390 queda larga (tarjetas por fila) pero sin desborde.

## Hallazgos fuera del carril
- Base `rediseno/premium` 6b5e269: `.rtm-region { display: contents }` en premium.css rompia el armazon de TODAS las paginas (panel bajo el sidebar). Corregido en un commit aparte (acotado a `.rtm-panel-scroll .rtm-region`, el uso de proveedores/inventario). Confirmar al integrar.
- `utilidad_periodo` (cascada) ya no recogia mermas ni castigos de inventario (ver `990_pendientes_de_correccion`, GD-07): este carril solo incorpora sus propias perdidas de paquete; mermas por conteo siguen fuera.
- Conflictos probables al integrar: `018_f3b_notificaciones` (conteo de tipos), y las cadenas rename+wrapper de `api.explicar_cifra` y `operacion.utilidad_periodo` si otro carril las envuelve; migracion con prefijo 20261112400000 (posterior a 20261112300000).

## Pendientes reales
- Renta de Omar de una reposicion: no se devenga (parametro del dueño sin definir).
- Pedidos directos del proveedor (karen/isaac directo): el reporte se rechaza con mensaje; el reclamo se hace por la cuenta con el proveedor.
- Reasignar el responsable de una SALIDA ya resuelta no existe (en ENTRADA se reasigna con las funciones de la compra y la lectura muestra el vigente); anular una resolucion de salida requiere contramovimientos manuales.
- Reclamo a la paqueteria como activo propio: no hay cuenta, se modela como sociedad, socio o proveedor.
- Incidente de entrada tras una recepcion ya confirmada: se resuelve desde la pantalla de la compra (diferencias); este flujo solo reporta antes de recibir.
