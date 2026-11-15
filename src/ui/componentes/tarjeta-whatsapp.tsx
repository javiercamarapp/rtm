'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { enlaceWhatsApp } from '@/dominio/nota/mensaje';
import { IconoWhatsApp } from '@/ui/iconos';
import '@/ui/estilos/dialogos.css';
import '@/ui/estilos/tarjeta-whatsapp.css';

export interface PropsTarjetaWhatsApp {
  /** Titulo del encabezado. */
  titulo?: string;
  /** Mensaje ya redactado que se muestra en la burbuja y se copia, abre o comparte. */
  mensaje: string;
  /** Ruta del PDF (misma ruta que ya sirve el documento). Sin ella no hay boton de PDF ni de compartir archivo. */
  urlPdf?: string | null;
  /** Nombre del archivo al descargar o compartir, por ejemplo "NP-0042.pdf". */
  nombreArchivo?: string;
  /** Render de la propia nota: se escala como miniatura de hoja y se repite a tamano completo en la vista ampliada. Sin el, la tarjeta es solo de mensaje. */
  vistaPrevia?: ReactNode;
  /** Nombre accesible de la vista previa, por ejemplo "nota NP-0042". */
  nombreDocumento?: string;
  /** Texto corto de estado junto al titulo (version anterior, corregida...). */
  estado?: ReactNode;
  /** Hora o fecha corta que se muestra en la burbuja. */
  hora?: string;
  /**
   * El texto completo vive en el servidor (por ejemplo, con datos que la pantalla solo ve enmascarados): copiar y compartir lo piden aqui, y
   * "Abrir en WhatsApp" no se ofrece porque el enlace iria con el texto enmascarado. Devuelve null si no se pudo armar.
   */
  obtenerCompleto?: () => Promise<string | null>;
  testid?: string;
  /** Ids de prueba de la burbuja y del boton Copiar (las pantallas que ya tenian pruebas e2e conservan los suyos). */
  /** Texto del boton de copiar. */
  etiquetaCopiar?: string;
  testidMensaje?: string;
  testidCopiar?: string;
}

type Aviso = { tipo: 'ok' | 'error' | 'info'; texto: string } | null;

