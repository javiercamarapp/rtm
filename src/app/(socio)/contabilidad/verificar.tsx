'use client';

import { useState } from 'react';
import type { VerificacionAsiento } from '@/dominio/contabilidad/tipos';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { verificarAsientoAccion } from './acciones';

/** "Verificar": cuadre, determinismo, cadena de hash y saldos contra los auxiliares. Nada se guarda. */
export function BotonVerificar({ asiento }: { asiento: number }) {
  const [estado, setEstado] = useState<{ fase: 'reposo' | 'cargando' | 'error' } | { fase: 'listo'; v: VerificacionAsiento }>({ fase: 'reposo' });
  const verificar = () => {
    setEstado({ fase: 'cargando' });
    verificarAsientoAccion(asiento).then((v) => setEstado({ fase: 'listo', v }), () => setEstado({ fase: 'error' }));
  };
  return (
    <div className="rtm-verificar">
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={verificar} disabled={estado.fase === 'cargando'} data-testid={`verificar-${asiento}`}>
        {estado.fase === 'cargando' ? 'Verificando…' : 'Verificar'}
      </button>
      {estado.fase === 'error' && <EstadoTexto tono="malo">No se pudo verificar</EstadoTexto>}
      {estado.fase === 'listo' && (
        <ul className="rtm-verificar-lista" data-testid={`verificacion-${asiento}`}>
          {[estado.v.cuadra, estado.v.determinismo, estado.v.cadena, estado.v.saldos].map((c) => (
            <li key={c.nombre}>
              <EstadoTexto tono={c.ok ? 'ok' : 'malo'}>{c.ok ? 'Cuadra' : 'No cuadra'}</EstadoTexto> {c.nombre}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
