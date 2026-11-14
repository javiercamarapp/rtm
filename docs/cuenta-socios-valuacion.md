# Cuenta de socios por valuacion

Decision del dueno (13-nov): la valuacion de cada socio es **capital aportado + utilidades acumuladas - retirado - fondos de la sociedad en su poder**. Siempre 50 % y 50 %: la inversion de los dos debe ser parecida, asi que se comparan valuaciones. Sube con cada utilidad y baja solo cuando un socio se paga un retiro; los dos se pagan lo mismo.

## Fuente unica

`api.cuenta_socios_valuacion(p_hasta date default null)` (migracion `20261114300000`): solo rol socio (`exigir_rol` dentro; sin GRANT a anon ni PUBLIC). Reutiliza `operacion.cap_periodo`, la misma funcion de `api.capital_por_mes`, del historial personal y del reporte mensual. La deuda con proveedores sale de `operacion.posicion_proveedor`. Ninguna pantalla recalcula dinero.

Identidad de cuadre: suma de las valuaciones por socio (capital + utilidades - retirado) = capital contable del Balance; equivale a valuaciones personales + fondos de la sociedad en poder de socios = activo - pasivo (identidades S1 a S6 del panel Cuadra).

Diferencia de valuacion X (lo que se aporta para igualar) y diferencia de aportaciones netas Y (`api.socios_aportacion_neta`) coinciden con utilidades 50/50 y retiros iguales; difieren por retiros desiguales o por el centavo impar de la utilidad.

## Donde se aplica

Inicio (TU VALUACION), barra superior (chip Tu valuacion), Cuenta de socios, Historial personal (aviso), Valuacion y su historial (comparacion y serie por socio), Balance (capital contable por socio), Estado de resultados (nota mitad Javier / mitad Angelo), Cascada de reparto (aviso de valuaciones y retiros), reporte mensual (tabla acumulada con los mismos rotulos).

No cambia: el acta sellada (es una foto inmutable al corte de cada acta); el agente de Telegram (lo corrige otro agente).

## Para el agente de Telegram ("mi valuacion", "como estamos")

Leer **solo** `api.cuenta_socios_valuacion()` (con el actor de lectura, como hace `agente.igualacion`) y redactar con la plantilla determinista; el modelo nunca calcula dinero:

- `socios[].valuacion_cent` del socio que pregunta: "Tu valuacion $X".
- `comparacion.igualados`: "Estas igualado con <otro>".
- `comparacion.mayor` / `menor` / `diferencia_valuacion_cent`: "Tienes $X mas|menos que <otro>".
- Accion: si tiene menos, "Te toca aportar $comparacion.aportar_para_igualar_cent para igualar"; si tiene mas, "<otro> debe igualar".
- `comparacion.retiros_desiguales` y `diferencia_retiros_cent`: alerta de retiro desigual.

Hay una funcion de view-model con estos textos en `src/dominio/socios/valuacion.ts` (`tarjetaValuacion`, `fraseIgualar`, `alertaRetiros`) que puede reutilizarse.
