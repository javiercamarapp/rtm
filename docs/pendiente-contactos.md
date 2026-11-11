# Contactos de menudeo: lo que falta para aplicar y cargar

Estado: código, migración y prueba pgTAP escritos en la rama `feat/contactos-menudeo`. Nada se ha aplicado ni cargado en ninguna base. No se tocó Vercel, Supabase en la nube ni `~/.bodega-secrets`.

Regla del dueño (11-nov): todos los números de las bases (Toocloudy, Vapeunion, contactos de Google) y de Meta son de Javier y de menudeo. Se segmenta solo por origen; la interfaz no filtra por Angelo o Javier; la IA nunca ve teléfonos; el correo se guarda solo si existe; sin duplicados; Omar nunca ve esto.

## Piezas

- Dominio puro: `src/dominio/contactos/` (`telefono.ts`, `csv.ts`, `leer.ts`, `consolidar.ts`, `vista.ts`, `tipos.ts`).
- Script de importación (solo lectura de las fuentes): `scripts/contactos/importar.mts` y `scripts/contactos/xlsx.mts`.
- Migración nueva: `supabase/migrations/20261111000100_contactos_menudeo.sql` (esquema `contactos`).
- Prueba pgTAP escrita, sin ejecutar: `supabase/tests/database/015_contactos.test.sql`.
- Pantalla: `src/app/(socio)/contactos/` y entrada «Contactos» en el sidebar.
- Pruebas vitest: `test/unit/contactos*.test.ts` (datos sintéticos).

## Comandos del importador

```
npx tsx scripts/contactos/importar.mts                         informe de conteos sin datos personales
npx tsx scripts/contactos/importar.mts --prueba-idempotencia   comprueba que el orden de entrada no cambia el resultado
npx tsx scripts/contactos/importar.mts --json RUTA             guarda el informe (fuera del repo)
npx tsx scripts/contactos/importar.mts --lotes CARPETA         escribe lotes JSON con datos personales (rechaza rutas dentro del repo)
```

## Pasos pendientes (en este orden)

1. El dueño revisa los conteos del informe y autoriza la carga a producción.
2. Revisar la migración con la base local (Docker) y correr `supabase test db` para ejecutar `015_contactos.test.sql`. Aún no se ha ejecutado: el SQL se revisó solo a ojo.
3. Aplicar la migración `20261111000100` por el flujo de despliegue autorizado (respaldo antes; la migración solo crea objetos nuevos).
4. Generar los lotes con `--lotes` en una carpeta fuera del repo (permisos 0700) y cargarlos uno por uno con `contactos.cargar_lote(lote_id, contactos)` conectado como `postgres` con `set rtm.canal = 'importacion'`. Cada lote lleva un `lote_id` estable (por ejemplo el nombre del archivo `lote-0001`); repetir el mismo lote no cambia nada y un lote con otro contenido se rechaza.
5. Verificar después de la carga: `select count(*) from contactos.contacto` contra `contactos_unicos` del informe, y que `api.contactos_resumen()` cuadre por origen.
6. Borrar los lotes JSON locales cuando termine la carga.
7. Si se quiere un rol dedicado para el agente de IA, crear `agente_ia` (la migración le da solo `contactos.v_contacto_agente` si el rol existe). Hoy el agente puede consultar mediante `api.contactos_agente`, siempre enmascarado.

## Decisiones del dueño aplicadas (11-nov)

- Teléfonos de otros países con «+» explícito: se conservan y se cuentan aparte (`extranjeros`).
- Números de 7 u 8 dígitos sin lada: se conservan como `sl:<dígitos>` (no son E.164 y no se inventa la lada), deduplicados por sus dígitos, marcados como «sin lada» en la pantalla y contados aparte (`telefonos_sin_lada`). Solo se descartan vacíos y basura real (cortos, largos, patrones falsos como 0000000 o 1234567).
- Un teléfono compartido une siempre. Un correo compartido une SOLO si el nombre normalizado (sin acentos, mayúsculas ni espacios extra) es el mismo; al unir se conservan todos los teléfonos, orígenes, etiquetas y lotes. Con nombre distinto no se unen y ambos quedan con `correo_compartido` para revisión (la tabla `contactos.correo` ya no exige correo único). Sin nombre no se une por correo.
- Orígenes: `meta` (anuncio y formulario), `toocloudy-whatsapp` (leads whatsapp FINAL.xlsx), `vapeunion`, `google-lote:<etiqueta>` y `google-vcf:<archivo>` (archivos .vcf: Todos.vcf, contacts.vcf y 1573.vcf; vCard 2.1/3.0, líneas dobladas y quoted-printable).
- `descargas-base-de-datos.xlsx` (BASE DE DATOS.xlsx): hoja sin cabeceras; se detectan por contenido las columnas de teléfono y de texto (el texto de la fila se usa como nombre), se ignoran los contadores y se reconstruyen los teléfonos en notación científica. Origen `descargas-base-de-datos`.
- Colonia (opcional): `leads whatsapp FINAL (1).xlsx` (idéntico a la copia (2)) se lee con cabeceras COLONIA y WHATSAPP, fuente `descargas-leads-whatsapp-final`, origen `toocloudy-whatsapp`. La colonia se fusiona por teléfono; se compara sin acentos, mayúsculas ni espacios extra y se conserva el texto original; con colonias distintas se conservan ambas y queda `colonia_conflicto`. La pantalla muestra y filtra por colonia.
- PDF `NÚMERO DE CLIENTES - Hoja 1` y `vapemate - Hoja 1` (casi idénticos): una sola fuente `numero-de-clientes-pdf` (se extrae con `pdftotext -layout`, que debe estar instalado, y se deduplica). `NÚMERO DE CLIENTES vapemate.xlsx` (Downloads, hash distinto a los demás): origen `numero-de-clientes-vapemate`.
- Se ignoran `Download.PDF` y `TooCloudyMX 2.zip`. `Todos.csv` está corrupto y se cuenta como archivo sin datos; su versión legible es `Todos.vcf`.
- Una tarjeta vCard sin teléfono (1573.vcf) se cuenta como descartada.

## Otras decisiones (revisables)

- La etiqueta de sistema `myContacts` de Google se ignora; sin etiqueta queda `google-lote:sin-etiqueta`.
- El correo se muestra a los socios; el teléfono solo al revelarlo, y cada revelación y cada exportación quedan en `contactos.revelacion` (solo inserción, sin llave foránea para sobrevivir a fusiones).
- En la base la unión por correo compara contra el nombre vigente del contacto (el más largo); puede diferir de la comparación del importador si los nombres cambian entre cargas. Los lotes salen ya consolidados, así que no debería ocurrir.

## Pendiente de verificación humana

- Recorrido visual de la pantalla en el navegador (no se corrió Playwright por instrucción).
- Existe una violación previa de las guardas en `src/app/(socio)/socios/page.tsx:38` (`style={{}}`) que no es de este módulo.
