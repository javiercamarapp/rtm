// "Explicar este numero" del Libro conciliado de Socios. Se arma con lo que ya calculo la base (operacion.cuadre_socios); aqui solo se ordena y se nombra.
// Definicion por escrito: docs/cuadre-socios-definicion.md.
import { formatearMoneda } from '../formato';
import type { Explicacion } from '../catalogo/tipos';
import type { CuentaSocios, VerificacionCuadre } from './tipos';

export const CIFRA_CUADRE_SOCIOS = 'socios:cuadre';

const GRUPOS: Record<VerificacionCuadre['grupo'], string> = {
  auxiliares: '(i) Auxiliar contra mayor',
  partida_doble: '(ii) Partida doble',
  comprobaciones: '(ii) Comprobaciones del libro',
  efectivo_repartido: '(iii) Efectivo repartido',
};

function cifra(v: VerificacionCuadre, lado: 'a' | 'b'): string {
  const x = lado === 'a' ? v.a_cent : v.b_cent;
  return v.unidad === 'n' ? x.toString() : formatearMoneda(x);
}

/** Los renglones son las verificaciones (cada una con sus dos lados); el valor es cuantas fallan y la comprobacion compara las que pasan contra el total. */
export function explicarCuadreSocios(c: CuentaSocios): Explicacion {
  const q = c.cuadre;
  const total = q.verificaciones.length;
  const buenas = q.verificaciones.filter((v) => v.ok).length;
  return {
    cifra: CIFRA_CUADRE_SOCIOS,
    titulo: `${q.etiqueta}: ${q.libro_conciliado ? 'todas las identidades del libro se cumplen' : `${q.fallas} identidad(es) del libro no se cumplen`}`,
    unidad: 'mxn',
    valor: q.fallas,
    comprobacion: { via1: 'Identidades que se cumplen', via1Valor: buenas, via2: 'Identidades verificadas', via2Valor: total, cuadra: q.libro_conciliado },
    movimientos: [],
    precioCent: null,
    costos: [],
    renglones: q.verificaciones.map((v) => ({
      concepto: `${GRUPOS[v.grupo]}: ${v.nombre}. ${v.a_nombre} ${cifra(v, 'a')} contra ${v.b_nombre} ${cifra(v, 'b')}: ${v.ok ? 'coincide' : 'NO coincide'}${v.detalle ? ` (${v.detalle})` : ''}`,
      montoCent: v.ok || v.unidad === 'n' ? 0n : v.a_cent - v.b_cent,
      saldoCent: null, hora: null, fechaNeg: null, evento: null, canal: null, autor: null, mensajeOrigen: null,
    })),
  };
}
