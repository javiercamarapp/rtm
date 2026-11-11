'use client';

import { useAccion } from '../operacion/usar-accion';

export function BotonLeido({ avisoId }: { avisoId: number }) {
  const { correr, ocupado, error } = useAccion();
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => correr('aviso_marcar_leido', { p_aviso: avisoId })}>{ocupado ? 'Guardando' : 'Marcar leído'}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </>
  );
}
