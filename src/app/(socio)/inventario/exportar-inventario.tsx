'use client';

import { useRef, useState, useTransition } from 'react';
import { enlaceWhatsApp } from '@/dominio/inventario/compartir';
import type { VersionInventario } from '@/dominio/inventario/tipos';
import { exportarInventarioAccion } from './acciones';

interface Props {
  marcas: string[];
  modelos: { marca: string; modelo: string }[];
  clientes: { id: number; nombre: string }[];
}

interface Resultado { id: number; folio: string; nombre_archivo: string; texto_compartir: string; version: VersionInventario; sha256: string }

/** Exportar el inventario en PDF y compartirlo: hoja nativa (Web Share con archivos) o descarga mas texto para WhatsApp. El software NO envia mensajes a clientes. */
export function ExportarInventario({ marcas, modelos, clientes }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [version, setVersion] = useState<VersionInventario>('clientes');
  const [marca, setMarca] = useState('');
  const [modelo, setModelo] = useState('');
  const [soloDisponibles, setSoloDisponibles] = useState(true);
  const [soloSocios, setSoloSocios] = useState(false);
  const [cantidades, setCantidades] = useState(false);
  const [caladas, setCaladas] = useState(false);
  const [cliente, setCliente] = useState('');
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, empezar] = useTransition();
  const clave = useRef(`web:${crypto.randomUUID()}`);

  const exportar = () => {
    setError(null);
    setAviso(null);
    empezar(async () => {
      const r = await exportarInventarioAccion(clave.current, version, {
        marca: marca || null, modelo: modelo || null, solo_disponibles: soloDisponibles, solo_socios_venden: soloSocios,
        mostrar_cantidades: version === 'interna' ? true : cantidades, con_caladas: caladas, cliente_id: version === 'clientes' && cliente ? Number(cliente) : null,
      });
      if (r.ok) {
        clave.current = `web:${crypto.randomUUID()}`;
        setResultado(r.datos);
        setTexto(r.datos.texto_compartir);
      } else setError(r.mensaje);
    });
  };

  const compartir = async () => {
    if (!resultado) return;
    setAviso(null);
    try {
      const resp = await fetch(`/inventario/documento/${resultado.id}/pdf`);
      const blob = await resp.blob();
      const archivo = new File([blob], resultado.nombre_archivo, { type: 'application/pdf' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], text: texto, title: resultado.nombre_archivo });
        return;
      }
      // Sin hoja de compartir con archivos (laptop): se descarga el PDF y se ofrece abrir WhatsApp con el texto ya escrito.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = resultado.nombre_archivo;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setAviso('Se descargó el PDF. Abre WhatsApp, elige el chat y adjunta el archivo; el texto sugerido está abajo.');
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setAviso('No se pudo abrir la hoja de compartir. Descarga el PDF y copia el texto.');
    }
  };

  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setAviso('Texto copiado.'); } catch { setAviso('No se pudo copiar: selecciona el texto a mano.'); }
  };

  const modelosDeMarca = modelos.filter((m) => !marca || m.marca === marca);

  return (
    <div className="rtm-exportar">
      <button type="button" className="rtm-boton rtm-boton-primario" onClick={() => setAbierto((v) => !v)} aria-expanded={abierto} data-testid="exportar-abrir">Exportar PDF</button>
      {abierto && (
        <div className="rtm-tarjeta rtm-exportar-panel" role="group" aria-label="Exportar el inventario">
          <div className="rtm-exportar-campos">
            <label className="rtm-etiqueta-campo">Versión
              <select className="rtm-campo" value={version} onChange={(e) => { setVersion(e.target.value as VersionInventario); setResultado(null); }} data-testid="exportar-version">
                <option value="clientes">Para clientes (sin costos)</option>
                <option value="interna">Interna para socios</option>
              </select>
            </label>
            <label className="rtm-etiqueta-campo">Marca
              <select className="rtm-campo" value={marca} onChange={(e) => { setMarca(e.target.value); setModelo(''); }} data-testid="exportar-marca">
                <option value="">Todas</option>
                {marcas.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="rtm-etiqueta-campo">Modelo
              <select className="rtm-campo" value={modelo} onChange={(e) => setModelo(e.target.value)} data-testid="exportar-modelo">
                <option value="">Todos</option>
                {modelosDeMarca.map((m) => <option key={`${m.marca}-${m.modelo}`} value={m.modelo}>{m.modelo}</option>)}
              </select>
            </label>
            {version === 'clientes' && (
              <label className="rtm-etiqueta-campo">Precios de un cliente
                <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="exportar-cliente">
                  <option value="">Sin precios</option>
                  {clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="rtm-exportar-opciones">
            <label><input type="checkbox" checked={soloDisponibles} onChange={(e) => setSoloDisponibles(e.target.checked)} /> Solo disponibles</label>
            <label><input type="checkbox" checked={soloSocios} onChange={(e) => setSoloSocios(e.target.checked)} /> Solo lo que los socios venden</label>
            {version === 'clientes' && <label><input type="checkbox" checked={cantidades} onChange={(e) => setCantidades(e.target.checked)} /> Mostrar piezas exactas</label>}
            <label><input type="checkbox" checked={caladas} onChange={(e) => setCaladas(e.target.checked)} /> Mostrar caladas</label>
          </div>
          <p className="rtm-nota">{version === 'clientes' ? 'La versión para clientes no lleva costos, utilidad ni proveedor; por defecto dice solo “Disponible” o “Agotado”.' : 'La versión interna lleva piezas exactas, costo promedio, valor y semáforo de cobertura.'}</p>
          <div className="rtm-acciones-fila">
            <button type="button" className="rtm-boton rtm-boton-primario" onClick={exportar} disabled={ocupado} data-testid="exportar-generar">{ocupado ? 'Generando' : 'Generar PDF'}</button>
          </div>
          {error && <p className="rtm-error" role="alert">{error}</p>}
          {resultado && (
            <div className="rtm-exportar-resultado" data-testid="exportar-resultado">
              <p><strong>{resultado.folio}</strong> <span className="rtm-nota">huella {resultado.sha256.slice(0, 12)}</span></p>
              <div className="rtm-acciones-fila">
                <a className="rtm-boton" href={`/inventario/documento/${resultado.id}/pdf`} target="_blank" rel="noreferrer" data-testid="exportar-ver">Ver PDF</a>
                <a className="rtm-boton" href={`/inventario/documento/${resultado.id}/pdf?descargar=1`} data-testid="exportar-descargar">Descargar</a>
                <button type="button" className="rtm-boton rtm-boton-primario" onClick={compartir} data-testid="exportar-compartir">Compartir</button>
              </div>
              <label className="rtm-etiqueta-campo">Texto sugerido para WhatsApp
                <textarea className="rtm-campo" rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} data-testid="exportar-texto" />
              </label>
              <div className="rtm-acciones-fila">
                <a className="rtm-boton rtm-boton-chico" href={enlaceWhatsApp(texto)} target="_blank" rel="noreferrer" data-testid="exportar-whatsapp">Abrir WhatsApp</a>
                <button type="button" className="rtm-boton rtm-boton-chico" onClick={copiar}>Copiar texto</button>
              </div>
              <p className="rtm-nota">Tú eliges el destinatario y pulsas enviar: el software no envía mensajes a clientes.</p>
              {aviso && <p className="rtm-nota" role="status" data-testid="exportar-aviso">{aviso}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
