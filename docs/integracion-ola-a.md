# Integracion de la Ola A

Fecha: 2026-11-10. Rama `main`, sin push. Las cinco ramas se fusionaron con `git merge --no-ff`, sin squash ni rebase, en este orden: `lane/costos-sistema`, `lane/graficas-animacion`, `lane/proveedores-scraper`, `lane/reportes`, `lane/agente-telegram`. Los worktrees de `.claude/worktrees` se conservan.

Fuente de las secciones por modulo: resultados de la Ola A (`necesita_db`, `desviaciones`, `pendientes` y la prueba de cada verificador), copiados sin reinterpretar. Estos documentos no pudieron escribirse dentro de las ramas; los de `docs/lanes/` si llegaron con cada merge y se citan en cada seccion.

## Resumen de la fusion

| Paso | Rama | Commits propios | Conflictos | Pruebas tras el merge (vitest) |
|---|---|---|---|---|
| 1 | costos-sistema | 6 | ninguno | 27 archivos, 308 pruebas |
| 2 | graficas-animacion | 6 | `package.json`, `package-lock.json`, `src/app/layout.tsx` | 31 archivos, 456 pruebas |
| 3 | proveedores-scraper | 5 | ninguno | 40 archivos, 684 pruebas |
| 4 | reportes | 12 (10 de codigo y 2 de documentacion) | ninguno | 50 archivos, 918 pruebas |
| 5 | agente-telegram | 6 | ninguno | 64 archivos, 1187 pruebas |

Despues de cada merge se ejecutaron typecheck, lint (con fronteras de capas), guardas estaticas (0 violaciones), escaner de secretos (0 hallazgos) y vitest sin Docker. Todo en verde.

### Resolucion del unico conflicto (merge 2)

- `package.json`: se conservaron ambos lados. `pdf-lib` y `pdfjs-dist` (de main, F2) mas `jsdom`, `axe-core` y `@vitest/coverage-v8` (de graficas) y el script `cobertura:graficas`.
- `src/app/layout.tsx`: se conservaron los dos imports de estilos, `operacion.css` y `graficas.css`.
- `package-lock.json`: se tomo el de main y se regenero con `npm install --package-lock-only`, luego `npm ci` local para que `node_modules` coincida. No se agrego ninguna dependencia fuera de las que declaraba graficas.

### Observaciones transversales

- Dependencias: `reportes`, `proveedores-scraper` y `agente-telegram` midieron cobertura con paquetes instalados `--no-save` o con un script propio; tras el merge `@vitest/coverage-v8` ya esta en `package.json` por graficas.
- Nota sobre reportes: su desviacion y su pendiente dicen que `docs/lanes/reportes.md` y `docs/lanes/reportes-necesita-db.md` fueron bloqueados; despues se escribieron en la rama y llegaron con el merge (existen en `docs/lanes/`). Ese pendiente queda cerrado. Si se intenta reproducir el PDF, el sha256 depende del mismo Chromium.
- Cuentas contables: costos usa 2320, 1150/1160, 6210-6240 y 1410; la spec 14 usa 2320 como "Guias por pagar a Javier". Hay que reconciliar con el plan de cuentas antes de escribir SQL.
- Cascada de reparto (adenda 21) y cuentas por cobrar (adenda 22) las necesitan costos (efecto del reembolso), reportes (pagina 10 del mensual) y agente; ningun modulo de la Ola A las implementa.
- Los cinco modulos corren hoy solo contra implementaciones en memoria. Ninguno toco base, Vercel, remotos ni valores reales. Builds de Vercel y despliegues provocados: 0.
- Ninguna de las cinco ramas incluye migraciones; el esquema que necesitan queda enumerado en cada seccion.

## Costos del sistema (lane/costos-sistema)

Commits: 6. Worktree: `/Users/javiercamaraportepetit/rtm/.claude/worktrees/wf_28fdc2da-a35-4`. Aprobado por el verificador: si; reparado: no; hallazgos abiertos: 0.

### Que aporta

Motor de costos de mantenimiento del sistema: cargo con techo unico en MXN (ceil_div, techo por fraccion exacta), tipo de cambio fechado de Banxico, conciliacion, prorrateo de Claude por proyecto, reembolso de la sociedad a Javier y resumen mensual. Script local `scripts/costos/prorratear-claude.mjs`.

### Contratos y puertos

Dominio `src/dominio/costos/*`; casos de uso y puertos `PuertoRepositorioCostos`, `PuertoTipoCambio` y `PuertoIds` en `src/aplicacion/costos/`; adaptadores `src/infra/costos/banxico.ts` (recibe `fetchFn` y `token` por parametro) y `repositorio_memoria.ts`. Detalle en `docs/lanes/costos-sistema.md`.

### Pruebas y cobertura (segun la rama)

Todo en verde:
- typecheck sin errores; lint sin errores.
- guardas: 0 violaciones.
- escaner de secretos: 0 hallazgos en 283 archivos y en el historial.
- npm test: Test Files 23 passed (23), Tests 271 passed (271).
- Las pruebas del modulo son 121 en 5 archivos (techo, dominio, aplicacion, prorratear_claude y el contrato sin flotantes). Las propiedades usan fast-check (500 casos en las de redondeo).
- No se corrio pgTAP, Playwright ni Docker (regla de la ola).

