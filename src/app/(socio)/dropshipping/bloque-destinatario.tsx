'use client';

import { useState, useTransition } from 'react';
import type { DatosDestinatario, Destinatario } from '@/dominio/dropshipping/tipos';
import { useAccion } from '../operacion/usar-accion';
import { revelarDestinatarioAccion } from './acciones';

/** Destinatario protegido: teléfono y correo ocultos con "Revelar" (auditado). Nunca se muestra a Omar, al agente de IA ni a Telegram. */
export function BloqueDestinatario({ pedidoId, destinatario }: { pedidoId: number; destinatario: Destinatario | null }) {
  const [rev, setRev] = useState<{ telefono?: string; correo?: string }>({});
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const revelar = (campo: 'telefono' | 'correo') => empezar(async () => {
    const r = await revelarDestinatarioAccion(pedidoId, campo);
    if (r.ok) { setRev((x) => ({ ...x, [campo]: r.valor })); setError(null); } else setError(r.mensaje);
  });
  if (!destinatario) return <p className="rtm-nota" data-testid="sin-destinatario">Sin destinatario capturado todavía.</p>;
  return (
    <dl className="rtm-ficha-datos" data-testid="bloque-destinatario">
      <div><dt>Nombre</dt><dd>{destinatario.nombre}</dd></div>
      <div><dt>Dirección</dt><dd>{destinatario.calle_numero}{destinatario.colonia ? `, ${destinatario.colonia}` : ''}, CP {destinatario.cp}</dd></div>
      <div><dt>Municipio y estado</dt><dd>{destinatario.municipio}, {destinatario.estado}</dd></div>
      <div><dt>Teléfono</dt><dd>{destinatario.tiene_telefono ? <><span data-testid="telefono-valor">{rev.telefono ?? destinatario.telefono_mascara}</span>{rev.telefono === undefined && <> <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => revelar('telefono')} data-testid="revelar-telefono">Revelar</button></>}</> : 'Sin teléfono'}</dd></div>
      <div><dt>Correo</dt><dd>{destinatario.tiene_correo ? <><span data-testid="correo-valor">{rev.correo ?? destinatario.correo_mascara}</span>{rev.correo === undefined && <> <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => revelar('correo')} data-testid="revelar-correo">Revelar</button></>}</> : 'Sin correo'}</dd></div>
      <div><dt>Referencias</dt><dd>{destinatario.referencias || 'Sin referencias'}</dd></div>
      {error && <p className="rtm-error" role="alert">{error}</p>}
    </dl>
  );
}

const VACIO: DatosDestinatario = { nombre: '', calle_numero: '', colonia: '', cp: '', municipio: '', estado: '', telefono: '', correo: '', referencias: '' };

/** Campos del destinatario (formulario de pedido y captura posterior). Los datos viajan solo a la función protegida; no entran a eventos ni a la IA. */
export function CamposDestinatario({ valor, onCambio }: { valor: DatosDestinatario; onCambio: (v: DatosDestinatario) => void }) {
  const c = (k: keyof DatosDestinatario) => (e: { target: { value: string } }) => onCambio({ ...valor, [k]: e.target.value });
  return (
    <div className="rtm-form-fila" data-testid="campos-destinatario">
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Nombre<input className="rtm-campo" value={valor.nombre} onChange={c('nombre')} autoComplete="off" data-testid="dest-nombre" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Calle y número<input className="rtm-campo" value={valor.calle_numero} onChange={c('calle_numero')} autoComplete="off" data-testid="dest-calle" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Colonia<input className="rtm-campo" value={valor.colonia} onChange={c('colonia')} autoComplete="off" data-testid="dest-colonia" /></label>
      <label className="rtm-etiqueta-campo">Código postal<input className="rtm-campo rtm-campo-num" inputMode="numeric" maxLength={5} value={valor.cp} onChange={c('cp')} autoComplete="off" data-testid="dest-cp" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Municipio o ciudad<input className="rtm-campo" value={valor.municipio} onChange={c('municipio')} autoComplete="off" data-testid="dest-municipio" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Estado<input className="rtm-campo" value={valor.estado} onChange={c('estado')} autoComplete="off" data-testid="dest-estado" /></label>
      <label className="rtm-etiqueta-campo">Teléfono<input className="rtm-campo" inputMode="tel" value={valor.telefono} onChange={c('telefono')} autoComplete="off" data-testid="dest-telefono" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Correo<input className="rtm-campo" type="email" value={valor.correo} onChange={c('correo')} autoComplete="off" data-testid="dest-correo" /></label>
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Referencias<input className="rtm-campo" value={valor.referencias} onChange={c('referencias')} autoComplete="off" data-testid="dest-referencias" /></label>
    </div>
  );
}
export { VACIO as DESTINATARIO_VACIO };

/** Captura o corrige el destinatario de un pedido ya creado (el bot no lo captura: se completa aquí). */
export function CapturarDestinatario({ pedidoId, etiqueta }: { pedidoId: number; etiqueta: string }) {
  const { correr, ocupado, error } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [v, setV] = useState<DatosDestinatario>(VACIO);
  const [local, setLocal] = useState<string | null>(null);
  if (!abierto) return <button type="button" className="rtm-boton" onClick={() => setAbierto(true)} data-testid="capturar-destinatario">{etiqueta}</button>;
  return (
    <div className="rtm-form">
      <CamposDestinatario valor={v} onCambio={setV} />
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <span className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="guardar-destinatario" onClick={() => {
          if (!/^\d{5}$/.test(v.cp.trim())) return setLocal('El código postal debe tener 5 dígitos.');
          setLocal(null);
          correr('ds_capturar_destinatario', { p_pedido: pedidoId, p_destinatario: v }, () => { setAbierto(false); setV(VACIO); });
        }}>{ocupado ? 'Guardando' : 'Guardar destinatario'}</button>
        <button type="button" className="rtm-boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </span>
    </div>
  );
}
