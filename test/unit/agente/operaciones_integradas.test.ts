// Auditoria de la INTEGRACION del bot (ventas-compras + socios-gastos + aprendizaje-alta): cada operacion que registra la maquina de conversacion tiene sus slots, su intencion de ida y vuelta,
// su puerta SQL (funciones y tipo de hub que existen de verdad en las migraciones) y su mensaje final. Si una rama futura agrega una operacion sin cablearla, esta prueba lo dice por nombre.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOGO_INTENCIONES } from '@/dominio/agente/catalogo_intenciones';
import type { Intencion, TipoIntencion } from '@/dominio/agente/intenciones';
import { OPERACIONES, OPERACIONES_CONV, slotsFaltantes, type OperacionConv } from '@/dominio/agente/slots';
import { instruccionDeIntencion, OPERACIONES_POR_CONVERSACION } from '@/dominio/agente/slots_desde_intencion';
import { intencionDeSlots } from '@/aplicacion/agente/slots_a_intencion';

const C = 'cita';
const cli = { id: '7', nombre: 'Lupita Soto' };
const prov = { id: '2', nombre: 'Isaac' };
const linea = { modeloId: '10', modelo: 'Nexa', saborId: '11', sabor: 'Mango', piezas: 24 };
const L = { modelo_texto: 'nexa', sabor_texto: 'mango', piezas: 24 };

interface Caso {
  /** Slots COMPLETOS tal como los deja la maquina (ids de catalogo, centavos, dias). */
  slots: Record<string, unknown>;
  /** Lo que el interprete extrae para abrir esa conversacion. */
  intencion: Intencion;
  /** Tipo de intencion del carril de frenos al que se traduce. */
  tipo: TipoIntencion;
}

