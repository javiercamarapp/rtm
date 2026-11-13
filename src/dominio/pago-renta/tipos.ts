// Tipos de lectura del Pago de renta (lo que devuelven api.pago_renta_panel y omar.mi_pago_renta). Dinero en centavos bigint; la web no calcula dinero:
// las cifras de dinero vienen de la base y aqui solo se agrupan, se ordenan y se redactan frases con plantillas fijas.

export interface EstadoRenta {
  hoy: string;
  /** Tarifa por pieza vigente; null si no hay tarifa configurada. */
  tarifa_cent: bigint | null;
  piezas: number;
  devengado_cent: bigint;
  compensado_tomas_cent: bigint;
  pagado_cent: bigint;
  /** Con signo: positivo se debe a Omar, negativo esta pagado de mas. */
  saldo_cent: bigint;
  por_pagar_cent: bigint;
  a_favor_cent: bigint;
  /** true si piezas x tarifa explica exactamente el devengado (la tarifa no cambio). */
  regla_exacta: boolean;
  primer_envio: string | null;
  ultimo_envio: string | null;
  mes_ini: string;
  mes_piezas: number;
  mes_devengado_cent: bigint;
}

/** `acum_mes_cent`: renta acumulada del mes hasta ese dia, calculada en la base. */
export interface DiaRenta { fecha: string; piezas: number; renta_cent: bigint; acum_mes_cent: bigint }

export interface PagoRenta {
  folio: string;
  fecha: string;
  monto_cent: bigint;
  via: 'transferencia' | 'efectivo';
  /** Solo en la vista del socio. */
  socio?: string | null;
  nota?: string | null;
  comprobante?: string | null;
  exceso_cent?: bigint;
  /** Fila de reversa (monto negativo) y su original anulado. */
  es_reversa: boolean;
  anulado: boolean;
  motivo_reversa?: string | null;
  reversa_de_folio?: string | null;
}

export interface MuestraProyeccion { dias_ventana: number; dias_con_envio: number; piezas: number; dias_requeridos: number; piezas_requeridas: number }
export interface Rango { central: bigint; bajo: bigint; alto: bigint }
export interface RangoPiezas { central: number; bajo: number; alto: number }

export type Proyeccion =
  | { etiqueta: 'Estimado'; emitida: false; motivo: 'sin_tarifa' | 'sin_historia' | 'muestra_chica'; muestra: MuestraProyeccion }
  | {
      etiqueta: 'Estimado';
      emitida: true;
      muestra: MuestraProyeccion;
      metodo: string;
      ritmo_diario_pz: number;
      fecha_corte: string;
      dias_restantes: number;
      mes_piezas_acumuladas: number;
      restantes_pz: RangoPiezas;
      mes_pz: RangoPiezas;
      restante_renta_cent: Rango;
      mes_renta_cent: Rango;
      pago_al_corte_cent: Rango;
    };

export interface PanelRenta {
  estado: EstadoRenta;
  proyeccion: Proyeccion;
  serie: DiaRenta[];
  pagos: PagoRenta[];
}

export type ResultadoPago =
  | { ok: true; folio: string; saldo_despues_cent: bigint; exceso_cent: bigint; repetido: boolean }
  | { ok: false; mensaje: string };
