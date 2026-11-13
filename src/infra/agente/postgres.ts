// Adaptadores de Postgres del agente de Telegram (rol `servidor`, funciones `agente.*`). El agente nunca calcula una cifra: todo viene de la base.
import { randomBytes } from 'node:crypto';
import type {
  AccionResuelta,
  AccionBoton,
  AlmacenAgente,
  AlmacenPresupuesto,
  AlmacenTokens,
  CatalogoAgente,
  ContextoEjecucion,
  DependenciasDeFolio,
  EstadoModoSinIa,
  EventoAgente,
  NegocioAgente,
  NuevoToken,
  ClasificacionReal,
  ResultadoSimulacion,
  ResultadoConsumo,
  ResultadoDeshacer,
  ResultadoNegocio,
  ResultadoReserva,
  ResultadoTomaResuelta,
  RespuestaConsulta,
  Resoluciones,
  SolicitudReserva,
  TomaCaducada,
} from '@/aplicacion/agente/puertos';
import { CONSULTAS_EXT } from '@/dominio/agente/catalogo_intenciones';
import type { IConsulta, Intencion } from '@/dominio/agente/intenciones';
import { parsearPrecio } from '@/dominio/agente/cifras';
import { sumarDias } from '@/dominio/calendario';
import { formatearMoneda } from '@/dominio/formato';
import type { EntradaCatalogo } from '@/dominio/agente/resolutor';
import type { AvisoPresupuesto, RolPresupuesto } from '@/dominio/agente/presupuesto';
import type { CifraServidor, ChatsRegistrados, Miembro, RolMiembro } from '@/dominio/agente/tipos';
import { llamar, type Sql } from '@/infra/postgres/servidor';

const F = (sql: Sql, fn: string, args: readonly unknown[] = [], casts: readonly string[] = []) => {
  const marcas = args.map((_, i) => `$${i + 1}${casts[i] ? `::${casts[i]}` : ''}`).join(', ');
  return sql<{ j: unknown }>(`select agente.${fn}(${marcas}) as j`, args).then((r) => r[0]?.j);
};

export class AlmacenAgenteDb implements AlmacenAgente {
  constructor(private readonly sql: Sql) {}
  async reclamarUpdate(updateId: number) { return (await F(this.sql, 'reclamar_update', [updateId], ['bigint'])) as boolean; }
  async reclamarMensaje(chatId: number, messageId: number) { return (await F(this.sql, 'reclamar_mensaje', [chatId, messageId], ['bigint', 'bigint'])) as boolean; }
  async miembroPorTelegramId(id: number): Promise<Miembro | null> { return ((await F(this.sql, 'miembro_por_telegram', [id], ['bigint'])) as Miembro | null) ?? null; }
  async chats(): Promise<ChatsRegistrados> {
    const j = (await F(this.sql, 'chats')) as { grupoSocios: number | null; privadoOmar: number | null };
    return { grupoSocios: j.grupoSocios ?? 0, privadoOmar: j.privadoOmar ?? 0 };
  }
  async modoSinIa(): Promise<EstadoModoSinIa> { return (await F(this.sql, 'modo_sin_ia')) as EstadoModoSinIa; }
  async fijarModoSinIa(activo: boolean, motivo: string | null) { return (await F(this.sql, 'fijar_modo_sin_ia', [activo, motivo], ['boolean', 'text'])) as boolean; }
  async marcarAvisoSinIa() { await F(this.sql, 'marcar_aviso_sin_ia'); }
  async corrida(clave: string) { return (await F(this.sql, 'corrida', [clave], ['text'])) ?? null; }
  async guardarCorrida(clave: string, resultado: unknown) { await F(this.sql, 'guardar_corrida', [clave, JSON.stringify(resultado)], ['text', 'jsonb']); }
  async contarNoProcesado() { await F(this.sql, 'contar_no_procesado'); }
  async mensajesRecientes(chatId: number, segundos: number) { return (await F(this.sql, 'mensajes_recientes', [chatId, segundos], ['bigint', 'int'])) as number; }
  async registrarEvento(e: EventoAgente) { await F(this.sql, 'registrar_evento', [e.tipo, e.miembro, e.detalle], ['text', 'bigint', 'text']); }
}

export class AlmacenPresupuestoDb implements AlmacenPresupuesto {
  constructor(private readonly sql: Sql) {}
  async reservar(s: SolicitudReserva): Promise<ResultadoReserva> {
    const j = (await F(this.sql, 'reservar', [s.clave, s.rol, s.microUsd.toString(), s.fechaNeg], ['text', 'text', 'bigint', 'date'])) as { ok: boolean; motivo?: ResultadoReserva extends { ok: false; motivo: infer M } ? M : never; avisos?: AvisoPresupuesto[] };
    return j.ok ? { ok: true, avisos: j.avisos ?? [] } : { ok: false, motivo: j.motivo! };
  }
  async liquidar(clave: string, costoRealMicroUsd: bigint) {
    const j = (await F(this.sql, 'liquidar', [clave, costoRealMicroUsd.toString()], ['text', 'bigint'])) as { avisos: AvisoPresupuesto[] };
    return { avisos: j.avisos };
  }
  async liberar(clave: string) { await F(this.sql, 'liberar', [clave], ['text']); }
}

