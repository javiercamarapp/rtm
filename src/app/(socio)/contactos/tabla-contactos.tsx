'use client';

import { useState, useTransition } from 'react';
import { etiquetaOrigen, telefonoLegible, type ContactoFila, type FiltroContactos } from '@/dominio/contactos/vista';
import { formatearEntero } from '@/dominio/formato';
import { EstadoTexto } from '@/ui/componentes/estado-texto';
import { Aviso } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { exportarContactos, revelarTelefono } from './acciones';

interface Props {
  filas: ContactoFila[];
  total: number;
  filtro: FiltroContactos;
}

function descargar(nombre: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}

/** Lista con teléfono enmascarado por omisión; revelar y exportar pasan por la base, que deja el registro. */
export function TablaContactos({ filas, total, filtro }: Props) {
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [reveladas, setReveladas] = useState<Map<number, string[]>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, empezar] = useTransition();

  const alternar = (id: number) =>
    setSeleccion((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const revelar = (id: number) => {
    setError(null);
    if (reveladas.has(id)) {
      setReveladas((m) => { const n = new Map(m); n.delete(id); return n; });
      return;
    }
    empezar(async () => {
      const r = await revelarTelefono(id);
      if (r.ok) setReveladas((m) => new Map(m).set(id, r.telefonos));
      else setError(r.mensaje);
    });
  };

  const exportar = (ids: number[] | null) => {
    setError(null);
    setAviso(null);
    empezar(async () => {
      const r = await exportarContactos(ids, filtro);
      if (r.ok) {
        descargar('contactos-menudeo.csv', r.csv);
        setAviso(`Se exportaron ${formatearEntero(r.total)} contactos. Queda registro de la exportación.`);
      } else setError(r.mensaje);
    });
  };

  const todosEnPagina = filas.length > 0 && filas.every((f) => seleccion.has(f.id));

  return (
    <>
      <div className="rtm-acciones-contactos" role="group" aria-label="Acciones sobre la selección">
        <button type="button" className="rtm-boton rtm-boton-chico" onClick={() => setSeleccion(todosEnPagina ? new Set() : new Set(filas.map((f) => f.id)))}>
          {todosEnPagina ? 'Quitar selección de la página' : 'Seleccionar la página'}
        </button>
        <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado || seleccion.size === 0} onClick={() => exportar([...seleccion])}>
          Exportar selección ({formatearEntero(seleccion.size)})
        </button>
        <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado || total === 0} onClick={() => exportar(null)}>
          Exportar todo el filtro ({formatearEntero(total)})
        </button>
      </div>
      {error && <Aviso tono="error">{error}</Aviso>}
      {aviso && <Aviso tono="info">{aviso}</Aviso>}
      <DataTable
        etiqueta="Contactos de menudeo"
        densidad="densa" plana pegajosa
        clave={(f) => f.id}
        filas={filas}
        estado={ocupado && filas.length === 0 ? 'cargando' : 'listo'}
        vacio={{ titulo: 'Sin contactos', texto: 'No hay contactos con este filtro. Quita la búsqueda o elige otro origen.' }}
        columnas={[
          { id: 's', titulo: 'Elegir', ancho: 'xs', prioridadMovil: 'oculta', celda: (f) => <input type="checkbox" aria-label={`Elegir a ${f.nombre || 'contacto sin nombre'}`} checked={seleccion.has(f.id)} onChange={() => alternar(f.id)} /> },
          { id: 'n', titulo: 'Nombre', ancho: 'l', truncar: 'm', prioridadMovil: 'titulo', celda: (f) => f.nombre || 'Sin nombre' },
          {
            id: 't',
            titulo: 'Teléfono', ancho: 'l', prioridadMovil: 'principal',
            celda: (f) => {
              const r = reveladas.get(f.id);
              return (
                <>
                  {r ? r.map(telefonoLegible).join(' · ') : f.telefonoMascara}{f.sinLada && !r ? ' · sin lada' : ''}{' '}
                  <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => revelar(f.id)}>{r ? 'Ocultar' : 'Revelar'}</button>
                </>
              );
            },
          },
          { id: 'c', titulo: 'Correo', ancho: 'l', truncar: 'm', prioridadMovil: 'normal', celda: (f) => <>{f.correo ?? '—'}{f.correoCompartido && <> · <EstadoTexto tono="atencion">correo compartido</EstadoTexto></>}</> },
          { id: 'l', titulo: 'Colonia', ancho: 'm', truncar: 's', prioridadMovil: 'normal', celda: (f) => <>{f.colonia || '—'}{f.coloniaConflicto && <> · <EstadoTexto tono="atencion">colonia en conflicto</EstadoTexto></>}</> },
          { id: 'o', titulo: 'Origen', ancho: 'm', truncar: 's', prioridadMovil: 'normal', celda: (f) => f.origenes.map(etiquetaOrigen).join(', ') },
          { id: 'a', titulo: 'Anuncio', ancho: 'm', truncar: 's', prioridadMovil: 'detalle', celda: (f) => (f.anuncios.length ? f.anuncios.join(', ') : '—') },
        ]}
      />
    </>
  );
}
