// Puerto EN MEMORIA de los avisos de inventario para las pruebas con reloj simulado y transporte falso (sin base ni red). Refleja las reglas de las funciones SQL
// (enfriamiento por clave, tope de mensajes, silencio nocturno, inmediatos limitados, pregunta abierta de /minimo); la version verdadera se prueba en pgTAP y en el e2e contra la base.
import { RechazoInventario, type LineaConsulta, type PuertoAvisosInventario, type RespInventario } from '@/aplicacion/agente/avisos_inventario';
import { horaMerida, type DigestArmado, type ItemAviso, type VentanaAviso } from '@/dominio/agente/avisos_inventario';
import type { Miembro } from '@/dominio/agente/tipos';

interface Fila extends ItemAviso {
  clave: string;
  estado: 'pendiente' | 'enviado' | 'historico';
  creadoMs: number;
}

export const TOPE = { tope_dia: 6, inmediatos_dia: 3, max_lineas: 12, silencio_ini: 21, silencio_fin: 7 } as const;
const dia = (ms: number): string => new Date(ms - 6 * 3_600_000).toISOString().slice(0, 10);

export class PuertoAvisosInventarioMemoria implements PuertoAvisosInventario {
  general = true;
  escritura = true;
  filas: Fila[] = [];
  digests: Array<{ dia: string; ventana: VentanaAviso; items: number }> = [];
  minimos = new Map<string, number>();
  reglasActivas = new Set<string>();
  lineas: { mas_vendido: LineaConsulta[]; reponer: LineaConsulta[] } = { mas_vendido: [], reponer: [] };
  /** Catalogo de la prueba: modelo -> sabores. */
  catalogo: Record<string, string[]> = { nexa: ['mango', 'uva'] };
  private pendiente = new Map<string, { modelo: string | null; sabor: string | null; piezas: number | null }>();
  private idSig = 1;

  encolar(codigo: string, clave: string, canal: VentanaAviso, payload: Record<string, unknown>, ahoraMs: number, enfriamientoH = 24, severidad: 'C' | 'I' | 'F' = 'I'): number | null {
    if (!this.general) return null;
    const previo = this.filas.some((f) => f.clave === clave && (f.estado === 'historico' || enfriamientoH === 0 || ahoraMs - f.creadoMs < enfriamientoH * 3_600_000));
    if (previo) return null;
    const id = this.idSig++;
    this.filas.push({ id, codigo, clave, canal, severidad, payload, estado: 'pendiente', creadoMs: ahoraMs });
    return id;
  }

  async armar(ventana: VentanaAviso, ahora: Date): Promise<DigestArmado> {
    if (!this.general) return { estado: 'apagado', items: [], restantes: 0 };
    const d = dia(ahora.getTime());
    const hoy = this.digests.filter((x) => x.dia === d);
    const total = hoy.length;
    const inm = hoy.filter((x) => x.ventana === 'I').length;
    const { hora } = horaMerida(ahora);
    const silencio = hora >= TOPE.silencio_ini || hora < TOPE.silencio_fin;
    const ok = (f: Fila): boolean => {
      const crit = f.severidad === 'C';
      if (ventana === 'I') return f.canal === 'I' && (!silencio || crit) && (inm < TOPE.inmediatos_dia || crit) && (total < TOPE.tope_dia || crit);
      if (ventana === 'M') return (f.canal === 'M' || f.canal === 'I') && (total < TOPE.tope_dia || crit);
      return f.canal === ventana && total < TOPE.tope_dia;
    };
    const rango = (f: Fila): number => (f.severidad === 'C' ? 0 : f.severidad === 'I' ? 1 : 2);
    const cand = this.filas.filter((f) => f.estado === 'pendiente' && ok(f)).sort((a, b) => rango(a) - rango(b) || a.id - b.id);
    return { estado: 'ok', items: cand.slice(0, TOPE.max_lineas).map(({ id, codigo, canal, severidad, payload }) => ({ id, codigo, canal, severidad, payload })), restantes: Math.max(0, cand.length - TOPE.max_lineas) };
  }