/** callback_data = token aleatorio de 12 caracteres (base64url): nunca monto, folio ni accion. */
export class AlmacenTokensDb implements AlmacenTokens {
  constructor(private readonly sql: Sql, private readonly generar: () => string = () => `b${randomBytes(9).toString('base64url')}`) {}
  async emitir(t: NuevoToken): Promise<string> {
    const token = this.generar();
    await F(this.sql, 'token_emitir', [token, t.accion, t.rolesPermitidos as string[], t.chatId, t.caducaEn.toISOString(), t.grupoExclusivo, JSON.stringify(t.payload ?? {})], ['text', 'text', 'text[]', 'bigint', 'timestamptz', 'text', 'jsonb']);
    return token;
  }
  async consumir(e: { token: string; rol: RolMiembro; chatId: number; ahora: Date; usuarioId?: number }): Promise<ResultadoConsumo> {
    const j = (await F(this.sql, 'token_consumir', [e.token, e.rol, e.chatId, e.ahora.toISOString(), e.usuarioId ?? null], ['text', 'text', 'bigint', 'timestamptz', 'bigint'])) as { estado: string; accion?: AccionBoton; payload?: unknown };
    if (j.estado === 'ok') return { estado: 'ok', accion: j.accion!, payload: j.payload };
    return { estado: j.estado as 'no_autorizado' | 'chat_distinto' | 'caducado' | 'usado' | 'invalido' };
  }
}

export class CatalogoAgenteDb implements CatalogoAgente {
  constructor(private readonly sql: Sql) {}
  async clientes() { return ((await F(this.sql, 'catalogo_clientes')) as EntradaCatalogo[]) ?? []; }
  async modelos() { return ((await F(this.sql, 'catalogo_modelos')) as EntradaCatalogo[]) ?? []; }
  async saboresDe(modeloId: string) { return ((await F(this.sql, 'sabores_de', [Number(modeloId)], ['bigint'])) as EntradaCatalogo[]) ?? []; }
  async saboresEnExistencia(modeloId: string) { return ((await F(this.sql, 'sabores_en_existencia', [Number(modeloId)], ['bigint'])) as EntradaCatalogo[]) ?? []; }
}

// ---------------------------------------------------------------- negocio: lo que ejecuta y consulta el servidor

type LineaJson = { etiqueta: string; piezas?: number; centavos?: number; texto?: string };
const aCifras = (ls: LineaJson[]): CifraServidor[] => ls.map((l) => (l.piezas !== undefined ? { tipo: 'piezas', etiqueta: l.etiqueta, piezas: l.piezas } : l.centavos !== undefined ? { tipo: 'pesos', etiqueta: l.etiqueta, centavos: BigInt(l.centavos) } : { tipo: 'texto', etiqueta: l.etiqueta, texto: l.texto ?? '' }));

const CATEGORIA_GASTO: Record<string, string> = { guia: 'guia_envio', envio: 'mensajeria', uber: 'uber', comision_terminal: 'terminal', servicio: 'servicio', otro: 'otro' };
const NO_SOPORTADO = 'Eso todavía no lo registro desde Telegram: hazlo en el software y yo te lo muestro aquí.';

function eco(j: { socio?: string; neto_cent?: number; reembolso_pendiente_cent?: number; debe_cent?: number } | undefined): { comprobacion: CifraServidor[]; saldos: CifraServidor[] } {
  if (!j) return { comprobacion: [], saldos: [] };
  return {
    comprobacion: [],
    saldos: [
      { tipo: 'pesos', etiqueta: `Reembolso pendiente a ${j.socio ?? 'el socio'}`, centavos: BigInt(j.reembolso_pendiente_cent ?? 0) },
      { tipo: 'pesos', etiqueta: `Posición neta de ${j.socio ?? 'el socio'}`, centavos: BigInt(j.neto_cent ?? 0) },
    ],
  };
}


/** Errores de negocio que el socio puede entender y corregir (mensaje en espanol de la propia base). */
function esErrorDeNegocio(e: unknown): boolean {
  const cod = (e as { code?: string }).code ?? '';
  return cod.startsWith('P04') || ['23514', '23502', '22023', '23505', '42501'].includes(cod);
}

type Preparada = { hub: 'ejecutar' | 'ejecutar_ext'; tipo: string; args: Record<string, unknown>; titulo: string };

