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
import type { IConsulta } from '@/dominio/agente/intenciones';
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
  async consumir(e: { token: string; rol: RolMiembro; chatId: number; ahora: Date }): Promise<ResultadoConsumo> {
    const j = (await F(this.sql, 'token_consumir', [e.token, e.rol, e.chatId, e.ahora.toISOString()], ['text', 'text', 'bigint', 'timestamptz'])) as { estado: string; accion?: AccionBoton; payload?: unknown };
    if (j.estado === 'ok') return { estado: 'ok', accion: j.accion!, payload: j.payload };
    return { estado: j.estado as 'no_autorizado' | 'chat_distinto' | 'caducado' | 'usado' | 'invalido' };
  }
}

export class CatalogoAgenteDb implements CatalogoAgente {
  constructor(private readonly sql: Sql) {}
  async clientes() { return ((await F(this.sql, 'catalogo_clientes')) as EntradaCatalogo[]) ?? []; }
  async modelos() { return ((await F(this.sql, 'catalogo_modelos')) as EntradaCatalogo[]) ?? []; }
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

/** Escribe con las funciones de negocio de siempre (sin atajos): gasto, aportacion y toma de Omar. Lo demas se rechaza con un motivo claro. */
export class NegocioAgenteDb implements NegocioAgente {
  constructor(private readonly sql: Sql) {}

  async ejecutar(a: AccionResuelta, ctx: ContextoEjecucion): Promise<ResultadoNegocio> {
    const i = a.intencion;
    try {
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
      if (cod === 'P0460' || cod === 'P0422' || cod === 'P0423') return { tipo: 'rechazado', codigo: cod, texto: (e as Error).message };
      throw e;
    }
  }

  async consultar(c: IConsulta, r: Resoluciones): Promise<RespuestaConsulta> {
    type Cons = { titulo: string; lineas: LineaJson[] };
    const q = async (tipo: string, id: number | null, sujeto: string | null): Promise<Cons> => (await F(this.sql, 'consulta', [tipo, id, sujeto], ['text', 'bigint', 'text'])) as Cons;
    let j: Cons | null = null;
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

  async dependenciasDe(): Promise<DependenciasDeFolio> {
    return { cantidad: 0, descripcion: [] };
  }

  async deshacer(e: { folio: string; autor: Miembro; claveIdem: string }): Promise<ResultadoDeshacer> {
    try {
      await F(this.sql, 'deshacer', [e.claveIdem, e.folio], ['text', 'text']);
      return { tipo: 'deshecho', folioContra: `Contramovimiento de ${e.folio}`, titulo: `Se deshizo ${e.folio}`, lineas: [], repetido: false };
    } catch (err) {
      return { tipo: 'rechazado', codigo: (err as { code?: string }).code ?? 'error', texto: (err as Error).message };
    }
  }

  async autorizarToma(e: { folio: string; socio: Miembro; autorizar: boolean; claveIdem: string }): Promise<ResultadoTomaResuelta> {
    try {
      const j = (await F(this.sql, 'resolver_toma', [e.claveIdem, e.folio, e.autorizar ? 'autorizar' : 'rechazar'], ['text', 'text', 'text'])) as { estado: string; folio?: string };
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

export { llamar };
export type { RolPresupuesto };