function puedeCompartirArchivos(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function' || typeof navigator.share !== 'function') return false;
    return navigator.canShare({ files: [new File(['%PDF'], 'nota.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/**
 * Tarjeta "Enviar por WhatsApp": la vista previa del PDF es el recuadro principal, el mensaje va como burbuja de chat y las acciones viven dentro
 * del mismo recuadro. El software NUNCA envia nada: copiar, descargar, abrir WhatsApp o compartir las hace la persona, y WhatsApp se abre sin
 * numero (la persona elige el contacto), asi ni la pagina ni el modelo de IA ven telefonos.
 */
export function TarjetaWhatsApp({ titulo = 'Enviar nota por WhatsApp', mensaje, urlPdf = null, nombreArchivo = 'nota.pdf', vistaPrevia, nombreDocumento = 'la nota', estado, hora, obtenerCompleto, testid = 'tarjeta-whatsapp', etiquetaCopiar = 'Copiar para WhatsApp', testidMensaje = 'texto-whatsapp', testidCopiar = 'copiar-texto' }: PropsTarjetaWhatsApp) {
  const id = useId();
  const dialogo = useRef<HTMLDialogElement>(null);
  const abridor = useRef<HTMLButtonElement>(null);
  const [ampliada, setAmpliada] = useState(false);
  const [mensajeAbierto, setMensajeAbierto] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [compartible, setCompartible] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => { setCompartible(!!urlPdf && puedeCompartirArchivos()); }, [urlPdf]);

  useEffect(() => {
    const d = dialogo.current;
    if (!d) return;
    if (ampliada && !d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
    if (!ampliada && d.open) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }
  }, [ampliada]);

  const cerrar = useCallback(() => { setAmpliada(false); abridor.current?.focus(); }, []);

  const texto = async (): Promise<string | null> => (obtenerCompleto ? obtenerCompleto() : mensaje);

  const copiar = async () => {
    setOcupado(true);
    try {
      const t = await texto();
      if (t === null) { setAviso({ tipo: 'error', texto: 'No se pudo armar el mensaje. Intenta de nuevo.' }); return; }
      try {
        await navigator.clipboard.writeText(t);
        setAviso({ tipo: 'ok', texto: 'Copiado' });
      } catch {
        setAviso({ tipo: 'error', texto: 'No se pudo copiar: selecciona el mensaje y cópialo a mano.' });
      }
    } finally {
      setOcupado(false);
    }
  };

  const compartir = async () => {
    if (!urlPdf) return;
    setOcupado(true);
    try {
      const t = await texto();
      if (t === null) { setAviso({ tipo: 'error', texto: 'No se pudo armar el mensaje. Intenta de nuevo.' }); return; }
      const r = await fetch(urlPdf, { credentials: 'same-origin' });
      if (!r.ok) throw new Error('pdf');
      const archivo = new File([await r.blob()], nombreArchivo, { type: 'application/pdf' });
      await navigator.share({ files: [archivo], text: t, title: nombreArchivo });
      setAviso({ tipo: 'info', texto: 'Elige el contacto en WhatsApp para enviarlo.' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setAviso({ tipo: 'error', texto: 'No se pudo compartir. Descarga el PDF y copia el mensaje.' });
    } finally {
      setOcupado(false);
    }
  };

  return (
    <article className="rtm-wa" aria-labelledby={`${id}-t`} data-testid={testid}>
      <header className="rtm-wa-cab">
        <span className="rtm-wa-logo" role="img" aria-label="WhatsApp"><IconoWhatsApp /></span>
        <h3 id={`${id}-t`} className="rtm-wa-titulo">{titulo}</h3>
        {estado && <span className="rtm-wa-estado">{estado}</span>}
      </header>

      {vistaPrevia && (
        <div className="rtm-wa-vista">
          <span className="rtm-wa-papel" aria-hidden="true">
            <span className="rtm-wa-papel-fondo" inert>{vistaPrevia}</span>
          </span>
          <button ref={abridor} type="button" className="rtm-wa-vista-abrir" onClick={() => setAmpliada(true)} aria-haspopup="dialog" aria-label={`Abrir vista ampliada de ${nombreDocumento}`} data-testid="wa-vista-previa">
            <span className="rtm-wa-vista-pie" aria-hidden="true">Ver nota completa</span>
          </button>
        </div>
      )}

      <div className="rtm-wa-chat">
        <div className="rtm-wa-burbuja" data-abierta={mensajeAbierto ? '' : undefined}>
          <pre className="rtm-wa-mensaje" id={`${id}-m`} data-testid={testidMensaje}>{mensaje}</pre>
          {hora && <span className="rtm-wa-hora">{hora}</span>}
        </div>
        <button type="button" className="rtm-wa-enlace" aria-expanded={mensajeAbierto} aria-controls={`${id}-m`} onClick={() => setMensajeAbierto((a) => !a)} data-testid="wa-ver-mensaje">
          {mensajeAbierto ? 'Ver menos' : 'Ver mensaje completo'}
        </button>
      </div>

      <div className="rtm-wa-acciones" role="group" aria-label="Acciones para enviar por WhatsApp">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={copiar} disabled={ocupado} data-testid={testidCopiar}>{etiquetaCopiar}</button>
        {urlPdf && <a className="rtm-boton" href={urlPdf} download={nombreArchivo} data-testid="descargar-pdf">Descargar PDF de la nota</a>}
        {!obtenerCompleto && <a className="rtm-boton" href={enlaceWhatsApp(mensaje)} target="_blank" rel="noopener noreferrer" data-testid="abrir-whatsapp">Abrir en WhatsApp</a>}
        {compartible && <button type="button" className="rtm-boton" onClick={compartir} disabled={ocupado} data-testid="compartir-pdf">Compartir PDF y mensaje</button>}
      </div>
      <p className="rtm-wa-ayuda">
        {compartible
          ? 'Compartir envía el PDF y el mensaje juntos: tú eliges el contacto en WhatsApp.'
          : urlPdf
            ? 'En computadora: descarga el PDF, copia el mensaje y pégalos en la conversación de WhatsApp.'
            : 'Copia el mensaje y pégalo en la conversación de WhatsApp.'}
        {' '}El sistema no envía nada por sí solo.
      </p>
      <p className={`rtm-wa-aviso${aviso ? ` rtm-wa-aviso-${aviso.tipo}` : ''}`} role={aviso?.tipo === 'error' ? 'alert' : 'status'} aria-live={aviso?.tipo === 'error' ? 'assertive' : 'polite'} data-testid="wa-aviso">{aviso?.texto ?? ''}</p>

      {vistaPrevia && (
        <dialog ref={dialogo} className="rtm-hoja rtm-wa-ampliada" data-ancho="lg" aria-labelledby={`${id}-d`} onClose={() => { if (ampliada) cerrar(); }} onClick={(e) => { if (e.target === e.currentTarget) cerrar(); }} data-testid="wa-ampliada">
          {ampliada && (
            <div className="rtm-wa-ampliada-marco">
              <header className="rtm-wa-ampliada-cab">
                <h3 id={`${id}-d`}>Vista ampliada de {nombreDocumento}</h3>
                {urlPdf && <a className="rtm-boton rtm-boton-chico" href={urlPdf} target="_blank" rel="noopener noreferrer">Abrir PDF en otra pestaña</a>}
                <button type="button" className="rtm-boton rtm-boton-chico" onClick={cerrar} data-testid="wa-cerrar">Cerrar</button>
              </header>
              <div className="rtm-wa-ampliada-cuerpo" tabIndex={0} role="region" aria-label={`Contenido de ${nombreDocumento}`}>{vistaPrevia}</div>
            </div>
          )}
        </dialog>
      )}
    </article>
  );
}
