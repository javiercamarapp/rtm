'use client';

import { useMemo, useState } from 'react';
import { leerMovimientos } from '@/dominio/movimientos/importar';
import { formatearMoneda, etiquetaFecha } from '@/dominio/formato';
import { bigintACentavos } from '@/dominio/operacion/json';
import { Aviso } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { KpiLinea } from '@/ui/componentes/kpi';
import { Rejilla, Tarjeta } from '@/ui/componentes/pagina';
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
    <div data-testid="importador" className="rtm-importador">
      <Rejilla dividir="8-4" alinear="inicio">
        <Tarjeta titulo="Movimientos crudos" descripcion="Pega una fila por línea o sube un archivo CSV; se cuenta antes de escribir">
          <label className="rtm-etiqueta-campo">Filas a importar
            <textarea className="rtm-campo rtm-pegado" value={texto} onChange={(e) => alCambiar(e.target.value, null)} placeholder={'Fecha\tMonto\tCuenta\tOrigen\tMensaje'} data-testid="pegado" />
          </label>
          <div className="rtm-acciones-fila">
            <label className="rtm-boton">
              Subir archivo CSV
              <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" hidden onChange={(e) => cargar(e.target.files?.[0])} data-testid="archivo" />
            </label>
            <button type="button" className="rtm-boton" disabled={ocupado || lectura.filas.length === 0} onClick={() => llamar(true)} data-testid="contar">Contar sin escribir</button>
            <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado || lectura.filas.length === 0} onClick={() => llamar(false)} data-testid="importar">Importar {lectura.filas.length > 0 ? `${lectura.filas.length} filas` : ''}</button>
          </div>
          {archivo && <p className="rtm-nota">Archivo: {archivo}</p>}
          {error && <Aviso tono="error" titulo="No se pudo importar.">{error}</Aviso>}
          {conteo && (
            <div data-testid="conteo" role="status">
              <Aviso tono="info">
                {conteo.solo_contar ? 'Ensayo, no se escribió nada: ' : `Importación ${conteo.importacion_id}: `}
                {conteo.filas_nuevas} nuevas, {conteo.filas_duplicadas} ya existían, {conteo.invalidas.length} inválidas de {conteo.filas_total}.
              </Aviso>
            </div>
          )}
        </Tarjeta>
        <Tarjeta titulo="Formato">
          <ul className="rtm-lista-formato">
            <li><strong>Fecha</strong> AAAA-MM-DD o DD/MM/AAAA</li>
            <li><strong>Monto</strong> con signo (entradas positivas, salidas negativas) o entrada y salida por separado</li>
            <li><strong>Cuenta, origen y mensaje</strong> libres</li>
            <li><strong>Encabezado</strong> opcional</li>
          </ul>
          <p className="rtm-nota">Una fila sin clasificar no afecta ningún saldo. Pegar de nuevo el mismo contenido da cero filas nuevas.</p>
        </Tarjeta>
      </Rejilla>
      {(lectura.filas.length > 0 || lectura.errores.length > 0) && (
        <KpiLinea
          etiquetaAria="Lectura del texto pegado"
          celdas={[
            { id: 'l', etiqueta: 'Filas leídas', valor: String(lectura.filas.length), categoria: 1 },
            { id: 'e', etiqueta: 'No se pudieron leer', valor: String(lectura.errores.length), categoria: 6, nota: lectura.errores.length > 0 ? 'Revisa las líneas indicadas' : 'Ninguna' },
            { id: 'en', etiqueta: 'Entradas', valor: formatearMoneda(lectura.filas.reduce((a, f) => (f.monto_cent > 0n ? a + f.monto_cent : a), 0n)), categoria: 3 },
            { id: 'sa', etiqueta: 'Salidas', valor: formatearMoneda(lectura.filas.reduce((a, f) => (f.monto_cent < 0n ? a - f.monto_cent : a), 0n)), categoria: 5 },
          ]}
        />
      )}
      {lectura.errores.length > 0 && (
        <Tarjeta titulo="Filas que no se pudieron leer">
          <ul data-testid="errores" className="rtm-lista-formato">{lectura.errores.slice(0, 20).map((e) => <li key={`${e.linea}-${e.motivo}`}>Línea {e.linea}: {e.motivo}</li>)}</ul>
        </Tarjeta>
      )}
      {lectura.filas.length > 0 && (
        <Tarjeta plana titulo={`Así se leyó (${lectura.filas.length} filas)`} descripcion="Vista previa de las primeras 15">
          <DataTable
            etiqueta="Vista previa de las filas leídas"
            densidad="densa" plana
            clave={(f) => f.linea}
            filas={lectura.filas.slice(0, 15)}
            columnas={[
              { id: 'f', titulo: 'Fecha', ancho: 's', prioridadMovil: 'titulo', celda: (f) => etiquetaFecha(f.fecha) },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', prioridadMovil: 'principal', celda: (f) => formatearMoneda(f.monto_cent, { conSigno: true }) },
              { id: 'c', titulo: 'Cuenta', ancho: 'm', truncar: 's', prioridadMovil: 'normal', celda: (f) => f.cuenta },
              { id: 'o', titulo: 'Origen', ancho: 'm', truncar: 's', prioridadMovil: 'normal', celda: (f) => f.origen },
              { id: 'x', titulo: 'Mensaje', ancho: 'l', truncar: 'l', prioridadMovil: 'detalle', celda: (f) => f.mensaje },
            ]}
          />
        </Tarjeta>
      )}
    </div>
  );
}
