'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Explicacion } from '@/dominio/catalogo/tipos';
import { etiquetaFechaHora, formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { DataTable } from './data-table';
import { EstadoTexto } from './estado-texto';

type Explicar = (cifra: string) => Promise<Explicacion>;
interface Ctx { abrir: (cifra: string, disparador: HTMLElement | null) => void }
const Contexto = createContext<Ctx | null>(null);

export function useExplicar(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error('CifraComprobada necesita un ExplicarProvider');
  return c;
}

type Estado = { fase: 'cerrado' } | { fase: 'cargando'; cifra: string } | { fase: 'error'; cifra: string } | { fase: 'listo'; datos: Explicacion };

/** Un solo cajon para toda la pagina: hoja derecha de 440 px con la cifra, su comprobacion por segunda via y los movimientos que la forman. */
export function ExplicarProvider({ explicar, children }: { explicar: Explicar; children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'cerrado' });
  const disparador = useRef<HTMLElement | null>(null);
  const cerrar = useRef<HTMLButtonElement>(null);
  const cifraAbierta = useRef('');
  const peticion = useRef(0); // la respuesta de una cifra cerrada o reemplazada no debe reabrir el cajon

  const abrir = useCallback((cifra: string, d: HTMLElement | null) => {
    disparador.current = d;
    cifraAbierta.current = cifra;
    const mia = ++peticion.current;
    setEstado({ fase: 'cargando', cifra });
    explicar(cifra).then((datos) => { if (peticion.current === mia) setEstado({ fase: 'listo', datos }); }, () => { if (peticion.current === mia) setEstado({ fase: 'error', cifra }); });
  }, [explicar]);

  const cerrarCajon = useCallback(() => {
    peticion.current += 1;
    setEstado({ fase: 'cerrado' });
    // Si la pantalla se repinto mientras estaba abierto, el boton de origen puede ser otro nodo: se vuelve a buscar por el identificador de la cifra.
    const destino = disparador.current?.isConnected ? disparador.current : document.querySelector<HTMLElement>(`[data-cifra="${CSS.escape(cifraAbierta.current)}"]`);
    destino?.focus();
  }, []);

  useEffect(() => {
    if (estado.fase === 'cerrado') return;
    cerrar.current?.focus();
    const alTeclear = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrarCajon(); };
    window.addEventListener('keydown', alTeclear);
    return () => window.removeEventListener('keydown', alTeclear);
  }, [estado.fase, cerrarCajon]);

  return (
    <Contexto.Provider value={{ abrir }}>
      {children}
      {estado.fase !== 'cerrado' && (
        <>
          <button type="button" className="rtm-velo rtm-velo-cajon" aria-label="Cerrar explicación" onClick={cerrarCajon} tabIndex={-1} />
          <aside className="rtm-cajon" role="dialog" aria-modal="true" aria-labelledby="cajon-titulo" data-testid="explicar-cajon">
            <header className="rtm-cajon-cabecera">
              <p className="rtm-eyebrow">Explicar este número</p>
              <button ref={cerrar} type="button" className="rtm-boton" onClick={cerrarCajon}>Cerrar</button>
            </header>
            {estado.fase === 'cargando' && <p className="rtm-cajon-estado" role="status">Buscando los movimientos que forman esta cifra…</p>}
            {estado.fase === 'error' && <p className="rtm-cajon-estado" role="alert">No se pudo explicar esta cifra. Cierra y vuelve a intentar.</p>}
            {estado.fase === 'listo' && <Contenido d={estado.datos} />}
          </aside>
        </>
      )}
    </Contexto.Provider>
  );
}

