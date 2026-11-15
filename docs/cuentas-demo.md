# Cuentas de demostracion

Rama `feat/cuentas-demo`. Para PRESENTAR el software (por ejemplo al socio) con cuentas demo que tengan todo lo nuevo y datos 100 % ficticios, sin tocar ni mezclar los datos reales. El libro es uno solo: el demo vive en una base APARTE y NUNCA se siembra en produccion.

## Que es y que no es

- Un generador determinista (`scripts/demo/generador.mjs`) arma un plan de unos 250 movimientos repartidos en 12 semanas y un ejecutor (`scripts/demo/ejecutor.mjs`) lo carga SOLO con las funciones oficiales (`api.*`, `operacion.*`, `catalogo.*`), una transaccion por movimiento. Por eso el libro de partida doble, el kardex, la cadena de hash y las comprobaciones C1 a C24 quedan consistentes y en verde (el cargador lo verifica al terminar).
- Datos ficticios: clientes con la palabra "Demo", contactos y telefonos 555 010, correos `@example.test`, guias `DEMO-`, precios, costos y cantidades inventados. Marcas y modelos son nombres de catalogo (los mismos que tienen foto en `public/`), por eso las fotos aparecen.
- Mismo parametro, mismo plan: `--hoy`, `--movimientos` (250 por omision, entre 60 y 2000) y `--semilla`. Las fechas se calculan hacia atras desde hoy: la ventana de 12 semanas siempre termina ayer.
- El bot de Telegram queda APAGADO (todos los interruptores en falso); el cargador lo verifica y falla si algo de envio quedo encendido. No se crea ningun grupo, token ni proyecto externo.

### Lo que NO se pudo hacer sin tocar el esquema real (decision pendiente del dueno)

Los nombres de los socios y de los proveedores estan fijados por el esquema de produccion (`CHECK socio_nombre in ('Angelo','Javier')` y `proveedor.nombre in ('Isaac','Karen')`) y el codigo los usa como llaves (`por_socio['Angelo']`, origen `karen_directo`, etc.). Por eso en el demo:

- Los dos socios aparecen con las llaves internas Angelo y Javier, pero sus CUENTAS son demo: `Socio Demo A` (Angelo) y `Socio Demo B` (Javier), correos `socio.demo.a@example.test` y `socio.demo.b@example.test`, 50/50.
- Los proveedores son Isaac y Karen (sus datos, precios y existencias son ficticios).

Para que la interfaz diga literalmente "Socio Demo A / B" e "Isaac demo / Karen demo" haria falta una migracion aditiva (relajar esos CHECK) y una capa de nombres visibles en unas 20 pantallas. No se hizo: cambia el esquema de produccion y necesita tu decision.

## Levantar el demo en tu Mac (local)

Requiere Docker y la CLI de Supabase. Nada de esto toca la nube.

```
npm run db:iniciar                      # Supabase local (base, Auth, API y buzon Mailpit); aplica las migraciones
node scripts/entorno/generar-env-local.mjs   # .env.local con llaves LOCALES (no se versiona)
npm run demo:cargar                     # siembra el demo en la base local vacia (usa supabase status si no hay DATABASE_URL)
npm run dev                             # http://127.0.0.1:3100
```

Para empezar de cero (borra TODO lo de la base local y vuelve a sembrar): `npm run demo:reiniciar -- --confirmar`.

Opciones de `demo:cargar`: `--movimientos 250`, `--hoy AAAA-MM-DD` (no puede ser posterior a hoy: la base nunca fecha en el futuro), `--semilla texto`, `--dry-run` (solo muestra el plan, sin base), `--url` (en lugar de `DATABASE_URL`).

### Guardas (obligatorias)

- Rehusa correr si la URL contiene la referencia del proyecto de produccion, con cualquier bandera.
- Rehusa si el host no es `localhost`, `127.0.0.1` o `::1`, salvo `--permitir-remoto-demo` Y que el proyecto este en la lista `RTM_DEMO_PROYECTOS` (separada por comas). Hoy esa lista esta vacia: no existe ningun proyecto demo en la nube.
- Rehusa si la base NO esta vacia (pedidos, compras, pagos, asientos, clientes, modelos, usuarios o correos permitidos). No hay forma de mezclar el demo con datos reales.
- Exige conectarse como el rol propietario `postgres` (el que respeta la fecha historica de la carga).

## Como entrar (solo local)

El acceso de la web es por enlace magico; no hay contrasenas y el demo no crea ninguna. Dos formas, ambas solo con el Supabase local:

1. `npm run demo:enlace -- socio_a` (o `socio_b`, `omar`, `bodega`): imprime un enlace de un solo uso; abrelo en el navegador con `npm run dev` corriendo.
2. Normal: en `/login` escribe el correo demo y abre el correo en Mailpit (`http://127.0.0.1:55324`).

