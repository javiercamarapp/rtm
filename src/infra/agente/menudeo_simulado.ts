// Espejo EN MEMORIA de las funciones de menudeo de la base (operacion.ds_*): pedido a costo del socio de menudeo, aviso de pago, decision del otro socio, compromiso y recordatorios.
// Sirve al simulador y a las pruebas unitarias; las mismas reglas las prueba la base en pgTAP (a7_002) y de punta a punta en test/integracion/telegram_menudeo_e2e.test.ts.
// Todo el dinero y las fechas se calculan aqui (bigint en centavos); el modelo de lenguaje nunca los toca. Datos ilustrativos.
import { fechaNeg } from '@/dominio/calendario';
import type { Miembro } from '@/dominio/agente/tipos';
import type { RecordatorioMenudeo, TipoRecordatorio } from '@/aplicacion/agente/puertos';

export interface ReporteSim {
  id: number;
  pedidoId: number;
  por: 'angelo' | 'javier';
  montoCent: bigint;
  aplicado: boolean;
  decision: 'confirmado' | 'rechazado' | null;
  comprobante: boolean;
}

export interface PedidoMenudeoSim {
  id: number;
  folio: string;
  socio: 'angelo' | 'javier';
  proveedor: string;
  costoCent: bigint;
  fecha: string | null;
  hora: string | null;
  estado: 'confirmado' | 'enviado' | 'cancelado';
  pagadoCent: bigint;
  compromisos: Array<{ fecha: string | null; hora: string | null; motivo: string | null }>;
  avisos: Array<{ tipo: TipoRecordatorio; enviadoEn: Date; ventana: number }>;
}

export class ErrorMenudeoSim extends Error {
  constructor(readonly codigo: string, mensaje: string) {
    super(mensaje);
  }
}

const HORA_MS = 3_600_000;

/** Instante (UTC) en que vence un compromiso: la fecha con su hora (o el final del dia) en hora de Merida. */
export function venceEn(fecha: string, hora: string | null): number {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const [hh, mm] = hora === null ? [23, 59] : (hora.split(':').map(Number) as [number, number]);
  return Date.UTC(a, m - 1, d, hh + 6, mm, hora === null ? 59 : 0);
}

export class MenudeoSimulado {
  /** Parametros de configuracion (ds_recordatorio_config). */
  socioMenudeo: 'angelo' | 'javier' = 'angelo';
  avisoPrevioHoras = 24;
  intervaloHoras = 24;
  maxRecordatorios = 7;
  /** Interruptor telegram_envio (nace apagado). */
  envioActivo = false;
  readonly pedidos: PedidoMenudeoSim[] = [];
  readonly reportes: ReporteSim[] = [];
  private contador = 0;

  exigirSocio(autor: Miembro): void {
    if (autor.persona !== this.socioMenudeo) throw new ErrorMenudeoSim('42501', `solo el socio de menudeo (${this.socioMenudeo === 'angelo' ? 'Angelo' : 'Javier'}) mete pedidos a costo, avisa sus pagos y reprograma sus fechas`);
  }

  porFolio(folio: string | null): PedidoMenudeoSim | undefined {
    return folio === null ? undefined : this.pedidos.find((p) => p.folio === folio.toUpperCase());
  }

  /** Pendiente de pago: lo que falta tras los pagos APLICADOS. */
  pendiente(p: PedidoMenudeoSim): bigint {
    return p.estado === 'cancelado' ? 0n : p.costoCent - p.pagadoCent;
  }

  /** Lo que aun se puede reportar: pendiente menos reportes sin resolver ni aplicar. */
  private reportable(p: PedidoMenudeoSim): bigint {
    const sinResolver = this.reportes.filter((r) => r.pedidoId === p.id && !r.aplicado && r.decision === null).reduce((t, r) => t + r.montoCent, 0n);
    return this.pendiente(p) - sinResolver;
  }

