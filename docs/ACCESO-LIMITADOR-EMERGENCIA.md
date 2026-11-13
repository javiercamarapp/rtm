# Limitador de intentos de login: falla CERRADO y procedimiento de emergencia

Decision del dueno (13-nov): si el limitador no puede consultar o registrar el intento (conexion caida, rol `servidor` sin login, contrasena rotada mal, tiempo agotado en dos intentos seguidos, respuesta invalida), el acceso se RECHAZA.

## Comportamiento

- UN reintento acotado (14-nov): un arranque en frio contra el pooler puede rechazar el primer intento de un usuario legitimo. Cada intento (conexion y consulta) tiene tope de 1.4 s y entre ambos hay 100 ms: peor caso 2.9 s en total (<= 3 s; constantes en `src/infra/limite/limitador_postgres.ts`). Si el segundo intento tambien falla, se falla CERRADO exactamente como antes. Una respuesta invalida no se reintenta. Si el primer intento llego a la base y solo se perdio la respuesta, el acceso cuenta dos veces: el error va hacia el lado restrictivo, nunca hacia dejar pasar.
- Piso de tiempo: el piso de 1.5 s de /login es un MINIMO (no recorta lo mas lento). Con la base caida la respuesta tarda hasta ~2.9 s mas el resto del flujo, en lugar de ~1.5 s; esa diferencia solo existe cuando el limitador esta caido (no depende del correo ni de lo que envie quien prueba), y la pantalla sigue siendo identica.

- Formulario de /login: no se envia ningun correo y la pantalla es la misma que la de un correo no permitido (tarjeta de «enviado», piso de 1.5 s que cubre tambien la consulta). No hay mensaje ni diferencia de tiempo que delate la falla.
- Reenvio de enlace caducado: degrada a «no», igual que un correo sin cuenta.
- Aviso interno en la bitacora del servidor: `{"evento":"login.limitador_no_disponible","puerta":"ip|correo|reenvio","codigo":"..."}`. Solo lleva un codigo tecnico (ECONNREFUSED, 28000, 57014, DESCONOCIDO); nunca correo, IP ni mensaje de error.
- Topes sin cambios: 3 por correo cada 10 min, 10 por IP cada 5 min, 60 globales cada 10 min.
- Quien ya tiene sesion abierta NO se ve afectado: el limitador solo protege la pedida y el reenvio del enlace.

## Riesgo de bloqueo accidental (los 3 usuarios reales)

Mientras la base o el pooler no respondan, nadie nuevo puede pedir enlace. Es el costo aceptado de fallar cerrado. Se mitiga asi:

1. Las sesiones abiertas siguen funcionando (cookie de Supabase); una cuenta que ya entro no necesita el limitador.
2. Un enlace ya enviado sigue siendo canjeable: canjear no pasa por el limitador.
3. La causa mas probable de bloqueo propio es operativa (rotar la contrasena del rol `servidor` o `LIMITE_PIMIENTA` sin actualizar `SERVIDOR_DATABASE_URL` en el despliegue, o `alter role servidor nologin`). Verificar tras toda rotacion con `scripts/despliegue/humo.mjs`, que comprueba que los intentos se cuentan.

## Como entrar si el limitador esta caido

No hay puerta trasera ni variable que lo apague. El procedimiento es:

1. Revisar la bitacora del servidor: buscar `login.limitador_no_disponible` y su `codigo`.
2. Corregir la causa en la base: Supabase arriba, rol `servidor` con login, `SERVIDOR_DATABASE_URL` vigente (pooler puerto 6543), funcion `seguridad.registrar_intento_login` presente.
3. Reintentar desde /login. No hace falta redesplegar ni reiniciar: el pool reabre conexiones solo en el siguiente intento.
4. Los topes por correo (3 por 10 min) no se gastan mientras el limitador estuvo caido, porque no registro nada; si se alcanzaron antes de la caida, esperar la ventana.

## Pruebas

- `test/unit/limitador_postgres.test.ts` y `test/unit/acceso_aplicacion.test.ts`: el adaptador lanza `LimitadorNoDisponible` en cada falla; el reenvio degrada a «no».
- `test/e2e/acceso.spec.ts` prueba 4b: se quita el login al rol `servidor`, se verifica la respuesta generica y cero correos, y se restaura. El `global-setup` deja el rol con login (tras un `supabase db reset` queda `nologin`) para que el limitador SI conecte en las demas pruebas.
