'use client';

import { useMemo, useState } from 'react';
import { leerMovimientos } from '@/dominio/movimientos/importar';
import { formatearMoneda, etiquetaFecha } from '@/dominio/formato';
import { bigintACentavos } from '@/dominio/operacion/json';
import { DataTable } from '@/ui/componentes/data-table';
import { ejecutar } from '../operacion/acciones';

interface Conteo { filas_total: number; filas_validas: number; filas_nuevas: number; filas_duplicadas: number; invalidas: { linea: number; motivo: string }[]; importacion_id?: number; solo_contar: boolean }

async function sha256Hex(texto: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Pegado de texto o archivo CSV. Primero se lee y se cuenta sin escribir; solo despues se importa. Reimportar el mismo contenido da cero filas nuevas. */
export function Importador() {
  const [texto, setTexto] = useState('');
  const [archivo, setArchivo] = useState<string | null>(null);
  const [conteo, setConteo] = useState<Conteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [clave, setClave] = useState(() => `web:${crypto.randomUUID()}`);
  const lectura = useMemo(() => leerMovimientos(texto), [texto]);

  const alCambiar = (t: string, nombre: string | null) => { setTexto(t); setArchivo(nombre); setConteo(null); setError(null); setClave(`web:${crypto.randomUUID()}`); };
  const cargar = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2_000_000) return setError('El archivo es demasiado grande (máximo 2 MB).');
    alCambiar(await f.text(), f.name);
  };
  const llamar = async (soloContar: boolean) => {
    setOcupado(true);
    setError(null);
    const filas = lectura.filas.map((f) => ({ fecha: f.fecha, monto_cent: bigintACentavos(f.monto_cent), cuenta: f.cuenta, origen: f.origen, mensaje: f.mensaje }));
    const r = await ejecutar('mov_importar', {
      p_clave_idem: clave, p_fuente: archivo ? 'archivo' : 'pegado', p_nombre_archivo: archivo, p_sha256: archivo ? await sha256Hex(texto) : null, p_filas: filas, p_solo_contar: soloContar,
    });
    setOcupado(false);
    if (r.ok) {
      setConteo(r.datos as unknown as Conteo);
      if (!soloContar) setClave(`web:${crypto.randomUUID()}`);
    } else setError(r.mensaje);
  };

  return (
    <div data-testid="importador">
      <label className="rtm-etiqueta-campo">Pega aquí los movimientos (una fila por línea) o sube un archivo CSV
        <textarea className="rtm-campo rtm-pegado" value={texto} onChange={(e) => alCambiar(e.target.value, null)} placeholder={'Fecha\tMonto\tCuenta\tOrigen\tMensaje'} data-testid="pegado" />
      </label>
      <p className="rtm-nota">Columnas: fecha (AAAA-MM-DD o DD/MM/AAAA), monto con signo (entradas positivas, salidas negativas) o entrada y salida por separado, cuenta, origen y mensaje. Con o sin encabezado.</p>
      <p className="rtm-acciones-fila">
        <label className="rtm-boton">
          Subir archivo CSV
          <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={(e) => cargar(e.target.files?.[0])} data-testid="archivo" />
        </label>
        <button type="button" className="rtm-boton" disabled={ocupado || lectura.filas.length === 0} onClick={() => llamar(true)} data-testid="contar">Contar sin escribir</button>
        <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado || lectura.filas.length === 0} onClick={() => llamar(false)} data-testid="importar">Importar {lectura.filas.length > 0 ? `${lectura.filas.length} filas` : ''}</button>
      </p>
      {archivo && <p className="rtm-nota">Archivo: {archivo}</p>}
      {error && <p className="rtm-error" role="alert">{error}</p>}
      {conteo && (
        <p data-testid="conteo" role="status">
          {conteo.solo_contar ? 'Ensayo, no se escribió nada: ' : `Importación ${conteo.importacion_id}: `}
          {conteo.filas_nuevas} nuevas, {conteo.filas_duplicadas} ya existían, {conteo.invalidas.length} inválidas de {conteo.filas_total}.
        </p>
      )}
      {lectura.errores.length > 0 && (
        <section className="rtm-seccion" aria-label="Filas con problemas">
          <h2>Filas que no se pudieron leer</h2>
          <ul data-testid="errores">{lectura.errores.slice(0, 20).map((e) => <li key={`${e.linea}-${e.motivo}`}>Línea {e.linea}: {e.motivo}</li>)}</ul>
        </section>
      )}
      {lectura.filas.length > 0 && (
        <section className="rtm-seccion" aria-label="Vista previa de lectura">
          <h2>Así se leyó ({lectura.filas.length} filas)</h2>
          <DataTable
            etiqueta="Vista previa de las filas leídas"
            clave={(f) => f.linea}
            filas={lectura.filas.slice(0, 15)}
            columnas={[
              { id: 'f', titulo: 'Fecha', celda: (f) => etiquetaFecha(f.fecha) },
              { id: 'm', titulo: 'Monto', numerica: true, celda: (f) => formatearMoneda(f.monto_cent, { conSigno: true }) },
              { id: 'c', titulo: 'Cuenta', secundaria: true, celda: (f) => f.cuenta },
              { id: 'o', titulo: 'Origen', secundaria: true, celda: (f) => f.origen },
              { id: 'x', titulo: 'Mensaje', celda: (f) => f.mensaje },
            ]}
          />
        </section>
      )}
    </div>
  );
}
