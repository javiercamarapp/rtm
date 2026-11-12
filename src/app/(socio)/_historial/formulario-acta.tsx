'use client';

// Propuesta de acta con la decision de cada socio: cuanto RETIRA y cuanto REINVIERTE de su parte. Lo que no se decide queda como utilidad por distribuir.
// El monto viaja en centavos enteros; la base valida el tope y recalcula al firmar (la interfaz no calcula dinero).
import { formatearMoneda } from '@/dominio/formato';
import { FormularioAccion } from '../operacion/formulario-accion';

export interface DisponibleSocio { socio: 'Angelo' | 'Javier'; disponible_cent: string }

const CLAVES = { Angelo: ['a_retira', 'a_reinvierte'], Javier: ['j_retira', 'j_reinvierte'] } as const;

export function FormularioActa({ ini, fin, disponibles }: { ini: string; fin: string; disponibles: DisponibleSocio[] }) {
  const campos = disponibles.flatMap((d) => {
    const [r, i] = CLAVES[d.socio];
    const tope = `Disponible para ${d.socio}: ${formatearMoneda(BigInt(d.disponible_cent))}`;
    return [
      { nombre: r, etiqueta: `${d.socio} retira`, tipo: 'monto' as const, ayuda: tope },
      { nombre: i, etiqueta: `${d.socio} reinvierte`, tipo: 'monto' as const, ayuda: 'Queda registrado como inversión suya' },
    ];
  });
  return (
    <FormularioAccion
      boton="Proponer acta de corte" titulo="Proponer el acta de corte" confirmar="Proponer acta" accion="proponer_cierre_reparto" primario testid="proponer-cierre"
      fijos={{ p_ini: ini, p_fin: fin }}
      campos={[...campos, { nombre: 'p_nota', etiqueta: 'Nota (opcional)', tipo: 'texto' }]}
      nota="Lo que no se retira ni se reinvierte queda como utilidad por distribuir. El acta congela las cifras, cada firma las recalcula y surte efecto con las dos firmas; no se edita, se corrige con una contra-acta."
      transformar={(a) => {
        const n = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) : 0);
        const { a_retira, a_reinvierte, j_retira, j_reinvierte, ...resto } = a;
        void a_retira; void a_reinvierte; void j_retira; void j_reinvierte;
        return { ...resto, p_decisiones: { Angelo: { retira: n('a_retira'), reinvierte: n('a_reinvierte') }, Javier: { retira: n('j_retira'), reinvierte: n('j_reinvierte') } } };
      }}
    />
  );
}