  validarCrear(autor: Miembro, fecha: string | null, ahora: Date): void {
    this.exigirSocio(autor);
    if (fecha !== null && fecha < fechaNeg(new Date(ahora.getTime() - 24 * HORA_MS))) throw new ErrorMenudeoSim('23514', 'la fecha comprometida no puede ser pasada');
  }

  crear(e: { folio: string; autor: Miembro; proveedor: string; costoCent: bigint; fecha: string | null; hora: string | null; ahora: Date }): PedidoMenudeoSim {
    this.validarCrear(e.autor, e.fecha, e.ahora);
    const p: PedidoMenudeoSim = { id: ++this.contador, folio: e.folio, socio: e.autor.persona as 'angelo' | 'javier', proveedor: e.proveedor, costoCent: e.costoCent, fecha: e.fecha, hora: e.hora, estado: 'confirmado', pagadoCent: 0n, compromisos: [{ fecha: e.fecha, hora: e.hora, motivo: null }], avisos: [] };
    this.pedidos.push(p);
    return p;
  }

  enviar(p: PedidoMenudeoSim): void {
    p.estado = 'enviado';
  }

  cancelar(p: PedidoMenudeoSim): void {
    p.estado = 'cancelado';
  }

  /** Espejo de ds_reportar_pago_menudeo: con comprobante (o si lo reporta el otro socio) se aplica; si no, queda Pago reportado hasta que el otro socio lo confirme. */
  reportarPago(e: { autor: Miembro; folio: string; montoCent: bigint; comprobante: boolean }): { reporte: ReporteSim; pedido: PedidoMenudeoSim } {
    this.exigirSocio(e.autor);
    const p = this.porFolio(e.folio);
    if (!p) throw new ErrorMenudeoSim('P0460', `no encuentro el pedido ${e.folio}: dime el folio (por ejemplo P-0001)`);
    if (p.estado !== 'enviado') throw new ErrorMenudeoSim('P0428', 'el pedido aun no esta enviado: no hay nada que pagar todavia');
    if (e.montoCent <= 0n) throw new ErrorMenudeoSim('23514', 'el monto debe ser positivo');
    if (e.montoCent > this.reportable(p)) throw new ErrorMenudeoSim('23514', 'el monto excede lo pendiente de pago (descontando pagos ya reportados por confirmar)');
    const aplicado = e.comprobante;
    const r: ReporteSim = { id: this.reportes.length + 1, pedidoId: p.id, por: e.autor.persona as 'angelo' | 'javier', montoCent: e.montoCent, aplicado, decision: null, comprobante: e.comprobante };
    this.reportes.push(r);
    if (aplicado) p.pagadoCent += e.montoCent;
    return { reporte: r, pedido: p };
  }

  /** Espejo de ds_decidir_pago_menudeo: lo decide el OTRO socio; rechazar exige motivo; rechazar un pago aplicado lo anula. */
  decidir(e: { autor: Miembro; reporteId: number; decision: 'confirmado' | 'rechazado'; motivo?: string }): { reporte: ReporteSim; pedido: PedidoMenudeoSim } {
    const r = this.reportes.find((x) => x.id === e.reporteId);
    if (!r) throw new ErrorMenudeoSim('22023', 'reporte de pago desconocido');
    if (e.autor.persona === r.por) throw new ErrorMenudeoSim('42501', 'lo confirma o rechaza el OTRO socio');
    if (r.decision !== null) throw new ErrorMenudeoSim('P0428', 'ese reporte ya se resolvio');
    if (e.decision === 'rechazado' && !e.motivo) throw new ErrorMenudeoSim('23502', 'rechazar exige un motivo');
    const p = this.pedidos.find((x) => x.id === r.pedidoId)!;
    if (e.decision === 'confirmado' && !r.aplicado) {
      r.aplicado = true;
      p.pagadoCent += r.montoCent;
    } else if (e.decision === 'rechazado' && r.aplicado) {
      r.aplicado = false;
      p.pagadoCent -= r.montoCent;
    }
    r.decision = e.decision;
    return { reporte: r, pedido: p };
  }

