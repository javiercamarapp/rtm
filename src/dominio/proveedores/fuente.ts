// Cortesia con la fuente: presupuesto diario de peticiones, agente de usuario honesto, robots.txt y frescura del dato.
// La direccion de la fuente NO vive aqui: es una variable de entorno privada que solo lee la capa de infraestructura.

import { HORAS_DATO_VIEJO, TOPE_PETICIONES_DIA, TOPE_POR_TIPO, TOPE_ROBOTS_DIA } from './politica';
import { horasEntre } from './tipos';
import type { EstadoProveedor, Instante } from './tipos';

// ---------------------------------------------------------------- presupuesto de peticiones

export type TipoPeticion = 'catalogo' | 'confirmacion' | 'inicio' | 'coleccion' | 'robots';

export interface PresupuestoDia {
  /** Fecha de negocio (America/Merida). */
  dia: string;
  usadas: number;
  porTipo: Record<TipoPeticion, number>;
}

export function presupuestoNuevo(dia: string): PresupuestoDia {
  return { dia, usadas: 0, porTipo: { catalogo: 0, confirmacion: 0, inicio: 0, coleccion: 0, robots: 0 } };
}

const TOPE_DE: Record<TipoPeticion, number> = { ...TOPE_POR_TIPO, robots: TOPE_ROBOTS_DIA };

/** El presupuesto de un dia distinto empieza en cero. */
export function presupuestoDelDia(p: PresupuestoDia | null, dia: string): PresupuestoDia {
  return p && p.dia === dia ? p : presupuestoNuevo(dia);
}

export function puedePedir(p: PresupuestoDia, tipo: TipoPeticion): boolean {
  return p.usadas < TOPE_PETICIONES_DIA && p.porTipo[tipo] < TOPE_DE[tipo];
}

export function registrarPeticion(p: PresupuestoDia, tipo: TipoPeticion): PresupuestoDia {
  return { ...p, usadas: p.usadas + 1, porTipo: { ...p.porTipo, [tipo]: p.porTipo[tipo] + 1 } };
}

// ---------------------------------------------------------------- agente de usuario honesto

/** Se identifica como lo que es. El contacto del negocio viene de una variable privada y se agrega si existe. */
export function agenteUsuario(contacto?: string): string {
  const base = 'RTM-InventarioProveedores/1.0 (lectura automatica de catalogo publico, una peticion por hora)';
  const limpio = contacto?.trim();
  return limpio ? `${base}; contacto: ${limpio}` : base;
}

// ---------------------------------------------------------------- robots.txt

/** Evalua si el robots.txt permite la ruta para el agente comodin. La regla mas especifica (mas larga) gana; empate: Allow. */
export function robotsPermite(robots: string, ruta: string): boolean {
  let agentes: string[] = [];
  let huboRegla = false;
  let aplica = false;
  const reglas: { permite: boolean; patron: string }[] = [];
  for (const cruda of robots.split(/\r?\n/)) {
    const linea = cruda.replace(/#.*$/, '').trim();
    if (linea === '') continue;
    const i = linea.indexOf(':');
    if (i < 0) continue;
    const campo = linea.slice(0, i).trim().toLowerCase();
    const valor = linea.slice(i + 1).trim();
    if (campo === 'user-agent') {
      if (huboRegla) {
        agentes = [];
        huboRegla = false;
      }
      agentes.push(valor);
      aplica = agentes.includes('*');
      continue;
    }
    if (campo !== 'allow' && campo !== 'disallow') continue;
    huboRegla = true;
    if (!aplica || valor === '') continue;
    reglas.push({ permite: campo === 'allow', patron: valor });
  }
  const coincide = (patron: string): boolean => {
    const anclado = patron.endsWith('$');
    const cuerpo = (anclado ? patron.slice(0, -1) : patron).split('*').map((t) => t.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(`^${cuerpo.join('.*')}${anclado ? '$' : ''}`).test(ruta);
  };
  let mejor: { permite: boolean; largo: number } | null = null;
  for (const r of reglas) {
    if (!coincide(r.patron)) continue;
    const largo = r.patron.length;
    if (mejor === null || largo > mejor.largo || (largo === mejor.largo && r.permite)) mejor = { permite: r.permite, largo };
  }
  return mejor === null ? true : mejor.permite;
}

/** Rutas que la lectura usa; si alguna queda prohibida se detiene el flujo y se avisa. */
export const RUTAS_DE_LECTURA = ['/products.json'] as const;

// ---------------------------------------------------------------- frescura

export interface Frescura {
  horasSinLectura: number | null;
  /** Mas de 3 horas sin lectura valida: advertencia visible. */
  desactualizado: boolean;
  /** La lista para clientes se bloquea con el dato desactualizado. */
  bloqueaLista: boolean;
  bloqueada: boolean;
}

export function frescuraDe(ultimaLecturaOk: Instante | null, ahora: Instante, bloqueada = false): Frescura {
  if (ultimaLecturaOk === null) return { horasSinLectura: null, desactualizado: true, bloqueaLista: true, bloqueada };
  const horas = horasEntre(ultimaLecturaOk, ahora);
  const viejo = horas > HORAS_DATO_VIEJO;
  return { horasSinLectura: horas, desactualizado: viejo, bloqueaLista: viejo, bloqueada };
}

export function frescura(estado: EstadoProveedor, ahora: Instante): Frescura {
  return frescuraDe(estado.salud.ultimaLecturaOk, ahora, estado.salud.bloqueada);
}

// ---------------------------------------------------------------- claves de lectura (idempotencia)

export type TipoClaveLectura = 'catalogo' | 'confirmacion' | 'promociones';

/**
 * `fuente|fecha|hora` en la hora de Merida (UTC-6 fijo). Repetir la misma hora no duplica eventos.
 * La confirmacion a los 10 minutos lleva sus minutos para no chocar con la lectura horaria.
 */
export function claveDeLectura(en: Instante, tipo: TipoClaveLectura): string {
  const local = new Date(Date.parse(en) - 6 * 3_600_000);
  const dos = (n: number): string => String(n).padStart(2, '0');
  const fecha = `${local.getUTCFullYear()}-${dos(local.getUTCMonth() + 1)}-${dos(local.getUTCDate())}`;
  const hora = dos(local.getUTCHours());
  if (tipo === 'confirmacion') return `inventario|${fecha}|${hora}${dos(local.getUTCMinutes())}c`;
  if (tipo === 'promociones') return `promociones|${fecha}|${hora}`;
  return `inventario|${fecha}|${hora}`;
}
