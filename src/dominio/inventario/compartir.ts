// Texto sugerido para pegar junto al PDF al compartirlo por WhatsApp: SIN cifras sensibles (ni costos, ni valor, ni cantidades) y sin enviar nada por si mismo.
import { etiquetaFecha } from '../formato';
import type { SnapshotInventario } from './tipos';

export function marcasDelDocumento(s: SnapshotInventario): string[] {
  return [...new Set(s.modelos.map((m) => m.marca))].sort((a, b) => a.localeCompare(b, 'es'));
}

/** Titulo al estilo de Angelo: DISPONIBLE <MARCA> (fecha). Con varias marcas, DISPONIBLE (fecha). */
export function tituloDisponible(s: SnapshotInventario): string {
  const marcas = marcasDelDocumento(s);
  const fecha = etiquetaFecha(s.hoy);
  return marcas.length === 1 ? `DISPONIBLE ${marcas[0]!.toUpperCase()} (${fecha})` : `DISPONIBLE (${fecha})`;
}

export function textoParaCompartir(s: SnapshotInventario): string {
  const marcas = marcasDelDocumento(s);
  const de = marcas.length === 1 ? ` de ${marcas[0]}` : '';
  return `Te comparto la lista de disponible${de} al ${etiquetaFecha(s.hoy)}. Cualquier duda me avisas.`;
}

export function nombreArchivo(folio: string, version: 'clientes' | 'interna'): string {
  return `${folio}-${version === 'clientes' ? 'disponible' : 'inventario-interno'}.pdf`;
}

/** Enlace de WhatsApp con el texto ya escrito (el usuario elige el destinatario y pulsa enviar). */
export function enlaceWhatsApp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}
