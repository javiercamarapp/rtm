'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useAccion } from '../../operacion/usar-accion';

/** Da de alta a este cliente como la persona que presta la bodega (Omar). Sin ella, "Marcar enviado" en un pedido no avanza. Solo se ofrece si todavía no hay una configurada. */
export function AltaPersonaBodega({ clienteId, nombre, variante }: { clienteId: number; nombre: string; variante?: 'boton' | 'item' }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <button type="button" className={variante === 'item' ? 'rtm-boton-item' : 'rtm-boton'} onClick={() => { limpiarError(); setAbierto(true); }} data-testid="alta-persona-bodega">Marcar como persona de bodega</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo="Persona de bodega" confirmar="Confirmar" ocupado={ocupado} onConfirmar={() => correr('registrar_persona_bodega', { p_cliente_id: clienteId }, () => setAbierto(false))} onCancelar={() => { setAbierto(false); limpiarError(); }}>
          <p>{nombre} será la persona que presta la bodega en Mérida. Los pedidos que salen de la bodega se registran con ella al marcarlos como enviados.</p>
          {error && <p className="rtm-error" role="alert">{error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
