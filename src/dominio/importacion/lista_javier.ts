// Lee la lista de clientes de Javier (nota de memoria) y los costos de Karen. Puro: los archivos de tabulador entran por `leerArchivo`.
import { centavosDesdeTexto } from '../dinero';
import { normalizar } from '../catalogo/normalizar';
import type { CostoKaren, ClienteJavier, ListaJavier, PrecioJavier } from './tipos';

const pesos = (n: string | number) => centavosDesdeTexto(String(n)) ;

function pares(texto: string): PrecioJavier[] {
  return texto
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = /^(.*\S)\s+\$?(\d+(?:\.\d\d)?)$/.exec(s);
      if (!m) throw new Error(`Par modelo/precio ilegible: "${s}"`);
      return { modelo: m[1]!.trim(), precio: pesos(m[2]!) };
    });
}

/** Lineas "36000 hits<TAB>BURST<TAB>$240.00" o "X-BOX<TAB>50k $250.00": nombre y precio, en orden. */
export function leerTabuladorTexto(txt: string): PrecioJavier[] {
  const salida: PrecioJavier[] = [];
  for (const l of txt.split('\n')) {
    const m = /^(.*?)\s*\$(\d+(?:\.\d\d)?)\s*$/.exec(l.trim());
    if (!m) continue;
    const nombre = m[1]!.replace(/^\d+\s*hits\s*/i, '').replace(/\s+/g, ' ').trim();
    if (nombre) salida.push({ modelo: nombre, precio: pesos(m[2]!) });
  }
  return salida;
}

export function leerListaJavier(md: string, leerArchivo: (prefijo: string) => string | null): ListaJavier {
  const advertencias: string[] = [];
  const orden = /Orden de modelos:\s*(.+?)\.\s*$/m.exec(md)?.[1]?.split('/').map((s) => s.trim()) ?? [];
  if (orden.length < 2) throw new Error('No se encontro el orden de modelos del tabulador');

  const archivos: Record<string, PrecioJavier[]> = {};
  const archivo = (prefijo: string): PrecioJavier[] | null => {
    const txt = leerArchivo(prefijo);
    if (txt === null) return null;
    return (archivos[prefijo] ??= leerTabuladorTexto(txt));
  };

  const clientes: ClienteJavier[] = [];
  for (const l of md.split('\n')) {
    if (!l.startsWith('|') || /^\|\s*-/.test(l) || /^\|\s*Cliente\s*\|/.test(l)) continue;
    const c = l.split('|').slice(1, -1).map((s) => s.trim());
    if (c.length !== 4) continue;
    const nombre = c[0]!.replace(/\s*\(.*\)\s*$/, '').trim();
    const celda = c[3]!;
    const parentesis = /\((.*)\)\s*$/.exec(c[0]!)?.[1] ?? '';
    const alias = [...parentesis.matchAll(/alias ([^,"]+)|"([^"]+)"/g)].map((m) => (m[1] ?? m[2])!.trim());
    const cli: ClienteJavier = { nombre, precios: [], fuentes: [], copiaDe: null, alias, descartada: null };
    const igual = /iguales a (.+?)$/i.exec(celda);
    if (igual) {
      cli.copiaDe = igual[1]!.trim();
      clientes.push(cli);
      continue;
    }
    const refs = [...celda.matchAll(/`(text-[0-9A-Fa-f]{4})[^`]*`/g)].map((m) => m[1]!);
    const correcta = /^LISTA CORRECTA[^:]*:\s*(.+?)\.\s*La lista anterior \((.+?)\)\s*NO era/.exec(celda);
    if (correcta) {
      for (const parte of correcta[1]!.split(';')) cli.precios.push(...pares(parte));
      cli.descartada = correcta[2]!;
      clientes.push(cli);
      continue;
    }
    const seq = new RegExp(`(\\d+(?:\\s*/\\s*\\d+){${orden.length - 1}})`).exec(celda);
    if (seq) {
      const valores = seq[1]!.split('/').map((s) => s.trim());
      cli.precios.push(...orden.map((modelo, i) => ({ modelo, precio: pesos(valores[i]!) })));
      // Verificacion cruzada contra el archivo que cita la nota.
      for (const r of refs) {
        const f = archivo(r);
        if (!f) { advertencias.push(`${nombre}: el archivo ${r} no existe en este equipo`); continue; }
        if (f.length === orden.length) {
          const igualOrden = f.every((p, i) => normalizar(p.modelo) === normalizar(orden[i]!) && p.precio === cli.precios[i]!.precio);
          if (!igualOrden) advertencias.push(`${nombre}: la nota y el archivo ${r} no coinciden`);
        } else {
          cli.fuentes.push(r);
        }
      }
      const ip = /iPlay:\s*(.+?)\s*\(/i.exec(celda);
      if (ip) cli.precios.push(...pares(ip[1]!));
      cli.fuentes.push(...refs);
    } else if (celda && celda !== '—') {
      cli.precios.push(...pares(celda.replace(/\(.*?\)/g, '')));
    }
    clientes.push(cli);
  }
  for (const cl of clientes) {
    if (cl.copiaDe) {
      const origen = clientes.find((x) => normalizar(x.nombre) === normalizar(cl.copiaDe!));
      if (!origen) throw new Error(`${cl.nombre}: no se encontro al cliente "${cl.copiaDe}" para copiar sus precios`);
      cl.precios = origen.precios.map((p) => ({ ...p }));
    }
  }

  // Precio de venta de Nexa 50K por cliente.
  const nexa: ListaJavier['nexa'] = [];
  const lineaNexa = /\*\*Nexa 50K \(precio de venta\):\*\*\s*(.+?)\.\s*Costo/.exec(md)?.[1] ?? /\*\*Nexa 50K \(precio de venta\):\*\*\s*(.+?)\.\s*$/m.exec(md)?.[1];
  for (const p of lineaNexa ? pares(lineaNexa) : []) {
    const candidatos = clientes.filter((x) => normalizar(x.nombre).startsWith(normalizar(p.modelo)));
    if (candidatos.length !== 1) throw new Error(`Nexa 50K: "${p.modelo}" no identifica a un solo cliente`);
    nexa.push({ cliente: candidatos[0]!.nombre, precio: p.precio });
  }

  const sin = /`(text-[0-9A-Fa-f]{4})[^`]*`\s*\([^)]*\)\s*sin cliente asignado/.exec(md)?.[1] ?? null;
  if (sin) archivo(sin);
  return { orden, clientes, nexa, archivoSinAsignar: sin, archivos, advertencias };
}

/** Los costos de Karen: "Burst 210, Blade 200, ... Elfbar 40K 95. Nexa 50K 90 (sociedad, ...)". Deben ser 17. */
export function leerCostosKaren(md: string): CostoKaren[] {
  const m = /\*\*Costos de Karen[^*]*\*\*\s*(.+?)\.\s+([^.]+?)\s+(\d+)\s*\(/.exec(md);
  if (!m) throw new Error('No se encontro la linea de costos de Karen');
  const lista = [...pares(m[1]!), { modelo: m[2]!.trim(), precio: pesos(m[3]!) }];
  return lista.map((p) => ({ modelo: p.modelo, costo: p.precio }));
}