const mesAnterior = (hoy: string): { ini: string; fin: string } => {
  const [a, m] = hoy.split('-').map(Number) as [number, number];
  const ant = m === 1 ? { a: a - 1, m: 12 } : { a, m: m - 1 };
  const ini = `${ant.a}-${String(ant.m).padStart(2, '0')}-01`;
  const sig = ant.m === 12 ? `${ant.a + 1}-01-01` : `${ant.a}-${String(ant.m + 1).padStart(2, '0')}-01`;
  return { ini, fin: sumarDias(sig, -1) };
};
const mesDe = (mes: string): { ini: string; fin: string } => {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const sig = m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
  return { ini: `${mes}-01`, fin: sumarDias(sig, -1) };
};
const socioNombre = (s: 'angelo' | 'javier') => (s === 'angelo' ? 'Angelo' : 'Javier');

/** Traduce una intencion ya resuelta (ids del catalogo, montos validados) a la indicacion de la base. Aqui NO se calcula ningun importe. */
export function preparar(a: AccionResuelta, ctx: ContextoEjecucion, hoy: string): Preparada | null {
  const i: Intencion = a.intencion;
  // `telegram_user_id` es el del remitente que ya verifico el webhook: la base lo contrasta con agente.miembro (no se confia solo en `autor`).
  // `efecto_hash` y `token_boton` solo los usan las puertas que los exigen (vista previa confirmada; firma del acta).
  const base = {
    origen: 'fuente_cita' in i ? i.fuente_cita : '',
    autor: ctx.autor.persona,
    telegram_user_id: ctx.autor.telegramUserId,
    ...(ctx.efectoHash ? { efecto_hash: ctx.efectoHash } : {}),
    ...(ctx.tokenBoton ? { token_boton: ctx.tokenBoton } : {}),
  };
  const lineasSku = () => a.resoluciones.lineas.map((r, n) => ({ modelo_id: Number(r.modeloId), sabor_id: r.saborId === null ? null : Number(r.saborId), piezas: (i as { lineas: { piezas: number }[] }).lineas[n]!.piezas }));
  switch (i.tipo) {
    case 'gasto':
      return { hub: 'ejecutar', tipo: 'gasto', titulo: `Gasto registrado (${i.gasto})`, args: { ...base, pagado_por: i.pagado_por, monto_cent: i.monto_centavos, categoria: CATEGORIA_GASTO[i.gasto] ?? 'otro', nota: i.descripcion } };
    case 'aportacion':
      return { hub: 'ejecutar', tipo: 'aportacion', titulo: i.intencion === 'capital' ? `Aportación de capital de ${socioNombre(i.socio)} registrada` : `Depósito de ${socioNombre(i.socio)} registrado como reembolso`, args: { ...base, socio: i.socio, monto_cent: i.monto_centavos, concepto: i.motivo ?? 'Aportación por Telegram', intencion: i.intencion } };
    case 'reembolso_socio':
    case 'retiro_utilidad': {
      const r = i.tipo === 'reembolso_socio';
      return { hub: 'ejecutar', tipo: 'pago_a_socio', titulo: `${r ? 'Reembolso a' : 'Retiro de utilidad de'} ${socioNombre(i.socio)} registrado`, args: { ...base, socio: i.socio, monto_cent: i.monto_centavos, tipo: r ? 'reembolso' : 'retiro', via: i.via } };
    }
    case 'pago':
      return { hub: 'ejecutar', tipo: 'pago_cliente', titulo: 'Cobro de cliente registrado', args: { ...base, cuenta: i.cuenta_destino_texto, monto_cent: i.monto_centavos, cliente_id: Number(a.resoluciones.clienteId) } };
    case 'pago_proveedor':
      return { hub: 'ejecutar', tipo: 'pago_proveedor', titulo: 'Pago a proveedor registrado', args: { ...base, proveedor: a.resoluciones.proveedorId, monto_cent: i.monto_centavos, pagado_por: i.pagado_por, cliente_id: a.resoluciones.clienteId === null ? null : Number(a.resoluciones.clienteId),
        // Dinero propio de un socio que paga a un proveedor: REEMBOLSO por omision; capital solo si el socio lo declaro expresamente (la base rechaza la combinacion con la funcion aun no integrada).
        ...(i.intencion === 'capital' && (i.pagado_por === 'angelo' || i.pagado_por === 'javier') && a.resoluciones.clienteId === null ? { declara_capital: true } : {}) } };
    case 'pedido':
      return { hub: 'ejecutar_ext', tipo: 'pedido_crear', titulo: 'Pedido creado y confirmado', args: { ...base, cliente_id: Number(a.resoluciones.clienteId), lineas: i.lineas.map((l, n) => ({ ...lineasSku()[n], precio_cent: l.precio_texto === null ? null : precioDeTexto(l.precio_texto) })), envio_cent: i.envio_cobrado_centavos ?? 0 } };
    case 'pedido_envio':
      return { hub: 'ejecutar_ext', tipo: i.estado === 'enviado' ? 'pedido_enviar' : 'pedido_entregar', titulo: i.estado === 'enviado' ? 'Pedido marcado como enviado' : 'Pedido marcado como entregado', args: { ...base, pedido_folio: i.pedido_folio, guia: i.guia_texto, paqueteria: i.paqueteria_texto, aceptar_avisos: ctx.confirmado } };
    case 'pedido_cancelar':
      return { hub: 'ejecutar_ext', tipo: 'pedido_cancelar', titulo: 'Pedido cancelado', args: { ...base, pedido_folio: i.pedido_folio, motivo: i.motivo } };
    case 'compra':
    case 'orden_compra':
      return { hub: 'ejecutar_ext', tipo: i.tipo === 'compra' ? 'compra_crear' : 'orden_compra', titulo: i.tipo === 'compra' ? 'Compra registrada y confirmada' : 'Orden de compra en borrador (falta que los socios la aprueben)', args: { ...base, proveedor: a.resoluciones.proveedorId, lineas: lineasSku(), guia_cent: i.tipo === 'compra' ? (i.guia_centavos ?? 0) : 0, pagado_por: i.tipo === 'compra' ? i.pagado_por : null, nota: i.tipo === 'orden_compra' && i.aplicar_saldo ? 'Aplicar saldo a favor' : null } };
    case 'compra_aprobar':
      return { hub: 'ejecutar_ext', tipo: 'compra_aprobar', titulo: 'Orden de compra aprobada', args: { ...base, compra_folio: i.compra_folio } };
    case 'compra_estado':
      return { hub: 'ejecutar_ext', tipo: 'compra_estado', titulo: i.estado === 'enviada' ? 'Compra marcada en trayecto' : 'Compra marcada: llegó a Mérida', args: { ...base, compra_folio: i.compra_folio, estado: i.estado } };
    case 'compra_recepcion':
      return { hub: 'ejecutar_ext', tipo: 'compra_recepcion', titulo: i.lineas.length === 0 ? 'Recepción total registrada' : 'Recepción parcial registrada', args: { ...base, compra_folio: i.compra_folio, lineas: i.lineas.length === 0 ? [] : lineasSku() } };
    case 'gasto_servicio':
      return { hub: 'ejecutar_ext', tipo: 'gasto_servicio', titulo: `Cargo de servicio registrado (${i.servicio_texto})`, args: { ...base, servicio: i.servicio_texto, monto_usd_cent: i.monto_usd_centavos, monto_mxn_cent: i.monto_mxn_centavos, tc_micro: i.tipo_cambio_micro, pagado_por: i.pagado_por } };
    case 'merma':
      return { hub: 'ejecutar_ext', tipo: 'merma', titulo: 'Merma registrada', args: { ...base, modelo_id: Number(a.resoluciones.lineas[0]!.modeloId), sabor_id: a.resoluciones.lineas[0]!.saborId === null ? null : Number(a.resoluciones.lineas[0]!.saborId), piezas: i.piezas, motivo: i.motivo } };
    case 'conteo':
      return { hub: 'ejecutar_ext', tipo: 'conteo', titulo: 'Conteo físico registrado', args: { ...base, lineas: lineasSku() } };
    case 'cliente_alta':
      return { hub: 'ejecutar_ext', tipo: 'cliente_alta', titulo: 'Cliente dado de alta', args: { ...base, nombre: i.nombre } };
    case 'cliente_precio':
      return { hub: 'ejecutar_ext', tipo: 'cliente_precio', titulo: 'Precio del cliente actualizado', args: { ...base, cliente_id: Number(a.resoluciones.clienteId), modelo_id: Number(a.resoluciones.modeloId), precio_cent: i.precio_centavos } };
    case 'acta_propuesta': {
      const per = i.mes === null ? mesAnterior(hoy) : mesDe(i.mes);
      const dec = (retira: number | null, reinv: number | null) => ({ retira: retira ?? 0, reinvierte: reinv ?? 0 });
      return { hub: 'ejecutar_ext', tipo: 'acta_propuesta', titulo: 'Acta de corte propuesta (falta la firma de cada socio)', args: { ...base, ini: per.ini, fin: per.fin, decisiones: { Angelo: dec(i.retira_angelo_centavos, i.reinvierte_angelo_centavos), Javier: dec(i.retira_javier_centavos, i.reinvierte_javier_centavos) } } };
    }
    case 'acta_firma':
      return { hub: 'ejecutar_ext', tipo: 'acta_firma', titulo: `Acta firmada por ${socioNombre(ctx.autor.persona as 'angelo' | 'javier')}`, args: { ...base, cierre_folio: i.acta_folio } };
    case 'lote_historico':
      return {
        hub: 'ejecutar_ext', tipo: 'lote_historico', titulo: 'Lote histórico registrado',
        args: { ...base, etiqueta: i.etiqueta, renglones: i.renglones.map((r, n) => ({ tipo: r.tipo, fecha: r.fecha, monto_cent: r.monto_centavos, socio: r.socio, cliente_id: a.resoluciones.clientesLote?.[String(n)] ? Number(a.resoluciones.clientesLote[String(n)]) : null, cuenta: r.cuenta_texto, concepto: r.concepto, intencion: r.intencion, via: r.via })) },
      };
    default:
      return null;
  }
}

