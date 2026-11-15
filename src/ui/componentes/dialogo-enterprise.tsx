'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { IconoClientes, IconoCobrar, IconoCatalogo, IconoPaquete } from '@/ui/iconos';
import '@/ui/estilos/dialogos.css';

export type TonoHoja = 'normal' | 'peligro';

export interface PropsHoja {
  abierto: boolean;
  titulo: string;
  /** Una linea bajo el titulo. */
  subtitulo?: string;
  /** Icono del encabezado; sin el, se infiere del titulo o se usa un monograma. */
  icono?: ReactNode;
  tono?: TonoHoja;
  /** 'compacta': confirmacion de una sola accion (sin campos). Si se omite se detecta por la ausencia de campos. */
  variante?: 'hoja' | 'compacta';
  ancho?: 'sm' | 'md' | 'lg';
  /** Hay cambios sin guardar: cerrar pide confirmacion. Si se omite, se detecta al escribir en cualquier campo. */
  sucio?: boolean;
  /** Muestra el sello de exito animado (true o el texto). */
  exito?: boolean | string;
  ocupado?: boolean;
  /** Error de servidor o de validacion, siempre visible encima del pie. */
  error?: string | null;
  confirmar: string;
  cancelar?: string;
  onConfirmar: () => void;
  onCancelar: () => void;
  children: ReactNode;
  /** Panel "Asi quedara" bajo los campos. */
  efecto?: ReactNode;
  testid?: string;
  enfocar?: 'cancelar' | 'primer-campo';
}

const CAMPOS = 'input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)';
const FOCOS = `a[href], button:not(:disabled), ${CAMPOS}, [tabindex]:not([tabindex="-1"])`;

const sinAcentos = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Acciones que quitan o deshacen algo: usan el tono de peligro sobrio. */
export function esDestructivo(...textos: (string | undefined)[]): boolean {
  return textos.some((t) => t !== undefined && /^(anular|cancelar \S|eliminar|desactivar|borrar|descartar|quitar)/.test(sinAcentos(t.trim())));
}

const Aviso = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 4 3.5 19h17L12 4Z" /><path d="M12 10v4M12 16.8v.01" /></svg>
);
const Equis = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" /></svg>
);

/** Icono sobrio segun lo que hace el dialogo; sin coincidencia, la inicial del titulo como monograma. */
export function iconoDeDialogo(titulo: string, tono: TonoHoja = 'normal'): ReactNode {
  if (tono === 'peligro') return <Aviso />;
  const t = sinAcentos(titulo);
  if (/pago|deposit|aport|retiro|liquid|cobr|gasto|monto|renta|costo|precio|recargo|abono|ajuste/.test(t)) return <IconoCobrar />;
  if (/envi|guia|paquete|llego|recep|trayecto|entrega|merida/.test(t)) return <IconoPaquete />;
  if (/cliente|persona|cuenta|correo|socio|bodega/.test(t)) return <IconoClientes />;
  if (/nota|acta|firma|conteo|merma|compra|pedido|plazo|catalogo|duplic|export|devol/.test(t)) return <IconoCatalogo />;
  return <span aria-hidden="true">{titulo.trim().charAt(0).toUpperCase() || 'R'}</span>;
}

function duracionSalidaMs(): number {
  if (typeof document === 'undefined') return 0;
  const m = document.documentElement.dataset.movimiento;
  if (m === 'off') return 0;
  return m === 'reduced' ? 100 : 160;
}

/** Cierra con sello de exito: muestra el check y despues de una breve pausa ejecuta el cierre real. */
export function useExito(): { exito: boolean; celebrar: (alCerrar: () => void) => void } {
  const [exito, setExito] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);
  const celebrar = useCallback((alCerrar: () => void) => {
    const m = typeof document === 'undefined' ? 'off' : document.documentElement.dataset.movimiento;
    const ms = m === 'off' ? 0 : m === 'reduced' ? 350 : 750;
    if (ms === 0) { alCerrar(); return; }
    setExito(true);
    temporizador.current = setTimeout(() => { setExito(false); alCerrar(); }, ms);
  }, []);
  return { exito, celebrar };
}

function primerObjetivo(cuerpo: HTMLElement | null): HTMLElement | null {
  const c = cuerpo?.querySelector<HTMLElement>(CAMPOS) ?? null;
  if (c instanceof HTMLInputElement && c.type === 'radio' && c.name) {
    const marcado = Array.from(cuerpo?.querySelectorAll<HTMLInputElement>('input[type=radio]:checked') ?? []).find((r) => r.name === c.name);
    return marcado ?? c;
  }
  return c;
}

