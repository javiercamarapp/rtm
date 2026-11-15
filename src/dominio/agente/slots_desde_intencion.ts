// El interprete alimenta los slots de la maquina de conversacion (integracion, 16-nov): lo que el extractor ya entendio de un mensaje se convierte en DATOS CRUDOS por slot
// (textos tal como los dijo el socio, centavos tal como los extrajo). La maquina los resuelve contra el catalogo, valida los montos contra la cita y pregunta lo que falte.
// Nada aqui calcula dinero ni resuelve ids; lo que el modelo dejo en null NO se manda (el slot queda vacio y se pregunta).
import type { Intencion } from './intenciones';
import type { OperacionConv } from './slots';

export interface InstruccionConversacion {
  operacion: OperacionConv;
  candidatos: Record<string, unknown>;
}

/** Operaciones que la conversacion registra de punta a punta por el carril de frenos. El resto de las intenciones sigue su camino anterior. */
export const OPERACIONES_POR_CONVERSACION: ReadonlySet<OperacionConv> = new Set<OperacionConv>([
  'pedido_bodega', 'cobro_cliente', 'pago_proveedor', 'pago_redirigido', 'gasto', 'aportacion', 'reembolso', 'retiro', 'conteo', 'alta_cliente',
]);

function limpiar(o: Record<string, unknown>): Record<string, unknown> {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== null && v !== undefined && v !== '') r[k] = v;
  return r;
}

const lineas = (ls: ReadonlyArray<{ modelo_texto: string; sabor_texto: string | null; piezas: number }>): Array<{ modelo_texto: string; sabor_texto: string | null; piezas: number }> =>
  ls.map((l) => ({ modelo_texto: l.modelo_texto, sabor_texto: l.sabor_texto, piezas: l.piezas }));

/** null = esta intencion no pasa por la conversacion (comandos, consultas, deshacer, intenciones sin puente...). */
export function instruccionDeIntencion(i: Intencion): InstruccionConversacion | null {
  switch (i.tipo) {
    case 'pedido': {
      // Modalidad y plazo: 0 dias = de contado; N dias = a credito con plazo. Sin dato, la maquina pregunta ("¿de contado o a credito?").
      const dias = i.plazo_dias ?? null;
      return {
        operacion: 'pedido_bodega',
        candidatos: limpiar({
          cliente: i.cliente_texto,
          lineas: lineas(i.lineas),
          modalidad: dias === null ? null : dias === 0 ? 'contado' : 'credito',
          plazo: dias !== null && dias > 0 ? `${dias} dias` : i.plazo_texto ?? null,
          // 0 = "sin envio" (valido); null = no lo dijo (se pregunta).
          envio: i.envio_cobrado_centavos,
          destino: i.destino_texto,
        }),
      };
    }
    case 'pago':
      return { operacion: 'cobro_cliente', candidatos: limpiar({ cliente: i.cliente_texto, monto: i.monto_centavos, cuenta: i.cuenta_destino_texto, pedido: i.pedido_folio }) };
    case 'pago_proveedor':
      return {
        operacion: i.cliente_texto === null ? 'pago_proveedor' : 'pago_redirigido',
        candidatos: limpiar({
          proveedor: i.proveedor_texto, monto: i.monto_centavos, cliente: i.cliente_texto,
          ...(i.cliente_texto === null ? { pagado_por: i.pagado_por, intencion: i.pagado_por === 'sociedad' ? null : i.intencion ?? null } : {}),
        }),
      };
    case 'gasto':
      return { operacion: 'gasto', candidatos: limpiar({ tipo_gasto: i.gasto, monto: i.monto_centavos, pagado_por: i.pagado_por === 'sociedad' ? null : i.pagado_por, referencia: i.descripcion }) };
    case 'aportacion':
      return { operacion: 'aportacion', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, intencion: i.intencion, motivo: i.motivo }) };
    case 'reembolso_socio':
      return { operacion: 'reembolso', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, via: i.via }) };
    case 'retiro_utilidad':
      return { operacion: 'retiro', candidatos: limpiar({ socio: i.socio, monto: i.monto_centavos, via: i.via }) };
    case 'conteo':
      return { operacion: 'conteo', candidatos: limpiar({ lineas: lineas(i.lineas) }) };
    case 'cliente_alta':
      return { operacion: 'alta_cliente', candidatos: limpiar({ nombre: i.nombre }) };
    default:
      return null;
  }
}