/**
 * Precio dictado ("250", "$1,250.50", "1250.5") a centavos exactos (convencion de Mexico). Los formatos ambiguos ("1.250", "1.250,50") ya se pidieron
 * aclarar antes de llegar aqui (datoFaltante); si aun asi llegan, NO se adivina: se lanza y la indicacion se rechaza.
 */
function precioDeTexto(t: string): number | null {
  const r = parsearPrecio(t);
  if (!r.ok) throw new RangeError(`precio ambiguo o ilegible: ${t}`);
  return r.centavos;
}

type ClasificacionSql = { clasificacion: string; monto_cent: number; socio: string };
type ResultadoSql = Record<string, unknown> & { folio?: string; repetido?: boolean; eco?: Parameters<typeof eco>[0]; clasificaciones?: ClasificacionSql[] };

const aClasificaciones = (c: ClasificacionSql[] | undefined): ClasificacionReal[] => (c ?? []).map((x) => ({ clasificacion: x.clasificacion, montoCent: x.monto_cent, socio: x.socio }));
const nombreClasificacion = (c: string): string => (c === 'capital' ? 'capital' : 'reembolso');

/** Lineas de la respuesta: solo cifras que devolvio la base. */
function lineasDeResultado(j: ResultadoSql): CifraServidor[] {
  const salida: CifraServidor[] = [];
  const pesos = (k: string, etiqueta: string) => { if (typeof j[k] === 'number') salida.push({ tipo: 'pesos', etiqueta, centavos: BigInt(j[k] as number) }); };
  pesos('monto_cent', 'Monto');
  pesos('total_cent', 'Total');
  if (typeof j.piezas === 'number') salida.push({ tipo: 'piezas', etiqueta: 'Piezas', piezas: j.piezas });
  if (typeof j.renglones === 'number') salida.push({ tipo: 'piezas', etiqueta: 'Renglones', piezas: j.renglones });
  if (typeof j.pedido === 'string') salida.push({ tipo: 'folio', etiqueta: 'Pedido', folio: j.pedido });
  if (typeof j.compra === 'string') salida.push({ tipo: 'folio', etiqueta: 'Compra', folio: j.compra });
  if (typeof j.estado === 'string') salida.push({ tipo: 'texto', etiqueta: 'Estado', texto: j.estado });
  if (Array.isArray(j.folios)) salida.push({ tipo: 'texto', etiqueta: 'Folios', texto: (j.folios as string[]).join(', ') });
  // Lo que la base REALMENTE registro (no una plantilla): una linea por aportacion que dejo la operacion.
  for (const c of aClasificaciones(j.clasificaciones)) salida.push({ tipo: 'pesos', etiqueta: `Registrado como ${nombreClasificacion(c.clasificacion)} (${c.socio})`, centavos: BigInt(c.montoCent) });
  return salida;
}