/** Hoja de dialogo unica del software: <dialog> modal con encabezado, cuerpo en rejilla, panel de efecto y pie fijo. */
export function DialogoEnterprise({ abierto, titulo, subtitulo, icono, tono, variante, ancho, sucio, exito, ocupado, error, confirmar, cancelar = 'Cancelar', onConfirmar, onCancelar, children, efecto, testid, enfocar }: PropsHoja) {
  const ref = useRef<HTMLDialogElement>(null);
  const cuerpoRef = useRef<HTMLDivElement>(null);
  const cancelarRef = useRef<HTMLButtonElement>(null);
  const seguirRef = useRef<HTMLButtonElement>(null);
  const origenRef = useRef<HTMLElement | null>(null);
  const salidaRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bajadaEnFondo = useRef(false);
  const [tocado, setTocado] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [sinCampos, setSinCampos] = useState(false);
  const id = useId();

  const tonoFinal: TonoHoja = tono ?? (esDestructivo(confirmar, titulo) ? 'peligro' : 'normal');
  const compacta = variante ? variante === 'compacta' : sinCampos;
  const hayCambios = sucio ?? tocado;
  const bloqueado = !!ocupado || !!exito;

  // Los formularios montan el dialogo solo mientras esta abierto: al desmontarse, el foco vuelve al control que lo abrio.
  useEffect(() => {
    const origen = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (salidaRef.current) clearTimeout(salidaRef.current);
      if (origen?.isConnected) origen.focus();
    };
  }, []);

  useLayoutEffect(() => { setSinCampos(!cuerpoRef.current?.querySelector('input, select, textarea')); });

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (abierto && !d.open) {
      origenRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', '');
      const objetivo = enfocar === 'cancelar' || tonoFinal === 'peligro' ? null : primerObjetivo(cuerpoRef.current);
      (objetivo ?? cancelarRef.current)?.focus();
    }
    if (!abierto && d.open) {
      if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
      if (origenRef.current?.isConnected) origenRef.current.focus();
    }
  }, [abierto, enfocar, tonoFinal]);

  // El error de servidor queda a la vista aunque el cuerpo este desplazado.
  useEffect(() => {
    const alerta = cuerpoRef.current?.querySelector<HTMLElement>('[role="alert"]');
    if (alerta && typeof alerta.scrollIntoView === 'function') alerta.scrollIntoView({ block: 'nearest' });
  }, [error, children]);

  useEffect(() => { if (descartando) seguirRef.current?.focus(); }, [descartando]);
  useEffect(() => { if (!abierto) { setTocado(false); setDescartando(false); } }, [abierto]);

  const salir = useCallback(() => {
    if (salidaRef.current) return;
    const ms = duracionSalidaMs();
    if (ms === 0) { onCancelar(); return; }
    setSaliendo(true);
    salidaRef.current = setTimeout(() => { salidaRef.current = null; setSaliendo(false); onCancelar(); }, ms);
  }, [onCancelar]);

  const pedirCerrar = useCallback(() => {
    if (bloqueado) return;
    if (hayCambios && !descartando) { setDescartando(true); return; }
    salir();
  }, [bloqueado, hayCambios, descartando, salir]);

  const alTeclear = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Tab') {
      const lista = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCOS) ?? []).filter((el) => !el.closest('[hidden]')).sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      if (!primero || !ultimo) return;
      if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !bloqueado && !descartando) {
      const t = e.target;
      if (t instanceof HTMLInputElement && t.type !== 'button' && t.type !== 'submit') { e.preventDefault(); onConfirmar(); }
    }
  };

  const peligro = tonoFinal === 'peligro';
  return (
    <dialog
      ref={ref}
      className="rtm-hoja"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-t`}
      aria-describedby={subtitulo ? `${id}-s` : `${id}-x`}
      data-tono={tonoFinal}
      data-ancho={ancho}
      data-compacta={compacta ? '' : undefined}
      data-saliendo={saliendo ? '' : undefined}
      data-testid={testid}
      onCancel={(e) => { e.preventDefault(); if (descartando) setDescartando(false); else pedirCerrar(); }}
      onMouseDown={(e) => { bajadaEnFondo.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && bajadaEnFondo.current) pedirCerrar(); }}
    >
      <div className="rtm-hoja-marco" onKeyDown={alTeclear}>
        <header className="rtm-hoja-cab">
          <span className="rtm-hoja-icono" aria-hidden="true">{icono ?? iconoDeDialogo(titulo, tonoFinal)}</span>
          <div className="rtm-hoja-titulos">
            <h2 id={`${id}-t`} className="rtm-hoja-titulo">{titulo}</h2>
            {subtitulo && <p id={`${id}-s`} className="rtm-hoja-sub">{subtitulo}</p>}
          </div>
          <button type="button" className="rtm-hoja-cerrar" aria-label="Cerrar" onClick={pedirCerrar} disabled={bloqueado} data-testid="cerrar-dialogo"><Equis /></button>
        </header>
        <div className="rtm-hoja-scroll">
          <div id={`${id}-x`} ref={cuerpoRef} className="rtm-hoja-cuerpo" onInput={() => setTocado(true)}>{children}</div>
          {efecto}
        </div>
        {error && <p className="rtm-hoja-error" role="alert" data-testid="error-dialogo">{error}</p>}
        <footer className="rtm-hoja-pie">
          {descartando ? (
            <>
              <p className="rtm-hoja-descartar">¿Descartar lo que escribiste?</p>
              <button ref={seguirRef} type="button" className="rtm-boton" onClick={() => setDescartando(false)}>Seguir editando</button>
              <button type="button" className="rtm-boton rtm-boton-peligro" onClick={() => { setDescartando(false); salir(); }} data-testid="descartar">Descartar</button>
            </>
          ) : (
            <>
              <button ref={cancelarRef} type="button" className="rtm-boton" onClick={pedirCerrar} disabled={bloqueado}>{cancelar}</button>
              <button type="button" className={`rtm-boton ${peligro ? 'rtm-boton-peligro' : 'rtm-boton-primario'}`} onClick={onConfirmar} disabled={bloqueado} data-testid="confirmar">
                {ocupado ? <><span className="rtm-hoja-puntos" aria-hidden="true" />Guardando</> : confirmar}
              </button>
            </>
          )}
        </footer>
        {exito && (
          <div className="rtm-hoja-exito" role="status">
            <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false"><circle cx="32" cy="32" r="28" pathLength="1" /><path d="M20 33l8 8 16-17" pathLength="1" /></svg>
            <p>{typeof exito === 'string' ? exito : 'Listo'}</p>
          </div>
        )}
      </div>
    </dialog>
  );
}
