// Caso de uso: exportar el inventario en PDF. La base arma el snapshot y reserva el folio (misma funcion que la pantalla: el corte coincide);
// el PDF se genera UNA vez, se guarda con su huella y reabrirlo devuelve los mismos bytes.
import { nombreArchivo, textoParaCompartir } from '@/dominio/inventario/compartir';
import type { ParametrosInventario, VersionInventario } from '@/dominio/inventario/tipos';
import type { EscritorInventario, GeneradorPdfInventario } from './puertos';

export interface InventarioExportado { id: number; folio: string; sha256: string; nombre_archivo: string; texto_compartir: string; version: VersionInventario }

export async function exportarInventario(
  deps: { escritor: EscritorInventario; pdf: GeneradorPdfInventario },
  claveIdem: string, version: VersionInventario, params: Partial<ParametrosInventario>,
): Promise<InventarioExportado> {
  const reservado = await deps.escritor.reservarDocumento(claveIdem, version, params);
  const bytes = await deps.pdf.generar(reservado.snapshot, reservado.folio, reservado.huella);
  const sha256 = deps.pdf.huella(bytes);
  await deps.escritor.completarDocumento(reservado.id, sha256, bytes);
  return { id: reservado.id, folio: reservado.folio, sha256, nombre_archivo: nombreArchivo(reservado.folio, version), texto_compartir: textoParaCompartir(reservado.snapshot), version };
}