function efectoDeSimulacion(e: Record<string, unknown>): CifraServidor[] {
  const salida: CifraServidor[] = [];
  const ls = e.lineas as { etiqueta: string; piezas: number; precio_cent: number; importe_cent: number }[] | undefined;
  for (const l of ls ?? []) {
    salida.push({ tipo: 'texto', etiqueta: l.etiqueta, texto: `${l.piezas} pz a ${formatearMoneda(BigInt(l.precio_cent))} = ${formatearMoneda(BigInt(l.importe_cent))}` });
  }
  const pesos = (k: string, etiqueta: string) => { if (typeof e[k] === 'number') salida.push({ tipo: 'pesos', etiqueta, centavos: BigInt(e[k] as number) }); };
  pesos('mercancia_cent', 'Mercancia');
  pesos('envio_cent', 'Envio cobrado');
  pesos('guia_cent', 'Guia');
  pesos('total_cent', 'Total de la compra');
  pesos('monto_cent', 'Monto en pesos (calculado por la base)');
  if (typeof e.usd_cent === 'number') salida.push({ tipo: 'pesos', etiqueta: 'Dolares del cargo', centavos: BigInt(e.usd_cent) });
  if (typeof e.tc_micro === 'number') salida.push({ tipo: 'texto', etiqueta: 'Tipo de cambio usado', texto: (e.tc_micro / 1_000_000).toFixed(4) });
  return salida;
}

/** Escribe con las funciones de negocio de siempre (sin atajos): gasto, aportacion y toma de Omar. Lo demas se rechaza con un motivo claro. */
export class NegocioAgenteDb implements NegocioAgente {
  constructor(private readonly sql: Sql) {}

