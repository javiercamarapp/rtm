// Lee el documento de Angelo ("logica-negocio-angelo.md") a un objeto. Determinista y puro: recibe el texto, no el archivo.
import { centavosDesdeTexto } from '../dinero';
import type { ClienteAngelo, ListaAngelo } from './tipos';

const celdas = (linea: string): string[] => linea.split('|').slice(1, -1).map((c) => c.trim());
const esFilaDatos = (linea: string) => linea.trim().startsWith('|') && !/^\|\s*-/.test(linea.trim());

function seccion(md: string, titulo: RegExp): string[] {
  const lineas = md.split('\n');
  const i = lineas.findIndex((l) => /^## /.test(l) && titulo.test(l));
  if (i < 0) throw new Error(`Falta la seccion ${titulo}`);
  const f = lineas.findIndex((l, k) => k > i && /^## /.test(l));
  return lineas.slice(i + 1, f < 0 ? undefined : f);
}

export function leerListaAngelo(md: string): ListaAngelo {
  const costos = seccion(md, /^## Costos de Isaac/)
    .filter(esFilaDatos)
    .map(celdas)
    .filter((c) => c.length === 2 && c[0] !== 'Modelo')
    .map((c) => ({ modelo: c[0]!, costo: centavosDesdeTexto(c[1]!) }));

  const clientes: ClienteAngelo[] = [];
  let actual: ClienteAngelo | null = null;
  for (const l of seccion(md, /^## Precios de venta por cliente/)) {
    const h = /^### (.+)$/.exec(l);
    if (h) {
      // "Mattwee (Diego Chan)" -> el nombre es lo que va antes del parentesis.
      actual = { nombre: h[1]!.replace(/\s*\(.*\)\s*$/, '').trim(), lineas: [] };
      clientes.push(actual);
      continue;
    }
    if (!actual || !esFilaDatos(l)) continue;
    const c = celdas(l);
    if (c.length !== 4 || c[0] === 'Modelo') continue;
    actual.lineas.push({ modelo: c[0]!, precio: centavosDesdeTexto(c[1]!), costoDoc: centavosDesdeTexto(c[2]!), margenDoc: centavosDesdeTexto(c[3]!) });
  }

  const aliasCliente: ListaAngelo['aliasCliente'] = [];
  const destinosCliente: ListaAngelo['destinosCliente'] = [];
  const ocasionales: string[] = [];
  const bloque = seccion(md, /^## Clientes/);
  for (const l of bloque) {
    const a = /^- \*\*([^*=]+?) = ([^*]+?)\*\*/.exec(l);
    if (a && !a[0].includes('"')) aliasCliente.push({ alias: a[1]!.trim(), destino: a[2]!.trim() });
    const d = /^- \*\*([^*]+)\*\* recibe en dos destinos: (.+?) y (.+?)\./.exec(l);
    if (d) destinosCliente.push({ cliente: d[1]!.trim(), etiquetas: [d[2]!.trim(), d[3]!.trim()] });
    const o = /^- \*\*([^*]+)\*\* es un cliente ocasional/.exec(l);
    if (o) ocasionales.push(o[1]!.trim());
  }

  const fuera = /^- Fuera de cat[aá]logo \(02 NOV\): (.+?)\. Si un cliente/m.exec(md);
  const fueraDeCatalogo = fuera ? fuera[1]!.split(',').map((s) => s.trim()) : [];

  return { costos, clientes, aliasCliente, destinosCliente, ocasionales, fueraDeCatalogo };
}
