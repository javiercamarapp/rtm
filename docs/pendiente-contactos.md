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

## Decisiones tomadas por criterio propio (revisables)

- Teléfonos de otros países con prefijo `+` explícito se conservan como válidos y se cuentan aparte (`extranjeros` en el informe). Los números mexicanos sin lada (7 u 8 dígitos) se descartan.
- Un contacto se une a otro si comparten teléfono o correo (cierre transitivo). Dos personas que compartan un correo quedarían unidas.
- El origen de los contactos de Google es `google-lote:<etiqueta>`; los que no traen etiqueta quedan en `google-lote:sin-etiqueta`. La etiqueta de sistema `myContacts` se ignora.
- `Todos.csv` está corrupto (bytes binarios en lugar de texto) y se cuenta como archivo sin datos.
- El correo se muestra a los socios; el teléfono solo al revelarlo, y cada revelación y cada exportación quedan en `contactos.revelacion` (solo inserción).
- Las revelaciones no tienen llave foránea al contacto para sobrevivir a fusiones de contactos.

## Pendiente de verificación humana

- Recorrido visual de la pantalla en el navegador (no se corrió Playwright por instrucción).
- Existe una violación previa de las guardas en `src/app/(socio)/socios/page.tsx:38` (`style={{}}`) que no es de este módulo.
