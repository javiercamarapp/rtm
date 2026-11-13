'use client';

// Propuesta de acta con la decision de cada socio: cuanto RETIRA y cuanto REINVIERTE de su parte. Lo que no se decide queda como utilidad por distribuir.
// La reinversion viene por omision IGUAL para los dos (monto_comun de api.acta_reinversion_sugerida: la calcula la base, no la pantalla); cada monto se puede editar antes de firmar y,
// si los dos montos difieren, solo se muestra una alerta informativa (no bloquea). El monto viaja en centavos enteros; la base valida el tope y recalcula al firmar.
import { centavosDesdeTexto } from '@/dominio/dinero';
import { formatearMoneda } from '@/dominio/formato';
import { FormularioAccion } from '../operacion/formulario-accion';

export interface DisponibleSocio { socio: 'Angelo' | 'Javier'; disponible_cent: string }

const CLAVES = { Angelo: ['a_retira', 'a_reinvierte'], Javier: ['j_retira', 'j_reinvierte'] } as const;

/** Centavos (texto entero) a pesos escritos para el campo ("11500.00"); vacio si no hay monto sugerido. */
function pesosDeCentavos(cent: string): string {
  const c = BigInt(cent);
  if (c <= 0n) return '';
  return `${c / 100n}.${String(c % 100n).padStart(2, '0')}`;
}

function centavos(texto: string | undefined): bigint | null {
  const t = (texto ?? '').trim();
  if (t === '') return 0n;
  try { return centavosDesdeTexto(t); } catch { return null; }
}

export function FormularioActa({ ini, fin, disponibles, reinversionComunCent }: { ini: string; fin: string; disponibles: DisponibleSocio[]; reinversionComunCent: string }) {
  const comun = pesosDeCentavos(reinversionComunCent);
  const campos = disponibles.flatMap((d) => {
    const [r, i] = CLAVES[d.socio];
    const tope = `Disponible para ${d.socio}: ${formatearMoneda(BigInt(d.disponible_cent))}`;
    return [
      { nombre: r, etiqueta: `${d.socio} retira`, tipo: 'monto' as const, ayuda: tope },
      { nombre: i, etiqueta: `${d.socio} reinvierte`, tipo: 'monto' as const, defecto: comun, ayuda: comun === '' ? 'Queda registrado como inversión suya' : `Sugerido igual para los dos: ${formatearMoneda(BigInt(reinversionComunCent))}. Queda registrado como inversión suya` },
    ];
  });
  return (
    <FormularioAccion
      boton="Proponer acta de corte" titulo="Proponer el acta de corte" confirmar="Proponer acta" accion="proponer_cierre_reparto" primario testid="proponer-cierre"
      fijos={{ p_ini: ini, p_fin: fin }}
      campos={[...campos, { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' }]}
      nota="Lo que no se retira ni se reinvierte queda como utilidad por distribuir. La reinversión se sugiere igual para los dos y se puede editar antes de firmar. El acta congela las cifras, cada firma las recalcula y surte efecto con las dos firmas; no se edita, se corrige con una contra-acta."
      avisoVivo={(v) => {
        const a = centavos(v.a_reinvierte);
        const j = centavos(v.j_reinvierte);
        if (a === null || j === null || a === j) return null;
        return <p className="rtm-nota" role="status" data-testid="alerta-reinversion-distinta">Los montos de reinversión son distintos (Angelo {formatearMoneda(a)}, Javier {formatearMoneda(j)}). Se busca reinvertir lo mismo cada mes; puedes firmar así, la diferencia solo queda a la vista.</p>;
      }}
      transformar={(a) => {
        const n = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : 0);
        const { a_retira, a_reinvierte, j_retira, j_reinvierte, ...resto } = a;
        void a_retira; void a_reinvierte; void j_retira; void j_reinvierte;
        return { ...resto, p_decisiones: { Angelo: { retira: n('a_retira'), reinvierte: n('a_reinvierte') }, Javier: { retira: n('j_retira'), reinvierte: n('j_reinvierte') } } };
      }}
    />
  );
}
