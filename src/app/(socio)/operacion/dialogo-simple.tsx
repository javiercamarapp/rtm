'use client';

import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useAccion } from './usar-accion';

interface Props {
  boton: string;
  titulo: string;
  accion: string;
  /** Argumentos fijos de la accion (sin la clave de idempotencia, que pone el hook). */
  args: Record<string, unknown>;
  confirmar?: string;
  primario?: boolean;
  chico?: boolean;
  /** Si pide un motivo escrito (obligatorio) lo manda como este parametro. */
  motivo?: string;
  texto?: ReactNode;
  testid?: string;
  alTerminar?: (datos: Record<string, unknown>) => void;
}

/** Boton + dialogo propio para una accion de un solo paso, con motivo opcional obligatorio. Nunca window.confirm. */
export function DialogoSimple({ boton, titulo, accion, args, confirmar, primario, chico, motivo, texto, testid, alTerminar }: Props) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [m, setM] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (motivo && m.trim() === '') return setLocal('Escribe el motivo.');
    setLocal(null);
    correr(accion, { ...args, ...(motivo ? { [motivo]: m.trim() } : {}) }, (d) => { setAbierto(false); setM(''); alTerminar?.(d); });
  };
  return (
    <>
      <button type="button" className={`rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} onClick={() => { limpiarError(); setAbierto(true); }} data-testid={testid}>{boton}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo} confirmar={confirmar ?? boton} ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          {texto}
          {motivo && <label className="rtm-etiqueta-campo">Motivo<textarea className="rtm-campo" value={m} onChange={(e) => setM(e.target.value)} aria-label="Motivo" /></label>}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Accion de un clic (sin dialogo): para pasos seguros y reversibles como confirmar o marcar empacado. */
export function BotonAccion({ boton, accion, args, primario, chico, testid }: { boton: string; accion: string; args: Record<string, unknown>; primario?: boolean; chico?: boolean; testid?: string }) {
  const { correr, ocupado, error } = useAccion();
  return (
    <>
      <button type="button" className={`rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} onClick={() => correr(accion, args)} disabled={ocupado} data-testid={testid}>{ocupado ? 'Guardando' : boton}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </>
  );
}