Cobertura: Con vitest --coverage v8 sobre el modulo: 99.75 % de lineas, 99.59 % de sentencias, 96.3 % de ramas, 100 % de funciones. Lo unico sin cubrir es la linea 239 del script (la guarda del arranque directo, que solo corre fuera de pruebas). La herramienta de cobertura se instalo con --no-save desde la cache local de npm, sin red; package.json y package-lock.json no cambiaron.

### Necesita base de datos (necesita_db)

- Esquemas costos e ia; funciones costos.ceil_div, costos.techo(num, den, paso) y costos.techo_pct_fraccion, gemelas de techo.ts con prueba de paridad.
- Tablas costos.servicio (con cuota_documento_orig_micro), tipo_cambio, cargo, reembolso, lectura_api, dato_faltante, conciliacion, presupuesto, parametro y claude_uso_mes, mas ia.llamada. Detalle completo de columnas, CHECK, UNIQUE y triggers en docs/lanes/costos-sistema-necesita-db.md.
- Columnas clave de costos.cargo: base_orig_micro, exacto_mxn_e6, exacto_puro_mxn_e6, monto_cent, como_seria_cent, como_deberia_cent, reversa_de y clave_idem UNIQUE. Con CHECK de monto >= techo del exacto, monto multiplo de 100 y confirmado exige evidencia.
- costos.reembolso solo insercion, con clave_idem UNIQUE y un trigger que valide que lo reembolsado no exceda lo cargado al socio.
- Tipos nuevos de operacion.evento y sus asientos en contabilidad.lineas_de_evento: costo_cargo_registrado, costo_cargo_anual, costo_devengo_mensual, costo_recarga_ia, costo_consumo_ia, reembolso_costos y costo_conciliado. Folios K y R sin huecos.
- Vistas api: v_costo_mes, v_costos_por_pagar y v_costos_resumen_mes. La cuenta por pagar debe cuadrar con cuenta_socios().
- Parametros: openrouter_incluir_comision, openrouter_comision_ppm=55000, conciliacion_tolerancia_ppm=20000, claude_proyectos_rtm, fecha_inicio_mantenimiento y otros.

### Desviaciones

- Choque 17 vs 20 punto 7 y 21: el reembolso es de la sociedad y se asienta Dr 2320 / Cr 1150|1160 (fondos de la sociedad). Se descarta el Dr 2320 / Cr 2310 y la vista v_costos_a_cargo_de_angelo del informe 17. Las mitades de Angelo y Javier (repartoMitades, techo) quedan solo como informacion del efecto sobre la utilidad, sin generar deuda.
- El caso 2 del informe 17 con 'reembolso de Angelo de 172' ya no aplica. Con la decision 20 el reembolso es de 344 y cancela la cuenta por pagar a Javier. Las cifras antes y despues de los tres cargos (344; mitad 172; Pos(J) 56,344.00; diferencia de 14,307.50 a 14,135.50) se reproducen. El efecto del reembolso sobre las posiciones depende de la cascada de la adenda 21 y no se implementa aqui.
- Un reembolso mayor a lo pendiente se rechaza con ErrorCostos('reembolso_invalido'). El informe 17 permitia dejarlo como saldo a favor de Angelo con aviso.
- La base se guarda en millonesimas de la moneda original (base_orig_micro), no en base_orig_cent, para que el libro de IA (usd_micro) no se redondee antes del unico techo en MXN. Unidades: pct en ppm, tc en micro, den 10^16.
- La spec mezcla bases de 'exacto': Supabase 235.875 usa el 17 % ya techado, mientras que Claude 651.20 usa el 17.6 % exacto, y asi se llega a 1,043.97. El motor guarda exactoMxnE6 (con el porcentaje techado) y exactoPuroMxnE6 (con el exacto). La prueba reproduce 1,043.97 como operar.exactoE6 + claude.exactoPuro, y la diferencia de 18.03 (18.0265 techada).
- Con la regla del mayor (decision 20) Vercel se cobra por la cuota del documento. Por eso el 'Vercel 30' del caso 1 del informe 17, que viene de la participacion de 5 %, se reproduce con atribucion 'participacion', y la regla del mayor se prueba aparte.
- La participacion de Claude usa la metrica entrada + salida + escritura de cache. El JSON trae tres metricas por la decision 20 (7.7 % principal, 12.3 % solo salida, 4.4 % con lectura de cache). Se calcula el techo al punto con la fraccion exacta (techoPctDeFraccion), no con un ppm truncado.
- El script es .mjs standalone (duplica ceilDiv) y una prueba de paridad por propiedad lo compara con el del dominio. El nombre difiere de la spec (scripts/claude-uso-mensual.py): se usa scripts/costos/prorratear-claude.mjs, como pidio la tarea.
- Fuera del alcance de esta ola, no implementados (necesitan llaves, red o base): lectores de Vercel y de /key de OpenRouter, crones, topes y reservas de IA (spec 17, seccion 6), componente LogoMarca y paginas /costos.
- La prueba 'sin number con decimales ni float' es un contrato en test/contratos (el lint no la cubre); no se edito scripts/ci/guardas.mjs por ser de otra area.

### Pendientes

