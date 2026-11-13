'use client';

import { useRef, useState, useTransition } from 'react';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';
import { validarEvidencia } from '@/dominio/dropshipping/evidencia';
import { evidenciaAccion } from './acciones';

const hoyISO = () => new Date().toISOString().slice(0, 10);

function aBase64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('lectura'));
    r.readAsDataURL(f);
  });
}

/**
 * "Marcar como pagado": se paga el TOTAL del costo. Referencia, fecha, monto, método y evidencia opcional (imagen o PDF, hasta 2 MB).
 * Con evidencia el pago se registra; sin evidencia queda "Pago reportado" hasta que el OTRO socio lo confirme. Un pago parcial deja el saldo pendiente.
 */
export function MarcarPagado({ pedidoId, folio, proveedor, pendienteTexto, pendienteCent }: { pedidoId: number; folio: string; proveedor: string; pendienteTexto: string; pendienteCent: number }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [via, setVia] = useState('proveedor');
  const [metodo, setMetodo] = useState('transferencia');
  const [monto, setMonto] = useState('');
  const [referencia, setReferencia] = useState('');
  const [fecha, setFecha] = useState(hoyISO());
  const [archivo, setArchivo] = useState<File | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const [leyendo, empezar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);
  const ir = () => empezar(async () => {
    const c = monto.trim() ? centavosDeTexto(monto) : pendienteCent;
    if (c === null || c <= 0) return setLocal('Escribe el monto, por ejemplo 9000 o 9,000.50, o déjalo vacío para pagar todo lo pendiente.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return setLocal('Elige la fecha del pago.');
    let b64: string | null = null;
    if (archivo) {
      const motivoInvalido = validarEvidencia(archivo.type, archivo.size);
      if (motivoInvalido) return setLocal(motivoInvalido);
      b64 = await aBase64(archivo);
    }
    setLocal(null);
    correr('ds_reportar_pago_menudeo', {
      p_pedido: pedidoId, p_monto_cent: c, p_metodo: metodo, p_referencia: referencia.trim(), p_fecha: fecha, p_via: via,
      ...(b64 ? { p_evidencia_b64: b64, p_evidencia_mime: archivo?.type, p_evidencia_nombre: archivo?.name } : {}),
    }, () => { setAbierto(false); setMonto(''); setReferencia(''); setArchivo(null); });
  });
  return (
    <>
      <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => { limpiarError(); setAbierto(true); }} data-testid={`marcar-pagado-${pedidoId}`}>Marcar como pagado</button>
      {abierto && (
        <ConfirmDialog abierto titulo={`Pago del pedido ${folio}`} confirmar="Registrar pago" ocupado={ocupado || leyendo} onConfirmar={ir} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <p className="rtm-nota">Debes pagar el total del costo. Pendiente de pago: {pendienteTexto}. Un pago parcial deja el saldo pendiente.</p>
          <label className="rtm-etiqueta-campo">Cómo se paga
            <select className="rtm-campo" value={via} onChange={(e) => setVia(e.target.value)} data-testid="menudeo-via">
              <option value="proveedor">Pago directo a {proveedor}</option><option value="sociedad">Abono a la sociedad</option>
            </select>
          </label>
          <label className="rtm-etiqueta-campo">Método
            <select className="rtm-campo" value={metodo} onChange={(e) => setMetodo(e.target.value)} data-testid="menudeo-metodo"><option value="transferencia">Transferencia</option><option value="deposito">Depósito</option><option value="efectivo">Efectivo</option></select>
          </label>
          <label className="rtm-etiqueta-campo">Monto (vacío = todo lo pendiente)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="menudeo-monto" /></label>
          <label className="rtm-etiqueta-campo">Referencia (clave de rastreo o folio)<input className="rtm-campo" value={referencia} onChange={(e) => setReferencia(e.target.value)} maxLength={120} data-testid="menudeo-referencia" /></label>
          <label className="rtm-etiqueta-campo">Fecha del pago<input className="rtm-campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} data-testid="menudeo-fecha" /></label>
          <label className="rtm-etiqueta-campo">Evidencia (opcional: imagen o PDF del ticket o comprobante, hasta 2 MB)
            <input ref={entrada} className="rtm-campo" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} data-testid="menudeo-evidencia" />
          </label>
          <p className="rtm-nota">Con evidencia el pago se registra. Sin evidencia queda «Pago reportado» y el pedido sigue pendiente de pago hasta que el otro socio confirme que lo recibió. La evidencia solo la ven los socios; ni la IA ni Telegram la leen. No cambia la aportación neta ni la valuación.</p>
          {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
        </ConfirmDialog>
      )}
    </>
  );
}

/** El OTRO socio confirma que recibió el pago, o lo rechaza con motivo. */
export function DecidirPago({ reporteId }: { reporteId: number }) {
  const { correr, ocupado, error } = useAccion();
  const [rechazando, setRechazando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  return (
    <span className="rtm-acciones-fila">
      <button type="button" className="rtm-boton rtm-boton-chico rtm-boton-primario" disabled={ocupado} onClick={() => correr('ds_decidir_pago_menudeo', { p_reporte: reporteId, p_decision: 'confirmado' })} data-testid={`confirmar-recibido-${reporteId}`}>Confirmar recibido</button>
      {!rechazando && <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setRechazando(true)} data-testid={`rechazar-${reporteId}`}>Rechazar</button>}
      {rechazando && (
        <>
          <input className="rtm-campo" placeholder="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo del rechazo" data-testid={`motivo-${reporteId}`} />
          <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} data-testid={`rechazar-confirmar-${reporteId}`} onClick={() => { if (!motivo.trim()) return setLocal('Escribe el motivo.'); setLocal(null); correr('ds_decidir_pago_menudeo', { p_reporte: reporteId, p_decision: 'rechazado', p_motivo: motivo.trim() }); }}>Rechazar con motivo</button>
        </>
      )}
      {(local || error) && <span className="rtm-error" role="alert">{local ?? error}</span>}
    </span>
  );
}

/** Abre la evidencia en otra pestaña (descarga controlada por la base, con registro de lectura). */
export function VerEvidencia({ reporteId, nombre }: { reporteId: number; nombre: string }) {
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} data-testid={`ver-evidencia-${reporteId}`} onClick={() => empezar(async () => {
        const r = await evidenciaAccion(reporteId);
        if (!r.ok) return setError(r.mensaje);
        setError(null);
        const bytes = Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0));
        window.open(URL.createObjectURL(new Blob([bytes], { type: r.mime })), '_blank', 'noopener');
      })}>{ocupado ? 'Abriendo' : `Ver evidencia (${nombre})`}</button>
      {error && <span className="rtm-error" role="alert"> {error}</span>}
    </span>
  );
}
