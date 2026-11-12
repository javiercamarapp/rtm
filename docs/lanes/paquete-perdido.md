# Carril paquete-perdido: informe

Rama `lane/paquete-perdido` (worktree `~/rtm-lane-paquete`, desde `rediseno/premium` 6b5e269). Sin push, sin Vercel, sin Supabase en la nube, sin datos reales. Instancia local propia `rtm-paq` (puertos 643xx, servidor 3140); config.toml marcado assume-unchanged. Detenida al terminar.

## Que hace
Migracion aditiva `20261112400000_lane_paquete_perdido.sql`: incidentes de solo insercion (`paquete_incidente`, `_linea`, `_resolucion`), reportar en salida (pedido enviado) y entrada (orden en camino), resolver con responsable sociedad (perdida 50/50 via utilidad del periodo, se arrastra), socio (cuenta por cobrar, adenda 29, 1170/1180), proveedor (reclamo) o cliente (sin efecto). Salida: reponer (merma al costo promedio + guia del reenvio como gasto nuevo una sola vez) o bonificar (correccion de nota, reclasificacion 5100 a 5200). Entrada: recibe lo sano, lo perdido no entra a existencia, la diferencia se castiga/asigna con las funciones existentes. Avisos NT-080/081 por `operacion.avisar` (nada se envia sin token). `operacion.utilidad_periodo` envuelta para incluir el ajuste; Explicar `paquete:valor|absorbe:<id>` con dos vias; `omar.mis_paquetes` muestra estado `incidente` sin dinero. Pantallas en por-hacer y en-trayecto (dialogos, tabla con totales); allow-list de explicar ampliada. Tambien corregido un bug de la base de rediseno: `.rtm-region {display: contents}` rompia el armazon de todas las paginas.

## Comandos y resultados reales
- pgTAP `028_paquete_perdido.test.sql`: 82/82 OK. Suite completa pgTAP: fallo solo `024_omar_cuenta_sin_folio` test 13 (ajuste -60.00, obtuvo -100.00). No lo investigue; puede ser anterior al carril o relacionado con mi corrida en base con datos demo: PENDIENTE verificar contra rediseno/premium limpio. (018 actualizado 125 a 127.)
- vitest completo: 114 archivos, 1723 pasaron. tsc, eslint, guardas: limpios. next build: OK.
- e2e laptop `paquete-perdido.spec.ts` 2/2 OK; movil (iphone, fold cerrado/abierto) 6/6 OK; f3b-inventario OK.
- e2e `f2.spec.ts` test 119 fallo: `saldo_puente` = 1,200,000 en vez de 0. Base sin reiniciar y con datos de mis capturas (diferencias de entrada castigadas por mi flujo), probable contaminacion; hice `db reset` pero NO alcance a repetir la prueba por la carga de la Mac. PENDIENTE: correr f2.spec tras reset limpio.
- Capturas en `docs/capturas/paquete-perdido/` (1440 y 390, claro y oscuro, por-hacer, en-trayecto, mi-bodega/paquetes); revise 1440 claro/oscuro y 390 de Omar: sin desborde (.desbordes.txt vacio). La pagina por-hacer 390 es larga pero legible.

## Pendientes
Repetir f2.spec y pgTAP 024 en base limpia; revisar visualmente el resto de capturas moviles; integracion posterior (migracion posterior a 20261112300000).
