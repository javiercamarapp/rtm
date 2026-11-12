'use client';

import { useState, useTransition } from 'react';
import type { ResultadoLista } from '@/dominio/proveedores/lista_cliente';
import { prepararLista } from './acciones';

export function CopiarLista({ marcas, clientes, bloqueada }: { marcas: string[]; clientes: { id: number; nombre: string }[]; bloqueada: boolean }) {
  const [marca, setMarca] = useState('');
  const [soloSocios, setSoloSocios] = useState(false);
  const [caladas, setCaladas] = useState(false);
  const [cliente, setCliente] = useState('');
  const [combinar, setCombinar] = useState(false);
  const [r, setR] = useState<ResultadoLista | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preparar = () => empezar(async () => {
    setError(null);
    setCopiado(false);
    try {
      setR(await prepararLista({ marca: marca || null, soloSocios, mostrarCaladas: caladas, clienteId: cliente ? Number(cliente) : null, combinarExistencia: combinar }));
    } catch {
      setError('No se pudo preparar la lista. Intenta de nuevo.');
    }
  });

  const copiar = async () => {
    if (r?.estado !== 'ok') return;
    try {
      await navigator.clipboard.writeText(r.texto);
      setCopiado(true);
    } catch {
      setError('Tu navegador no permitió copiar: selecciona el texto y cópialo a mano.');
    }
  };

  return (
    <div className="rtm-copiable-bloque" data-testid="copiar-lista">
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Marca
          <select className="rtm-campo" value={marca} onChange={(e) => setMarca(e.target.value)} data-testid="lista-marca"><option value="">Todas</option>{marcas.map((m) => <option key={m} value={m}>{m}</option>)}</select>
        </label>
        <label className="rtm-etiqueta-campo">Precios de este cliente
          <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="lista-cliente"><option value="">Sin precios</option>{clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </label>
        <label><input type="checkbox" checked={soloSocios} onChange={(e) => setSoloSocios(e.target.checked)} /> Solo lo que vendemos</label>
        <label><input type="checkbox" checked={caladas} onChange={(e) => setCaladas(e.target.checked)} /> Mostrar caladas</label>
        <label><input type="checkbox" checked={combinar} onChange={(e) => setCombinar(e.target.checked)} /> Combinar con nuestra existencia</label>
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={preparar} disabled={ocupado} data-testid="lista-preparar">{bloqueada ? 'Preparar lista (dato desactualizado)' : 'Preparar lista'}</button>
      </div>
      {error && <p className="rtm-error" role="alert">{error}</p>}
      {r?.estado === 'bloqueada' && <div className="rtm-aviso" role="alert" data-testid="lista-bloqueada"><strong>No se prepara la lista</strong><p>{r.advertencia}</p></div>}
      {r?.estado === 'ok' && (
        <>
          <pre className="rtm-texto-copiable" data-testid="lista-texto">{r.texto || 'No hay nada disponible con esos filtros.'}</pre>
          {r.sinPrecio.length > 0 && <p className="rtm-nota">Sin precio de este cliente: {r.sinPrecio.join(', ')}.</p>}
          <div className="rtm-acciones-fila">
            <button type="button" className="rtm-boton" onClick={copiar} disabled={!r.texto} data-testid="lista-copiar">Copiar lista para cliente</button>
            {copiado && <span role="status" data-testid="lista-copiada">Copiada. Pégala en WhatsApp; el sistema nunca la envía.</span>}
          </div>
        </>
      )}
    </div>
  );
}