- Cablear src/composicion/costos.ts con el repositorio Postgres y el token de Banxico leido del almacen de secretos del servidor. Hoy solo existe la implementacion en memoria.
- Lectores de Vercel (/v1/billing/charges) y de OpenRouter (/key y /credits), y los crones de actualizacion mensual.
- Topes y reservas de IA (spec 17, seccion 6).
- Paginas /costos con 'Explicar este número' y las dos columnas 'como seria' / 'como deberia ser', componente LogoMarca con su prueba de integridad, y pruebas axe cuando existan las pantallas.
- Reconciliar los codigos de cuenta (6210-6240, 1410, 2320, 1150/1160) con el plan de cuentas; 2320 hoy es 'Guias por pagar a Javier' en la spec 14.
- Efecto del reembolso sobre las posiciones de los socios: depende de la cascada de reparto (adenda 21, otro modulo). Falta definir de que cuenta de fondos sale el pago.
- Confirmar con Javier la lista de proyectos de Claude: el patron por omision es la carpeta -Users-javiercamaraportepetit-rtm (incluye worktrees). El script no se corrio sobre transcripciones reales, solo sinteticas.
- Builds de Vercel provocados: 0. Despliegues: 0. Sin push, sin remotos, sin Docker ni Supabase, sin red.

## Graficas y animacion (lane/graficas-animacion)

Commits: 6. Worktree: `/Users/javiercamaraportepetit/rtm/.claude/worktrees/wf_28fdc2da-a35-5`. Aprobado por el verificador: si; reparado: no; hallazgos abiertos: 0.

### Que aporta

Biblioteca de 15 graficas SVG propias y movimiento (barras con delta, linea con proyeccion, cascada, Pareto, mapa de calor, burbujas, treemap, radar, bump, sparkline, antiguedad de saldos, cobertura en dias, tarjeta de insight, contador, procedencia) con tabla alterna, estados y sin dependencias de graficas. Catalogo en `/diseno/graficas` con datos ilustrativos.

### Contratos y puertos

Componentes de cliente que reciben solo datos serializables y textos de cifras ya formateados (`src/ui/graficas/index.ts` es el barril); estilos en `src/ui/estilos/graficas.css` (solo tokens); `src/ui/movimiento/cliente.ts`. Detalle en `docs/lanes/graficas-animacion.md`.

### Pruebas y cobertura (segun la rama)

npm test: Test Files 22 passed (22), Tests 298 passed (298). Lint, typecheck, guardas (0 violaciones) y escaner de secretos (0 hallazgos en 290 archivos) en verde. Criterios con prueba automatizada: axe 0 violaciones (listo, cargando, error, muestra insuficiente y catalogo completo; una prueba confirma que axe si detecta fallos); reducido y apagado dan HTML final identico al modo completo salvo data-anim, sin animacion; toda animacion del CSS esta bajo data-anim="on" y solo anima transform, opacity y stroke-dashoffset; cada grafica tiene su tabla alterna con los mismos datos; ninguna depende solo del color (tramas, formas, palabras, contraste de tokens de 3:1 en marcas y 4,5:1 en texto, en ambos temas); teclado; propiedades con fast-check para cascada, Pareto, treemap, calor y apiladas.

Cobertura: npm run cobertura:graficas, modulo src/ui/graficas y src/ui/movimiento (sin barras.tsx ni linea.tsx de F1): lineas 99.82%, sentencias 99.26%, ramas 94%, funciones 98.63%. Umbrales fijados en vitest.config.mts: 90% lineas, sentencias y funciones; 85% ramas.

### Necesita base de datos (necesita_db)

- Ninguna.

### Desviaciones

- CHOQUE spec vs adenda 22: la spec de 10a daba tramos de antiguedad 0-7, 8-30, 31-60 y mas de 60 dias; manda la adenda 22 (0 a 7, 8 a 14, 15 a 30, mas de 30 dias). Es el valor por omision y se puede sustituir por prop.
- Movimiento reducido: la spec (14 y 10a) dice fundido lineal de 120 ms; el criterio de este modulo exige no animacion. Las graficas no animan nada en reducido ni apagado. El fundido de 120 ms de F0 sigue en .rtm-entra y en el cajon y el dialogo.
- Radar y burbujas se construyeron aunque 11a proponia 12 tipos distintos (sin radar, bump ni treemap): se siguio la lista de 12 tipos de la tarea. Radar limitado a 8 ejes y 2 series, siempre con tabla.
- Ranking del bump, clasificacion de burbujas y estados de cobertura los recibe ya decididos del servidor; la UI no calcula negocio ni dinero. Los textos de cifras llegan preformateados; valor numerico solo para geometria.
- Axe corre en jsdom con la regla color-contrast desactivada (jsdom no calcula estilos); el contraste se valida contra tokens.css en claro y oscuro, no sobre pixeles renderizados.
- No se implementaron: reorden con resorte A11, tooltip sincronizado A14, clic o Enter que filtra la pagina por URL, y Guardar como imagen. Dependen de estado de pagina y del shell.
- Cambios fuera de src/ui/graficas, minimos y necesarios: una linea en src/app/layout.tsx (import de graficas.css), bloque coverage en vitest.config.mts, script cobertura:graficas en package.json, y devDependencies jsdom, axe-core y @vitest/coverage-v8 (con package-lock). Se anadio src/ui/movimiento/cliente.ts sin tocar index.ts.
- En pantallas angostas el SVG conserva un ancho minimo de 480 px con scroll interno; la alternativa movil es la tabla alterna. Las filas de barras, apiladas y cobertura si se reacomodan a una columna.

### Pendientes

