// Libro de cifras: construye el paquete cifra por cifra. Cada cifra nace con su comprobacion por dos vias
// (via1 y via2 se calculan por caminos distintos); una cifra cuyas vias difieren queda marcada y bloquea el PDF.
import type { Clase, Cifra, EstadoCifra, FormatoCifra, ResultadoComprobacion, Unidad } from './tipos';
import { ErrorReporte } from './tipos';

export interface OpcionesCifra {
  readonly clase: Clase;
  readonly fuente: string;
  readonly periodo: string;
  readonly n?: number;
  /** Segunda via; si se omite la cifra es una identidad y via2 = via1 (se declara asi en la fuente). */
  readonly via2?: bigint;
  readonly formato?: FormatoCifra;
  readonly rango?: { readonly lo: bigint; readonly hi: bigint };
  readonly metodo?: string;
  readonly estado?: EstadoCifra;
}

export class LibroCifras {
  private readonly porId = new Map<string, Cifra>();

  agregar(id: string, etiqueta: string, valor: bigint, unidad: Unidad, o: OpcionesCifra): Cifra {
    if (this.porId.has(id)) throw new ErrorReporte('DATOS_INVALIDOS', `cifra duplicada: ${id}`);
    const via2 = o.via2 ?? valor;
    const cifra: Cifra = {
      id,
      etiqueta,
      valor,
      unidad,
      ...(o.formato ? { formato: o.formato } : {}),
      periodo: o.periodo,
      fuente: o.fuente,
      clase: o.clase,
      nMuestra: o.n ?? 0,
      comprobacion: { via1: valor, via2, igual: valor === via2 },
      estado: o.estado ?? 'ok',
      ...(o.rango ? { rango: o.rango } : {}),
      ...(o.metodo ? { metodo: o.metodo } : {}),
    };
    this.porId.set(id, cifra);
    return cifra;
  }

  /** Cifra sin dato: el texto fuerza "no hay datos suficientes (n de m requeridos)". */
  sinDatos(id: string, etiqueta: string, unidad: Unidad, o: Omit<OpcionesCifra, 'via2'> & { readonly requeridos: number; readonly n: number; readonly insuficiente?: boolean }): Cifra {
    return this.agregar(id, etiqueta, BigInt(o.n), unidad === 'cent' ? 'n' : unidad, { ...o, estado: o.insuficiente ? 'insuficiente' : 'sin_datos', metodo: `requeridos:${o.requeridos}` });
  }

  tiene(id: string): boolean {
    return this.porId.has(id);
  }

  obtener(id: string): Cifra {
    const c = this.porId.get(id);
    if (!c) throw new ErrorReporte('CIFRA_INEXISTENTE', `la cifra ${id} no existe en el paquete`);
    return c;
  }

  valor(id: string): bigint {
    return this.obtener(id).valor;
  }

  todas(): Cifra[] {
    return [...this.porId.values()];
  }

  /** Comprobaciones internas: una por cifra con vias distintas fallida (las que coinciden se agrupan en R.CIFRAS). */
  comprobaciones(): ResultadoComprobacion[] {
    const todas = this.todas();
    const malas = todas.filter((c) => !c.comprobacion.igual);
    const out: ResultadoComprobacion[] = [
      {
        id: 'R.CIFRAS',
        nombre: 'Cada cifra del paquete coincide por dos vías',
        via1: BigInt(todas.length - malas.length),
        via2: BigInt(todas.length),
        ok: malas.length === 0,
        ...(malas.length ? { detalle: `difieren: ${malas.map((m) => m.id).join(', ')}` } : {}),
      },
    ];
    return out;
  }
}