  reprogramar(e: { autor: Miembro; pedido: PedidoMenudeoSim; fecha: string; hora: string | null; motivo: string | null; ahora: Date }): void {
    this.exigirSocio(e.autor);
    if (!e.motivo) throw new ErrorMenudeoSim('23502', 'reprogramar exige motivo');
    if (e.fecha < fechaNeg(new Date(e.ahora.getTime() - 24 * HORA_MS))) throw new ErrorMenudeoSim('23514', 'la fecha comprometida no puede ser pasada');
    e.pedido.fecha = e.fecha;
    e.pedido.hora = e.hora;
    e.pedido.compromisos.push({ fecha: e.fecha, hora: e.hora, motivo: e.motivo });
  }

  // ---- recordatorios (espejo de ds_recordatorios_pago_menudeo): sin datos personales

  lista(ahora: Date): RecordatorioMenudeo[] {
    const hoy = fechaNeg(ahora);
    const salida: RecordatorioMenudeo[] = [];
    for (const p of this.pedidos) {
      if (p.estado !== 'enviado' || this.pendiente(p) <= 0n) continue;
      const reportado = this.reportes.some((r) => r.pedidoId === p.id && !r.aplicado && r.decision === null);
      const base = { pedidoId: p.id, folio: p.folio, socio: p.socio === 'angelo' ? 'Angelo' : 'Javier', proveedor: p.proveedor, pendienteCent: this.pendiente(p), fechaCompromiso: p.fecha, horaCompromiso: p.hora, enviados: p.avisos.length, pagoReportado: reportado };
      if (p.fecha === null) {
        salida.push({ ...base, diasAtraso: 0, tipo: 'sin_fecha' });
        continue;
      }
      const vence = venceEn(p.fecha, p.hora);
      const dias = Math.max(0, Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${p.fecha}T00:00:00Z`)) / 86_400_000));
      const ult = p.avisos.length === 0 ? null : Math.max(...p.avisos.map((a) => a.enviadoEn.getTime()));
      const ahoraMs = ahora.getTime();
      let tipo: TipoRecordatorio | null = null;
      if (vence > ahoraMs && vence <= ahoraMs + this.avisoPrevioHoras * HORA_MS) {
        if (!p.avisos.some((a) => a.tipo === 'por_vencer' && a.enviadoEn.getTime() >= vence - this.avisoPrevioHoras * HORA_MS)) tipo = 'por_vencer';
      } else if (vence <= ahoraMs && p.fecha === hoy) {
        if (!p.avisos.some((a) => (a.tipo === 'vence_hoy' || a.tipo === 'vencido') && a.enviadoEn.getTime() >= vence)) tipo = 'vence_hoy';
      } else if (vence <= ahoraMs) {
        if (p.avisos.length < this.maxRecordatorios && (ult === null || ult + this.intervaloHoras * HORA_MS <= ahoraMs)) tipo = 'vencido';
      }
      if (tipo !== null) salida.push({ ...base, diasAtraso: dias, tipo });
    }
    return salida;
  }

  /** Reclama el aviso (registro idempotente por pedido y hora): true solo la primera vez. */
  reclamar(pedidoId: number, tipo: TipoRecordatorio, ahora: Date): boolean {
    if (!this.lista(ahora).some((f) => f.pedidoId === pedidoId && f.tipo === tipo)) return false;
    const p = this.pedidos.find((x) => x.id === pedidoId)!;
    const ventana = Math.floor(ahora.getTime() / HORA_MS);
    if (p.avisos.some((a) => a.ventana === ventana)) return false;
    p.avisos.push({ tipo, enviadoEn: ahora, ventana });
    return true;
  }
}
