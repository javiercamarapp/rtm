'use client';

import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useExito } from '@/ui/componentes/dialogo-enterprise';
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
  /** 'item': fila de un menu desplegable (BarraAcciones) en lugar de boton con contorno. */
  variante?: 'boton' | 'item';
  /** Texto largo para title y lectores cuando la etiqueta visible es corta. */
  descripcion?: string;
  alTerminar?: (datos: Record<string, unknown>) => void;
}

/** Boton + dialogo propio para una accion de un solo paso, con motivo opcional obligatorio. Nunca window.confirm. */
export function DialogoSimple({ boton, titulo, accion, args, confirmar, primario, chico, motivo, texto, testid, variante, descripcion, alTerminar }: Props) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const { exito, celebrar } = useExito();
  const [abierto, setAbierto] = useState(false);
  const [m, setM] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (motivo && m.trim() === '') return setLocal('Escribe el motivo.');
    setLocal(null);
    correr(accion, { ...args, ...(motivo ? { [motivo]: m.trim() } : {}) }, (d) => celebrar(() => { setAbierto(false); setM(''); alTerminar?.(d); }));
  };
  return (
    <>
      <button type="button" className={variante === 'item' ? 'rtm-boton-item' : `rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} title={descripcion} onClick={() => { limpiarError(); setAbierto(true); }} data-testid={testid}>{boton}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo} subtitulo={descripcion} confirmar={confirmar ?? boton} ocupado={ocupado} exito={exito} error={local ?? error} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          {texto}
          {motivo && <label className="rtm-etiqueta-campo">Motivo<textarea className="rtm-campo" value={m} onChange={(e) => setM(e.target.value)} aria-label="Motivo" /></label>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Accion de un clic (sin dialogo): para pasos seguros y reversibles como confirmar o marcar empacado. */
export function BotonAccion({ boton, accion, args, primario, chico, testid, variante, descripcion }: { boton: string; accion: string; args: Record<string, unknown>; primario?: boolean; chico?: boolean; testid?: string; variante?: 'boton' | 'item'; descripcion?: string }) {
  const { correr, ocupado, error } = useAccion();
  return (
    <>
      <button type="button" className={variante === 'item' ? 'rtm-boton-item' : `rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} title={descripcion} onClick={() => correr(accion, args)} disabled={ocupado} data-testid={testid}>{ocupado ? 'Guardando' : boton}</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </>
  );
}
