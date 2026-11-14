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

## Pulido final (14-nov): desglose, rendimiento y Telegram

**Desglose explícito (decisión del dueño).** La valuación de quien tiene fondos de la sociedad en su cuenta SÍ los resta; ahora se ve por qué es menos. Campo nuevo `igualacion` en `api.cuenta_socios_valuacion` (migración `20261114500000`): `faltan_cent` (diferencia de valuación), `componentes` (aportó menos capital, fondos cobrados pendientes de entregar, retiros desiguales, centavo suelto; suman exactamente lo que falta) y `por_socio` (`entregar_cent`, `valuacion_tras_entregar_cent`, `aportar_cent`). Con datos del dueño: Javier 154,832.30 contra Angelo 106,910.39 = 47,921.91 = 12,446.91 + 35,475.00; al entregar los 35,475.00 Angelo sube a 142,385.39 y solo falta aportar 12,446.91, que coincide con «diferencia a igualar» y «le toca aportar» del libro (`coincide_con_libro`; con retiros desiguales difieren y se avisa). Cada socio tiene `fondos_detalle` (los cobros). Textos: `src/dominio/socios/valuacion.ts` (`textoFaltan`, `indicacionesSocio`, `desgloseDiferencia`); aparecen en la tarjeta de Inicio, en /socios («Por qué hay diferencia y cómo igualar», con enlace a la cuenta del socio y esos cobros) y en el aviso del Historial personal.

**Rendimiento.** La serie mensual ya no llama a `cap_periodo` por mes: una sola consulta por conjuntos, mismas cifras (pgTAP `a11_001` compara contra el cálculo anterior con 1, 12 y 61 meses). Medido en local con la misma siembra: 1 mes 619 ms → 361 ms, 12 meses 767 → 361 ms, 61 meses 2,317 → 615 ms.

**Telegram.** `mi valuación`, `como estamos` y `/valuacion` responden con `agente.valuacion_socios()` (la misma función de la base, sin teléfonos, solo socios; Omar rechazado). Causa del silencio: el prefiltro sin IA descartaba mensajes sin cifras ni palabras de negocio; se añadieron `valuacion`, `estamos`, `igualar`, `igualados`. Guion: `scripts/agente/guion-valuacion.txt`.
