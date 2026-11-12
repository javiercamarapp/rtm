import type { EscritorOperacion, GeneradorPdf, LectorOperacion } from './puertos';

export type VarianteNota = 'cliente' | 'interna';
export interface DocumentoNota { bytes: Uint8Array; sha256: string; folio: string }

/**
 * Entrega el PDF de una nota. Se genera UNA vez (huella estable) y se guarda; las siguientes veces se devuelven los mismos bytes.
 * La hoja interna solo se arma para socios (la ruta que la sirve exige sesion de socio).
 */
export async function obtenerDocumentoNota(deps: { lector: LectorOperacion; escritor: EscritorOperacion; pdf: GeneradorPdf }, notaId: number, variante: VarianteNota): Promise<DocumentoNota | null> {
  const fuente = await deps.lector.notaFuente(notaId);
  if (!fuente) return null;
  const clave = variante === 'cliente' ? 'cliente_pdf' : 'interna_pdf';
  const guardado = await deps.lector.documento(notaId, clave);
  if (guardado) return { bytes: new Uint8Array(Buffer.from(guardado.base64, 'base64')), sha256: guardado.sha256, folio: fuente.folio_documento };
  const bytes = variante === 'cliente' ? await deps.pdf.notaCliente(fuente) : await deps.pdf.hojaInterna(fuente);
  const sha256 = deps.pdf.huella(bytes);
  await deps.escritor.guardarDocumento(notaId, clave, sha256, bytes);
  // Si dos solicitudes generaron a la vez, gana la primera guardada: se devuelve lo que quedo en la base.
  const final = await deps.lector.documento(notaId, clave);
  return final ? { bytes: new Uint8Array(Buffer.from(final.base64, 'base64')), sha256: final.sha256, folio: fuente.folio_documento } : { bytes, sha256, folio: fuente.folio_documento };
}

export interface DocumentoDevolucion { bytes: Uint8Array; sha256: string; folio: string }

/** PDF de una nota de credito (cliente) o de una devolucion a proveedor: se genera una vez y se guarda; reabrir entrega los mismos bytes. */
export async function obtenerDocumentoDevolucion(deps: { lector: LectorOperacion; escritor: EscritorOperacion; pdf: GeneradorPdf }, tipo: 'cliente' | 'proveedor', id: number): Promise<DocumentoDevolucion | null> {
  const fuente = await deps.lector.devolucionFuente(tipo, id);
  if (!fuente) return null;
  const guardado = await deps.lector.devolucionDocumento(tipo, id);
  if (guardado) return { bytes: new Uint8Array(Buffer.from(guardado.base64, 'base64')), sha256: guardado.sha256, folio: fuente.folio };
  const bytes = await deps.pdf.devolucion(fuente);
  const sha256 = deps.pdf.huella(bytes);
  await deps.escritor.guardarDocumentoDevolucion(tipo, id, sha256, bytes);
  const final = await deps.lector.devolucionDocumento(tipo, id);
  return final ? { bytes: new Uint8Array(Buffer.from(final.base64, 'base64')), sha256: final.sha256, folio: fuente.folio } : { bytes, sha256, folio: fuente.folio };
}