- Revision visual en navegador (Chromium y WebKit, claro y oscuro, lila y neutro, 1440 y 402): no se levanto servidor ni Playwright en esta ola; solo se verifico por jsdom y analisis estatico.
- Contraste real de texto sobre rellenos suaves y celdas del mapa de calor (nivel 3 y 4 con texto inverso) con axe en navegador.
- Validacion CIEDE2000 de la paleta de datos y revision con herramienta externa (pendiente desde 10a).
- Enlace a /diseno/graficas en el menu lateral (shell es de otra area).
- Migrar GraficaBarras y GraficaLinea de F1 a BarrasDelta y LineaProyeccion (opcional, paginas de inventario, catalogo y cliente).
- Verificar JS de la ruta /omar: este modulo no debe importarse alli.
- Integrar clic y teclado Enter para filtrar la pagina por URL cuando existan las paginas de F3 en adelante.
- No hubo push ni Vercel: 0 builds y 0 despliegues provocados.

## Proveedores y scraper (lane/proveedores-scraper)

Commits: 5. Worktree: `/Users/javiercamaraportepetit/rtm/.claude/worktrees/wf_28fdc2da-a35-3`. Aprobado por el verificador: si; reparado: no; hallazgos abiertos: 0.

### Que aporta

Inventario actual de proveedores: lector HTTP inyectable, validacion y normalizacion del catalogo, deteccion de cambios con confirmacion, promociones sin importes, variedad, salud de la fuente, lista para cliente sin nombrar al proveedor y avisos P-01 a P-20 y V-1.

### Contratos y puertos

Dominio `src/dominio/proveedores/*`; aplicacion `ciclo.ts`, `lista.ts` y puertos (`PuertoLecturaProveedor`, `RepositorioInventarioProveedor`, `PuertoContextoNegocio`, `PuertoAvisos`, `PuertoDatosLista`, `Reloj`); infra `lector_http.ts` y `memoria.ts`. Detalle en `docs/lanes/proveedores-scraper.md`.

### Pruebas y cobertura (segun la rama)

npm run lint, npm run guardas (0 violaciones), npm run secretos (0 hallazgos), npm run typecheck: todos verdes. npm test: Test Files 27 passed (27), Tests 378 passed (378); 224 de ellas en test/unit/proveedores (8 archivos, con pruebas de propiedades de fast-check). Los 5 criterios de aceptación tienen prueba automatizada (carga inicial sin avisos, parpadeo sin aviso, catálogo vacío y caída anómala rechazados con aviso, lista sin costos ni dirección, ningún importe persistido). Sin Docker, Supabase, Playwright ni red.

Cobertura: Módulo (src/{dominio,aplicacion,infra}/proveedores): líneas 99.44 % (1077/1083), sentencias 98.09 %, ramas 92.8 %, funciones 97.75 %. Medido con @vitest/coverage-v8 instalado con --no-save (no modifica package.json ni el lock).

### Necesita base de datos (necesita_db)

- Tablas proveedor_modelo, proveedor_variante, proveedor_candidato, proveedor_cola_confirmacion, proveedor_alias_sabor, proveedor_alias_modelo, proveedor_par_descartado, proveedor_retenida, proveedor_variedad y proveedor_variedad_dia, proveedor_promocion (sin ninguna columna de importe, precio o texto de mercadotecnia), proveedor_salud, proveedor_lectura (idempotencia por clave fuente|fecha|hora), proveedor_evento (solo cambios, clave única determinista), proveedor_foto_diaria (idempotente por día) y proveedor_presupuesto (tope de 40 con UPDATE condicional).
- Funciones SECURITY DEFINER proveedores.guardar_estado (transacción única, rechaza claves de importe), cargar_estado, presupuesto_tomar y lecturas STABLE para la pantalla; RLS solo socios, Omar sin acceso.
- notificacion.emitir idempotente por clave_dedupe y notificacion.resolver; tipos P-01 a P-12, P-17 a P-20 y V-1 registrados en notificacion.tipo.
- Del módulo de catálogo e inventario: modelos y sabores propios, alias confirmados (con grupos), definición de modelo y sabor activo para los socios, precioDeTabulador(clienteId, modeloCanonicoId) que devuelve solo el precio del cliente, y existenciaPropia().
- seguridad.interruptor: promociones_lectura (apagado hasta que el dueño autorice) y cron_pausado; cron en America/Merida (horario cada hora, promociones cada 3 h, robots semanal, confirmación a los 10 min con el instante que devuelve la lectura), sin builds de Vercel. Detalle completo en docs/lanes/proveedores-scraper-necesita-db.md.

### Desviaciones

