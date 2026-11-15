'use client';

import { useId, useState } from 'react';
import { formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import { etiquetaFechaHora } from '@/dominio/formato';
import { estadoVisible, ETIQUETA_ESTADO, TONO_ESTADO, tiempoRestante } from '@/dominio/omar/solicitud';
import type { Lectura, PiezaDisponible, Solicitud } from '@/dominio/omar/tipos';
import { DataTable } from '../componentes/data-table';
import { EstadoTexto } from '../componentes/estado-texto';
import { ModeloMiniatura } from '../componentes/modelo';

/** Lo que la pantalla dice cuando una lectura no trae datos: la funcion de la base aun no existe, o fallo. Nunca un cero inventado. */
export function TextoLectura({ lectura, pendiente }: { lectura: Lectura<unknown>; pendiente: string }) {
  if (lectura.estado === 'pendiente_sql') return <p className="rtm-nota" data-testid="lectura-pendiente">{pendiente}</p>;
  if (lectura.estado === 'error') return <p className="rtm-error" role="alert" data-testid="lectura-error">No se pudo cargar. Intenta de nuevo en un momento.</p>;
  return null;
}

/** Existencia fisica de su bodega por modelo y sabor, con buscador. Sin costos, sin precios, sin totales del negocio. */
export function ListaDisponible({ lectura }: { lectura: Lectura<PiezaDisponible[]> }) {
  const id = useId();
  const [q, setQ] = useState('');
  if (lectura.estado !== 'ok') {
    return <DataTable etiqueta="Disponible en tu bodega" estado="error" error={{ texto: 'No se pudo leer tu bodega. Intenta de nuevo en un momento.' }} columnas={[]} filas={[]} clave={() => 0} />;
  }
  const t = q.trim().toLowerCase();
  const filas = lectura.datos.filter((p) => t === '' || `${p.modelo} ${p.sabor}`.toLowerCase().includes(t));
  return (
    <div className="omar-buscador-tabla">
      <label className="rtm-etiqueta-campo omar-buscador" htmlFor={id}>Buscar modelo o sabor
        <input id={id} className="rtm-campo" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Elux, sandía…" />
      </label>
      <DataTable plana densidad="densa" etiqueta="Disponible en tu bodega" clave={(p) => `${p.modelo}|${p.sabor}`} filas={filas}
        vacio={{ titulo: lectura.datos.length === 0 ? 'Bodega vacía' : 'Sin coincidencias', texto: lectura.datos.length === 0 ? 'No hay piezas en tu bodega ahora mismo.' : 'Ningún modelo o sabor coincide con la búsqueda.' }}
        columnas={[
          { id: 'm', titulo: 'Modelo', ancho: 'l', prioridadMovil: 'titulo', celda: (p) => <span className="rtm-modelo-tarjeta" data-tam="xs"><ModeloMiniatura modelo={p.modelo} tam="xs" /><span className="rtm-modelo-texto"><strong>{nombreVape(p.modelo)}</strong></span></span> },
          { id: 's', titulo: 'Sabor', celda: (p) => saborMayus(p.sabor) },
          { id: 'p', titulo: 'Disponible', numerica: true, prioridadMovil: 'principal', celda: (p) => formatearPiezas(p.piezas) },
        ]} />
    </div>
  );
}

/** Últimas solicitudes con su estado en palabra: pendiente, autorizada, rechazada o caducada. `ahoraIso` entra como dato (la pagina lo fija). */
export function ListaSolicitudes({ lectura, ahoraIso }: { lectura: Lectura<Solicitud[]>; ahoraIso: string }) {
  if (lectura.estado !== 'ok') return <TextoLectura lectura={lectura} pendiente="Tus solicitudes aparecerán aquí cuando los socios habiliten el envío desde la web." />;
  const ahora = new Date(ahoraIso);
  return (
    <DataTable plana densidad="densa" etiqueta="Últimas solicitudes" clave={(s) => s.folio} filas={lectura.datos.slice(0, 10)}
      vacio={{ titulo: 'Sin solicitudes', texto: 'Todavía no has solicitado piezas desde aquí.' }}
      columnas={[
        { id: 'f', titulo: 'Solicitud', prioridadMovil: 'titulo', celda: (s) => <span className="rtm-mono">{s.folio}</span> },
        { id: 'p', titulo: 'Pieza', celda: (s) => <>{nombreVape(s.modelo)} · {saborMayus(s.sabor)}<span className="rtm-celda-sub">{etiquetaFechaHora(s.solicitada_at)}</span></> },
        { id: 'n', titulo: 'Piezas', numerica: true, prioridadMovil: 'principal', celda: (s) => formatearPiezas(s.piezas) },
        {
          id: 'e', titulo: 'Estado',
          celda: (s) => {
            const e = estadoVisible(s, ahora);
            const resto = e === 'pendiente' ? tiempoRestante(s.caduca_at, ahora) : '';
            return <><EstadoTexto tono={TONO_ESTADO[e]}>{ETIQUETA_ESTADO[e]}</EstadoTexto>{resto && <span className="rtm-celda-sub">{resto}</span>}</>;
          },
        },
      ]} />
  );
}
