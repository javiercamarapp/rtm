# Inventario actual de proveedores (clave `proveedores-scraper`)

Lectura horaria del catálogo de datos de Karen (alias Vapemate), detección de cambios y de promociones, avisos y lista de disponibilidad para clientes. En pantalla y en Telegram el nombre es solo "Inventario actual de proveedores", sección "Inventario de Karen". La página de origen no figura en código, textos, registros ni documentos: vive únicamente en la variable de entorno privada `INVENTARIO_PROVEEDORES_FUENTE` (más `INVENTARIO_PROVEEDORES_CONTACTO` opcional para el agente de usuario).

Rama: `lane/proveedores-scraper`. Sin migraciones: el esquema que hace falta está en `proveedores-scraper-necesita-db.md`. Mientras tanto todo corre contra puertos con implementaciones en memoria.

## Qué se construyó

| Capa | Archivo | Contenido |
|---|---|---|
| dominio | `src/dominio/proveedores/tipos.ts` | Estado vigente, candidatos, eventos, solicitudes de aviso. Ids como texto. |
| dominio | `catalogo_json.ts` | Parser con lista blanca (descarta precios y precio de comparación en memoria), clasificador de respuesta (403, 429, captcha, página de edad, no JSON). |
| dominio | `normalizador.ts` | Limpieza ("60,000" = "60k", "ELFBAR" = "Elf Bar"), alias de modelo (un alias puede apuntar a un grupo, "Waka 50"), sabores con alias confirmados y similitud de trigramas (>= 0.9 vincula solo; 0.6 a 0.9 va a la cola), cola de confirmación, marca y puffs derivados del título. |
| dominio | `validacion.ts` | Caída de variantes > 30 % o cambio de disponibilidad > 50 %: lectura sospechosa. |
| dominio | `detector.ts` | Candidato -> confirmado en una lectura válida posterior; carga inicial silenciosa; nuevo, sabor nuevo, agotado, regreso, renombrado, descontinuado (3 lecturas y 24 horas), modelo agotado, inestable (3 cambios en 24 h), retención y decisión "Es real" o "Ignorar". |
| dominio | `variedad.ts` | Señal derivada "poca variedad" (V-1). No existe "quedan N piezas". |
| dominio | `promociones_html.ts`, `promociones.ts` | Insignias "N % de descuento", campañas con cuenta regresiva o nombre de oferta, estados candidata, activa, anunciada, terminada; plantilla rota se descarta. |
| dominio | `avisos.ts` | Eventos a solicitudes de aviso (P-01 a P-12, P-17 a P-20 y V-1), agrupadas por lectura y por modelo, y su redacción sin emojis. |
| dominio | `salud.ts`, `fuente.ts`, `politica.ts` | Latido, fallos, incidentes P-17 (una vez y recordatorio a las 6 h), presupuesto de 40 peticiones al día, agente de usuario honesto, robots.txt, claves de lectura. |
| dominio | `lista_cliente.ts` | `DISPONIBLE <MARCA> (fecha y hora)`; sin emojis ni caladas por defecto; opción con precios del tabulador del cliente; nunca costos. |
| dominio | `privacidad.ts` | `exigirSinImportes` y `contieneDireccion`: guardas antes de persistir y de entregar texto. |
| aplicación | `src/aplicacion/proveedores/puertos.ts` | Puertos: lectura inyectable, repositorio, contexto de negocio, avisos, datos de lista. |
| aplicación | `ciclo.ts` | `ejecutarLecturaHoraria`, `ejecutarConfirmacion`, `ejecutarLecturaPromociones`, `verificarRobots`, `decidirLecturaRetenida`, `reanudarLectura`. |
| aplicación | `lista.ts` | `prepararListaParaCliente`. |
| infra | `src/infra/proveedores/lector_http.ts` | Lector HTTP: pausa de 3 s, sin sesión ni cookies, errores de red sin dirección. |
| infra | `src/infra/proveedores/memoria.ts` | Repositorio y avisos en memoria (pruebas y desarrollo). |

