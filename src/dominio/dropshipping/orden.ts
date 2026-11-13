// Texto de la orden para el proveedor (espejo de operacion.texto_orden_proveedor). El sistema NO la envia: el socio la copia y la manda el mismo.
// No lleva precios al cliente ni costos. El bloque de entrega solo aparece cuando hay destinatario.
import type { GrupoOrden } from './tipos';

export interface BloqueEntrega { nombre: string; calle_numero: string; colonia?: string; cp: string; municipio: string; estado: string; telefono?: string; correo?: string; referencias?: string }

export function textoOrden(folio: string, grupos: GrupoOrden[], destino: BloqueEntrega | null): string {
  let v = `Pedido ${folio}\n`;
  let total = 0;
  for (const g of grupos) {
    v += `\n${g.marca} ${g.modelo} (${g.piezas} pzas)\n`;
    for (const s of g.sabores) v += `- ${s.sabor} x ${s.piezas}\n`;
    total += g.piezas;
  }
  v += `\nTotal: ${total} pzas`;
  if (destino) {
    v += `\n\nEntregar a:\n${destino.nombre}\n${destino.calle_numero}${destino.colonia ? `, ${destino.colonia}` : ''}, CP ${destino.cp}\n${destino.municipio}, ${destino.estado}`;
    if (destino.telefono) v += `\nTel: ${destino.telefono}`;
    if (destino.correo) v += `\nCorreo: ${destino.correo}`;
    if (destino.referencias) v += `\nReferencias: ${destino.referencias}`;
  }
  return v;
}

/** Agrupa renglones (marca, modelo, sabor, piezas) como los agrupa la base: por marca y modelo, sabores en orden alfabetico. */
export function agruparRenglones(renglones: { marca: string; modelo: string; sabor: string; piezas: number }[]): GrupoOrden[] {
  const mapa = new Map<string, GrupoOrden>();
  for (const r of renglones) {
    const k = `${r.marca}\u0000${r.modelo}`;
    const g = mapa.get(k) ?? { marca: r.marca, modelo: r.modelo, piezas: 0, sabores: [] };
    g.piezas += r.piezas;
    g.sabores.push({ sabor: r.sabor, piezas: r.piezas });
    mapa.set(k, g);
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, sabores: [...g.sabores].sort((a, b) => a.sabor.localeCompare(b.sabor, 'es')) }))
    .sort((a, b) => `${a.marca}\u0000${a.modelo}`.localeCompare(`${b.marca}\u0000${b.modelo}`, 'es'));
}
