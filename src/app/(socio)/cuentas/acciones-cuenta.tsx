'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { ResultadoCuentas } from '@/aplicacion/cuentas/cuentas';
import { Campo } from '@/ui/componentes/campo';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';

type Accion = (clave: string, correo: string, activo: boolean, motivo: string | null) => Promise<ResultadoCuentas>;

/** Desactivar (con confirmacion) o reactivar una cuenta. No borra: el historial y la auditoria se conservan. */
export function AccionesCuenta({ correo, activo, accion }: { correo: string; activo: boolean; accion: Accion }) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ocupado, empezar] = useTransition();
  const clave = useRef(`web:${crypto.randomUUID()}`);

  const ejecutar = (nuevo: boolean) => {
    setAbierto(false);
    empezar(async () => {
      let r: ResultadoCuentas;
      try {
        r = await accion(clave.current, correo, nuevo, nuevo ? null : motivo);
      } catch {
        r = { ok: false, mensaje: 'No se pudo guardar. Intenta de nuevo.', errores: {} };
      }
      setMensaje(r.ok ? null : r.mensaje);
      if (r.ok) {
        clave.current = `web:${crypto.randomUUID()}`;
        router.refresh();
      }
    });
  };

  return (
    <span className="rtm-acciones-fila">
      {activo
        ? <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => setAbierto(true)} data-testid="desactivar-cuenta">Desactivar</button>
        : <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => ejecutar(true)} data-testid="reactivar-cuenta">Reactivar</button>}
      {mensaje && <span className="rtm-error" role="alert">{mensaje}</span>}
      {abierto && (
        <ConfirmDialog abierto titulo="Desactivar cuenta" confirmar="Desactivar" ocupado={ocupado} onConfirmar={() => ejecutar(false)} onCancelar={() => setAbierto(false)}>
          <p>{correo} dejará de poder entrar y se cerrarán sus sesiones. La cuenta se conserva y puedes reactivarla cuando quieras.</p>
          <Campo etiqueta="Motivo (opcional)" valor={motivo} onCambio={setMotivo} testid="campo-motivo" ayuda="Queda en la auditoría. No escribas correos ni datos personales: se omiten." />
        </ConfirmDialog>
      )}
    </span>
  );
}