## Reglas que el código hace cumplir

- **La carga inicial es silenciosa.** La primera lectura válida fija la base: cero eventos y cero avisos.
- **Todo cambio nace candidato.** Se confirma al verse en una lectura válida posterior (la de confirmación a los 10 minutos o la siguiente). Un parpadeo no avisa.
- **Catálogo vacío, formato nuevo y caída anómala se rechazan.** No generan eventos, no marcan nada como descontinuado, conservan el último estado bueno y avisan (P-17 una vez por incidente con recordatorio a las 6 horas; P-18 para la retención). Un bloqueo (403, 429, captcha) detiene la fuente hasta que un socio la reanude.
- **Ningún importe se persiste.** El parser construye objetos campo por campo; `exigirSinImportes` revisa estado, eventos y avisos antes de guardar. De las promociones solo se guarda bandera, tipo, porcentaje entero, modelos, fechas y una etiqueta corta redactada por el sistema.
- **La lista para clientes no recibe costos** (la función no tiene dónde ponerlos) **ni la dirección de origen** (se rechaza cualquier texto con forma de dirección). Se bloquea con dato de más de 3 horas.
- **Límite de peticiones:** 40 al día en total (24 catálogo, 6 confirmaciones, 8 inicio, 2 colecciones; robots.txt dentro del tope). Pausa de 3 s, agente de usuario honesto, sin rotar IP.
- **IA: cero en la ruta normal.** El modelo de IA nunca calcula dinero. El agente prepara el texto de la lista; nunca lo envía a clientes.

## Cómo integrarlo

1. Programar con cron en America/Merida (sin builds de Vercel): `ejecutarLecturaHoraria` cada hora; si devuelve `programarConfirmacionEn`, una sola `ejecutarConfirmacion` en ese instante; `ejecutarLecturaPromociones` cada 3 horas; `verificarRobots` una vez por semana. Cada función es idempotente por clave `fuente|fecha|hora`.
2. Cablear los puertos de `src/aplicacion/proveedores/puertos.ts`: `PuertoLecturaProveedor` con `lectorDesdeEntorno()`, el repositorio con Postgres, `PuertoContextoNegocio` con el catálogo propio y las ventas, y `PuertoAvisos` con `notificacion.emitir` (idempotente por `claveDedupe`). Los avisos salen antes de guardar el estado para que un reintento no pierda ninguno.
3. Los botones del aviso P-18 llaman a `decidirLecturaRetenida(deps, 'es_real' | 'ignorar')`; el recordatorio de bloqueo usa `reanudarLectura`.
4. La pantalla "Copiar lista para cliente" usa `prepararListaParaCliente`; si devuelve `bloqueada`, muestra la advertencia en lugar del texto.
5. La cola de confirmación (`estado.cola`) se resuelve con `confirmarPar` y `descartarPar` del normalizador.

## Avisos que quedan para otros módulos

P-13 a P-16 (stock propio) dependen del semáforo de cobertura de Inventario y no se tocan aquí. Los avisos P-03 y P-04 no se resuelven solos al llegar P-05: la capa de notificaciones decide esa regla; este módulo solo informa `resueltos` para V-1, P-09 (promoción terminada) y los P-08 que se editan por clave. P-11 lleva `condicion: existencia_propia_baja` para que el módulo de notificaciones lo filtre contra el inventario propio.

## Pruebas

`test/unit/proveedores/*.test.ts` (8 archivos): parser, normalizador, detector, promociones, fuente y avisos, lista, ciclo de punta a punta, lector HTTP y variedad. Incluyen pruebas de propiedades (parser sin precios, normalización idempotente, similitud simétrica, convergencia del detector, tope de 40 peticiones, precio de la lista igual al tabulador). Los fixtures son sintéticos y la dirección de prueba es inventada e inválida.

Cobertura de líneas del módulo: ver el informe de entrega.
