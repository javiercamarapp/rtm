// Implementaciones en memoria de los puertos del inventario de proveedores. Sirven para pruebas y para desarrollo local sin base de datos.
// La version de produccion usa las tablas descritas en docs/lanes/proveedores-scraper-necesita-db.md.

import type { FilaFoto, PuertoAvisos, RepositorioInventarioProveedor } from '@/aplicacion/proveedores/puertos';
import type { PresupuestoDia } from '@/dominio/proveedores/fuente';
import { estadoVacio } from '@/dominio/proveedores/tipos';
import type { EstadoProveedor, EventoCambio, SolicitudAviso } from '@/dominio/proveedores/tipos';

export class RepositorioMemoria implements RepositorioInventarioProveedor {
  estado: EstadoProveedor = estadoVacio();
  readonly eventos = new Map<string, EventoCambio>();
  readonly fotos = new Map<string, FilaFoto[]>();
  private presupuestos = new Map<string, PresupuestoDia>();
  guardados = 0;

  async cargarEstado(): Promise<EstadoProveedor> {
    return structuredClone(this.estado);
  }

  async guardarEstado(estado: EstadoProveedor, eventos: EventoCambio[]): Promise<void> {
    this.estado = structuredClone(estado);
    for (const e of eventos) if (!this.eventos.has(e.clave)) this.eventos.set(e.clave, structuredClone(e));
    this.guardados += 1;
  }

  async cargarPresupuesto(dia: string): Promise<PresupuestoDia | null> {
    const p = this.presupuestos.get(dia);
    return p ? structuredClone(p) : null;
  }

  async guardarPresupuesto(p: PresupuestoDia): Promise<void> {
    this.presupuestos.set(p.dia, structuredClone(p));
  }

  async guardarFotoDiaria(dia: string, filas: FilaFoto[]): Promise<void> {
    this.fotos.set(dia, structuredClone(filas));
  }
}

/** Avisos en memoria con la misma idempotencia que exige `notificacion.emitir`: una clave abierta no se duplica. */
export class AvisosMemoria implements PuertoAvisos {
  readonly abiertos = new Map<string, SolicitudAviso>();
  readonly emitidos: SolicitudAviso[] = [];
  readonly resueltos: string[] = [];

  async emitir(aviso: SolicitudAviso): Promise<void> {
    if (this.abiertos.has(aviso.claveDedupe)) return;
    this.abiertos.set(aviso.claveDedupe, aviso);
    this.emitidos.push(aviso);
  }

  async resolver(claveDedupe: string): Promise<void> {
    if (this.abiertos.delete(claveDedupe)) this.resueltos.push(claveDedupe);
  }
}
