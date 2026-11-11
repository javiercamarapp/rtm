'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { Disponibilidad } from '@/dominio/catalogo/tipos';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { cambiarDisponibilidad } from '../acciones';

interface Props { modeloId: number; modelo: string; estado: Disponibilidad }

/** Alterna la disponibilidad del modelo (reversible). Confirma con el dialogo propio; los precios de sus clientes se conservan. */
export function BotonDisponibilidad({ modeloId, modelo, estado }: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, empezar] = useTransition();
  const destino: Disponibilidad = estado === 'disponible' ? 'sin_disponibilidad' : 'disponible';
  const confirmar = () =>
    empezar(async () => {
      try {
        await cambiarDisponibilidad(modeloId, destino, crypto.randomUUID());
        setAbierto(false);
        setError(null);
        router.refresh();
      } catch {
        setError('No se pudo guardar. Intenta de nuevo.');
      }
    });
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setAbierto(true)} aria-label={`${destino === 'disponible' ? 'Marcar disponible' : 'Marcar sin disponibilidad'}: ${modelo}`}>
        {destino === 'disponible' ? 'Marcar disponible' : 'Sin disponibilidad'}
      </button>
      {abierto && <ConfirmDialog abierto={abierto} titulo={destino === 'disponible' ? 'Marcar como disponible' : 'Marcar sin disponibilidad ahora'} confirmar="Confirmar" ocupado={ocupado} onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setError(null); }}>
        <p>{modelo}</p>
        <p>
          {destino === 'sin_disponibilidad'
            ? 'Queda sin disponibilidad por ahora. El modelo y los precios de sus clientes se conservan; puedes volver a marcarlo disponible cuando quieras.'
            : 'Vuelve a estar disponible para pedidos.'}
        </p>
        {error && <p role="alert">{error}</p>}
      </ConfirmDialog>}
    </>
  );
}
