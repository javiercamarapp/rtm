'use client';

import { useState, type ReactNode } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from './usar-accion';

export interface Campo {
  nombre: string;
  etiqueta: string;
  tipo: 'monto' | 'texto' | 'seleccion' | 'fecha' | 'entero';
  opciones?: { valor: string; texto: string }[];
  defecto?: string;
  requerido?: boolean;
  ayuda?: string;
}

interface Props {
  boton: string;
  titulo: string;
  confirmar: string;
  accion: string;
  campos: Campo[];
  fijos?: Record<string, unknown>;
  primario?: boolean;
  chico?: boolean;
  /** 'item': fila de un menu desplegable (BarraAcciones) en lugar de boton con contorno. */
  variante?: 'boton' | 'item';
  /** Texto largo para title y lectores cuando la etiqueta visible es corta. */
  descripcion?: string;
  testid?: string;
  nota?: ReactNode;
  /** Solo desde componentes de cliente: ajusta los argumentos antes de enviarlos (por ejemplo armar un jsonb). */
  transformar?: (args: Record<string, unknown>) => Record<string, unknown>;
  /** Aviso informativo que se recalcula con lo que se va escribiendo (no bloquea el envio). */
  avisoVivo?: (valores: Record<string, string>) => ReactNode;
}

/** Formulario en dialogo para una accion de la lista cerrada: convierte montos a centavos enteros, manda la clave de idempotencia y muestra el error de la base tal cual. */
export function FormularioAccion({ boton, titulo, confirmar, accion, campos, fijos = {}, primario, chico, variante, descripcion, testid, nota, transformar, avisoVivo }: Props) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const inicial = () => Object.fromEntries(campos.map((c) => [c.nombre, c.defecto ?? (c.tipo === 'seleccion' ? (c.opciones?.[0]?.valor ?? '') : '')]));
  const [valores, setValores] = useState<Record<string, string>>(inicial);
  const [local, setLocal] = useState<string | null>(null);

  const cerrar = () => { setAbierto(false); setLocal(null); limpiarError(); };
  const enviar = () => {
    const args: Record<string, unknown> = { ...fijos };
    for (const c of campos) {
      const v = (valores[c.nombre] ?? '').trim();
      if (c.requerido && v === '') return setLocal(`Falta: ${c.etiqueta.toLowerCase()}.`);
      if (c.tipo === 'monto') {
        if (v === '' && !c.requerido) { args[c.nombre] = null; continue; }
        const cent = centavosDeTexto(v);
        if (cent === null || cent === 0) return setLocal(`Escribe un monto válido en ${c.etiqueta.toLowerCase()}, por ejemplo 9000 o 9,000.50.`);
        args[c.nombre] = cent;
      } else if (c.tipo === 'entero') {
        args[c.nombre] = v === '' ? null : Number(v);
      } else {
        args[c.nombre] = v === '' ? null : v;
      }
    }
    setLocal(null);
    correr(accion, transformar ? transformar(args) : args, () => { setAbierto(false); setValores(inicial()); });
  };

  return (
    <>
      <button type="button" className={variante === 'item' ? 'rtm-boton-item' : `rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} title={descripcion} onClick={() => { limpiarError(); setValores(inicial()); setAbierto(true); }} data-testid={testid}>{boton}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo} confirmar={confirmar} ocupado={ocupado} onConfirmar={enviar} onCancelar={cerrar}>
          {campos.map((c) => (
            <label key={c.nombre} className="rtm-etiqueta-campo">
              {c.etiqueta}
              {c.tipo === 'seleccion' ? (
                <select className="rtm-campo" value={valores[c.nombre]} onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })} data-testid={`campo-${c.nombre}`}>
                  {c.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                </select>
              ) : (
                <input
                  className={`rtm-campo${c.tipo === 'monto' ? ' rtm-campo-num' : ''}`}
                  type={c.tipo === 'fecha' ? 'date' : 'text'}
                  inputMode={c.tipo === 'monto' ? 'decimal' : c.tipo === 'entero' ? 'numeric' : undefined}
                  value={valores[c.nombre]}
                  onChange={(e) => setValores({ ...valores, [c.nombre]: e.target.value })}
                  data-testid={`campo-${c.nombre}`}
                />
              )}
              {c.ayuda && <span className="rtm-nota">{c.ayuda}</span>}
            </label>
          ))}
          {avisoVivo?.(valores)}
          {nota && <p className="rtm-nota">{nota}</p>}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Boton de una sola accion con confirmacion (firmar, anular, cerrar...). */
export function BotonAccion({ texto, accion, args, confirmarTexto, titulo, chico, primario, testid, motivo, desactivado }: {
  texto: string; accion: string; args: Record<string, unknown>; confirmarTexto?: string; titulo?: string; chico?: boolean; primario?: boolean; testid?: string; motivo?: string; desactivado?: boolean;
}) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [m, setM] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const ir = () => {
    if (motivo && m.trim() === '') return setLocal('Escribe el motivo.');
    setLocal(null);
    correr(accion, { ...args, ...(motivo ? { p_motivo: m.trim() } : {}) }, () => setAbierto(false));
  };
  return (
    <>
      <button type="button" className={`rtm-boton${primario ? ' rtm-boton-primario' : ''}${chico ? ' rtm-boton-chico' : ''}`} disabled={desactivado} onClick={() => { limpiarError(); setM(''); setAbierto(true); }} data-testid={testid}>{texto}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={titulo ?? texto} confirmar={confirmarTexto ?? texto} ocupado={ocupado} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          {motivo && (
            <label className="rtm-etiqueta-campo">{motivo}
              <input className="rtm-campo" value={m} onChange={(e) => setM(e.target.value)} data-testid="campo-motivo" />
            </label>
          )}
          {!motivo && <p>¿Confirmas esta acción? Queda registrada y se puede deshacer con un movimiento contrario.</p>}
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}