const CASOS: Partial<Record<OperacionConv, Caso>> = {
  pedido_bodega: { tipo: 'pedido', slots: { cliente: cli, lineas: [linea], modalidad: 'credito', plazo: 15, envio: 0 },
    intencion: { tipo: 'pedido', cliente_texto: 'Lupita', destino_texto: null, lineas: [{ ...L, precio_texto: null, fuente_cita: C }], envio_cobrado_centavos: 0, plazo_texto: null, plazo_dias: 15, plazo_fecha_dicha: null, fuente_cita: C } },
  pedido_dropshipping: { tipo: 'pedido_ds', slots: { cliente: cli, origen: 'karen_directo', lineas: [linea], modalidad: 'credito', plazo: 15, envio: 0 },
    intencion: { tipo: 'pedido_ds', cliente_texto: 'Lupita', proveedor_origen: 'karen_directo', lineas: [L], forma_pago: 'credito', plazo_texto: null, plazo_dias: 15, envio_cobrado_centavos: 0, folio_proveedor_texto: null, fuente_cita: C } as Intencion },
  pedido_a_costo: { tipo: 'pedido_menudeo', slots: { lineas: [linea], origen: 'karen_directo', fecha_pago: { fecha: '2026-11-20', hora: null, sinFecha: false } },
    intencion: { tipo: 'pedido_menudeo', proveedor_origen: 'karen_directo', lineas: [L], cuando_texto: null, fecha_compromiso: '2026-11-20', hora_compromiso: null, sin_fecha: false, fuente_cita: C } as Intencion },
  cobro_cliente: { tipo: 'pago', slots: { cliente: cli, monto: 100000, cuenta: 'efectivo' },
    intencion: { tipo: 'pago', cliente_texto: 'Lupita', monto_centavos: 100000, cuenta_destino_texto: 'efectivo', pedido_folio: null, fuente_cita: C } },
  pago_redirigido: { tipo: 'pago_proveedor', slots: { cliente: cli, proveedor: prov, monto: 50000 },
    intencion: { tipo: 'pago_proveedor', proveedor_texto: 'Isaac', monto_centavos: 50000, pagado_por: 'sociedad', cliente_texto: 'Lupita', intencion: null, fuente_cita: C } },
  pago_proveedor: { tipo: 'pago_proveedor', slots: { proveedor: prov, monto: 50000, pagado_por: 'angelo', intencion: 'reembolso' },
    intencion: { tipo: 'pago_proveedor', proveedor_texto: 'Isaac', monto_centavos: 50000, pagado_por: 'angelo', cliente_texto: null, intencion: 'reembolso', fuente_cita: C } },
  compra: { tipo: 'compra', slots: { proveedor: prov, lineas: [linea] },
    intencion: { tipo: 'compra', proveedor_texto: 'Isaac', lineas: [L], guia_centavos: null, pagado_por: null, fuente_cita: C } },
  orden_compra: { tipo: 'orden_compra', slots: { proveedor: prov, lineas: [linea] },
    intencion: { tipo: 'orden_compra', proveedor_texto: 'Isaac', lineas: [L], aplicar_saldo: false, fuente_cita: C } as Intencion },
  recepcion_compra: { tipo: 'compra_recepcion', slots: { folio_compra: 'C-0001', alcance: 'parcial', lineas: [linea] },
    intencion: { tipo: 'compra_recepcion', compra_folio: 'C-0001', lineas: [L], fuente_cita: C } as Intencion },
  compra_estado: { tipo: 'compra_estado', slots: { folio_compra: 'C-0001', estado_compra: 'llego_merida' },
    intencion: { tipo: 'compra_estado', compra_folio: 'C-0001', estado: 'llego_merida', fuente_cita: C } as Intencion },
  compra_cierre: { tipo: 'compra_cierre', slots: { folio_compra: 'C-0001', motivo: 'no manda el resto' },
    intencion: { tipo: 'compra_cierre', compra_folio: 'C-0001', motivo: 'no manda el resto', fuente_cita: C } as Intencion },
  envio_lote: { tipo: 'envio_lote', slots: { folios: ['LS-001', 'MG-004'], paqueteria: 'Castores' },
    intencion: { tipo: 'envio_lote', paqueteria: 'castores', folios: ['LS-001', 'MG-004'], fuente_cita: C } as Intencion },
  guias_lote: { tipo: 'guias_lote', slots: { guias: [{ folio: 'LS-001', guia: '8801' }] },
    intencion: { tipo: 'guias_lote', paqueteria: null, guias: [{ pedido_folio: 'LS-001', cliente_texto: null, guia_texto: '8801' }], fuente_cita: C } as Intencion },
  devolucion: { tipo: 'devolucion', slots: { cliente: cli, pedido_folio: 'LS-001', lineas: [linea], destino_piezas: 'inventario', motivo: 'llego mal' },
    intencion: { tipo: 'devolucion', cliente_texto: 'Lupita', pedido_folio: 'LS-001', lineas: [L], destino: 'inventario', motivo: 'llego mal', fuente_cita: C } as Intencion },
  paquete_perdido: { tipo: 'paquete_perdido', slots: { pedido_folio: 'LS-001', incidente: 'perdido', detalle: 'no lo entregaron' },
    intencion: { tipo: 'paquete_perdido', pedido_folio: 'LS-001', cliente_texto: null, incidente: 'perdido', detalle: 'no lo entregaron', fuente_cita: C } as Intencion },
  gasto: { tipo: 'gasto', slots: { tipo_gasto: 'uber', monto: 4500, pagado_por: 'angelo' },
    intencion: { tipo: 'gasto', gasto: 'uber', monto_centavos: 4500, pagado_por: 'angelo', descripcion: null, fuente_cita: C } as Intencion },
  gasto_servicio: { tipo: 'gasto_servicio', slots: { servicio: 'hosting', moneda: 'usd', monto: 2000, pagado_por: 'javier', tipo_cambio: '18.50' },
    intencion: { tipo: 'gasto_servicio', servicio_texto: 'hosting', monto_usd_centavos: 2000, monto_mxn_centavos: null, tipo_cambio_micro: 18_500_000, pagado_por: 'javier', fuente_cita: C } as Intencion },
  aportacion: { tipo: 'aportacion', slots: { socio: 'angelo', monto: 2000000, intencion: 'reembolso' },
    intencion: { tipo: 'aportacion', socio: 'angelo', monto_centavos: 2000000, motivo: null, intencion: 'reembolso', fuente_cita: C } as Intencion },
  reembolso: { tipo: 'reembolso_socio', slots: { socio: 'angelo', monto: 50000, via: 'efectivo' },
    intencion: { tipo: 'reembolso_socio', socio: 'angelo', monto_centavos: 50000, via: 'efectivo', fuente_cita: C } as Intencion },
  retiro: { tipo: 'retiro_utilidad', slots: { socio: 'javier', monto: 50000, via: 'transferencia' },
    intencion: { tipo: 'retiro_utilidad', socio: 'javier', monto_centavos: 50000, via: 'transferencia', fuente_cita: C } as Intencion },
  entrega_fondos: { tipo: 'entrega_fondos', slots: { socio: 'angelo', monto: 300000, destino: 'sociedad', via: 'efectivo' },
    intencion: { tipo: 'entrega_fondos', socio: 'angelo', destino: 'sociedad', monto_centavos: 300000, via: 'efectivo', fuente_cita: C } as Intencion },
  liquidacion: { tipo: 'liquidacion_socios', slots: { socio: 'angelo', contraparte: 'javier', monto: 100000, via: 'transferencia' },
    intencion: { tipo: 'liquidacion_socios', de_socio: 'angelo', a_socio: 'javier', monto_centavos: 100000, via: 'transferencia', fuente_cita: C } as Intencion },
  retiro_capital: { tipo: 'retiro_capital', slots: { socio: 'angelo', monto: 100000 },
    intencion: { tipo: 'retiro_capital', socio: 'angelo', monto_centavos: 100000, via: null, fuente_cita: C } as Intencion },
  renta_omar: { tipo: 'renta_omar', slots: { monto: 200, pagado_por: 'javier', via: 'transferencia' },
    intencion: { tipo: 'renta_omar', monto_centavos: 200, pagado_por: 'javier', via: 'transferencia', fuente_cita: C } as Intencion },
  conteo: { tipo: 'conteo', slots: { lineas: [linea] },
    intencion: { tipo: 'conteo', lineas: [L], fuente_cita: C } as Intencion },
  alta_cliente: { tipo: 'cliente_alta', slots: { nombre: 'Memo Garcia', tipo_cliente: 'mayoreo', duenio: 'javier', plazo_habitual: '8' },
    intencion: { tipo: 'cliente_alta', nombre: 'Memo Garcia', fuente_cita: C } as Intencion },
  alta_sabor: { tipo: 'sabor_alta', slots: { nombre: 'Sandia', modelo: 'Nexa' },
    intencion: { tipo: 'sabor_alta', modelo_texto: 'Nexa', sabor_texto: 'Sandia', fuente_cita: C } as Intencion },
  alta_modelo: { tipo: 'modelo_alta', slots: { nombre: 'Zafiro', marca: 'Lost Mary', puffs: '20000', proveedor_costo: 'ninguno' },
    intencion: { tipo: 'modelo_alta', modelo_texto: 'Zafiro', marca_texto: 'Lost Mary', puffs_texto: '20000', proveedor_texto: null, costo_centavos: null, fuente_cita: C } as Intencion },
};

