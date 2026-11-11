import type { FilaExportada, FiltroContactos, ListaContactos, ResumenContactos } from '@/dominio/contactos/vista';

/** Contactos de menudeo para socios. El telefono sale enmascarado; revelar y exportar dejan registro en la base. */
export interface LectorContactos {
  resumen(): Promise<ResumenContactos>;
  lista(filtro: FiltroContactos, limite: number, desplazamiento: number): Promise<ListaContactos>;
  revelar(id: number, motivo: string): Promise<string[]>;
  /** Con `ids`, exporta esa seleccion; sin ellos, todo lo que coincide con el filtro. */
  exportar(ids: number[] | null, filtro: FiltroContactos): Promise<FilaExportada[]>;
}
