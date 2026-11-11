-- F3b-2 / 0021: nucleo de notificaciones.
--  * esquema `notificacion`: catalogo de tipos (122 de la matriz 25 mas el cierre de reparto), destinatarios con leida/silenciada, entregas por canal con estados,
--    intentos de solo insercion, destinos, miembros de Telegram, tokens de un solo uso para botones y su auditoria de pulsaciones.
--  * `operacion.aviso` es la tabla `notificacion` de la especificacion 26 (misma fila: asunto con clave de deduplicacion, estado, version, conteo): no se duplica.
--    `operacion.avisar()` conserva su firma, valida contra el catalogo, crea destinatarios y entregas EN LA MISMA TRANSACCION del hecho de negocio (outbox).
--  * la campana (`api.mis_notificaciones`, `api.contar_no_leidas`, `api.marcar_leida`, `api.marcar_todas_leidas`), el pulso y "Tu turno".
--  * emisores de F3b: conteo (en 0022), comprobaciones, cuenta con proveedor, posicion entre socios, periodos y altas de usuario.
-- En M1 todo se muestra solo en el software: los interruptores `telegram_envio` y `correo_envio` nacen apagados (la entrega queda `omitida`).

create schema notificacion;
revoke all on schema notificacion from public, anon, authenticated;
grant usage on schema notificacion to servidor;

-- ---------------------------------------------------------------------------
-- Parametros (todo en catalogo.config con vigencia; ninguna constante vive dentro de las funciones)
-- ---------------------------------------------------------------------------
insert into catalogo.config (clave, valor, vigente_desde) values
  ('notif_ventana_agrupacion_min', '15', '2026-11-10'),
  ('notif_presupuesto_hora', '12', '2026-11-10'),
  ('notif_freno_tormenta_hora', '40', '2026-11-10'),
  ('notif_silencio_ini_hora', '22', '2026-11-10'),
  ('notif_silencio_fin_hora', '7', '2026-11-10'),
  ('notif_intentos_max', '5', '2026-11-10'),
  ('notif_entrega_horas_max', '24', '2026-11-10'),
  ('notif_backoff_seg', '[30, 60, 120, 240, 3600]', '2026-11-10'),
  ('notif_correo_demora_horas', '2', '2026-11-10'),
  ('notif_correo_respaldo_horas', '2', '2026-11-10'),
  ('notif_token_pulsaciones_min', '10', '2026-11-10'),
  ('notif_token_ttl_min', '{"autorizar_toma": 4320, "rechazar_toma": 4320, "deshacer": 10, "reintentar_reporte": 1440, "ignorar_cambio_proveedores": 10080, "por_omision": 60}', '2026-11-10'),
  ('posicion_socios_cambio_cent', '500000', '2026-11-10'),
  ('posicion_socios_cambio_pct', '20', '2026-11-10');

