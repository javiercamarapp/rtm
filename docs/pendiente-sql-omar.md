# Pendiente de SQL: vista web de Omar

La vista de Omar (`/mi-bodega`) ya existe con adaptador y pruebas con mock. Lee solo del esquema `omar`. Las vistas `omar.v_mercancia` y `omar.v_mi_cuenta` ya existen. Faltan las funciones de abajo; **no se creó ninguna migración**. Mientras no existan, cada lectura responde `pendiente_sql` y la pantalla lo dice con una frase, sin inventar ceros; `omar.solicitar_toma` responde "las solicitudes todavía no están habilitadas".

Reglas comunes a todas: `security definer`, `set search_path = ''`, primera línea `seguridad.exigir_rol(array['omar'])` y exigir `seguridad.usuario.activo` (cuenta desactivada = error `42501`, igual que las vistas dan cero filas). `grant execute ... to authenticated` solo para estas funciones; `revoke ... from public, anon`. Ninguna devuelve costo, margen, utilidad, precio de venta, cliente, proveedor, socio, dueño, reservas ni folios de pedido o de compra (la prueba `test/unit/omar/permisos.test.ts` y el parser de lista blanca lo vigilan).

## 1. `omar.mi_configuracion()`

```sql
create function omar.mi_configuracion() returns jsonb
language plpgsql stable security definer set search_path = '';
```

Devuelve `{ "tope_toma_piezas": int, "caduca_horas": int, "renta_por_pieza_cent": bigint }` leyendo `catalogo.config` (`omar_tope_toma_piezas` = 15, `omar_toma_caduca_horas` = 72, `renta_por_pieza_cent`). Sin ella la web usa 15 y 72 y la tarifa que ve en su renta.

## 2. `omar.solicitar_toma(...)`

```sql
create function omar.solicitar_toma(p_clave_idem text, p_modelo text, p_sabor text, p_piezas int) returns jsonb
language plpgsql security definer set search_path = '';
```

- Idempotente con `seguridad.iniciar_operacion(p_clave_idem, ...)` / `terminar_operacion`: la misma clave devuelve el mismo resultado con `"repetido": true` y NO crea otra toma ni otra tarjeta.
- Resuelve `p_modelo` + `p_sabor` a `sku_id` (`operacion.resolver_sku`); desconocido: `22023`.
- Valida `p_piezas` entero > 0 (`23514`) y <= `omar_tope_toma_piezas` como TOTAL por solicitud (`23514`).
- **Existencia neta**: `existencia en bodega_omar` menos reservas activas (`operacion.reserva`: pedidos confirmados y tomas pendientes). Si `p_piezas` > neta: `P0423` (el mensaje NO dice cuántas piezas están reservadas ni por qué). Cierra el hallazgo H03 de la auditoría 03.
- Llama a `operacion.registrar_toma_omar(p_clave_idem, sku, p_piezas, null, null, 'telegram_omar')` (nace `pendiente`, crea reserva, sin kardex ni saldo) y emite el aviso a la cola de Telegram (`operacion.avisar(... array['software','telegram'])`) para que el agente publique la tarjeta Autorizar/Rechazar en el grupo de socios. `registrar_toma_omar` hoy exige rol socio/importacion: hace falta una variante interna o permitir `omar` con `p_via = 'telegram_omar'`.
- Devuelve `{ "estado": "pendiente", "folio": "T-0001", "caduca_at": timestamptz, "repetido": bool }`.
- Una solicitud por pieza (una fila `toma_omar` es un sku); el tope cuenta las piezas de esa solicitud.

## 3. `omar.mis_solicitudes(...)`

```sql
create function omar.mis_solicitudes(p_limite int default 20) returns jsonb
language plpgsql stable security definer set search_path = '';
```

Devuelve un arreglo, más reciente primero, de `{ "folio", "modelo", "sabor", "piezas", "estado", "solicitada_at", "caduca_at", "resuelta_at" }` desde `operacion.toma_omar` (todas las vías). `estado` en `pendiente | autorizada | rechazada | caducada | deshecha`. `caduca_at = solicitada_at + omar_toma_caduca_horas`. Sin precio ni importe.

## 4. `omar.mis_liquidaciones(...)`

```sql
create function omar.mis_liquidaciones(p_limite int default 8) returns jsonb
language plpgsql stable security definer set search_path = '';
```

Arreglo de `{ "folio", "semana_ini", "semana_fin", "renta_cent", "tomas_cent", "compensado_cent", "neto_cent", "pagado_cent", "fecha_cierre" }` desde `operacion.liquidacion_omar`. `neto_cent` > 0: los socios le deben; < 0: Omar debe. `pagado_cent` = suma con signo de `operacion.pago_omar` con `liquidacion_id` de esa fila (`a_omar` suma, `de_omar` resta). La web calcula el estado (pagada, parcial, pendiente) y la comprobación renta − tomas + compensado = neto.

## 5. `omar.mis_paquetes()`

```sql
create function omar.mis_paquetes() returns jsonb
language plpgsql stable security definer set search_path = '';
```

Arreglo de paquetes SIN cliente, proveedor, dueño, guía, costo ni folio:

```json
{ "consecutivo": 1, "tipo": "salida", "estado": "por_empacar", "horas": 5, "llegada_estimada": null,
  "renglones": [ { "modelo": "...", "sabor": "...", "piezas": 8 } ] }
```

- `tipo = 'salida'`: pedidos confirmados que salen de `bodega_omar` y aún no se marcan enviados (`estado` `por_empacar | empacado`, `horas` desde que se pidió preparar). `consecutivo` se numera en la propia función (1..n por orden de antigüedad), nunca el id ni el folio del pedido.
- `tipo = 'entrada'`: compras en trayecto hacia Mérida (`estado` `en_trayecto | llego`, `llegada_estimada` fecha). Solo modelos, sabores y piezas pedidas.
- Los pedidos directos del proveedor al cliente (sin pasar por Mérida) no aparecen.
- La web suma las piezas de las salidas para la **proyección** (renta por pieza × piezas por enviar); por eso esta función también alimenta "Estimado".

## 6. Observaciones sobre las vistas existentes (no bloquean la web)

- `omar.v_mi_cuenta.referencia` de la renta es el folio del pedido (H07 de la auditoría): la web lo **reemplaza** por `R-001…` al leer, pero conviene que la vista ya no lo exponga (consecutivo propio) y que las reversas salgan como "ajuste".
- `omar.v_mi_cuenta` muestra `importe` positivo en `pago` cuando es `a_omar`: la web lo trata como "recibido" y negativo como "pagado por ti".
- `omar.v_mercancia` es existencia física (no neta de reservas); es la fuente única de número para web y bot.
- El interruptor único de M2 sigue siendo `seguridad.usuario.activo` del usuario con rol `omar`: desactivado, las vistas dan cero filas, el enlace mágico no abre sesión y la web redirige a `/login?error=desactivada`.
