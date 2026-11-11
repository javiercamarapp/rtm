// Implementacion en memoria del repositorio de costos (pruebas y vista previa). Solo inserta: no hay editar ni borrar.
// La implementacion Postgres llega con las tablas descritas en docs/lanes/costos-sistema-necesita-db.md.

import type { EventoRegistrado, PuertoIds, PuertoRepositorioCostos } from '@/aplicacion/costos/puertos';
import type { CargoCosto, ReembolsoCosto } from '@/dominio/costos/tipos';

export class RepositorioCostosEnMemoria implements PuertoRepositorioCostos {
  private cargos: CargoCosto[] = [];
  private reembolsos: ReembolsoCosto[] = [];
  private eventosRegistrados: EventoRegistrado[] = [];
  private contadores = { K: 0, R: 0, E: 0 };

  async siguienteFolio(prefijo: 'K' | 'R'): Promise<string> {
    this.contadores[prefijo] += 1;
    return `${prefijo}-${String(this.contadores[prefijo]).padStart(4, '0')}`;
  }

  private evento(e: Omit<EventoRegistrado, 'folio'>): EventoRegistrado {
    this.contadores.E += 1;
    const reg: EventoRegistrado = Object.freeze({ ...e, folio: `E-${String(this.contadores.E).padStart(4, '0')}` });
    this.eventosRegistrados.push(reg);
    return reg;
  }

  async insertarCargo(cargo: CargoCosto, evento: Omit<EventoRegistrado, 'folio'>): Promise<EventoRegistrado> {
    this.cargos.push(cargo);
    return this.evento(evento);
  }

  async insertarReembolso(r: ReembolsoCosto, evento: Omit<EventoRegistrado, 'folio'>): Promise<EventoRegistrado> {
    this.reembolsos.push(r);
    return this.evento(evento);
  }

  async cargoPorId(id: string) {
    return this.cargos.find((c) => c.id === id) ?? null;
  }
  async cargoPorClave(claveIdem: string) {
    return this.cargos.find((c) => c.claveIdem === claveIdem) ?? null;
  }
  async cargoPorEvidencia(servicioSlug: string, mes: string, sha256: string) {
    return this.cargos.find((c) => c.servicioSlug === servicioSlug && c.mes === mes && c.evidenciaSha256 === sha256 && c.reversaDe === null) ?? null;
  }
  async reversaDe(cargoId: string) {
    return this.cargos.find((c) => c.reversaDe === cargoId) ?? null;
  }
  async reembolsoPorClave(claveIdem: string) {
    return this.reembolsos.find((r) => r.claveIdem === claveIdem) ?? null;
  }
  async listarCargos() {
    return [...this.cargos];
  }
  async listarReembolsos() {
    return [...this.reembolsos];
  }
  eventos(): readonly EventoRegistrado[] {
    return [...this.eventosRegistrados];
  }
}

export function idsSecuenciales(prefijo = 'id'): PuertoIds {
  let n = 0;
  return { nuevoId: () => `${prefijo}-${++n}` };
}