/** Operaciones que NO pasan por la maquina de conversacion en esta integracion (siguen por su camino anterior, con comando o interprete). */
const FUERA_DE_CONVERSACION: readonly OperacionConv[] = ['deposito', 'merma', 'obsequio'];

/** Las altas las registra el modulo de aprendizaje con sus propias funciones agente.alta_* (deteccion de parecidos, sin inventar costos). */
const ALTAS_ASISTIDAS: ReadonlySet<string> = new Set(['alta_cliente', 'alta_sabor', 'alta_modelo']);

const migraciones = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n').toLowerCase();
const existeFuncion = (nombre: string): boolean => new RegExp(`function\\s+${nombre.toLowerCase().replace('.', '\\.')}\\s*\\(`).test(migraciones);

describe('integracion: cada operacion de la conversacion esta cableada de punta a punta', () => {
  it('todas las operaciones declaradas pasan por la conversacion o estan listadas como fuera de ella (ninguna queda a medias)', () => {
    for (const op of OPERACIONES_CONV) {
      const por = OPERACIONES_POR_CONVERSACION.has(op);
      expect(por || FUERA_DE_CONVERSACION.includes(op), `${op}: ni conectada a la conversacion ni listada como fuera`).toBe(true);
      expect(por && FUERA_DE_CONVERSACION.includes(op), `${op}: no puede estar en las dos`).toBe(false);
      expect(OPERACIONES[op].slots.some((s) => s.obligatorio), `${op}: sin slots obligatorios`).toBe(true);
      expect(OPERACIONES[op].titulo.length, `${op}: sin titulo para el mensaje final`).toBeGreaterThan(3);
    }
    expect([...OPERACIONES_POR_CONVERSACION].sort()).toEqual(Object.keys(CASOS).sort());
  });

  for (const op of Object.keys(CASOS) as OperacionConv[]) {
    const caso = CASOS[op]!;
    describe(op, () => {
      it('slots: el caso completo no deja nada faltante y sin cada obligatorio la maquina pregunta', () => {
        expect(slotsFaltantes(op, caso.slots)).toEqual([]);
        for (const s of OPERACIONES[op].slots.filter((x) => x.obligatorio && (x.si === undefined || (x.si.valores === undefined ? caso.slots[x.si.slot] !== undefined : x.si.valores.includes(String(caso.slots[x.si.slot]))))))
          expect(slotsFaltantes(op, { ...caso.slots, [s.clave]: undefined }), `${op}.${s.clave}`).toContain(s.clave);
      });

      it('intencion: el interprete abre la operacion y los slots completos vuelven a la intencion del carril de frenos', () => {
        const ins = instruccionDeIntencion(caso.intencion);
        expect(ins, 'el interprete no alimenta la conversacion').not.toBeNull();
        expect(ins!.operacion).toBe(op);
        if (ALTAS_ASISTIDAS.has(op)) return; // el modulo de aprendizaje las registra con agente.alta_* (se prueba abajo y en aprendizaje_e2e)
        const tr = intencionDeSlots(op, caso.slots, C);
        expect(tr.ok, tr.ok ? '' : tr.texto).toBe(true);
        if (tr.ok) expect(tr.intencion.tipo).toBe(caso.tipo);
      });

      it('SQL: la intencion esta activa en el catalogo, su puerta existe y las funciones que llama existen en las migraciones', () => {
        if (op === 'alta_sabor' || op === 'alta_modelo') {
          // Su puerta es el modulo de aprendizaje (agente.alta_*), no el hub: el catalogo las marca 'extraido' para que el camino viejo no las registre sin conversacion.
          expect(existeFuncion(op.replace('alta_', 'agente.alta_')), `agente.${op}`).toBe(true);
          return;
        }
        const d = CATALOGO_INTENCIONES[caso.tipo];
        expect(d.estado, `${caso.tipo} no esta activa`).toBe('activa');
        expect(d.hub).not.toBe('ninguno');
        expect(d.tipoHub, 'sin tipo de puerta').not.toBeNull();
        expect(migraciones.includes(`'${d.tipoHub}'`), `la puerta ${d.hub} no enruta '${d.tipoHub}' en ninguna migracion`).toBe(true);
        expect(d.funcionesSql.length).toBeGreaterThan(0);
        for (const f of d.funcionesSql) expect(existeFuncion(f), `${caso.tipo}: la funcion ${f} no existe en las migraciones`).toBe(true);
        if (ALTAS_ASISTIDAS.has(op)) expect(existeFuncion(op.replace('alta_', 'agente.alta_')), `agente.${op}`).toBe(true);
      });
    });
  }

  it('las operaciones con SQL propio de dinero entre socios no son reversibles por Telegram cuando no deben serlo (retiro de capital, firma del acta, entrega a proveedor)', () => {
    expect(migraciones).toContain("array['retiro_capital', 'acta_confirmar', 'entrega_proveedor']");
    expect(migraciones).toContain("'envio_lote'");
  });
});