- Choque entre el informe 05 (límite de 6 peticiones al día y 2 corridas) y la adenda 24 más 25b: mandan la adenda y 25b. Tope de 40 al día con desglose 24 catálogo, 6 confirmaciones, 8 inicio, 2 colecciones; robots.txt cuenta dentro del tope de 40 (1 al día máximo).
- Respaldo por producto (detalle .js) ante formato nuevo NO se invoca automáticamente: reconstruir el catálogo costaría ~48 peticiones y rompería el tope de 40. Ante formato nuevo se conserva el último estado bueno, se marca dato viejo y se avisa P-17 una vez por incidente; el plan alterno es la lista que manda Karen.
- Estados fuera de la lista del informe: los fallos de red avisan a la 3.ª lectura fallida seguida, pero bloqueo (403, 429, captcha, página de edad), catálogo vacío, formato nuevo y robots que prohíbe la ruta avisan de inmediato (el criterio de aceptación pide que el vacío se rechace y avise).
- Sabores inestables: el aviso individual se suprime a partir del cambio que completa 3 en 24 h (los dos primeros ya avisaron); GN-12 se puede leer como cero avisos individuales desde el inicio. Se documentó la interpretación.
- La lista combinada (existencia propia más disponibilidad del proveedor) etiqueta los renglones como ENTREGA INMEDIATA y POR PEDIDO en lugar de nombrar a Karen, para que la lista de cliente no revele al proveedor (adenda 28: sin proveedor en listas de cliente).
- La señal de poca variedad usa la mediana de los máximos diarios de 7 días (en lugar del último valor de cada día) y se evalúa sobre el estado vigente, que se retrasa una lectura por la confirmación; por eso V-1 necesita 3 lecturas desde el cambio en vez de 2.
- Modelos nuevos que resuelven por similitud (>= 0.6) nunca se vinculan solos al catálogo propio (siempre a la cola); solo los sabores con similitud >= 0.9 se vinculan automáticamente.
- P-11 (promoción por terminar) se emite sin filtrar por existencia propia baja: lleva condicion existencia_propia_baja para que el módulo de notificaciones lo filtre. P-03 y P-04 no se resuelven solos al llegar P-05 en este módulo.
- Cobertura medida con @vitest/coverage-v8 instalado con npm install --no-save (no existía en el repo); package.json y package-lock.json no se tocaron, así que el comando de cobertura no está en los scripts.
- Un mensaje de commit (8f4c2ea) quedó con la palabra 'cortes' mal escrita en el asunto ('lector HTTP cortes'); no se reescribió el historial.

### Pendientes

- Implementar el repositorio en Postgres y el cableado de composición una vez exista el esquema (hoy solo hay implementación en memoria).
- Cablear PuertoAvisos con notificacion.emitir y PuertoContextoNegocio/PuertoDatosLista con catálogo, ventas y tabulador reales; la pantalla Inventario actual de proveedores, el botón Copiar lista para cliente y la cola de confirmación (UI) no se construyeron (fuera del alcance de este módulo).
- Programar los crons en el hosting y definir la variable privada INVENTARIO_PROVEEDORES_FUENTE (y opcional INVENTARIO_PROVEEDORES_CONTACTO); no se tocó ningún valor real.
- Los fixtures HTML son sintéticos e imitan la estructura documentada; las clases CSS reales del tema podrían diferir: validar el parser de promociones con una lectura real autorizada (contrato) antes de activar promociones_lectura.
- Regla de aviso P-13 a P-16 (stock propio) y resolución automática de P-03 y P-04 pertenecen al módulo de notificaciones e inventario.
- Fuera de lo autorizado y no hecho: no hubo push, no se tocó Vercel ni remotos; 0 builds y 0 despliegues provocados.

## Reportes (lane/reportes)

Commits: 10. Worktree: `/Users/javiercamaraportepetit/rtm/.claude/worktrees/wf_28fdc2da-a35-1`. Aprobado por el verificador: si; reparado: si; hallazgos abiertos: 0.

### Que aporta

Motor de reportes tipo consultora: paquete de cifras con guardia de numeros (el LLM nunca calcula dinero), insights, proyecciones, puente entre periodos, paginas HTML/SVG en grises, PDF determinista con Chromium (mismo sha256 en dos corridas), versionado, entrega por Telegram y correo sin adjunto.

### Contratos y puertos

Dominio `src/dominio/reportes/*`; aplicacion `generar_reporte.ts`, `entrega.ts` y puertos `FuenteInsumos`, `RenderizadorPdf`, `RepositorioReportes`, `EntregaReportes`; infra `render_pdf_chromium.ts`, `posproceso_pdf.ts`, `fuentes_css.ts` y `memoria.ts`. Script de cobertura `scripts/ci/cobertura-reportes.mjs`. Detalle en `docs/lanes/reportes.md`.

### Pruebas y cobertura (segun la rama)

npx tsc --noEmit: OK. npx eslint src scripts test: OK (fronteras de capas incluidas). node scripts/ci/guardas.mjs: 'Guardas estaticas: 0 violaciones (baseline 0).' node scripts/ci/escaner-secretos.mjs: 'Escaner de secretos: 0 hallazgos en 301 archivos y en el historial'. npx vitest run (todo el repo): 'Test Files 28 passed (28)' y 'Tests 384 passed (384)'; el modulo de reportes aporta 234 pruebas en 10 archivos (test/unit/reportes). No se corrio 'npm run verificar' ni pgTAP ni Playwright e2e porque exigen Docker y Supabase, prohibidos en esta ola; la unica corrida de Chromium es la de test/unit/reportes/pdf_chromium.test.ts (5 pruebas secuenciales, 2.5 s).

Cobertura: 94.88 % de lineas del modulo (2781 de 2931 lineas, 22 archivos en src/dominio/reportes, src/aplicacion/reportes y src/infra/reportes), medido con 'node scripts/ci/cobertura-reportes.mjs' (cobertura precisa de V8 por node:inspector mapeada a las lineas de TypeScript con el mapa de fuentes; no hay @vitest/coverage-v8 ni red para instalarlo). La cifra es conservadora: cuenta la linea 1 de cada archivo como sin cubrir por un artefacto del mapeo del envoltorio de vite-node. Menor cobertura: render_pdf_chromium.ts 69.8 % (ramas de error al abrir Chromium), dominio/entrega.ts 87.3 %.

### Necesita base de datos (necesita_db)

