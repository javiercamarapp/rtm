'use client';

import { useId, useState, type CSSProperties } from 'react';
import { formatearPiezas } from '@/dominio/formato';
import { CampoMonto } from '@/ui/componentes/campos-dialogo';
import { ConfirmDialog } from '@/ui/componentes/confirm-dialog';
import { useExito } from '@/ui/componentes/dialogo-enterprise';
import { centavosDeTexto, useAccion } from './usar-accion';

export interface RenglonEnvio { linea_id: number; modelo: string; sabor: string; piezas: number; disponible: number }

interface Props {
  pedidoId: number;
  folio: string;
  renglones: RenglonEnvio[];
  avisosPendientes: number;
  etiquetaBoton?: string;
  chico?: boolean;
}

/** Marcar enviado: surtido pieza por pieza (el cliente solo paga lo que salio), guia con su costo real y "Enviar de todos modos" si hay avisos. */
export function DialogoEnviar({ pedidoId, folio, renglones, avisosPendientes, etiquetaBoton = 'Marcar enviado', chico = false }: Props) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const { exito, celebrar } = useExito();
  const idCosto = useId();
  const [abierto, setAbierto] = useState(false);
  const [surtido, setSurtido] = useState<Record<number, string>>(() => Object.fromEntries(renglones.map((r) => [r.linea_id, String(r.piezas)])));
  const [paqueteria, setPaqueteria] = useState('');
  const [numero, setNumero] = useState('');
  const [costo, setCosto] = useState('');
  const [pagaGuia, setPagaGuia] = useState('');
  const [faltante, setFaltante] = useState('entrega_diferida');
  const [acepto, setAcepto] = useState(false);
  const [local, setLocal] = useState<string | null>(null);

  const confirmar = () => {
    const lista = renglones.map((r) => ({ linea_id: r.linea_id, piezas: Number(surtido[r.linea_id] ?? '0') }));
    if (lista.some((x, i) => !Number.isInteger(x.piezas) || x.piezas < 0 || x.piezas > renglones[i]!.piezas)) return setLocal('Las piezas surtidas deben ser enteros entre 0 y lo pedido.');
    if (lista.every((x) => x.piezas === 0)) return setLocal('Marca al menos una pieza surtida.');
    if (avisosPendientes > 0 && !acepto) return setLocal('El pedido tiene avisos: marca "Enviar de todos modos" para aceptarlos.');
    const c = costo.trim() === '' ? null : centavosDeTexto(costo);
    if (costo.trim() !== '' && c === null) return setLocal('El costo de la guía debe ser un monto como 180 o 180.00.');
    setLocal(null);
    correr('enviar_pedido', {
      p_pedido: pedidoId, p_surtido: lista, p_aceptar_avisos: acepto, p_falta_tipo: faltante,
      p_guia: numero.trim() ? { paqueteria: paqueteria.trim() || 'Paquetería', numero: numero.trim(), ...(c !== null ? { costo_cent: c } : {}), ...(pagaGuia ? { pagada_por: pagaGuia } : {}) } : null,
    }, () => celebrar(() => setAbierto(false)));
  };

  return (
    <>
      <button type="button" className={`rtm-boton rtm-boton-primario${chico ? ' rtm-boton-chico' : ''}`} onClick={() => { limpiarError(); setAbierto(true); }} data-testid={`marcar-enviado-${pedidoId}`}>{etiquetaBoton}</button>
      {abierto && (
        <ConfirmDialog abierto={abierto} titulo={`Marcar enviado ${folio}`} subtitulo="Piezas surtidas y guía del envío" confirmar="Marcar enviado" ocupado={ocupado} exito={exito} error={local ?? error} variante="hoja" ancho="lg" onConfirmar={confirmar} onCancelar={() => { setAbierto(false); setLocal(null); limpiarError(); }}>
          <div className="rtm-hoja-seccion">
            <h3 className="rtm-hoja-seccion-titulo" aria-hidden="true">Piezas surtidas</h3>
            <p className="rtm-nota rtm-hoja-ancho">Escribe las piezas que realmente salieron. El cliente solo paga lo surtido; lo demás queda pendiente.</p>
            {renglones.map((r) => (
              <label key={r.linea_id} className="rtm-etiqueta-campo">
                {r.modelo} · {r.sabor} (pedidas {formatearPiezas(r.piezas)}, disponibles {formatearPiezas(Math.max(r.disponible, 0))})
                <input className="rtm-campo rtm-campo-num" inputMode="numeric" value={surtido[r.linea_id] ?? ''} onChange={(e) => setSurtido((s) => ({ ...s, [r.linea_id]: e.target.value }))} aria-label={`Surtidas de ${r.modelo} ${r.sabor}`} />
              </label>
            ))}
            <label className="rtm-etiqueta-campo rtm-hoja-ancho">Lo que no salga queda como
              <select className="rtm-campo" value={faltante} onChange={(e) => setFaltante(e.target.value)}>
                <option value="entrega_diferida">Entrega diferida</option>
                <option value="pieza_no_llego">Pieza que no llegó (saldo a favor si ya pagó)</option>
              </select>
            </label>
          </div>
          <div className="rtm-hoja-seccion" style={{ '--rtm-i': 1 } as CSSProperties}>
            <h3 className="rtm-hoja-seccion-titulo" aria-hidden="true">Guía</h3>
            <label className="rtm-etiqueta-campo">Paquetería<input className="rtm-campo" value={paqueteria} onChange={(e) => setPaqueteria(e.target.value)} placeholder="Castores" /></label>
            <label className="rtm-etiqueta-campo">Guía<input className="rtm-campo" value={numero} onChange={(e) => setNumero(e.target.value)} aria-label="Número de guía" /></label>
            <div className="rtm-hoja-campo">
              <label htmlFor={`${idCosto}-c`}>Costo real de la guía</label>
              <CampoMonto id={`${idCosto}-c`} valor={costo} onCambio={setCosto} />
            </div>
            <label className="rtm-etiqueta-campo">La pagó
              <select className="rtm-campo" value={pagaGuia} onChange={(e) => setPagaGuia(e.target.value)}><option value="">Sin indicar</option><option value="Angelo">Angelo</option><option value="Javier">Javier</option></select>
            </label>
          </div>
          {avisosPendientes > 0 && (
            <label className="rtm-hoja-ancho"><input type="checkbox" checked={acepto} onChange={(e) => setAcepto(e.target.checked)} data-testid="enviar-de-todos-modos" /> Enviar de todos modos ({avisosPendientes} {avisosPendientes === 1 ? 'aviso' : 'avisos'}): queda registrado quién lo aceptó</label>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}