  async ejecutar(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoNegocio> {
    const i = a.intencion;
    try {
      const prep = i.tipo === 'toma_omar' || i.tipo === 'devolucion' || i.tipo === 'paquete_perdido' ? null : preparar(a, ctx, hoyDe(ctx.ahora));
      if (prep) {
        const j = (await F(this.sql, prep.hub, [ctx.claveIdem, prep.tipo, JSON.stringify(prep.args)], ['text', 'text', 'jsonb'])) as ResultadoSql;
        const ls = lineasDeResultado(j);
        // El monto que el socio dicto (ya validado contra su mensaje) se muestra aunque la funcion de negocio no lo devuelva.
        if (!ls.some((l) => l.etiqueta === 'Monto') && typeof prep.args.monto_cent === 'number') ls.unshift({ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(prep.args.monto_cent) });
        return { tipo: 'ejecutado', folio: j.folio ?? '', titulo: prep.titulo, lineas: ls, ...eco(j.eco), advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'gasto') {
        const j = (await F(this.sql, 'ejecutar', [ctx.claveIdem, 'gasto', JSON.stringify({ pagado_por: i.pagado_por, monto_cent: i.monto_centavos, categoria: CATEGORIA_GASTO[i.gasto] ?? 'otro', nota: i.descripcion, origen: i.fuente_cita, autor: ctx.autor.persona })], ['text', 'text', 'jsonb'])) as { folio: string; eco?: Parameters<typeof eco>[0]; repetido?: boolean };
        const e = eco(j.eco);
        return { tipo: 'ejecutado', folio: j.folio, titulo: `Gasto registrado (${i.gasto})`, lineas: [{ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(i.monto_centavos) }], ...e, advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'aportacion') {
        const j = (await F(this.sql, 'ejecutar', [ctx.claveIdem, 'aportacion', JSON.stringify({ socio: i.socio, monto_cent: i.monto_centavos, concepto: i.motivo ?? 'Aportación por Telegram', intencion: i.intencion, origen: i.fuente_cita, autor: ctx.autor.persona })], ['text', 'text', 'jsonb'])) as { folio: string; eco?: Parameters<typeof eco>[0]; repetido?: boolean };
        const e = eco(j.eco);
        return { tipo: 'ejecutado', folio: j.folio, titulo: i.intencion === 'capital' ? `Aportación de capital de ${i.socio === 'angelo' ? 'Angelo' : 'Javier'} registrada` : `Depósito de ${i.socio === 'angelo' ? 'Angelo' : 'Javier'} registrado como reembolso`, lineas: [{ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(i.monto_centavos) }], ...e, advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'reembolso_socio' || i.tipo === 'retiro_utilidad') {
        const reembolso = i.tipo === 'reembolso_socio';
        const j = (await F(this.sql, 'ejecutar', [ctx.claveIdem, 'pago_a_socio', JSON.stringify({ socio: i.socio, monto_cent: i.monto_centavos, tipo: reembolso ? 'reembolso' : 'retiro', via: i.via, origen: i.fuente_cita, autor: ctx.autor.persona })], ['text', 'text', 'jsonb'])) as { folio: string; eco?: Parameters<typeof eco>[0]; repetido?: boolean };
        const e = eco(j.eco);
        return { tipo: 'ejecutado', folio: j.folio, titulo: `${reembolso ? 'Reembolso a' : 'Retiro de utilidad de'} ${i.socio === 'angelo' ? 'Angelo' : 'Javier'} registrado`, lineas: [{ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(i.monto_centavos) }], ...e, advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'pago') {
        const j = (await F(this.sql, 'ejecutar', [ctx.claveIdem, 'pago_cliente', JSON.stringify({ cuenta: i.cuenta_destino_texto, monto_cent: i.monto_centavos, cliente_id: Number(a.resoluciones.clienteId), origen: i.fuente_cita, autor: ctx.autor.persona })], ['text', 'text', 'jsonb'])) as { folio: string; repetido?: boolean };
        return { tipo: 'ejecutado', folio: j.folio, titulo: 'Cobro de cliente registrado', lineas: [{ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(i.monto_centavos) }], comprobacion: [], saldos: [], advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'pago_proveedor') {
        const j = (await F(this.sql, 'ejecutar', [ctx.claveIdem, 'pago_proveedor', JSON.stringify({ proveedor: a.resoluciones.proveedorId, monto_cent: i.monto_centavos, pagado_por: i.pagado_por, cliente_id: a.resoluciones.clienteId === null ? null : Number(a.resoluciones.clienteId), origen: i.fuente_cita, autor: ctx.autor.persona })], ['text', 'text', 'jsonb'])) as { folio: string; repetido?: boolean };
        return { tipo: 'ejecutado', folio: j.folio, titulo: 'Pago a proveedor registrado', lineas: [{ tipo: 'pesos', etiqueta: 'Monto', centavos: BigInt(i.monto_centavos) }], comprobacion: [], saldos: [], advertencias: [], ejecutadoEn: ctx.ahora, repetido: j.repetido === true };
      }
      if (i.tipo === 'devolucion' || i.tipo === 'paquete_perdido') {
        return { tipo: 'rechazado', codigo: 'dependencia_pendiente', texto: 'Eso todavía no lo registro desde Telegram: depende de la rama de devoluciones y paquetes. Hazlo en el software.' };
      }
      if (i.tipo === 'toma_omar') {
        const folios: string[] = [];
        const lineas: CifraServidor[] = [];
        let precios = 0n;
        for (const [n, l] of i.lineas.entries()) {
          const r = a.resoluciones.lineas[n];
          if (!r || !r.saborId) return { tipo: 'rechazado', codigo: 'falta_sabor', texto: 'Falta el sabor de una línea de la toma. Dime modelo y sabor.' };
          const j = (await F(this.sql, 'ejecutar', [`${ctx.claveIdem}:${n}`, 'toma_omar', JSON.stringify({ modelo_id: r.modeloId, sabor_id: r.saborId, piezas: l.piezas })], ['text', 'text', 'jsonb'])) as { folio: string; precio_cent: number | null };
          folios.push(j.folio);
          lineas.push({ tipo: 'piezas', etiqueta: `${l.modelo_texto} ${l.sabor_texto ?? ''}`.trim(), piezas: l.piezas });
          if (j.precio_cent !== null) precios += BigInt(j.precio_cent) * BigInt(l.piezas);
        }
        return { tipo: 'toma_pendiente', folio: folios.join(', '), titulo: 'Toma de Omar pendiente de autorización', lineas, resumen: [{ tipo: 'pesos', etiqueta: 'Valor a su precio', centavos: precios }] };
      }
      return { tipo: 'rechazado', codigo: 'no_soportado', texto: NO_SOPORTADO };
    } catch (e) {
      const cod = (e as { code?: string }).code;
      if (cod === 'P0460' || cod === 'P0422' || cod === 'P0423' || esErrorDeNegocio(e)) return { tipo: 'rechazado', codigo: cod ?? 'error', texto: (e as Error).message };
      throw e;
    }
  }


  /** Vista previa: la base ejecuta la indicacion dentro de un sub-bloque y la revierte; devuelve el efecto real y el cuadre por dos vias. */
  async simular(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoSimulacion> {
    const prep = a.intencion.tipo === 'toma_omar' || a.intencion.tipo === 'devolucion' || a.intencion.tipo === 'paquete_perdido' ? null : preparar(a, ctx, hoyDe(ctx.ahora));
    if (!prep) return { tipo: 'simulado', lineas: [], advertencias: [], cuadra: true, rojas: [] };
    try {
      const j = (await F(this.sql, 'simular', [prep.hub, prep.tipo, JSON.stringify(prep.args)], ['text', 'text', 'jsonb'])) as { resultado: ResultadoSql; efecto: Record<string, unknown>; efecto_hash?: string; clasificaciones?: ClasificacionSql[]; cuadra: boolean; comprobaciones_rojas: { nombre: string }[] };
      const clasificaciones = aClasificaciones(j.clasificaciones);
      // El capital se registra SOLO si el socio lo declaro: si la base lo clasificaria como capital sin esa declaracion (regla de main antes de integrar cuadrar-cuentas), NO se registra.
      const declarados = prep.tipo === 'aportacion' ? (prep.args.intencion === 'capital' ? 1 : 0) : prep.tipo === 'pago_proveedor' ? (prep.args.declara_capital === true ? 1 : 0)
        : prep.tipo === 'lote_historico' ? ((prep.args.renglones as { tipo: string; intencion: string | null }[]).filter((r) => r.tipo === 'aportacion' && r.intencion === 'capital').length) : 0;
      if (clasificaciones.filter((c) => c.clasificacion === 'capital').length > declarados) {
        return { tipo: 'rechazado', codigo: 'capital_sin_declarar', texto: 'La base registraria este dinero como CAPITAL y el socio no lo declaro como capital (la regla es reembolso por omision). No lo registro: hazlo en el software o declaralo expresamente.' };
      }
      const lineas = [...efectoDeSimulacion(j.efecto ?? {}), ...lineasDeResultado(j.resultado ?? {}).filter((l) => l.tipo === 'texto' && l.etiqueta === 'Folios' ? false : true), ...eco(j.resultado?.eco).saldos];
      const avisos = Array.isArray(j.efecto?.avisos) ? (j.efecto.avisos as string[]) : [];
      return { tipo: 'simulado', lineas, advertencias: avisos, cuadra: j.cuadra, rojas: (j.comprobaciones_rojas ?? []).map((r) => r.nombre), efectoHash: j.efecto_hash ?? null, clasificaciones };
    } catch (e) {
      const cod = (e as { code?: string }).code;
      if (cod === 'P0427') return { tipo: 'pregunta', motivo: 'otro', texto: `${(e as Error).message}. ¿Lo envio de todos modos, aceptando esos avisos?`, cifras: [] };
      if (esErrorDeNegocio(e)) return { tipo: 'rechazado', codigo: cod ?? 'error', texto: (e as Error).message };
      throw e;
    }
  }

  async consultar(c: IConsulta, r: Resoluciones): Promise<RespuestaConsulta> {
    type Cons = { titulo: string; lineas: LineaJson[] };
    const q = async (tipo: string, id: number | null, sujeto: string | null): Promise<Cons> => (await F(this.sql, 'consulta', [tipo, id, sujeto], ['text', 'bigint', 'text'])) as Cons;
    let j: Cons | null = null;
    const qx = async (tipo: string, id: number | null, sujeto: string | null): Promise<Cons> => (await F(this.sql, 'consulta_ext', [tipo, id, sujeto], ['text', 'bigint', 'text'])) as Cons;
    if (CONSULTAS_EXT.has(c.consulta) && !(c.consulta === 'saldo')) {
      if (c.consulta === 'reporte') j = await qx('reporte', null, c.periodo ?? 'semana');
      else j = await qx(c.consulta, c.consulta === 'cobertura' && r.modeloId ? Number(r.modeloId) : null, null);
      return { titulo: j.titulo, lineas: aCifras(j.lineas) };
    }
    if (c.consulta === 'inventario') j = await q('inventario', r.modeloId ? Number(r.modeloId) : null, null);
    else if (c.consulta === 'saldo' && (c.sujeto_texto === 'socios' || !r.clienteId)) j = await q('socios', null, null);
    else if (c.consulta === 'saldo' && r.clienteId) j = await q('cuenta_cliente', Number(r.clienteId), null);
    else if (c.consulta === 'saldo_proveedor' && r.proveedorId) j = await q('proveedor', null, r.proveedorId);
    else if (c.consulta === 'estado_cuenta_socio') j = await q('estado_socio', null, c.sujeto_texto);
    else if (c.consulta === 'utilidad') j = await q('utilidad', null, c.periodo ?? 'mes');
    else if (c.consulta === 'cartera') j = await q('cartera', null, null);
    if (!j) return { titulo: 'Eso todavía no lo consulto desde Telegram', lineas: [{ tipo: 'texto', etiqueta: 'Dónde verlo', texto: 'En el software, en la sección correspondiente.' }] };
    return { titulo: j.titulo, lineas: aCifras(j.lineas) };
  }

  async localizarParaDeshacer(autor: Miembro, folio: string | null) {
    const j = (await F(this.sql, 'localizar', [folio, folio === null ? autor.persona : null], ['text', 'text'])) as { folio: string; ejecutado_en: string } | null;
    return j ? { folio: j.folio, ejecutadoEn: new Date(j.ejecutado_en) } : null;
  }

  /** STUB deliberado (B1): ver DependenciasDeFolio. Las anulaciones de la base rechazan lo que tiene dependientes; aqui no se calcula nada. */
  async dependenciasDe(): Promise<DependenciasDeFolio> {
    return { cantidad: 0, descripcion: [] };
  }

  async deshacer(e: { folio: string; autor: Miembro; claveIdem: string }): Promise<ResultadoDeshacer> {
    try {
      // El solicitante viaja verificado (id de Telegram): la base lo usa como actor, aplica la politica de quien puede deshacer y deja `deshecho_por`.
      await F(this.sql, 'deshacer', [e.claveIdem, e.folio, e.autor.persona, e.autor.telegramUserId], ['text', 'text', 'text', 'bigint']);
      return { tipo: 'deshecho', folioContra: `Contramovimiento de ${e.folio}`, titulo: `Se deshizo ${e.folio}`, lineas: [], repetido: false };
    } catch (err) {
      return { tipo: 'rechazado', codigo: (err as { code?: string }).code ?? 'error', texto: (err as Error).message };
    }
  }

  async autorizarToma(e: { folio: string; socio: Miembro; autorizar: boolean; claveIdem: string }): Promise<ResultadoTomaResuelta> {
    try {
      // El socio que pulso viaja verificado (id de Telegram): la base lo contrasta con agente.miembro.
      const j = (await F(this.sql, 'resolver_toma', [e.claveIdem, e.folio, e.autorizar ? 'autorizar' : 'rechazar', e.socio.persona, e.socio.telegramUserId], ['text', 'text', 'text', 'text', 'bigint'])) as { estado: string; folio?: string };
      if (j.estado === 'no_encontrada') return { tipo: 'no_encontrada' };
      return { tipo: 'resuelta', folio: e.folio, estado: j.estado === 'autorizada' ? 'autorizada' : 'rechazada', lineas: [], saldoSemanal: null, repetido: false };
    } catch (err) {
      if ((err as { code?: string }).code === 'P0428') return { tipo: 'ya_resuelta', folio: e.folio, estado: 'resuelta' };
      throw err;
    }
  }

  async caducarTomas(_ahora: Date, horas: number): Promise<TomaCaducada[]> {
    const j = (await F(this.sql, 'caducar_tomas', [horas], ['int'])) as string[];
    return j.map((folio) => ({ folio, lineas: [] }));
  }
}

const hoyDe = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Merida' }).format(d);

export { llamar };
export type { RolPresupuesto };