- Esquema rep (solo insercion, trigger T1, escritura por funciones SECURITY DEFINER idempotentes con exigir_rol(['socio'])): rep.reporte(clave tipo:AAAA-MM-DD, version, folio, huella char(6), estado publicado|borrador, etiquetas text[], sha256_pdf, paquete jsonb, html_sha256, creado_at) con UNIQUE(clave, version) y PDF/HTML en almacenamiento privado por sha256; rep.entrega(reporte_id, canal telegram|correo, enviado_at, clave_idem) con UNIQUE(reporte_id, canal); rep.config con parametros vigentes (alfa, ventana, z, umbrales I01..I25, tope de plataforma). Funciones rep.versiones(clave), rep.guardar(reporte, pdf, html, clave_idem), rep.marcar_entrega(clave, version, canal), rep.pdf(clave, version): espejo del puerto RepositorioReportes (src/aplicacion/reportes/puertos.ts).
- Funciones STABLE rep.insumos_semanal(inicio date) y rep.insumos_mensual(inicio date) que devuelvan jsonb con la forma de InsumosSemanal e InsumosMensual (src/dominio/reportes/insumos.ts): pedidos confirmados con lineas (modelo, sabor, piezas, precio_cent, costo promedio al salir), origen bodega|directo, cobrado, guia, mensajeros, avisos, control de piezas C2 (salieron, cobradas, autorizadas), precio de tabulador y excepcion por linea; pedidos del periodo anterior; historia de 12 a 13 semanas y de clientes (pedidos con sabores y ritmo declarado con rango); inventario por modelo (existencia, transito, costo promedio, ventas semanales, contribucion por pieza y su mediana, dias sin venta, proveedor y costo de reposicion, lead time observado o declarado, piezas por caja, sabores con vendidas en 28 dias y dias agotado, cambio de costo registrado con clientes al mismo precio, semanas seguidas en Revisar); cartera por cliente; liquidacion del proveedor con lo que dice su hoja y cobros PROMETIDOS hasta el viernes; gastos; conteo; socios y Omar (posicion actual y anterior, renta, tomas, pagos, horas de toma pendiente); comparacion Isaac/Karen; flujo (saldo inicial, 8 semanas de cobros o cadencia declarada, prometidos, pagos programados, renta, gastos); plataforma (tope y gasto del mes). Mensual ademas: renglones del estado de resultados con signo y utilidad neta, costos del sistema (adendas 20 y 21), 24 meses de ventas, matriz cliente x sabor, ranking semanal de clientes, DSO y tendencia de cartera.
- contabilidad.comprobaciones(periodo) con C1 a C22 como {id, nombre, via1, via2, ok, unidad}; bloqueantes C3, C4, C5, C10, C11, C12. contabilidad.periodo.aprobado_en (DEFINITIVO vs PRELIMINAR) y banderas de datos incompletos (PARCIAL). negocio.hoy()/negocio.ahora() con reloj inyectado y corte del reporte (lunes 05:59 Merida = 11:59 UTC).
- Tareas programadas M2 (sin crearlas): semanal 0 12 * * 1; reintentos 0 14 * * 1 y 0 18 * * 1 solo si falta el reporte del periodo; mensual 15 12 1 * *; liquidacion con el proveedor 0 2 * * 6 verificando que negocio.hoy() sea viernes; candado de un PDF a la vez.
- Registro de chats: grupo_socios (Angelo, Javier y el bot; nunca el chat de Omar) y correos de los dos duenos desde configuracion privada (nunca del repo); enviar() debe rechazar cualquier otro destino.

### Desviaciones

- Documentos de lane NO creados: la escritura de docs/lanes/reportes.md y docs/lanes/reportes-necesita-db.md fue bloqueada por la herramienta ('Subagents should return findings as text, not write report files'); no se rodeo (regla 10). Su contenido esta aqui y en necesita_db.
- Numeracion de comprobaciones: 02 numera C3 como cuadre de asiento y C4 como balanza; 14 (sec. 12) y 16 (sec. 8) las unifican (C3 balanza, C4 auxiliares, C5 valuacion, C10 asientos, C11 periodo cerrado, C12 pedidos a libro). Mandan 14 y 16; lista en PARAMETROS.bloqueantes. Ademas toda comprobacion interna R.* (pedidos, puente, cifras por dos vias) es bloqueante.
- '14 de 14 comprobaciones': el conteo mostrado es solo de las contables; las internas R.* van en el anexo.
- Ventana del promedio movil: la tabla 4.2 dice 8 semanas y la maqueta C 12; se sigue la tabla. El rango de la demanda diaria (cobertura) no lo define la spec: se usa error estandar de la demanda semanal x 1.28.
- Colores: las guardas del repo prohiben hexadecimales fuera de tokens; los grises son rgb() en variables CSS --rep-g0 a --rep-g4 (solo grises, verificado por prueba).
- pdf-lib no se instalo (sin red para dependencias nuevas): el posproceso de fecha, /ID y producer son reemplazos de igual longitud sobre los bytes, probados; dos corridas de Chromium dan el mismo sha256.
- axe-core y jsdom no estan en node_modules ni en el cache de npm: se sustituyo por pruebas estructurales de accesibilidad del HTML y SVG (lang, title, role=img, aria-labelledby, desc, sin color, sin scripts). Falta axe real cuando haya vista previa web (M3).
- Pruebas de pixeles (spec 9.3) no hechas (requieren linea base); en su lugar el texto extraido del PDF con pdftotext se compara con el modelo y con la guardia.
- Version de Omar (spec 16 sec. 7) fuera del alcance listado: no construida; si estan finDeMesOmar y los bloqueantes propios C8 y C9 (PARAMETROS.bloqueantesOmar).
- Pagina 10 del mensual (caja y socios): trae flujo con saldo minimo, pero no el balance resumido, la cuenta entre socios ni el reparto 50/50, que dependen de la cascada de reparto (adenda 21) y de cuentas por cobrar (adenda 22), de otras lanes. Adenda 20 aplicada: costos de mantenimiento del sistema con cargo, como seria, como deberia ser, bolsillo, reembolsado y pendiente como lineas separadas.
- liq.fondos y liq.holgura se rotulan Calculado (no Estimado): los cobros esperados hasta el viernes son un insumo que contabilidad debe entregar como PROMETIDOS con fecha; el motor no estima nada sin muestra.
- Cobertura medida con script propio (cobertura precisa de V8) por no existir @vitest/coverage-v8; no se edito package.json ni vitest.config.mts (config aparte vitest.cobertura.config.mts).
- No hay vista previa web ni Excel opcional de cifras; la estacionalidad se emite solo como cifra de meses de historia (descriptiva) y no se aplica a proyecciones.