function Contenido({ d }: { d: Explicacion }) {
  const fmt = (n: number) => (d.unidad === 'pz' ? formatearPiezas(n) : formatearMoneda(BigInt(n)));
  return (
    <div className="rtm-cajon-cuerpo">
      <h2 id="cajon-titulo" className="rtm-cajon-titulo">{d.titulo}</h2>
      {d.valor !== null && <p className="rtm-cajon-cifra rtm-num">{fmt(d.valor)}</p>}
      {d.comprobacion && (
        <section className="rtm-cajon-bloque" aria-label="Comprobación por dos vías">
          <h3>Comprobación por dos vías</h3>
          <dl className="rtm-dl">
            <dt>{d.comprobacion.via1}</dt><dd className="rtm-num">{fmt(d.comprobacion.via1Valor)}</dd>
            <dt>{d.comprobacion.via2}</dt><dd className="rtm-num">{fmt(d.comprobacion.via2Valor)}</dd>
          </dl>
          <EstadoTexto tono={d.comprobacion.cuadra ? 'ok' : 'malo'}>{d.comprobacion.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>
        </section>
      )}
      {d.precioCent !== null && (
        <section className="rtm-cajon-bloque" aria-label="Margen">
          <h3>Precio menos costo</h3>
          <DataTable
            etiqueta="Margen por proveedor"
            clave={(c) => c.proveedor}
            filas={d.costos}
            vacio={{ titulo: 'Sin costo', texto: 'Este modelo no tiene costo vigente: el margen queda sin dato.' }}
            columnas={[
              { id: 'p', titulo: 'Proveedor', celda: (c) => <>{c.proveedor}{c.supuesto && <> <EstadoTexto tono="atencion">supuesto</EstadoTexto></>}</> },
              { id: 'c', titulo: 'Costo', numerica: true, celda: (c) => formatearMoneda(c.costoCent) },
              { id: 'm', titulo: 'Margen', numerica: true, celda: (c) => formatearMoneda(c.margenCent) },
              { id: 'k', titulo: 'Cuadra', celda: (c) => <EstadoTexto tono={c.cuadra ? 'ok' : 'malo'}>{c.cuadra ? 'Sí' : 'No'}</EstadoTexto> },
            ]}
          />
          <p className="rtm-nota">Precio del tabulador {formatearMoneda(d.precioCent)}. Margen = precio − costo.</p>
        </section>
      )}
      {d.renglones.length > 0 && (
        <section className="rtm-cajon-bloque" aria-label="Renglones">
          <h3>Renglones que forman la cifra</h3>
          <DataTable
            etiqueta="Renglones que forman la cifra"
            clave={(r) => `${r.evento ?? ''}-${r.concepto}-${r.montoCent}-${r.hora ?? ''}`}
            filas={d.renglones}
            columnas={[
              { id: 'h', titulo: 'Fecha', celda: (r) => (r.hora ? etiquetaFechaHora(r.hora) : r.fechaNeg ?? '') },
              { id: 'c', titulo: 'Concepto', celda: (r) => r.concepto },
              { id: 'm', titulo: 'Monto', numerica: true, celda: (r) => formatearMoneda(r.montoCent) },
              { id: 's', titulo: 'Saldo', numerica: true, secundaria: true, celda: (r) => (r.saldoCent === null ? '' : formatearMoneda(r.saldoCent)) },
              { id: 'q', titulo: 'Quién', secundaria: true, celda: (r) => <>{r.autor ?? r.canal ?? ''}<br /><span className="rtm-nota rtm-mono">{r.evento ?? ''}</span>{r.mensajeOrigen && <><br /><span className="rtm-nota">{r.mensajeOrigen}</span></>}</> },
            ]}
          />
        </section>
      )}
      {d.unidad === 'pz' && (
        <section className="rtm-cajon-bloque" aria-label="Movimientos">
          <h3>Movimientos</h3>
          <DataTable
            etiqueta="Movimientos que forman la cifra"
            clave={(m) => `${m.evento}-${m.hora}-${m.sabor}-${m.cantidad}`}
            filas={d.movimientos}
            vacio={{ titulo: 'Sin movimientos', texto: 'No hay movimientos registrados: la existencia queda sin dato, no en cero.' }}
            columnas={[
              { id: 'h', titulo: 'Hora', celda: (m) => etiquetaFechaHora(m.hora) },
              { id: 't', titulo: 'Tipo', celda: (m) => <>{m.tipo.replaceAll('_', ' ')}<br /><span className="rtm-nota">{m.sabor} · {m.ubicacion}</span></> },
              { id: 'c', titulo: 'Cantidad', numerica: true, celda: (m) => formatearPiezas(m.cantidad) },
              { id: 's', titulo: 'Saldo', numerica: true, celda: (m) => formatearPiezas(m.saldo) },
              { id: 'q', titulo: 'Quién', secundaria: true, celda: (m) => <>{m.autor ?? m.canal}<br /><span className="rtm-nota rtm-mono">{m.evento}</span>{m.mensajeOrigen && <><br /><span className="rtm-nota">{m.mensajeOrigen}</span></>}</> },
            ]}
          />
        </section>
      )}
    </div>
  );
}