create function catalogo.config_num(p_clave text, p_fecha date default null) returns numeric
language sql stable set search_path = ''
as $$ select (catalogo.config_valor(p_clave, p_fecha) #>> '{}')::numeric $$;

insert into seguridad.interruptor (clave, activo) values
  ('telegram_envio', false), ('correo_envio', false), ('cron_pausado', false), ('telegram_adjuntar_pdf', false), ('omar_existencia_insuficiente', false)
  on conflict (clave) do nothing;

-- ---------------------------------------------------------------------------
-- Catalogo de tipos
-- ---------------------------------------------------------------------------
create table notificacion.tipo (
  codigo text primary key,
  nt text,
  titulo text not null,
  severidad text not null check (severidad in ('C', 'I', 'F')),
  -- requiere_accion = trae algun boton que cambia el estado (Marcar, Registrar, Autorizar, Corregir...); abrir, ver o explicar solo navegan.
  requiere_accion boolean not null,
  no_silenciable boolean not null default false,
  canal text not null check (canal in ('SW', 'TG', 'ST', 'STC', 'SC', 'CO', 'OM', 'VO')),
  dominio text,
  agrupable boolean not null default false,
  ttl_horas int check (ttl_horas is null or ttl_horas > 0),
  fase text not null,
  botones text[] not null default '{}',
  campos_permitidos text[],
  activo boolean not null default true
);
insert into notificacion.tipo (codigo, nt, titulo, severidad, requiere_accion, no_silenciable, canal, dominio, agrupable, ttl_horas, fase, botones, activo) values
  ('aviso_precio_tabulador', 'NT-001', 'Precio de línea distinto del tabulador', 'I', true, false, 'SW', 'PED', false, 720, 'F2', array['Enviar de todos modos', 'Corregir']::text[], true),
  ('aviso_venta_bajo_costo', 'NT-002', 'Venta a costo o bajo costo', 'I', true, false, 'SW', 'PED', false, 720, 'F2', array['Enviar de todos modos', 'Corregir']::text[], true),
  ('piezas_nota_difieren', 'NT-003', 'Piezas de la nota distintas de las que salen (C2)', 'C', true, false, 'ST', 'PED', false, null, 'F2', array['Corregir nota', 'Enviar de todos modos']::text[], true),
  ('aviso_sin_precio_catalogo', 'NT-004', 'Modelo fuera de catálogo, por confirmar o sin precio del cliente', 'I', true, false, 'SW', 'PED', false, 720, 'F2', array['Dar precio', 'Quitar línea']::text[], true),
  ('aviso_minimo_piezas', 'NT-005', 'Pedido con menos de 20 piezas', 'F', true, false, 'SW', 'PED', false, 168, 'F2', array['Enviar de todos modos']::text[], true),
  ('pedido_enviado_con_excepcion', 'NT-006', 'Pedido enviado aceptando un aviso', 'I', true, false, 'ST', 'PED', true, 720, 'F2', array['Ver pedido', 'Emitir corrección']::text[], true),
  ('pieza_no_llego_saldo', 'NT-007', 'Pieza no llegada con pago previo (saldo a favor)', 'I', true, false, 'ST', 'PED', false, 720, 'F2', array['Marcar enviado', 'Devolver saldo']::text[], true),
  ('nota_corregida_o_anulada', 'NT-008', 'Nota corregida o pedido anulado tras enviar', 'I', false, false, 'ST', 'PED', true, 720, 'F2', array['Ver versiones']::text[], true),
  ('guia_sin_costear', 'NT-009', 'Guía sin costear más de 3 días', 'F', true, false, 'SW', 'PED', false, 168, 'M2d', array['Capturar costo']::text[], true),
  ('paquete_por_empacar', 'NT-010', 'Paquete por empacar (pedido confirmado)', 'I', true, false, 'ST', 'PAQ', true, 720, 'F2', array['Marcar empacado', 'Abrir en el software', 'Posponer']::text[], true),
  ('paquete_pendiente_horas', 'NT-011', 'Paquete sin empacar o sin enviar pasadas N horas', 'I', true, false, 'ST', 'PAQ', false, 720, 'M2d', array['Marcar empacado', 'Marcar enviado', 'Posponer 24 h']::text[], true),
  ('paquete_enviado_con_guia', 'NT-012', 'Paquete enviado con su guía', 'F', false, false, 'ST', 'PAQ', true, 168, 'F2', array['Abrir en el software']::text[], true),
  ('sabor_faltante_antes_empacar', 'NT-013', 'Sabor faltante antes de empacar', 'I', false, false, 'ST', 'PAQ', true, 720, 'F2', array['Abrir en el software', 'Posponer']::text[], true),
  ('oc_confirmada_dinero_aplicado', 'NT-014', 'Orden de compra confirmada con dinero aplicado', 'F', true, false, 'ST', 'PAQ', false, 168, 'F2', array['Registrar guía', 'Abrir en el software']::text[], true),
  ('guia_registrada_trayecto', 'NT-015', 'Guía registrada de un paquete en trayecto', 'F', false, false, 'ST', 'PAQ', true, 168, 'F2', array['Abrir en el software']::text[], true),
  ('llegada_pendiente_confirmar', 'NT-016', 'Llegada a Mérida pendiente de confirmar', 'I', true, false, 'ST', 'PAQ', false, 720, 'F2', array['Confirmar recepción', 'Posponer', 'Abrir en el software']::text[], true),
  ('diferencia_recepcion_abierta', 'NT-017', 'Recepción confirmada con diferencias (faltante o sobrante)', 'I', true, false, 'ST', 'COM', false, 720, 'F2', array['Asignar responsable', 'Texto de reclamo']::text[], true),
  ('diferencia_recepcion_antigua', 'NT-018', 'Diferencia sin resolver a 7, 14 y 30 días', 'I', true, false, 'ST', 'COM', false, 720, 'M2d', array['Resolver']::text[], true),
  ('pago_de_mas_proveedor', 'NT-019', 'Pago de más a proveedor fuera de la sociedad', 'I', true, false, 'ST', 'COM', false, 720, 'F2', array['Aplicar a la sociedad', 'Pedir reembolso']::text[], true),
  ('trayecto_demorado', 'NT-020', 'Paquete en trayecto con más días de los esperados (compra pagada y no recibida)', 'I', true, false, 'ST', 'COM', false, 720, 'M2d', array['Registrar guía', 'Marcar recibida', 'Reclamar', 'Posponer']::text[], true),
  ('oc_karen_sin_pago', 'NT-021', 'Orden de compra a Karen rechazada por falta de pago', 'I', true, false, 'TG', 'COM', false, 720, 'M2c', array['Registrar pago', 'Reducir orden']::text[], true),
  ('costo_deja_tabulador_sin_margen', 'NT-022', 'Costo nuevo deja precios menores o iguales al costo', 'I', false, false, 'ST', 'COM', true, 720, 'F2', array['Ver clientes afectados']::text[], true),
  ('liquidacion_isaac_previa', 'NT-023', 'Jueves: liquidación con Isaac con pendientes', 'I', false, false, 'ST', 'COM', true, 720, 'M2d', array['Ver pendientes']::text[], true),
  ('cobertura_pago_viernes', 'NT-024', 'Cobertura del pago del viernes menor a 1.2 o 1.0', 'I', false, false, 'ST', 'COM', true, 720, 'M2d', array['Ver cuenta']::text[], true),
  ('cuenta_proveedor_no_cuadra', 'NT-025', 'Cuenta de proveedor no cuadra', 'C', false, false, 'ST', 'COM', false, null, 'F3b', array['Explicar este número']::text[], true),
  ('diferencia_vs_proveedor', 'NT-026', 'Diferencia contra lo que dice el proveedor', 'I', true, false, 'ST', 'COM', false, 720, 'F3b', array['Conciliar renglón por renglón']::text[], true),
  ('saldo_proveedor_cruza_cero', 'NT-027', 'Saldo con proveedor cruza cero', 'I', false, false, 'ST', 'COM', true, 720, 'F3b', array['Ver movimientos']::text[], true),
  ('saldo_negativo_karen', 'NT-028', 'Se le debe a Karen (saldo negativo)', 'C', true, false, 'ST', 'COM', false, null, 'F3b', array['Registrar pago', 'Ver orden']::text[], true),
  ('reponer_urge_pedir', 'NT-029', 'Por reponer: modelo o sabores propios en URGE PEDIR', 'I', true, false, 'ST', 'INV', false, 720, 'M2c', array['Crear OC a Karen (o Dar costo)', 'Buscar con Isaac', 'Posponer 24 h']::text[], true),
  ('sabor_sin_existencia_con_demanda', 'NT-030', 'Sabor o modelo propio sin existencia con demanda', 'I', true, false, 'ST', 'INV', false, 720, 'M2c', array['Igual que el anterior']::text[], true),
  ('conteo_semanal_vencido', 'NT-031', 'Conteo semanal vencido y recordatorio del viernes', 'I', true, false, 'ST', 'INV', false, 720, 'M2d', array['Iniciar conteo', 'Posponer 1 día']::text[], true),
  ('conteo_con_diferencia', 'NT-032', 'Conteo cerrado con diferencia', 'I', false, false, 'ST', 'INV', true, 720, 'F3b', array['Explicar', 'Ver kárdex']::text[], true),
  ('diferencia_conteo_sin_explicar', 'NT-033', 'Diferencias de conteo sin explicar a las 48 h', 'I', false, false, 'ST', 'INV', true, 720, 'M2d', array['Explicar']::text[], true),
  ('fuga_de_piezas', 'NT-034', 'Fuga de piezas detectada en la integridad', 'C', true, false, 'ST', 'INV', false, null, 'M2d', array['Corregir nota', 'Explicar']::text[], true),
  ('cobranza_vence_manana', 'NT-035', 'Cuenta por cobrar vence mañana', 'I', true, false, 'ST', 'CLI', false, 720, 'M2d', array['Texto de cobro', 'Registrar abono', 'Acordar plazo']::text[], true),
  ('cuenta_vencida', 'NT-036', 'Cuenta vencida: día 1 y cruces de 8, 15, 30 y 60 días', 'I', true, false, 'ST', 'CLI', false, 720, 'M2d', array['Texto de cobro', 'Registrar recargo', 'Acordar plazo']::text[], true),
  ('pago_sin_identificar', 'NT-037', 'Pago sin identificar', 'I', true, false, 'ST', 'CLI', false, 720, 'F2', array['Asignar a cliente']::text[], true),
  ('pago_posible_duplicado', 'NT-038', 'Posible pago duplicado', 'C', true, false, 'ST', 'CLI', false, null, 'F2', array['Es otro pago', 'Descartar']::text[], true),
  ('credito_sin_plazo', 'NT-039', 'Pedido a crédito sin plazo acordado', 'F', true, false, 'SW', 'CLI', false, 168, 'M2d', array['Acordar plazo']::text[], true),
  ('tabulador_cambiado_por_otro', 'NT-040', 'Tabulador de cliente ajeno cambiado por el otro socio', 'I', true, false, 'ST', 'CLI', false, 720, 'M2d', array['Revertir', 'Aceptar']::text[], true),
  ('posicion_socios_cambia', 'NT-041', 'Posición entre socios cambia 5,000 pesos o 20%', 'I', false, false, 'ST', 'SOC', true, 720, 'F3b', array['Explicar este número']::text[], true),
  ('cobro_en_cuenta_de_socio', 'NT-042', 'Cobro de cliente en cuenta personal de un socio', 'I', true, false, 'ST', 'SOC', false, 720, 'M2d', array['Ver fondos', 'Registrar entrega']::text[], true),
  ('fondos_en_poder_socio', 'NT-043', 'Fondos de la sociedad en poder de un socio (antigüedad o monto)', 'I', true, false, 'ST', 'SOC', false, 720, 'M2d', array['Registrar entrega', 'Aplicar a Isaac']::text[], true),
  ('eco_cruzado_accion_web', 'NT-044', 'Acción web de un socio que mueve dinero, avisada al otro', 'F', true, false, 'ST', 'SOC', true, 168, 'M2a', array['Ver movimiento', 'Reversar (web)']::text[], true),
  ('cascada_lista_firma', 'NT-045', 'Cascada del periodo lista para firma', 'I', true, false, 'ST', 'SOC', false, 720, 'M2d', array['Revisar y firmar (web)']::text[], true),
  ('utilidad_mayor_que_efectivo', 'NT-046', 'Utilidad repartible mayor que el efectivo', 'I', false, false, 'ST', 'SOC', true, 720, 'M2d', array['Ver cascada']::text[], true),
  ('accion_fuerte_o_periodo', 'NT-047', 'Acción fuerte ejecutada, importación masiva o periodo/cascada cerrado o reabierto', 'I', true, false, 'ST', 'SOC', false, 720, 'F3b', array['Ver auditoría', 'Revertir (web)']::text[], true),
  ('toma_omar_pendiente', 'NT-048', 'Toma de Omar pendiente de autorización', 'I', true, true, 'ST', 'OMA', false, 720, 'M2a', array['Autorizar', 'Rechazar']::text[], true),
  ('toma_omar_resuelta', 'NT-049', 'Toma de Omar autorizada o rechazada', 'F', false, false, 'ST', 'OMA', true, 168, 'M2a', array[]::text[], true),
  ('toma_omar_caducada', 'NT-050', 'Toma de Omar caducada', 'I', true, false, 'ST', 'OMA', false, 720, 'M2a', array['Registrar la diferencia en el conteo']::text[], true),
  ('toma_sin_precio', 'NT-051', 'Toma autorizada sin precio (Falta precio)', 'I', true, false, 'ST', 'OMA', false, 720, 'F2', array['Fijar precio']::text[], true),
  ('omar_mensaje_no_permitido', 'NT-052', 'Omar escribió algo que parece entrada, salida, pedido o compra', 'I', true, false, 'ST', 'OMA', false, 720, 'M2a', array['Registrar como salida (web)', 'Ignorar']::text[], true),
  ('liquidacion_omar_cerrada', 'NT-053', 'Liquidación semanal de Omar cerrada (socios)', 'F', false, false, 'ST', 'OMA', true, 168, 'M2a', array['Ver liquidación']::text[], true),
  ('liquidacion_omar_bloqueada', 'NT-054', 'Liquidación de Omar que no puede cerrarse', 'I', true, false, 'ST', 'OMA', false, 720, 'F3b', array['Autorizar', 'Rechazar', 'Cerrar con diferencia']::text[], true),
  ('saldo_liquidacion_omar', 'NT-055', 'Saldo de la liquidación: Omar debe o toca pagarle', 'I', true, false, 'ST', 'OMA', false, 720, 'F3b', array['Registrar pago']::text[], true),
  ('pago_omar_atrasado', 'NT-056', 'Pago de o a Omar atrasado 7 y 14 días', 'I', true, false, 'ST', 'OMA', false, 720, 'M2d', array['Registrar pago', 'Texto de cobro']::text[], true),
  ('omar_toma_recibida', 'NT-057', 'Omar: toma recibida, pendiente de autorización', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_toma_autorizada', 'NT-058', 'Omar: toma autorizada con su saldo semanal', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_toma_rechazada', 'NT-059', 'Omar: toma rechazada (motivo si lo escribió un socio)', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_toma_caducada', 'NT-060', 'Omar: toma caducó sin autorizar', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_liquidacion_cerrada', 'NT-061', 'Omar: liquidación semanal cerrada (texto, sin PDF)', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_fuera_de_alcance', 'NT-062', 'Omar: eso lo registran los dueños, ya les avisé', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], true),
  ('omar_sin_existencia', 'NT-063', 'Omar: existencia insuficiente para su toma (APAGADA, ampliación a confirmar)', 'F', false, false, 'OM', 'OMA', false, 168, 'M2a', array[]::text[], false),
  ('omar_vista_mercancia_llego', 'NT-064', 'Vista de Omar: mercancía llegó a su bodega', 'F', true, false, 'VO', 'OMA', false, 168, 'M2a', array['Ver']::text[], true),
  ('omar_vista_pago_a_favor', 'NT-065', 'Vista de Omar: pago registrado a su favor', 'F', true, false, 'VO', 'OMA', false, 168, 'M2a', array['Ver']::text[], true),
  ('omar_vista_conteo_proximo', 'NT-066', 'Vista de Omar: conteo próximo', 'F', true, false, 'VO', 'OMA', false, 168, 'M2a', array['Ver']::text[], true),
  ('comprobacion_dinero_falla', 'NT-067', 'Falla una comprobación de dinero (C2, C6 a C9, C17)', 'C', false, false, 'ST', 'CON', false, null, 'F3b', array['Explicar este número']::text[], true),
  ('comprobacion_bloqueante_falla', 'NT-068', 'Falla una comprobación bloqueante contable (C3, C4, C5, C10, C11, C12)', 'C', true, false, 'ST', 'CON', false, null, 'M2d', array['Ver diferencia', 'Reintentar']::text[], true),
  ('comprobacion_no_bloqueante', 'NT-069', 'Falla no bloqueante: el reporte sale PRELIMINAR', 'I', false, false, 'SW', 'CON', false, 720, 'M2d', array['Ver comprobaciones']::text[], true),
  ('integridad_nocturna_falla', 'NT-070', 'Integridad nocturna falla (inventario, cadena de auditoría)', 'C', false, true, 'STC', 'CON', false, null, 'M2d', array['Ver detalle']::text[], true),
  ('recordatorio_aprobar_periodo', 'NT-071', 'Periodo por aprobar (lunes 09:00 y 12:00)', 'I', true, false, 'ST', 'CON', false, 720, 'M2b', array['Revisar y aprobar (enlace web)']::text[], true),
  ('importacion_con_pendientes', 'NT-072', 'Importación con pendientes o duplicados', 'I', true, false, 'SW', 'MOV', false, 720, 'F3b', array['Resolver pendientes']::text[], true),
  ('movimientos_sin_clasificar', 'NT-073', 'Cobros o movimientos sin clasificar (48 h, 7 días)', 'I', true, false, 'SW', 'MOV', false, 720, 'M2d', array['Clasificar']::text[], true),
  ('ia_80_por_ciento', 'NT-074', 'IA al 80% del tope (día o mes) o llave de OpenRouter al 80%', 'I', false, false, 'ST', 'COS', true, 720, 'M2d', array['Ver costos']::text[], true),
  ('ia_100_modo_sin_ia', 'NT-075', 'IA al 100%: modo sin IA', 'I', false, true, 'ST', 'COS', true, 720, 'M2d', array['Ver costos']::text[], true),
  ('saldo_openrouter_bajo', 'NT-076', 'Saldo de OpenRouter bajo el mínimo', 'I', false, false, 'ST', 'COS', true, 720, 'M2d', array['Ver costos']::text[], true),
  ('modelo_ia_techo_o_retirado', 'NT-077', 'Modelo de IA sobre el techo de precio o retirado', 'I', false, false, 'ST', 'COS', true, 720, 'M2d', array['Ver modelos']::text[], true),
  ('renovaciones_proximas', 'NT-078', 'Renovaciones próximas (7 y 1 día)', 'F', false, false, 'SW', 'COS', true, 168, 'M2d', array['Ver costos']::text[], true),
  ('anomalia_costo', 'NT-079', 'Anomalía o cambio de plan en un costo', 'I', false, false, 'SW', 'COS', false, 720, 'M2d', array['Explicar']::text[], true),
  ('costos_dato_faltante', 'NT-080', 'Capturas de costos faltantes (días 1, 3 y 5)', 'F', true, false, 'ST', 'COS', false, 168, 'M2d', array['Capturar']::text[], true),
  ('conciliacion_costos_fuera_tolerancia', 'NT-081', 'Conciliación de costos fuera de tolerancia o tipo de cambio sin dato', 'I', false, false, 'SW', 'COS', false, 720, 'M2d', array['Ver conciliación']::text[], true),
  ('cargo_discrepado', 'NT-082', 'Un socio marca Discrepo en un cargo', 'I', false, false, 'ST', 'COS', true, 720, 'M2d', array['Ver cargo']::text[], true),
  ('reporte_semanal', 'NT-083', 'Reporte semanal (PRELIMINAR, DEFINITIVO o PARCIAL)', 'I', true, false, 'STC', 'REP', false, 720, 'M2b', array['Abrir reporte', 'Aprobar periodo (enlace)']::text[], true),
  ('reporte_mensual', 'NT-084', 'Reporte mensual', 'F', false, false, 'STC', 'REP', true, 168, 'M2b', array['Abrir reporte']::text[], true),
  ('reporte_gastos', 'NT-085', 'Mini reporte de gastos fijos y variables', 'F', false, false, 'STC', 'REP', true, 168, 'M2b', array['Abrir']::text[], true),
  ('liquidacion_isaac_viernes', 'NT-086', 'Liquidación con Isaac', 'I', false, false, 'STC', 'REP', true, 720, 'M2b', array['Abrir liquidación']::text[], true),
  ('reporte_no_salio', 'NT-087', 'Reporte programado no salió', 'C', true, true, 'STC', 'REP', false, null, 'M2b', array['Reintentar (24 h)']::text[], true),
  ('resumen_diario', 'NT-088', 'Resumen diario', 'F', false, false, 'ST', 'REP', true, 168, 'M2b', array['Ver pendientes']::text[], true),
  ('eco_indicacion', 'NT-089', 'Eco de indicación ejecutada', 'F', true, false, 'TG', 'AGE', false, 168, 'M2a', array['Deshacer (10 min)']::text[], true),
  ('pregunta_agente', 'NT-090', 'Pregunta del agente antes de ejecutar', 'I', true, false, 'TG', 'AGE', false, 720, 'M2a', array['Opciones', 'Cancelar']::text[], true),
  ('instruccion_sospechosa', 'NT-091', 'Instrucción sospechosa dentro de un mensaje o imagen', 'I', false, false, 'ST', 'AGE', true, 720, 'M2a', array['Ver mensaje']::text[], true),
  ('acceso_dispositivo_nuevo', 'NT-092', 'Primer acceso o dispositivo nuevo de un socio', 'I', true, false, 'SC', 'ACC', false, 720, 'F3b', array['Fui yo', 'No fui yo (web)']::text[], true),
  ('acceso_limite_intentos', 'NT-093', 'Límite de intentos de acceso alcanzado', 'I', false, false, 'SC', 'ACC', false, 720, 'F3b', array['Ver auditoría']::text[], true),
  ('acceso_omar_cambio', 'NT-094', 'Acceso de Omar activado o desactivado', 'I', false, false, 'SC', 'ACC', false, 720, 'M2a', array['Ver usuarios']::text[], true),
  ('usuario_alta_o_rol', 'NT-095', 'Alta de usuario, cambio de rol o de allowlist', 'C', false, false, 'SC', 'ACC', false, null, 'F3b', array['Ver auditoría']::text[], true),
  ('aislamiento_omar_violado', 'NT-096', 'Violación del aislamiento de Omar', 'C', false, false, 'ST', 'ACC', false, null, 'M2a', array['Ver auditoría']::text[], true),
  ('mensaje_omar_bloqueado', 'NT-097', 'enviar() bloqueó un mensaje al chat de Omar', 'C', false, false, 'ST', 'ACC', false, null, 'M2a', array['Ver mensaje']::text[], true),
  ('correo_autenticacion', 'NT-098', 'Correos de autenticación (transaccional)', 'F', false, false, 'CO', 'ACC', false, 168, 'F0', array[]::text[], true),
  ('grupo_membresia_anomala', 'NT-099', 'Miembro nuevo en el grupo, chat desconocido o chat migrado', 'C', false, false, 'STC', 'SIS', false, null, 'M2a', array['Ver miembros']::text[], true),
  ('telegram_entrega_muerta', 'NT-100', 'Telegram caído, destino inválido o entrega muerta', 'C', false, false, 'STC', 'SIS', false, null, 'M2a', array['Ver estado']::text[], true),
  ('webhook_cola_alta', 'NT-101', 'Webhook de Telegram con cola alta', 'C', false, false, 'STC', 'SIS', false, null, 'M2a', array['Ver estado']::text[], true),
  ('tarea_falla', 'NT-102', 'Tarea programada falla 3 veces seguidas', 'C', true, true, 'STC', 'SIS', false, null, 'M2a', array['Reintentar ahora', 'Ver detalle']::text[], true),
  ('tarea_sin_latido', 'NT-103', 'Tarea o latido sin ejecutarse', 'C', true, true, 'STC', 'SIS', false, null, 'M2a', array['Ejecutar ahora']::text[], true),
  ('freno_tormenta', 'NT-104', 'Freno de tormenta o excedente (N avisos más)', 'I', false, false, 'STC', 'SIS', true, 720, 'M2a', array['Ver en el software']::text[], true),
  ('respaldo_fallido', 'NT-105', 'Respaldo fallido o más de 8 días sin respaldo', 'C', true, false, 'STC', 'SIS', false, null, 'M3', array['Reintentar']::text[], true),
  ('restauracion_verificada', 'NT-106', 'Restauración mensual verificada', 'F', false, false, 'ST', 'SIS', true, 168, 'M3', array['Ver informe']::text[], true),
  ('exportacion_o_purga', 'NT-107', 'Exportación total o purga de capturas', 'I', false, false, 'ST', 'SIS', true, 720, 'M3', array['Ver auditoría']::text[], true),
  ('proveedor_modelo_nuevo', 'NT-108', 'Modelo nuevo en Karen', 'I', true, false, 'ST', 'PRV', true, 720, 'M2c', array['Dar costo', 'Ver', 'Ignorar este modelo']::text[], true),
  ('proveedor_sabor_nuevo', 'NT-109', 'Sabores nuevos en un modelo conocido', 'F', true, false, 'ST', 'PRV', false, 168, 'M2c', array['Ver', 'Ignorar este sabor']::text[], true),
  ('proveedor_sabor_agotado', 'NT-110', 'Sabor agotado en Karen (de los que se venden)', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Ver', 'Posponer 24 h', 'Ignorar']::text[], true),
  ('proveedor_modelo_agotado', 'NT-111', 'Modelo agotado completo en Karen', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Ver', 'Buscar con Isaac', 'Posponer']::text[], true),
  ('proveedor_regreso', 'NT-112', 'Regreso a disponibilidad en Karen', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Crear OC a Karen', 'Ver', 'Posponer']::text[], true),
  ('proveedor_descontinuado', 'NT-113', 'Modelo descontinuado en Karen', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Ver', 'Ignorar']::text[], true),
  ('proveedor_cambios_sin_impacto', 'NT-114', 'Cambios en lo que no se vende (agotado, regreso, renombrado, retirado)', 'F', false, false, 'SW', 'PRV', false, 168, 'M2c', array[]::text[], true),
  ('proveedor_nombres_por_confirmar', 'NT-115', 'Nombres por confirmar (renombrado o sabores sin vínculo)', 'F', true, false, 'SW', 'PRV', false, 168, 'M2c', array['Confirmar vínculo', 'Separar como modelo distinto']::text[], true),
  ('proveedor_poca_variedad', 'NT-116', 'Poca variedad en Karen', 'F', true, false, 'SW', 'PRV', false, 168, 'M2c', array['Ver']::text[], true),
  ('inventario_proveedores_degradado', 'NT-117', 'Inventario de proveedores desactualizado, bloqueado o con formato nuevo', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Ver estado', 'Pedir lista a Karen', 'Cargar lista manual']::text[], true),
  ('lectura_retenida', 'NT-118', 'Lectura retenida por cambio anómalo', 'I', true, false, 'ST', 'PRV', false, 720, 'M2c', array['Es real, publicar', 'Descartar lectura']::text[], true),
  ('promocion_nueva', 'NT-119', 'Promoción nueva en el inventario de proveedores', 'I', true, false, 'ST', 'PRO', false, 720, 'M2c', array['Ver', 'Posponer 24 h', 'Ignorar']::text[], true),
  ('promocion_anunciada', 'NT-120', 'Promoción anunciada con fecha', 'F', true, false, 'ST', 'PRO', false, 168, 'M2c', array['Ver', 'Recordarme el día de inicio']::text[], true),
  ('promocion_por_terminar', 'NT-121', 'Promoción por terminar (24 h antes)', 'I', true, false, 'ST', 'PRO', false, 720, 'M2c', array['Crear OC a Karen', 'Ver']::text[], true),
  ('promocion_terminada', 'NT-122', 'Promoción terminada', 'F', false, false, 'SW', 'PRO', false, 168, 'M2c', array[]::text[], true),
  ('periodo_cascada_cerrado','NT-047','Cierre de reparto firmado','I', false, false, 'ST','SOC', false, 720, 'F3a', array[]::text[], true);

-- Los emisores de F3b declaran la lista de claves que su payload puede llevar (referencias, nunca texto con cifras).
update notificacion.tipo set campos_permitidos = array['conteo_id', 'ubicacion', 'lineas', 'diferencias', 'exactitud_bp'] where codigo = 'conteo_con_diferencia';
update notificacion.tipo set campos_permitidos = array['comprobacion'] where codigo in ('comprobacion_dinero_falla', 'cuenta_proveedor_no_cuadra');
update notificacion.tipo set campos_permitidos = array['proveedor'] where codigo in ('saldo_negativo_karen', 'saldo_proveedor_cruza_cero');
update notificacion.tipo set campos_permitidos = array['periodo_id', 'estado'] where codigo = 'accion_fuerte_o_periodo';
update notificacion.tipo set campos_permitidos = array['rol', 'activo'] where codigo = 'usuario_alta_o_rol';

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------
alter table operacion.aviso add column version int not null default 1;
alter table operacion.aviso add column grupo_clave text;
alter table operacion.aviso add column resuelta_canal text check (resuelta_canal in ('web', 'telegram', 'sistema'));
alter table operacion.aviso add constraint aviso_codigo_fk foreign key (codigo) references notificacion.tipo (codigo);

-- Leida y resuelta son independientes: un aviso con accion sigue en "Tu turno" hasta que cese la condicion.
create table notificacion.destinatario (
  aviso_id bigint not null references operacion.aviso (id),
  usuario_id uuid not null,
  leida_at timestamptz,
  silenciada_hasta timestamptz,
  primary key (aviso_id, usuario_id)
);
insert into notificacion.destinatario (aviso_id, usuario_id, leida_at) select aviso_id, usuario_id, leida_at from operacion.aviso_lectura;
drop table operacion.aviso_lectura;
create index destinatario_usuario_idx on notificacion.destinatario (usuario_id) where leida_at is null;

create table notificacion.destino (
  clave text primary key check (clave in ('grupo_socios', 'socios', 'privado_omar')),
  telegram_chat_id bigint,
  activo boolean not null default true
);
insert into notificacion.destino (clave) values ('grupo_socios'), ('socios'), ('privado_omar');

create table notificacion.entrega (
  id bigint generated always as identity primary key,
  notificacion_id bigint not null references operacion.aviso (id),
  canal text not null check (canal in ('telegram', 'correo')),
  destino_clave text not null references notificacion.destino (clave),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviada', 'entregada', 'fallida', 'incierta', 'muerta', 'omitida')),
  grupo_clave text,
  intentos int not null default 0 check (intentos >= 0),
  siguiente_intento_at timestamptz not null default now(),
  lease_hasta timestamptz,
  mensaje_externo_id text,
  codigo_error text,
  reenvio boolean not null default false,
  creada_at timestamptz not null default now(),
  enviada_at timestamptz,
  unique (notificacion_id, canal, destino_clave)
);
create index entrega_cola_idx on notificacion.entrega (siguiente_intento_at) where estado in ('pendiente', 'enviando');
create index entrega_grupo_idx on notificacion.entrega (canal, destino_clave, grupo_clave, creada_at);

-- Solo el codigo de error: jamas el contenido del mensaje.
create table notificacion.entrega_intento (
  id bigint generated always as identity primary key,
  entrega_id bigint not null references notificacion.entrega (id),
  resultado text not null,
  http int,
  codigo text,
  creado_at timestamptz not null default now()
);

create table notificacion.miembro (
  telegram_user_id bigint primary key,
  usuario_id uuid,
  rol text not null check (rol in ('socio', 'omar')),
  activo boolean not null default true
);

create table notificacion.accion_token (
  token text primary key check (token ~ '^[0-9A-Za-z]{10}$'),
  notificacion_id bigint not null references operacion.aviso (id),
  accion text not null,
  roles_permitidos text[] not null,
  chat_id bigint not null,
  version int not null,
  grupo_exclusivo text,
  expira_at timestamptz not null,
  usado_at timestamptz,
  usado_por bigint,
  callback_query_id text,
  invalidado boolean not null default false
);
create index accion_token_notif_idx on notificacion.accion_token (notificacion_id);

create table notificacion.pulsacion (
  id bigint generated always as identity primary key,
  telegram_user_id bigint not null,
  token text,
  resultado text not null,
  creado_at timestamptz not null default now()
);
create index pulsacion_usuario_idx on notificacion.pulsacion (telegram_user_id, creado_at);

create table notificacion.estado_evaluador (
  clave text primary key,
  valor jsonb not null,
  actualizado_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['entrega_intento', 'pulsacion'] loop
    execute format('create trigger %I before update or delete on notificacion.%I for each row execute function seguridad.t1_solo_insercion()', t || '_t1', t);
    execute format('create trigger %I before truncate on notificacion.%I for each statement execute function seguridad.t1_solo_insercion()', t || '_t1t', t);
    execute format('revoke delete, truncate on notificacion.%I from postgres', t);
  end loop;
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'notificacion' and c.relkind = 'r' loop
    execute format('alter table notificacion.%I enable row level security', t);
    execute format('alter table notificacion.%I force row level security', t);
    execute format('revoke all on notificacion.%I from public, anon, authenticated', t);
  end loop;
end $$;
revoke all on all sequences in schema notificacion from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guardia: solo el sistema (rol servidor del latido o postgres local) ejecuta el despacho. La web usa api.*.
-- ---------------------------------------------------------------------------
create function notificacion.exigir_sistema() returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if session_user not in ('servidor', 'postgres') then raise exception 'permiso denegado' using errcode = '42501'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Entregas por canal (outbox): se crean al emitir, en la misma transaccion del hecho.
-- ---------------------------------------------------------------------------
create function notificacion.crear_entregas(p_aviso bigint) returns int
language plpgsql security definer set search_path = ''
as $$
declare
  a operacion.aviso; t notificacion.tipo; v_tg boolean; v_co boolean; v_tg_on boolean; v_co_on boolean; v_grupo text; v_primero timestamptz; v_sig timestamptz; v_n int := 0;
  v_vent int := catalogo.config_num('notif_ventana_agrupacion_min')::int;
begin
  select * into a from operacion.aviso where id = p_aviso;
  select * into t from notificacion.tipo where codigo = a.codigo;
  v_tg := t.canal in ('ST', 'STC', 'TG');
  v_co := t.canal in ('STC', 'SC', 'CO');
  v_tg_on := coalesce((select activo from seguridad.interruptor where clave = 'telegram_envio'), false);
  v_co_on := coalesce((select activo from seguridad.interruptor where clave = 'correo_envio'), false);
  v_grupo := coalesce(a.grupo_clave, case when t.agrupable then t.codigo end);
  if v_tg then
    v_sig := now();
    if t.agrupable and v_grupo is not null then
      select min(e.creada_at) into v_primero from notificacion.entrega e
        where e.canal = 'telegram' and e.destino_clave = 'grupo_socios' and e.grupo_clave = v_grupo and e.estado <> 'omitida' and e.creada_at > now() - make_interval(mins => v_vent);
      if v_primero is not null then v_sig := v_primero + make_interval(mins => v_vent); end if;
    end if;
    insert into notificacion.entrega (notificacion_id, canal, destino_clave, estado, grupo_clave, siguiente_intento_at, codigo_error)
      values (p_aviso, 'telegram', 'grupo_socios', case when v_tg_on then 'pendiente' else 'omitida' end, v_grupo, v_sig, case when v_tg_on then null else 'interruptor_apagado' end)
      on conflict do nothing;
    v_n := v_n + 1;
  end if;
  if v_co then
    insert into notificacion.entrega (notificacion_id, canal, destino_clave, estado, grupo_clave, siguiente_intento_at, codigo_error)
      values (p_aviso, 'correo', 'socios', case when v_co_on then 'pendiente' else 'omitida' end, null,
              case when t.canal = 'STC' and t.codigo not like 'reporte%' then now() + make_interval(hours => catalogo.config_num('notif_correo_demora_horas')::int) else now() end,
              case when v_co_on then null else 'interruptor_apagado' end)
      on conflict do nothing;
    v_n := v_n + 1;
  end if;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Emision: operacion.avisar() es la unica entrada. Misma clave => solo sube el conteo.
-- ---------------------------------------------------------------------------
create or replace function operacion.avisar(p_codigo text, p_nt text, p_clave text, p_severidad text, p_titulo text, p_entidad_tipo text, p_entidad_id bigint,
                                            p_payload jsonb default '{}'::jsonb, p_duenio_socio_id bigint default null, p_evento_id bigint default null,
                                            p_solo_otro boolean default false, p_canales text[] default array['software']) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_id bigint; v_nuevo boolean; t notificacion.tipo; v_caduca timestamptz; v_canales text[]; v_sev text;
begin
  select * into t from notificacion.tipo where codigo = p_codigo;
  if not found then raise exception 'tipo de notificacion desconocido: %', p_codigo using errcode = '22023'; end if;
  if not t.activo then return null; end if;
  if t.campos_permitidos is not null and exists (select 1 from jsonb_object_keys(p_payload) k where k <> all (t.campos_permitidos)) then
    raise exception 'el payload de % lleva claves no permitidas', p_codigo using errcode = '22023';
  end if;
  -- La severidad del catalogo manda; un emisor puede subirla (por ejemplo un conteo con exactitud baja es critico) y entonces no caduca.
  v_sev := case when p_severidad in ('C', 'I', 'F') then p_severidad else t.severidad end;
  v_caduca := case when v_sev = 'C' or t.ttl_horas is null then null else now() + make_interval(hours => t.ttl_horas) end;
  v_canales := array['software'] || case t.canal when 'ST' then array['telegram'] when 'TG' then array['telegram'] when 'STC' then array['telegram', 'correo'] when 'SC' then array['correo'] when 'CO' then array['correo'] else array[]::text[] end;
  insert into operacion.aviso (codigo, nt, clave_dedupe, severidad, titulo, entidad_tipo, entidad_id, payload, duenio_socio_id, actor_socio_id, solo_otro, canales_previstos, evento_id, caduca_at)
  values (p_codigo, coalesce(p_nt, t.nt), p_clave, v_sev, p_titulo, p_entidad_tipo, p_entidad_id, p_payload, p_duenio_socio_id, operacion.actor_socio(), p_solo_otro, v_canales, p_evento_id, v_caduca)
  on conflict (clave_dedupe) do update set conteo = operacion.aviso.conteo + 1, actualizado_at = now()
  returning id, (xmax = 0) into v_id, v_nuevo;
  if v_nuevo then
    if t.canal not in ('OM', 'VO') then
      insert into notificacion.destinatario (aviso_id, usuario_id)
        select v_id, u.id from seguridad.usuario u where u.rol = 'socio' and u.activo on conflict do nothing;
    end if;
    perform notificacion.crear_entregas(v_id);
  end if;
  return v_id;
end $$;

-- Un asunto recurrente (comprobacion que falla, saldo negativo): una sola fila abierta por entidad; cada pasada solo sube el conteo.
create function notificacion.emitir_recurrente(p_codigo text, p_entidad_tipo text, p_entidad_id bigint, p_titulo text, p_payload jsonb default '{}'::jsonb) returns bigint
language plpgsql security definer set search_path = ''
as $$
declare v_clave text;
begin
  select clave_dedupe into v_clave from operacion.aviso where codigo = p_codigo and entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id and estado = 'abierta' order by id desc limit 1;
  if v_clave is null then
    v_clave := p_codigo || ':' || p_entidad_tipo || ':' || p_entidad_id || ':' || ((select count(*) from operacion.aviso where codigo = p_codigo and entidad_tipo = p_entidad_tipo and entidad_id = p_entidad_id) + 1);
  end if;
  return operacion.avisar(p_codigo, null, v_clave, null, p_titulo, p_entidad_tipo, p_entidad_id, p_payload);
end $$;

-- ---------------------------------------------------------------------------
-- Despacho: reclamar, registrar resultado, caducar. Lo ejecuta el latido (rol servidor).
-- ---------------------------------------------------------------------------
create function notificacion.reclamar_entregas(p_limite int default 10, p_lease_seg int default 120) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r record; v_out jsonb := '[]'::jsonb; v_dest text[] := '{}'; v_n int := 0; v_ids bigint[]; v_clave text; v_hora int; v_info int; v_tormenta int; v_afectadas int;
  v_presup int := catalogo.config_num('notif_presupuesto_hora')::int; v_freno int := catalogo.config_num('notif_freno_tormenta_hora')::int;
  v_tg_on boolean := coalesce((select activo from seguridad.interruptor where clave = 'telegram_envio'), false);
  v_co_on boolean := coalesce((select activo from seguridad.interruptor where clave = 'correo_envio'), false);
  v_pausa boolean := coalesce((select activo from seguridad.interruptor where clave = 'cron_pausado'), false);
  v_sil boolean; v_miembros jsonb;
begin
  perform notificacion.exigir_sistema();
  if v_pausa then return v_out; end if;
  -- Lease vencido: la entrega pudo salir. Una tarjeta con accion se reenvia; un informativo queda `incierta`.
  update notificacion.entrega e set estado = case when t.requiere_accion then 'pendiente' else 'incierta' end, lease_hasta = null, reenvio = t.requiere_accion,
         siguiente_intento_at = now(), codigo_error = 'lease_vencido'
    from operacion.aviso a, notificacion.tipo t where a.id = e.notificacion_id and t.codigo = a.codigo and e.estado = 'enviando' and e.lease_hasta < now();
  -- Una tarjeta con accion cuyo asunto ya no esta abierto no se envia.
  update notificacion.entrega e set estado = 'omitida', codigo_error = 'ya_resuelta'
    from operacion.aviso a, notificacion.tipo t where a.id = e.notificacion_id and t.codigo = a.codigo and e.estado = 'pendiente' and t.requiere_accion and a.estado <> 'abierta';
  -- Freno de tormenta: pasado el limite por hora se detienen los individuales y sale un solo aviso.
  select count(*) into v_tormenta from notificacion.entrega where canal = 'telegram' and estado = 'enviada' and enviada_at > now() - interval '1 hour';
  if v_tormenta > v_freno then
    update notificacion.entrega e set estado = 'omitida', codigo_error = 'freno_tormenta'
      from operacion.aviso a, notificacion.tipo t where a.id = e.notificacion_id and t.codigo = a.codigo and e.canal = 'telegram' and e.estado = 'pendiente' and not t.requiere_accion and a.severidad <> 'C';
    get diagnostics v_afectadas = row_count;
    if v_afectadas > 0 then
      perform operacion.avisar('freno_tormenta', null, 'freno_tormenta:' || to_char(now() at time zone 'America/Merida', 'YYYYMMDDHH24'), 'I', 'Eventos agrupados por exceso de mensajes en una hora', null, null, jsonb_build_object('eventos', v_afectadas));
    end if;
  end if;
  v_hora := extract(hour from (now() at time zone 'America/Merida'))::int;
  select count(*) into v_info from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id join notificacion.tipo t on t.codigo = a.codigo
    where e.canal = 'telegram' and e.estado = 'enviada' and e.enviada_at > now() - interval '1 hour' and not t.requiere_accion and a.severidad <> 'C';
  for r in
    select e.id, e.canal, e.destino_clave, e.grupo_clave, a.severidad, a.codigo, t.requiere_accion
      from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id join notificacion.tipo t on t.codigo = a.codigo
     where e.estado = 'pendiente' and e.siguiente_intento_at <= now() and ((e.canal = 'telegram' and v_tg_on) or (e.canal = 'correo' and v_co_on))
       and not exists (select 1 from notificacion.entrega x where x.estado = 'enviando' and x.canal = e.canal and x.destino_clave = e.destino_clave)
     order by (a.severidad = 'C') desc, e.creada_at, e.id
       for update of e skip locked
  loop
    v_clave := r.canal || ':' || r.destino_clave;
    if v_clave = any (v_dest) then continue; end if;
    exit when v_n >= p_limite;
    if r.canal = 'telegram' and not r.requiere_accion and r.severidad <> 'C' and v_info >= v_presup then
      -- Excedente del presupuesto horario: espera a la hora siguiente (y entra en el resumen).
      update notificacion.entrega set siguiente_intento_at = date_trunc('hour', now()) + interval '1 hour' where id = r.id;
      continue;
    end if;
    select array_agg(q.id order by q.creada_at, q.id) into v_ids from (
      select x.id, x.creada_at from notificacion.entrega x
       where x.estado = 'pendiente' and x.siguiente_intento_at <= now() and x.canal = r.canal and x.destino_clave = r.destino_clave and (x.id = r.id or (r.grupo_clave is not null and x.grupo_clave = r.grupo_clave))
         for update skip locked) q;
    update notificacion.entrega set estado = 'enviando', lease_hasta = now() + make_interval(secs => p_lease_seg) where id = any (v_ids);
    v_dest := v_dest || v_clave;
    if r.canal = 'telegram' and not r.requiere_accion and r.severidad <> 'C' then v_info := v_info + 1; end if;
    v_sil := (v_hora >= catalogo.config_num('notif_silencio_ini_hora')::int or v_hora < catalogo.config_num('notif_silencio_fin_hora')::int) and r.severidad <> 'C' and r.codigo not like 'reporte%';
    select jsonb_agg(jsonb_build_object('entrega_id', e.id, 'notificacion_id', a.id, 'tipo', a.codigo, 'severidad', a.severidad, 'version', a.version, 'titulo', a.titulo, 'payload', a.payload,
                                         'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id, 'conteo', a.conteo, 'requiere_accion', t.requiere_accion, 'botones', to_jsonb(t.botones), 'reenvio', e.reenvio) order by e.creada_at, e.id)
      into v_miembros from notificacion.entrega e join operacion.aviso a on a.id = e.notificacion_id join notificacion.tipo t on t.codigo = a.codigo where e.id = any (v_ids);
    v_out := v_out || jsonb_build_array(jsonb_build_object('canal', r.canal, 'destino', r.destino_clave, 'grupo_clave', r.grupo_clave, 'silencioso', v_sil,
      'telegram_chat_id', (select telegram_chat_id from notificacion.destino where clave = r.destino_clave), 'miembros', v_miembros));
    v_n := v_n + 1;
  end loop;
  return v_out;
end $$;

-- Resultado de un intento de envio. 429: espera retry_after sin gastar intento; 5xx o red: 30, 60, 120, 240 s y luego 1 h hasta 5 intentos o 24 h;
-- 403: sin destino; 400 de formato: muerta; 400 con migrate_to_chat_id: se actualiza el chat y se reintenta. `p_incierto`: el envio pudo haber salido.
create function notificacion.registrar_resultado(p_entrega bigint, p_resultado text, p_http int default null, p_retry_after int default null, p_codigo text default null,
                                                 p_mensaje_id text default null, p_incierto boolean default false, p_migrar_a bigint default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  e notificacion.entrega; t notificacion.tipo; v_backoff jsonb := catalogo.config_valor('notif_backoff_seg'); v_int int; v_estado text; v_espera int;
  v_max int := catalogo.config_num('notif_intentos_max')::int;
begin
  perform notificacion.exigir_sistema();
  if p_resultado not in ('ok', '429', '5xx', 'red', '403', '400_formato', '400_migrar') then raise exception 'resultado desconocido' using errcode = '22023'; end if;
  select * into e from notificacion.entrega where id = p_entrega for update;
  if not found or e.estado <> 'enviando' then raise exception 'la entrega no esta en envio' using errcode = 'P0428'; end if;
  select tp.* into t from notificacion.tipo tp join operacion.aviso a on a.codigo = tp.codigo where a.id = e.notificacion_id;
  insert into notificacion.entrega_intento (entrega_id, resultado, http, codigo) values (p_entrega, p_resultado, p_http, p_codigo);
  if p_resultado = 'ok' then
    update notificacion.entrega set estado = 'enviada', enviada_at = now(), lease_hasta = null, mensaje_externo_id = p_mensaje_id, intentos = intentos + 1, codigo_error = null where id = p_entrega;
    return 'enviada';
  elsif p_resultado = '429' then
    update notificacion.entrega set estado = 'pendiente', lease_hasta = null, siguiente_intento_at = now() + make_interval(secs => coalesce(p_retry_after, 1)), codigo_error = '429' where id = p_entrega;
    return 'pendiente';
  elsif p_resultado = '400_migrar' then
    if p_migrar_a is null then raise exception 'falta el chat nuevo' using errcode = '22023'; end if;
    update notificacion.destino set telegram_chat_id = p_migrar_a where clave = e.destino_clave;
    update notificacion.entrega set estado = 'pendiente', lease_hasta = null, siguiente_intento_at = now(), codigo_error = 'chat_migrado' where id = p_entrega;
    return 'pendiente';
  elsif p_resultado = '403' or p_resultado = '400_formato' then
    update notificacion.entrega set estado = 'muerta', lease_hasta = null, intentos = intentos + 1, codigo_error = case p_resultado when '403' then 'sin_destino' else 'formato' end where id = p_entrega;
    v_estado := 'muerta';
  else
    v_int := e.intentos + 1;
    if v_int >= v_max or now() - e.creada_at >= make_interval(hours => catalogo.config_num('notif_entrega_horas_max')::int) then
      v_estado := case when p_incierto and not t.requiere_accion then 'incierta' else 'muerta' end;
      update notificacion.entrega set estado = v_estado, lease_hasta = null, intentos = v_int, codigo_error = coalesce(p_codigo, p_resultado) where id = p_entrega;
    elsif p_incierto and t.requiere_accion then
      update notificacion.entrega set estado = 'pendiente', lease_hasta = null, intentos = v_int, reenvio = true, siguiente_intento_at = now(), codigo_error = 'reenvio_por_incierta' where id = p_entrega;
      return 'pendiente';
    else
      v_espera := (v_backoff -> least(v_int, jsonb_array_length(v_backoff)) - 1)::text::int;
      update notificacion.entrega set estado = 'pendiente', lease_hasta = null, intentos = v_int, siguiente_intento_at = now() + make_interval(secs => v_espera), codigo_error = coalesce(p_codigo, p_resultado) where id = p_entrega;
      return 'pendiente';
    end if;
  end if;
  -- Con la entrega muerta y el asunto abierto, la campana lo dice ("Telegram no salio") y el sistema avisa una vez al dia.
  if v_estado = 'muerta' and e.canal = 'telegram' then
    perform operacion.avisar('telegram_entrega_muerta', null, 'telegram_entrega_muerta:' || to_char(negocio.hoy(), 'YYYYMMDD'), 'C', 'Un aviso no salio por Telegram', 'entrega', p_entrega, '{}'::jsonb);
  end if;
  return v_estado;
end $$;

create function notificacion.caducar_vencidas() returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  perform notificacion.exigir_sistema();
  update operacion.aviso set estado = 'caducada', actualizado_at = now(), resuelta_canal = 'sistema' where estado = 'abierta' and caduca_at is not null and caduca_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Con Telegram caido (entrega pendiente, muerta o incierta de un asunto C o con accion) mas de 2 h sale un correo de una linea sin cifras; maximo uno por hora.
create function notificacion.respaldo_correo() returns int
language plpgsql security definer set search_path = ''
as $$
declare v_a bigint; v_on boolean := coalesce((select activo from seguridad.interruptor where clave = 'correo_envio'), false);
  v_h int := catalogo.config_num('notif_correo_respaldo_horas')::int;
begin
  perform notificacion.exigir_sistema();
  if exists (select 1 from notificacion.entrega e where e.canal = 'correo' and e.creada_at > now() - interval '1 hour' and e.codigo_error is not distinct from 'respaldo') then return 0; end if;
  select a.id into v_a from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo join notificacion.entrega g on g.notificacion_id = a.id and g.canal = 'telegram'
   where a.estado = 'abierta' and (a.severidad = 'C' or t.requiere_accion) and g.estado in ('pendiente', 'muerta', 'incierta') and g.creada_at < now() - make_interval(hours => v_h)
     and not exists (select 1 from notificacion.entrega c where c.notificacion_id = a.id and c.canal = 'correo')
   order by a.id limit 1;
  if v_a is null then return 0; end if;
  insert into notificacion.entrega (notificacion_id, canal, destino_clave, estado, siguiente_intento_at, codigo_error)
    values (v_a, 'correo', 'socios', case when v_on then 'pendiente' else 'omitida' end, now(), 'respaldo');
  return 1;
end $$;

-- ---------------------------------------------------------------------------
-- Tokens de un solo uso para los botones de Telegram. callback_data = 'n:' + token (10 caracteres, nunca monto, folio ni accion).
-- ---------------------------------------------------------------------------
create function notificacion.crear_token(p_notificacion bigint, p_accion text, p_roles text[], p_chat bigint, p_grupo_exclusivo text default null) returns text
language plpgsql security definer set search_path = ''
as $$
declare v_tok text; a operacion.aviso; v_ttl numeric; v_cfg jsonb := catalogo.config_valor('notif_token_ttl_min');
begin
  perform notificacion.exigir_sistema();
  select * into a from operacion.aviso where id = p_notificacion;
  if not found then raise exception 'notificacion desconocida' using errcode = '22023'; end if;
  v_ttl := coalesce((v_cfg ->> p_accion)::numeric, (v_cfg ->> 'por_omision')::numeric);
  loop
    v_tok := substr(translate(encode(sha256((gen_random_uuid()::text || clock_timestamp()::text)::bytea), 'base64'), '+/=', 'abc'), 1, 10);
    exit when not exists (select 1 from notificacion.accion_token where token = v_tok);
  end loop;
  insert into notificacion.accion_token (token, notificacion_id, accion, roles_permitidos, chat_id, version, grupo_exclusivo, expira_at)
    values (v_tok, p_notificacion, p_accion, p_roles, p_chat, a.version, p_grupo_exclusivo, now() + make_interval(mins => v_ttl::int));
  return v_tok;
end $$;

-- Validaciones en orden: (1) quien pulsa es miembro con rol permitido; (2) el chat es el del token; (3) caducidad; (4) un solo uso, y los botones del mismo
-- grupo exclusivo (Autorizar/Rechazar) se invalidan entre si; (5) version vigente. Cada pulsacion queda auditada; la repetida del mismo callback devuelve lo mismo.
create function notificacion.consumir_token(p_token text, p_telegram_user bigint, p_chat bigint, p_callback text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  k notificacion.accion_token; a operacion.aviso; m notificacion.miembro; v_prev jsonb; v_res jsonb; v_n int;
  v_max int := catalogo.config_num('notif_token_pulsaciones_min')::int;
begin
  perform notificacion.exigir_sistema();
  v_prev := seguridad.iniciar_operacion('tg:cb:' || p_callback, jsonb_build_object('t', p_token, 'u', p_telegram_user, 'c', p_chat));
  if v_prev is not null then return v_prev; end if;
  select count(*) into v_n from notificacion.pulsacion where telegram_user_id = p_telegram_user and creado_at > now() - interval '1 minute';
  if v_n >= v_max then
    v_res := jsonb_build_object('ok', false, 'motivo', 'limite');
  else
    select * into k from notificacion.accion_token where token = p_token for update;
    select * into m from notificacion.miembro where telegram_user_id = p_telegram_user and activo;
    if not found then v_res := jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
    elsif k.token is null then v_res := jsonb_build_object('ok', false, 'motivo', 'token_desconocido');
    elsif not (m.rol = any (k.roles_permitidos)) then v_res := jsonb_build_object('ok', false, 'motivo', 'no_autorizado');
    elsif k.chat_id <> p_chat then v_res := jsonb_build_object('ok', false, 'motivo', 'chat_distinto');
    elsif k.invalidado then v_res := jsonb_build_object('ok', false, 'motivo', 'invalidado');
    elsif k.usado_at is not null then v_res := jsonb_build_object('ok', false, 'motivo', 'ya_usado');
    elsif k.expira_at <= now() then v_res := jsonb_build_object('ok', false, 'motivo', 'caducado');
    else
      select * into a from operacion.aviso where id = k.notificacion_id for update;
      if a.version <> k.version then v_res := jsonb_build_object('ok', false, 'motivo', 'tarjeta_cambio');
      elsif a.estado <> 'abierta' then v_res := jsonb_build_object('ok', false, 'motivo', 'ya_resuelta', 'estado', a.estado);
      else
        update notificacion.accion_token set usado_at = now(), usado_por = p_telegram_user, callback_query_id = p_callback where token = p_token and usado_at is null;
        if k.grupo_exclusivo is not null then
          update notificacion.accion_token set invalidado = true where notificacion_id = k.notificacion_id and grupo_exclusivo = k.grupo_exclusivo and token <> p_token and usado_at is null;
        end if;
        v_res := jsonb_build_object('ok', true, 'motivo', 'ok', 'accion', k.accion, 'notificacion_id', k.notificacion_id);
      end if;
    end if;
  end if;
  insert into notificacion.pulsacion (telegram_user_id, token, resultado) values (p_telegram_user, p_token, v_res ->> 'motivo');
  perform seguridad.terminar_operacion('tg:cb:' || p_callback, v_res);
  return v_res;
end $$;

-- ---------------------------------------------------------------------------
-- Evaluadores (los corre el latido): comprobaciones de dinero, cuenta con el proveedor y posicion entre socios.
-- ---------------------------------------------------------------------------
create function notificacion.evaluar(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_hoy date := coalesce(p_hoy, negocio.hoy()); c record; p record; v_n int := 0; v_ant jsonb; v_signo int; v_neto bigint; v_ult bigint; v_umbral bigint := catalogo.config_num('posicion_socios_cambio_cent')::bigint;
  v_pct numeric := catalogo.config_num('posicion_socios_cambio_pct'); v_saldo bigint; v_clave text;
begin
  perform notificacion.exigir_sistema();
  -- NT-067 y NT-025: una sola fila abierta por comprobacion; se resuelve sola cuando cuadra.
  for c in select codigo, nombre, ok from contabilidad.comprobaciones() where codigo in ('C2', 'C6', 'C7', 'C8', 'C9', 'C17') loop
    if c.ok then
      perform operacion.resolver_avisos(case when c.codigo = 'C7' then 'cuenta_proveedor_no_cuadra' else 'comprobacion_dinero_falla' end, 'comprobacion', substr(c.codigo, 2)::bigint);
    else
      perform notificacion.emitir_recurrente(case when c.codigo = 'C7' then 'cuenta_proveedor_no_cuadra' else 'comprobacion_dinero_falla' end, 'comprobacion', substr(c.codigo, 2)::bigint,
        'No cuadra la comprobacion ' || c.codigo || ': ' || c.nombre, jsonb_build_object('comprobacion', c.codigo));
      v_n := v_n + 1;
    end if;
  end loop;
  -- NT-028 (se le debe a Karen) y NT-027 (el saldo cruza cero).
  for p in select pr.id, pr.nombre from catalogo.proveedor pr loop
    v_saldo := operacion.saldo_proveedor(p.id);
    if p.nombre = 'Karen' then
      if v_saldo < 0 then
        perform notificacion.emitir_recurrente('saldo_negativo_karen', 'proveedor', p.id, 'Se le debe a Karen: el saldo con la proveedora es negativo', jsonb_build_object('proveedor', p.nombre));
        v_n := v_n + 1;
      else
        perform operacion.resolver_avisos('saldo_negativo_karen', 'proveedor', p.id);
      end if;
    end if;
    v_signo := sign(v_saldo)::int;
    select valor into v_ant from notificacion.estado_evaluador where clave = 'signo_proveedor:' || p.id;
    if v_ant is not null and (v_ant #>> '{}')::int <> v_signo and v_signo <> 0 and (v_ant #>> '{}')::int <> 0 then
      perform operacion.avisar('saldo_proveedor_cruza_cero', null, 'cruce:' || p.id || ':' || v_hoy || ':' || v_signo, 'I', 'El saldo con ' || p.nombre || ' cruzo cero', 'proveedor', p.id, jsonb_build_object('proveedor', p.nombre));
      v_n := v_n + 1;
    end if;
    insert into notificacion.estado_evaluador (clave, valor) values ('signo_proveedor:' || p.id, to_jsonb(v_signo))
      on conflict (clave) do update set valor = excluded.valor, actualizado_at = now() where notificacion.estado_evaluador.valor is distinct from excluded.valor;
  end loop;
  -- NT-041: la posicion entre socios cambia 5,000 pesos o 20 %; maximo una al dia.
  select abs(operacion.neto_socio(s.id)) into v_neto from catalogo.socio s where s.nombre = 'Angelo';
  select (valor #>> '{}')::bigint into v_ult from notificacion.estado_evaluador where clave = 'posicion_socios';
  if v_ult is null then
    insert into notificacion.estado_evaluador (clave, valor) values ('posicion_socios', to_jsonb(v_neto));
  elsif abs(v_neto - v_ult) >= v_umbral or (v_ult <> 0 and abs(v_neto - v_ult) * 100 >= v_pct * abs(v_ult)) then
    perform operacion.avisar('posicion_socios_cambia', null, 'posicion_socios:' || v_hoy, 'I', 'La posicion entre socios cambio de forma importante', 'socios', null, '{}'::jsonb);
    update notificacion.estado_evaluador set valor = to_jsonb(v_neto), actualizado_at = now() where clave = 'posicion_socios';
    v_n := v_n + 1;
  end if;
  return jsonb_build_object('emitidas', v_n);
end $$;

-- Un pulso del latido local: caduca, evalua y revisa el respaldo por correo. Idempotente.
create function notificacion.latido(p_hoy date default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_cad int; v_ev jsonb; v_resp int;
begin
  perform notificacion.exigir_sistema();
  v_cad := notificacion.caducar_vencidas();
  v_ev := notificacion.evaluar(p_hoy);
  v_resp := notificacion.respaldo_correo();
  return jsonb_build_object('caducadas', v_cad, 'evaluacion', v_ev, 'respaldos', v_resp);
end $$;

-- ---------------------------------------------------------------------------
-- Emisores por trigger: periodos (NT-047) y altas o cambios de acceso (NT-095, solo software y correo; nunca Telegram).
-- ---------------------------------------------------------------------------
create function notificacion.t_periodo() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.estado in ('aprobado', 'publicado') and old.estado is distinct from new.estado then
    perform operacion.avisar('accion_fuerte_o_periodo', null, 'periodo:' || new.id || ':' || new.estado, 'I', 'Periodo ' || to_char(new.ini, 'DD/MM/YYYY') || ' al ' || to_char(new.fin, 'DD/MM/YYYY') || ': ' || new.estado,
                             'periodo', new.id, jsonb_build_object('periodo_id', new.id, 'estado', new.estado));
  end if;
  return new;
end $$;
create trigger periodo_aviso after update on contabilidad.periodo for each row execute function notificacion.t_periodo();

create function notificacion.t_reapertura() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform operacion.avisar('accion_fuerte_o_periodo', null, 'periodo:' || new.periodo_id || ':reabierto:' || new.id, 'I', 'Periodo reabierto con motivo registrado', 'periodo', new.periodo_id,
                           jsonb_build_object('periodo_id', new.periodo_id, 'estado', 'reabierto'));
  return new;
end $$;
create trigger reapertura_aviso after insert on contabilidad.reapertura for each row execute function notificacion.t_reapertura();

create function notificacion.t_correo_permitido() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.rol is distinct from old.rol or new.activo is distinct from old.activo then
    perform operacion.avisar('usuario_alta_o_rol', null, 'usuario:' || substr(encode(sha256(convert_to(new.correo, 'UTF8')), 'hex'), 1, 12) || ':' || new.rol || ':' || new.activo, 'C', 'Alta de usuario o cambio de rol o de la lista de acceso', 'usuario', null,
                             jsonb_build_object('rol', new.rol, 'activo', new.activo));
  end if;
  return new;
end $$;
-- La clave del aviso no puede llevar el correo (dato personal): se usa un hash corto.
create trigger correo_permitido_aviso after insert or update on seguridad.correo_permitido for each row execute function notificacion.t_correo_permitido();

-- ---------------------------------------------------------------------------
-- Lectura: campana, "Tu turno" y pulso (rol socio, por api.*)
-- ---------------------------------------------------------------------------
create or replace function operacion.aviso_marcar_leido(p_clave_idem text, p_aviso bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_uid is null then raise exception 'sin sesion' using errcode = '42501'; end if;
  insert into notificacion.destinatario (aviso_id, usuario_id, leida_at) values (p_aviso, v_uid, now())
    on conflict (aviso_id, usuario_id) do update set leida_at = coalesce(notificacion.destinatario.leida_at, now());
  return jsonb_build_object('aviso_id', p_aviso, 'leido', true);
end $$;

create or replace function api.avisos_lista(p_estado text default 'abierta') returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('sin_leer', (select count(*) from operacion.aviso a where a.estado = 'abierta' and not (a.solo_otro and a.actor_socio_id = v_yo)
                                          and not exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null)),
    'avisos', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nt', a.nt, 'codigo', a.codigo, 'severidad', a.severidad, 'titulo', a.titulo, 'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id, 'payload', a.payload,
        'duenio', (select nombre from catalogo.socio where id = a.duenio_socio_id), 'actor', (select nombre from catalogo.socio where id = a.actor_socio_id), 'estado', a.estado, 'conteo', a.conteo,
        'creado_at', a.creado_at, 'canales_previstos', a.canales_previstos, 'leido', exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null)) order by a.id desc)
      from operacion.aviso a where (p_estado is null or a.estado = p_estado) and not (a.solo_otro and a.actor_socio_id = v_yo)), '[]'::jsonb));
end $$;

create function api.contar_no_leidas() returns int
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  return (select count(*)::int from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
           where a.estado = 'abierta' and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
             and not exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null));
end $$;

-- La campana: pestanas Todas y Sin leer. Cada fila dice si el asunto sigue abierto, si pide accion y si Telegram no salio.
create function api.mis_notificaciones(p_filtro text default 'todas', p_pagina int default 0) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio(); v_uid uuid := auth.uid(); v_tam constant int := 25; v_filas jsonb; v_hay boolean;
begin
  perform seguridad.exigir_rol(array['socio']);
  if p_filtro not in ('todas', 'sin_leer') then raise exception 'filtro desconocido' using errcode = '22023'; end if;
  with base as (
    select a.*, t.requiere_accion, t.botones, t.titulo as tipo_titulo,
           exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null) as leida,
           (select e.estado from notificacion.entrega e where e.notificacion_id = a.id and e.canal = 'telegram' order by e.id desc limit 1) as telegram
      from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
     where t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
  ), pag as (
    select * from base where p_filtro = 'todas' or (estado = 'abierta' and not leida) order by id desc offset greatest(p_pagina, 0) * v_tam limit v_tam + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nt', nt, 'codigo', codigo, 'severidad', severidad, 'titulo', titulo, 'entidad_tipo', entidad_tipo, 'entidad_id', entidad_id, 'estado', estado, 'conteo', conteo,
           'creado_at', creado_at, 'requiere_accion', requiere_accion, 'botones', to_jsonb(botones), 'leida', leida, 'telegram', telegram, 'telegram_no_salio', telegram = 'muerta' and estado = 'abierta') order by id desc), '[]'::jsonb)
    into v_filas from (select * from pag order by id desc limit v_tam) x;
  select count(*) > v_tam into v_hay from (select 1 from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
     where t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
       and (p_filtro = 'todas' or (a.estado = 'abierta' and not exists (select 1 from notificacion.destinatario d where d.aviso_id = a.id and d.usuario_id = v_uid and d.leida_at is not null)))
     offset greatest(p_pagina, 0) * v_tam limit v_tam + 1) q;
  return jsonb_build_object('filtro', p_filtro, 'pagina', greatest(p_pagina, 0), 'hay_mas', v_hay, 'sin_leer', api.contar_no_leidas(), 'notificaciones', v_filas);
end $$;

create function api.marcar_leida(p_aviso bigint) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_uid is null then raise exception 'sin sesion' using errcode = '42501'; end if;
  insert into notificacion.destinatario (aviso_id, usuario_id, leida_at) values (p_aviso, v_uid, now())
    on conflict (aviso_id, usuario_id) do update set leida_at = coalesce(notificacion.destinatario.leida_at, now());
  return jsonb_build_object('aviso_id', p_aviso, 'leida', true);
end $$;

create function api.marcar_todas_leidas() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_yo bigint := operacion.actor_socio(); v_n int;
begin
  perform seguridad.exigir_rol(array['socio']);
  if v_uid is null then raise exception 'sin sesion' using errcode = '42501'; end if;
  insert into notificacion.destinatario (aviso_id, usuario_id, leida_at)
    select a.id, v_uid, now() from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
     where a.estado = 'abierta' and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
    on conflict (aviso_id, usuario_id) do update set leida_at = coalesce(notificacion.destinatario.leida_at, now());
  get diagnostics v_n = row_count;
  return jsonb_build_object('marcadas', v_n);
end $$;

-- "Tu turno": lo abierto que pide una accion (botones del catalogo o severidad critica) y las tomas de Omar pendientes de autorizacion.
create function api.tu_turno() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_yo bigint := operacion.actor_socio();
begin
  perform seguridad.exigir_rol(array['socio']);
  return jsonb_build_object('items', coalesce((select jsonb_agg(x order by orden, creado_at desc) from (
      select jsonb_build_object('clase', 'aviso', 'id', a.id, 'codigo', a.codigo, 'severidad', a.severidad, 'titulo', a.titulo, 'entidad_tipo', a.entidad_tipo, 'entidad_id', a.entidad_id,
                                'creado_at', a.creado_at, 'botones', to_jsonb(t.botones)) as x, (case a.severidad when 'C' then 0 else 1 end) as orden, a.creado_at
        from operacion.aviso a join notificacion.tipo t on t.codigo = a.codigo
       where a.estado = 'abierta' and (t.requiere_accion or a.severidad = 'C') and t.canal not in ('OM', 'VO') and not (a.solo_otro and a.actor_socio_id = v_yo)
      union all
      select jsonb_build_object('clase', 'toma', 'id', o.id, 'codigo', 'toma_pendiente', 'severidad', 'I', 'titulo', 'Toma ' || o.folio || ' pendiente de autorizacion', 'entidad_tipo', 'toma', 'entidad_id', o.id,
                                'creado_at', o.solicitada_at, 'botones', '["Autorizar", "Rechazar"]'::jsonb), 1, o.solicitada_at
        from operacion.toma_omar o where o.estado = 'pendiente'
    ) q), '[]'::jsonb));
end $$;

-- Los cuatro indicadores del pulso. `null` = Sin dato (no hay ningun hecho que lo respalde): jamas un cero inventado.
create function api.pulso() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_isaac bigint := catalogo.proveedor_id('Isaac'); v_cxc bigint; v_pedidos int; v_neto_a bigint; v_neto_j bigint; v_ia bigint; v_ij bigint; v_val bigint; v_pz bigint; v_mov int; v_socios_hay boolean;
begin
  perform seguridad.exigir_rol(array['socio']);
  select count(*) into v_pedidos from operacion.pedido where estado = 'enviado';
  select coalesce(sum(greatest(operacion.pedido_saldo(pe.id), 0)), 0) into v_cxc from operacion.pedido pe where pe.estado = 'enviado';
  select id into v_ia from catalogo.socio where nombre = 'Angelo';
  select id into v_ij from catalogo.socio where nombre = 'Javier';
  v_neto_a := operacion.neto_socio(v_ia); v_neto_j := operacion.neto_socio(v_ij);
  v_socios_hay := exists (select 1 from operacion.aportacion_socio) or exists (select 1 from operacion.cuenta_socio_mov) or exists (select 1 from operacion.compra where estado not in ('borrador', 'anulada'));
  select coalesce(sum(piezas), 0), coalesce(sum(valor_cent), 0), count(*) into v_pz, v_val, v_mov from operacion.existencia_modelo;
  return jsonb_build_object(
    'por_pagar_isaac_cent', case when exists (select 1 from operacion.cuenta_proveedor_mov where proveedor_id = v_isaac) or exists (select 1 from operacion.compra where proveedor_id = v_isaac and estado not in ('borrador', 'anulada'))
                                 then greatest(-operacion.saldo_proveedor(v_isaac), 0) end,
    'por_cobrar_cent', case when v_pedidos > 0 then v_cxc end,
    'entre_socios', case when v_socios_hay then jsonb_build_object(
        'socio', case when v_neto_a >= v_neto_j then 'Angelo' else 'Javier' end,
        'diferencia_cent', greatest(v_neto_a, v_neto_j) - least(v_neto_a, v_neto_j)) end,
    'en_bodega', case when v_mov > 0 then jsonb_build_object('piezas', v_pz, 'valor_cent', v_val) end);
end $$;

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
grant execute on function notificacion.reclamar_entregas(int, int), notificacion.registrar_resultado(bigint, text, int, int, text, text, boolean, bigint), notificacion.caducar_vencidas(),
  notificacion.respaldo_correo(), notificacion.crear_token(bigint, text, text[], bigint, text), notificacion.consumir_token(text, bigint, bigint, text), notificacion.evaluar(date), notificacion.latido(date) to servidor;
grant execute on function api.contar_no_leidas(), api.mis_notificaciones(text, int), api.marcar_leida(bigint), api.marcar_todas_leidas(), api.tu_turno(), api.pulso() to authenticated;
revoke execute on all functions in schema notificacion from public, anon, authenticated;
grant execute on function notificacion.reclamar_entregas(int, int), notificacion.registrar_resultado(bigint, text, int, int, text, text, boolean, bigint), notificacion.caducar_vencidas(),
  notificacion.respaldo_correo(), notificacion.crear_token(bigint, text, text[], bigint, text), notificacion.consumir_token(text, bigint, bigint, text), notificacion.evaluar(date), notificacion.latido(date) to servidor;
revoke execute on all functions in schema operacion, catalogo from public, anon, authenticated;
revoke execute on all functions in schema api from public, anon;
grant execute on function api.contar_no_leidas(), api.mis_notificaciones(text, int), api.marcar_leida(bigint), api.marcar_todas_leidas(), api.tu_turno(), api.pulso() to authenticated;