### Pendientes

- Crear docs/lanes/reportes.md y docs/lanes/reportes-necesita-db.md (bloqueados por la herramienta; contenido en desviaciones y necesita_db) o autorizar su escritura.
- Tablas rep.*, funciones de insumos y adaptadores de Postgres para FuenteInsumos, RepositorioReportes y EntregaReportes; hoy hay adaptadores en memoria (src/infra/reportes/memoria.ts).
- Cablear en composicion/ con RenderizadorChromium({fecha14 = cierre del periodo}) y cargarCssFuentes('src/fuentes'); decidir en M3 donde corre Chromium en produccion (job fuera de Vercel o funcion con Chromium empaquetado) y consultar costo antes de cualquier despliegue.
- Version de Omar (spec 16 sec. 7) con lista blanca de campos y 50 corridas sinteticas; integrar cascada de reparto (adenda 21) y cuentas por cobrar (adenda 22) en las paginas de socios y caja del mensual.
- Linea base de pixeles por maquina, axe real sobre la vista previa web y modo sombra de una semana (M3); redaccion opcional con IA bajo la guardia (el modelo nunca calcula dinero).
- Recalibrar los umbrales [CAL] con 8 a 12 semanas de datos reales; costos de Karen (los agrega Javier) y remision de Isaac por sabor (puente de 12 piezas).
- Builds de Vercel: 0 y despliegues: 0; sin push, sin remotos. Las 10 commits quedan solo locales en lane/reportes.

## Agente de Telegram (lane/agente-telegram)

Commits: 6. Worktree: `/Users/javiercamaraportepetit/rtm/.claude/worktrees/wf_28fdc2da-a35-2`. Aprobado por el verificador: si; reparado: no; hallazgos abiertos: 0.

### Que aporta

Nucleo del agente de Telegram: webhook, flujo de un update, resolucion de intenciones, eco, comprobacion y boton Deshacer, preguntas con botones de un solo uso, tomas de Omar pendientes de autorizacion, politica de modelos con techo de precio, presupuesto de IA con reserva, guardia de cifras de salida y simulador (`src/composicion/simulador_agente.ts`).

### Contratos y puertos

Dominio `src/dominio/agente/*`; aplicacion `agente.ts` y puertos `AlmacenAgente`, `AlmacenPresupuesto`, `AlmacenTokens`, `CatalogoAgente`, `ClienteLlm`, `EnviadorTelegram` y `NegocioAgente`; infra `telegram_webhook.ts`, `telegram_api.ts`, `openrouter.ts`, `memoria.ts`, `negocio_simulado.ts`, `llm_simulado.ts`; composicion `src/composicion/agente.ts`. Detalle en `docs/lanes/agente-telegram.md`.

### Pruebas y cobertura (segun la rama)

npm run typecheck: sin errores. npm run lint: sin errores. npm run guardas: "Guardas estaticas: 0 violaciones (baseline 0)". npm run secretos: "Escaner de secretos: 0 hallazgos en 304 archivos y en el historial (lista privada local comprobada)". npm test (suite completa del repo): "Test Files 32 passed (32) / Tests 419 passed (419)". Modulo del agente: 13 archivos de prueba y 262 pruebas, con propiedades fast-check para cifras, presupuesto, contramovimiento, resolucion de alias y privacidad de los mensajes a Omar. Aceptacion: mismo mensaje dos veces (agente.idempotencia.test.ts); Omar a secas y Waka 50 (agente.ambiguedad.test.ts, resolutor.test.ts); toma pendiente hasta autorizar (agente.omar.test.ts); ninguna cifra ajena al servidor (agente.guardias.test.ts, cifras.test.ts); reserva antes de llamar y corte al tope (agente.presupuesto.test.ts, politica.test.ts); modo sin IA con comandos (agente.presupuesto.test.ts, comandos.test.ts). No se corrieron pruebas de base de datos, Playwright ni servidores.

Cobertura: Modulo del agente (dominio, aplicacion e infra del agente, composicion/agente.ts y simulador_agente.ts): lineas 98.48 %, sentencias 96.76 %, ramas 90.37 %, funciones 98.78 %. Medido con @vitest/coverage-v8 instalado con npm install --no-save, sin tocar package.json ni package-lock.json.

### Necesita base de datos (necesita_db)

