// Puente: la solicitud web de Omar entra a la cola del agente de Telegram. Reusa el negocio (existencia neta de reservas) y publica la tarjeta
// Autorizar / Rechazar en el grupo de socios por el mismo camino que una toma escrita. Idempotente por clave: un reintento no duplica la tarjeta.
import type { AgenteTelegram } from '@/aplicacion/agente/agente';
import type { ColaSolicitudes } from '@/aplicacion/omar/puertos';
import type { Miembro } from '@/dominio/agente/tipos';
import { caducaEn } from '@/dominio/omar/solicitud';
import type { LineaSolicitud, ResultadoSolicitud } from '@/dominio/omar/tipos';

export interface ResolucionPieza {
  modeloId: string;
  saborId: string | null;
}

export function colaViaAgente(deps: {
  agente: Pick<AgenteTelegram, 'solicitarTomaDesdeWeb'>;
  autor: Miembro;
  resolver: (l: LineaSolicitud) => ResolucionPieza | null;
  ahora: () => Date;
  caducaHoras: number;
}): ColaSolicitudes {
  // Se guarda la PROMESA: dos envios simultaneos con la misma clave comparten un solo trabajo (doble clic).
  const hechas = new Map<string, Promise<ResultadoSolicitud>>();
  return {
    async solicitar(clave, linea) {
      const previa = hechas.get(clave);
      if (previa) {
        const r = await previa;
        return r.ok ? { ...r, repetido: true } : r;
      }
      const trabajo = hacer(clave, linea);
      hechas.set(clave, trabajo);
      return trabajo;
    },
  };

  async function hacer(clave: string, linea: LineaSolicitud): Promise<ResultadoSolicitud> {
    {
      const res = deps.resolver(linea);
      if (!res) return { ok: false, motivo: 'pieza_desconocida', mensaje: 'Ese modelo y sabor no están en tu bodega.' };
      const r = await deps.agente.solicitarTomaDesdeWeb(
        {
          intencion: { tipo: 'toma_omar', lineas: [{ modelo_texto: linea.modelo, sabor_texto: linea.sabor, piezas: linea.piezas }], fuente_cita: 'web' },
          resoluciones: { clienteId: null, proveedorId: null, lineas: [{ modeloId: res.modeloId, saborId: res.saborId }], modeloId: null },
        },
        deps.autor,
        clave,
      );
      const salida: ResultadoSolicitud = r.tipo === 'toma_pendiente'
        ? { ok: true, folio: r.folio, estado: 'pendiente', caduca_at: caducaEn(deps.ahora().toISOString(), deps.caducaHoras), repetido: false }
        : { ok: false, motivo: 'sin_disponible', mensaje: 'Esa pieza ya no está disponible para tomar. Revisa tu bodega.' };
      return salida;
    }
  }
}
