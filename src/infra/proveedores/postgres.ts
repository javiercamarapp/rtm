// Adaptadores de Postgres del inventario de proveedores. Hablan con las funciones `proveedores.*` (rol servidor) o, para las paginas, con `api.prov_*` (sesion del socio).
// Ningun importe viaja ni se guarda: la base lo rechaza y el dominio lo comprueba antes.
import { randomUUID } from 'node:crypto';
import type { FilaFoto, PuertoAvisos, PuertoContextoNegocio, PuertoDatosLista, RepositorioInventarioProveedor } from '@/aplicacion/proveedores/puertos';
import { ErrorProveedor } from '@/dominio/proveedores/errores';
import { redactarAviso } from '@/dominio/proveedores/avisos';
import type { ContextoSocios } from '@/dominio/proveedores/detector';
import type { PresupuestoDia, TipoPeticion } from '@/dominio/proveedores/fuente';
import type { ExistenciaPropiaParaLista } from '@/dominio/proveedores/lista_cliente';
import type { ContextoNormalizacion } from '@/dominio/proveedores/normalizador';
import type { EstadoProveedor, EventoCambio, SolicitudAviso } from '@/dominio/proveedores/tipos';

/** Una funcion de la base por nombre corto (`cargar_estado`, `guardar_estado`...). Cada implementacion decide el esquema. */
export type LlamadaProveedores = (fn: string, args?: Record<string, unknown>) => Promise<unknown>;

const TIPOS: TipoPeticion[] = ['catalogo', 'confirmacion', 'inicio', 'coleccion', 'robots'];

export class RepositorioProveedorDb implements RepositorioInventarioProveedor {
  constructor(private readonly db: LlamadaProveedores) {}

  async cargarEstado(): Promise<EstadoProveedor> {
    return (await this.db('cargar_estado')) as EstadoProveedor;
  }

  async guardarEstado(estado: EstadoProveedor, eventos: EventoCambio[]): Promise<void> {
    await this.db('guardar_estado', { p_estado: estado, p_eventos: eventos, p_clave_idem: `prov:${Date.now()}:${randomUUID()}` });
  }

  async cargarPresupuesto(dia: string): Promise<PresupuestoDia | null> {
    return ((await this.db('cargar_presupuesto', { p_dia: dia })) as PresupuestoDia | null) ?? null;
  }

  /** El tope de 40 lo hace la base con un UPDATE condicional: aqui solo se pide por cada peticion que el ciclo contó de mas. */
  async guardarPresupuesto(p: PresupuestoDia): Promise<void> {
    const actual = (await this.cargarPresupuesto(p.dia)) ?? { dia: p.dia, usadas: 0, porTipo: { catalogo: 0, confirmacion: 0, inicio: 0, coleccion: 0, robots: 0 } };
    for (const t of TIPOS) {
      for (let i = actual.porTipo[t]; i < p.porTipo[t]; i++) {
        const ok = (await this.db('presupuesto_tomar', { p_dia: p.dia, p_tipo: t })) as boolean;
        if (!ok) throw new ErrorProveedor('presupuesto_agotado', 'se alcanzo el tope de 40 peticiones del dia');
      }
    }
  }

  async guardarFotoDiaria(dia: string, filas: FilaFoto[]): Promise<void> {
    await this.db('guardar_foto_diaria', { p_dia: dia, p_filas: filas });
  }
}

interface SociosJson { modelos: number[]; sabores: string[] }

export class ContextoNegocioDb implements PuertoContextoNegocio {
  constructor(private readonly db: LlamadaProveedores) {}

  async normalizacion(): Promise<ContextoNormalizacion> {
    return (await this.db('contexto_normalizacion')) as ContextoNormalizacion;
  }

  async socios(): Promise<ContextoSocios> {
    const j = (await this.db('contexto_socios')) as SociosJson;
    const modelos = new Set(j.modelos.map(String));
    const sabores = new Set(j.sabores);
    return {
      modeloActivo: (m) => m.canonicoId !== null && modelos.has(m.canonicoId),
      saborDeSocios: (v, m) => m.canonicoId !== null && v.saborCanonicoId !== null && sabores.has(`${m.canonicoId}:${v.saborCanonicoId}`),
    };
  }
}

export class DatosListaDb implements PuertoDatosLista {
  constructor(private readonly db: LlamadaProveedores) {}

  async precioDeTabulador(clienteId: string, modeloCanonicoId: string): Promise<bigint | null> {
    const r = (await this.db('precio_tabulador', { p_cliente: Number(clienteId), p_modelo: Number(modeloCanonicoId) })) as { precio_cent: number | null } | number | null;
    const v = typeof r === 'object' && r !== null ? r.precio_cent : r;
    return v === null || v === undefined ? null : BigInt(v);
  }

  async existenciaPropia(): Promise<ExistenciaPropiaParaLista[]> {
    return (await this.db('existencia_propia')) as ExistenciaPropiaParaLista[];
  }
}

export class AvisosDb implements PuertoAvisos {
  constructor(private readonly db: LlamadaProveedores) {}

  async emitir(a: SolicitudAviso): Promise<void> {
    await this.db('emitir_aviso', { p_codigo: a.codigo, p_clave: a.claveDedupe, p_entidad_tipo: a.entidadTipo, p_entidad_id: a.entidadId, p_payload: a.payload, p_titulo: redactarAviso(a) });
  }

  async resolver(claveDedupe: string): Promise<void> {
    await this.db('resolver_aviso', { p_clave: claveDedupe });
  }
}