  async confirmar(ventana: VentanaAviso, ids: number[], ahora: Date): Promise<number | null> {
    const fs = this.filas.filter((f) => ids.includes(f.id) && f.estado === 'pendiente');
    if (fs.length === 0) return null;
    for (const f of fs) f.estado = 'enviado';
    this.digests.push({ dia: dia(ahora.getTime()), ventana, items: fs.length });
    return this.digests.length;
  }

  async consulta(tipo: 'mas_vendido' | 'reponer'): Promise<{ titulo: string; lineas: LineaConsulta[] }> {
    return { titulo: tipo === 'mas_vendido' ? 'Lo que mas se vende (ultimos 28 dias)' : 'Que reponer', lineas: this.lineas[tipo] };
  }

  async hayPregunta(chatId: number, autor: Miembro): Promise<boolean> {
    return this.pendiente.has(`${chatId}:${autor.persona}`);
  }

  async minimoPaso(clave: string, autor: Miembro, chatId: number, texto: string): Promise<RespInventario> {
    if (!this.escritura) throw new RechazoInventario('el agente esta en solo lectura: un socio lo reactiva con /escritura', 'P0463');
    const k = `${chatId}:${autor.persona}`;
    const p = this.pendiente.get(k) ?? { modelo: null, sabor: null, piezas: null };
    let t = texto.trim();
    const cifra = /(\S+)\s*$/.exec(t)?.[1];
    if (cifra !== undefined && /^\d+$/.test(cifra)) {
      p.piezas = Number(cifra);
      t = t.replace(/\S+\s*$/, '').trim();
    } else if (cifra !== undefined && /^\d+(?:[.,]\d+)?(k|mil)$/i.test(cifra)) {
      this.pendiente.set(k, p);
      return { estado: 'pregunta', falta: 'piezas', texto: 'Escribe la cifra completa de piezas, sin k ni mil. Por ejemplo 200.' };
    }
    if (t !== '') {
      const w = t.toLowerCase().split(/\s+/);
      if (p.modelo === null) {
        const m = Object.keys(this.catalogo).find((x) => w[0] === x);
        if (m) {
          p.modelo = m;
          const s = this.catalogo[m]!.find((x) => w.slice(1).join(' ') === x);
          if (s) p.sabor = s;
        }
      } else if (p.sabor === null) {
        p.sabor = this.catalogo[p.modelo]!.find((x) => x === t.toLowerCase()) ?? null;
      }
    }
    if (p.modelo === null || p.sabor === null || p.piezas === null) {
      this.pendiente.set(k, p);
      const mod = (p.modelo ?? '').toUpperCase();
      const sab = (p.sabor ?? '').toUpperCase();
      const falta = p.modelo === null ? 'modelo' : p.sabor === null ? 'sabor' : 'piezas';
      return { estado: 'pregunta', falta, texto: falta === 'modelo' ? '¿De qué modelo y sabor quieres fijar el mínimo? Por ejemplo: nexa mango 20.' : falta === 'sabor' ? `¿De qué sabor de ${mod}?` : `¿Cuántas piezas es el mínimo de ${mod} ${sab}? Escribe la cifra completa.` };
    }
    this.pendiente.delete(k);
    const llave = `${p.modelo}/${p.sabor}`;
    const antes = this.minimos.get(llave);
    this.minimos.set(llave, p.piezas);
    const nombre = `${p.modelo.toUpperCase()} ${p.sabor.toUpperCase()}`;
    return { estado: 'registrado', clave, piezas: p.piezas, texto: `Mínimo registrado: ${nombre} en ${p.piezas} piezas.`, aviso_grupo: `${autor.persona === 'angelo' ? 'Angelo' : 'Javier'} fijó el mínimo de ${nombre} en ${p.piezas} piezas${antes === undefined ? '' : ` (antes ${antes})`}. Las alertas de reposición lo usan mientras no haya 28 días de historia.` };
  }

  async fijarAvisos(_clave: string, _autor: Miembro, activo: boolean, regla: string | null): Promise<RespInventario> {
    if (regla === null) {
      this.general = activo;
      return { general: true, activo };
    }
    if (activo) this.reglasActivas.add(regla);
    else this.reglasActivas.delete(regla);
    return { regla, activo };
  }
}