| Cuenta | Correo | Entra a |
|---|---|---|
| Socio Demo A (Angelo) | `socio.demo.a@example.test` | todo el sistema |
| Socio Demo B (Javier) | `socio.demo.b@example.test` | todo el sistema |
| Omar Demo (renta de bodega) | `omar.demo@example.test` | `/mi-bodega`: renta devengada, disponibilidad sin costos ni precios |
| Persona de bodega demo | `bodega.demo@example.test` | `/bodega`: que preparar hoy y llegadas por guardar |

## Que trae el demo (a 250 movimientos)

Unos 30 modelos reales de catalogo con 6 a 10 sabores y foto, 37 clientes con tabulador de precios, 11 compras a Isaac y Karen con guias y recepciones (con faltantes y devoluciones al proveedor), unas 70 ventas de bodega y 19 pedidos de dropshipping (con Karen e Isaac y a costo para el socio de menudeo) con paqueterias Castores, Pitic, DHL y Estafeta, pedidos en borrador, por enviar, enviados y entregados, cobros parciales y totales, cuentas por cobrar con antiguedad y vencidos, devoluciones de clientes, mermas, depositos, gastos y traspasos de socios, renta de Omar devengada y pagada en parte, costos del sistema como aportacion de capital del mes en curso, dos cortes mensuales firmados (actas), valuaciones distintas entre socios (y el banner de igualacion), stock de proveedor con cambios recientes, avisos vigentes y resueltos y 12 semanas con ritmo creciente (picos y semanas flojas).

## Guion de presentacion de 10 minutos

1. Entrada y pulso (1 min): entra como Socio Demo A; el pulso del dia, el ritmo semanal y los avisos. Mensaje: todo es el mismo negocio, sin dividir por dueno.
2. Pedidos (2 min): `/pedidos`. Estados (borrador, por enviar, enviado), un pedido con guia y paqueteria, uno con aviso por excepcion de minimo, el detalle de una nota. Despues `/dropshipping`: un pedido de Karen y uno a costo para el socio de menudeo.
3. Cobranza (1 min): `/cuentas-por-cobrar`: antiguedad, vencidos, cobros parciales; registrar un abono en vivo.
4. Inventario y catalogo (1,5 min): `/inventario` (kardex por modelo con fotos y sabores), `/catalogo` (tabulador por cliente), una devolucion en `/devoluciones`.
5. Compras y proveedores (1,5 min): `/proveedores`: compras con guias y recepcion con faltantes, la posicion con cada proveedor y `/proveedores/stock` (cambios recientes de Karen).
6. Socios (1,5 min): `/socios`: cuenta de cada socio, valuaciones distintas y el banner "igualar valuacion", la cascada, `/socios/actas` (corte mensual firmado) y el historial personal.
7. Contabilidad (1 min): `/contabilidad`: Comprobaciones C1 a C24 en verde, Balance, Estado de resultados, Flujo y Proyecciones (siempre "Estimado"); "Explicar este numero" en una cifra.
8. Omar y bodega (0,5 min): cierra sesion y entra como Omar Demo (`/mi-bodega`: renta devengada y por pagar, sin costos ni margenes) y como bodega.

## Pruebas

- `npx vitest run test/unit/demo test/contratos/demo_sin_datos_reales.test.ts`: generador determinista, volumen, coherencia del dinero, guardas de destino y base vacia, y el contrato de que no hay datos reales (correos fuera de `example.test`, telefonos, nombres de clientes reales por huella, secretos, referencia de produccion).
- Carga de extremo a extremo contra una base local vacia: `DATABASE_URL=<url local> npm run demo:cargar` (termina con las comprobaciones en verde o con codigo de salida 1).

## Hospedaje del demo en la nube (OPCIONES; no se creo nada)

Crear un proyecto o gastar requiere autorizacion explicita del dueno. Esta rama NO crea proyectos, cuentas ni despliegues en ningun servicio.

| Opcion | Que implica | Costo estimado (verificar precios vigentes) |
|---|---|---|
| A. Solo local (recomendada) | El demo corre en tu Mac durante la presentacion. | 0 |
| B. Supabase demo + Vercel demo aparte | Un proyecto nuevo de Supabase SOLO para el demo y un proyecto nuevo de Vercel sin Git, sin relacion con el real. Se declara el proyecto en `RTM_DEMO_PROYECTOS` y se siembra con `--permitir-remoto-demo`. | Supabase: plan gratuito si el cupo de proyectos lo permite, o unos US$25 al mes con plan Pro; Vercel: gratis en Hobby (uso personal) o plan Pro por usuario; cada despliegue es un build facturable, asi que se agrupan en uno solo. |
| C. Un solo entorno efimero | Crear el proyecto de Supabase demo, presentar y pausarlo o borrarlo el mismo dia. | Cobro por dias de uso; el Vercel demo puede quedar apagado entre presentaciones. |

Advertencias: (1) el demo y produccion jamas comparten proyecto ni variables de entorno; (2) las variables del Vercel demo apuntan solo al Supabase demo; (3) las cuentas demo usan correos `example.test`, que no reciben correo: en la nube habria que habilitar un acceso de demostracion distinto y eso necesita tu decision (no se hizo); (4) no tocar Spend Management ni facturacion.