- Esquema agente: miembro(telegram_user_id, persona, rol, activo); chat_registrado(destino, chat_id); tg_update(update_id) y tg_mensaje(chat_id, message_id) con INSERT ON CONFLICT DO NOTHING; estado (modo sin IA, motivo, avisado); llm_corrida(clave, resultado jsonb, modelo, tokens, costo_micro_usd); ia_presupuesto e ia_reserva (reserva, liquidacion y liberacion idempotentes por clave, con la misma logica que presupuesto.ts); tg_token (callback_data de maximo 64 bytes, accion, roles, chat, caducidad, grupo_exclusivo, usado_at, payload); evento (sin texto de usuarios); contador_no_procesado.
- Funciones SECURITY DEFINER idempotentes por p_clave_idem (contrato NegocioAgente): registrar_pedido, registrar_pago, registrar_pago_proveedor, registrar_gasto, registrar_aportacion, registrar_compra, generar_orden_compra (costo vigente, saldo a favor primero, cuenta negativa si hay credito, Karen solo confirma con pago completo), registrar_toma_omar (reserva activa, sin kardex ni saldo), autorizar_toma, caducar_tomas, localizar_para_deshacer, dependencias_de, deshacer (contramovimiento con corrige_folio).
- Consultas STABLE para existencia por modelo y sabor, saldos (cliente, Omar, proveedor, socios), precio del tabulador, pendientes y resumen. El agente no calcula ninguna cifra.
- Las preguntas del servidor (precio_fuera_tabulador, bajo_costo, existencia_insuficiente, menos_de_20_piezas, modelo_fuera_de_catalogo, monto_parecido_a_saldo, baja_confianza, falta_destino) se resuelven en la funcion cuando confirmado = false.
- Prueba de paridad por propiedad (500 casos) entre las funciones SQL de presupuesto y el oraculo de presupuesto.ts.
- Detalle completo en docs/lanes/agente-telegram-necesita-db.md.

### Desviaciones

- Se ejecuta con eco, comprobacion y boton Deshacer en vez de tarjeta con Confirmar (el documento 04 propone confirmar toda escritura). Mandan la spec 14 sec. 12 y la adenda 23 (sin segundo si). Solo se pregunta ante duda, y esas preguntas las decide el servidor.
- Ventana de deshacer de 10 minutos (spec 14 y 26), no 15 como dice el documento 04.
- Se elimina el escalamiento a Sonnet (politica 19). Los US$0.15 diarios de ese rol pasan al rol de texto: texto 0.55, vision 0.25, audio 0.05, redaccion 0.10, resumen 0.05 reservado.
- La toma de Omar no se auto-registra (el 04 lo proponia): queda pendiente hasta que un socio autorice (spec 14 sec. 12 y spec 26). Una toma escrita por un socio tambien queda pendiente.
- Rol de Omar 'omar' en vez de 'bodega' (spec 26). Botones con tokens de un solo uso (AlmacenTokens, spec 26 sec. 5) en vez de c:<id>:<v>. El estado de la accion en curso viaja en el token, no en el callback_data.
- Las citas literales del mensaje del socio dentro de una pregunta se registran como procedencia del usuario en la guardia de cifras de salida. Es la unica cifra no calculada por el servidor que puede aparecer.
- Los slugs de modelo son los de referencia de la politica 19, no slugs fechados. Hay que fijarlos al correr la prueba de modelos. La lista blanca de endpoints de EE.UU. para DeepSeek se inyecta por configuracion; sin ella, el modelo chino se omite. El costo de Whisper (30 micro-USD por segundo) es un supuesto conservador hasta medir.
- El nombre de la pagina de origen del scraper no aparece en codigo, pruebas ni docs de este modulo (lo verifica una prueba). Las pruebas usan 'Proveedor Ajeno' para el caso de proveedor desconocido. docs/F1-informe.md ya existente si lo menciona y no se toco.
- No se modifico package.json ni package-lock.json (ni se agrego script npm). El simulador se corre con npx tsx. La cobertura se midio con un paquete instalado con --no-save.

### Pendientes

- Lectura de fotos (rol de vision con segunda lectura) y transcripcion de audios: el router, la politica y compararLecturas existen, pero no hay lector conectado. Hoy fotos y audios quedan 'sin leer'.
- Cola por chat con arrendamiento, debounce de mensajes cortos y albumes, y completarUpdate con lease. Un fallo despues del reclamo pierde ese mensaje: se avisa al grupo y se registra el evento.
- Limite de 40 llamadas al modelo por hora y por usuario, e interruptor de circuito (3 fallos en 2 minutos).
- Comandos /tope, /anular <folio>, /explicar con cadena de movimientos y /procesar; boton 'Ver mas' y orden de candidatos por frecuencia de uso.
- Resumen de las 8 pm y avisos (los envia la ola de notificaciones; aqui solo se reserva su presupuesto).
- Manejo de migrate_to_chat_id, guardia horaria de membresia (getChatMemberCount), coincidencia difusa de transferencias duplicadas y unicidad (cuenta_destino, clave_rastreo).
- Reintentos y outbox de envio a Telegram (ola de entrega y revision; ErrorTelegram ya expone rate_limit con retry_after).
- Ruta app/api/telegram/webhook y composicion de produccion: se hacen cuando las olas de base de datos entreguen los puertos reales. manejarWebhook ya esta listo para conectarla.
- Fijar slugs fechados y la lista de endpoints de EE.UU. con retencion cero de DeepSeek tras la prueba de modelos (hasta US$5 con unas 70 muestras etiquetadas).
