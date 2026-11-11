// Lista de disponibilidad para clientes (WhatsApp), con el formato que Angelo ya usa:
//   DISPONIBLE <MARCA> (fecha y hora de la ultima lectura)
//   <MODELO EN MAYUSCULAS>
//   <un sabor por linea>
// Sin emojis, sin numero de caladas por defecto. Opcion "con precios de este cliente": el precio del tabulador del cliente elegido
// junto al modelo. Esta funcion NO recibe costos ni utilidad: no tiene por donde filtrarlos. Nunca lleva la direccion de la fuente.
// Se bloquea con advertencia si el dato tiene mas de 3 horas. El texto lo prepara el sistema; jamas se envia a clientes desde aqui.

import { etiquetaFechaHora, formatearMoneda } from '@/dominio/formato';
import { normalizar } from '@/dominio/catalogo/normalizar';
import { ErrorProveedor } from './errores';
import { claveCompacta } from './normalizador';
import { frescuraDe } from './fuente';
import { contieneDireccion } from './privacidad';
import type { Instante } from './tipos';

export interface SaborParaLista {
  nombre: string;
  disponible: boolean;
}

export interface ModeloParaLista {
  id: string;
  marca: string;
  /** Titulo del proveedor tal cual (incluye las caladas). */
  nombre: string;
  sabores: SaborParaLista[];
  /** Lo que los socios venden (ventas recientes o existencia propia). */
  deSocios: boolean;
  /** Precio del tabulador del cliente elegido, en centavos. Nunca el costo. */
  precioCliente?: bigint | null;
}

export interface ExistenciaPropiaParaLista {
  marca: string;
  nombre: string;
  sabores: string[];
}

export interface OpcionesLista {
  marcas?: string[];
  modelos?: string[];
  soloSocios?: boolean;
  /** Por defecto no se muestran las caladas. */
  mostrarCaladas?: boolean;
  conPrecios?: boolean;
  /** Combina la existencia propia (ENTREGA INMEDIATA) con la disponibilidad del proveedor (POR PEDIDO), cada renglon etiquetado. */
  existenciaPropia?: ExistenciaPropiaParaLista[];
}

export interface EntradaLista {
  ahora: Instante;
  ultimaLectura: Instante | null;
  modelos: ModeloParaLista[];
  opciones?: OpcionesLista;
  /** Origen privado configurado: solo para comprobar que el texto no lo contenga. */
  origenPrivado?: string;
}

export type ResultadoLista =
  | { estado: 'ok'; texto: string; marcas: string[]; sinPrecio: string[] }
  | { estado: 'bloqueada'; motivo: 'sin_lectura' | 'dato_desactualizado'; advertencia: string };

const CALADAS = [/(?<![A-Za-z0-9])\d{1,3}(?:[,.]\d{3})+(?![A-Za-z0-9])/g, /(?<![A-Za-z0-9])\d{1,3}\s?[kK](?![A-Za-z0-9])/g, /(?<![A-Za-z0-9])\d{4,6}(?![A-Za-z0-9])/g];

/** "Waka Icon 50,000" -> "Waka Icon". Un codigo de modelo pegado ("TE6000") se conserva. */
export function sinCaladas(nombre: string): string {
  let t = nombre;
  for (const re of CALADAS) t = t.replace(re, ' ');
  const limpio = t.replace(/\s+/g, ' ').trim();
  return limpio === '' ? nombre : limpio;
}

function clave(texto: string): string {
  return claveCompacta(normalizar(texto));
}

function bloqueDeModelo(nombre: string, sabores: string[], precio: string | null): string[] {
  const encabezado = precio ? `${nombre.toUpperCase()} - ${precio}` : nombre.toUpperCase();
  return [encabezado, ...sabores];
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function ordenar(sabores: string[]): string[] {
  const vistos = new Set<string>();
  const unicos = sabores.filter((s) => {
    const k = normalizar(s);
    if (k === '' || vistos.has(k)) return false;
    vistos.add(k);
    return true;
  });
  return unicos.sort((a, b) => comparar(normalizar(a), normalizar(b)));
}

export function generarListaDisponibilidad(entrada: EntradaLista): ResultadoLista {
  const op = entrada.opciones ?? {};
  const fr = frescuraDe(entrada.ultimaLectura, entrada.ahora);
  if (entrada.ultimaLectura === null) {
    return { estado: 'bloqueada', motivo: 'sin_lectura', advertencia: 'Todavía no hay una lectura del Inventario de Karen. No se puede preparar la lista.' };
  }
  if (fr.bloqueaLista) {
    const horas = Math.floor(fr.horasSinLectura ?? 0);
    return { estado: 'bloqueada', motivo: 'dato_desactualizado', advertencia: `El dato del Inventario de Karen tiene ${horas} horas (última lectura ${etiquetaFechaHora(entrada.ultimaLectura)}). No se prepara la lista hasta tener una lectura de menos de 3 horas.` };
  }

  const marcasFiltro = op.marcas?.map(clave);
  const modelosFiltro = op.modelos ? new Set(op.modelos) : null;
  const elegidos = entrada.modelos.filter((m) => (!marcasFiltro || marcasFiltro.includes(clave(m.marca))) && (!modelosFiltro || modelosFiltro.has(m.id)) && (!op.soloSocios || m.deSocios));

  // Si dos modelos quedan con el mismo nombre al quitar las caladas, se conservan para no confundirlos.
  const conteo = new Map<string, number>();
  for (const m of elegidos) conteo.set(clave(sinCaladas(m.nombre)), (conteo.get(clave(sinCaladas(m.nombre))) ?? 0) + 1);
  const nombreVisible = (m: { nombre: string }): string => (op.mostrarCaladas || (conteo.get(clave(sinCaladas(m.nombre))) ?? 0) > 1 ? m.nombre : sinCaladas(m.nombre));

  const sinPrecio: string[] = [];
  const porMarca = new Map<string, { marca: string; pedido: string[][]; inmediato: string[][] }>();
  const grupo = (marca: string): { marca: string; pedido: string[][]; inmediato: string[][] } => {
    const k = clave(marca);
    const g = porMarca.get(k) ?? { marca, pedido: [], inmediato: [] };
    porMarca.set(k, g);
    return g;
  };

  for (const m of [...elegidos].sort((a, b) => comparar(normalizar(nombreVisible(a)), normalizar(nombreVisible(b))))) {
    const disponibles = ordenar(m.sabores.filter((s) => s.disponible).map((s) => s.nombre));
    if (disponibles.length === 0) continue;
    let precio: string | null = null;
    if (op.conPrecios) {
      if (m.precioCliente === undefined || m.precioCliente === null) sinPrecio.push(nombreVisible(m));
      else precio = formatearMoneda(m.precioCliente);
    }
    grupo(m.marca).pedido.push(bloqueDeModelo(nombreVisible(m), disponibles, precio));
  }
  if (op.existenciaPropia) {
    for (const e of [...op.existenciaPropia].sort((a, b) => comparar(normalizar(a.nombre), normalizar(b.nombre)))) {
      if (marcasFiltro && !marcasFiltro.includes(clave(e.marca))) continue;
      const sabores = ordenar(e.sabores);
      if (sabores.length === 0) continue;
      grupo(e.marca).inmediato.push(bloqueDeModelo(op.mostrarCaladas ? e.nombre : sinCaladas(e.nombre), sabores, null));
    }
  }

  const fecha = etiquetaFechaHora(entrada.ultimaLectura);
  const secciones: string[] = [];
  const marcas: string[] = [];
  for (const g of [...porMarca.values()].sort((a, b) => comparar(clave(a.marca), clave(b.marca)))) {
    if (g.pedido.length === 0 && g.inmediato.length === 0) continue;
    marcas.push(g.marca);
    const lineas: string[] = [`DISPONIBLE ${g.marca.toUpperCase()} (${fecha})`, ''];
    const combinada = g.inmediato.length > 0;
    if (combinada) {
      lineas.push('ENTREGA INMEDIATA', '');
      for (const b of g.inmediato) lineas.push(...b, '');
      if (g.pedido.length > 0) lineas.push('POR PEDIDO', '');
    }
    for (const b of g.pedido) lineas.push(...b, '');
    secciones.push(lineas.join('\n').trimEnd());
  }
  const texto = secciones.join('\n\n');
  if (contieneDireccion(texto, entrada.origenPrivado)) {
    throw new ErrorProveedor('configuracion', 'la lista contiene algo con forma de direccion de la fuente');
  }
  return { estado: 'ok', texto, marcas, sinPrecio };
}
