'use client';

import { useState, useTransition } from 'react';
import type { ResultadoLista } from '@/dominio/proveedores/lista_cliente';
import { marcaMayus } from '@/dominio/formato';
import { TarjetaWhatsApp } from '@/ui/componentes/tarjeta-whatsapp';
import { prepararLista } from './acciones';

export function CopiarLista({ marcas, clientes, bloqueada }: { marcas: string[]; clientes: { id: number; nombre: string }[]; bloqueada: boolean }) {
  const [marca, setMarca] = useState('');
  const [soloSocios, setSoloSocios] = useState(false);
  const [caladas, setCaladas] = useState(false);
  const [cliente, setCliente] = useState('');
  const [combinar, setCombinar] = useState(false);
  const [r, setR] = useState<ResultadoLista | null>(null);
  const [ocupado, empezar] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const preparar = () => empezar(async () => {
    setError(null);
    try {
      setR(await prepararLista({ marca: marca || null, soloSocios, mostrarCaladas: caladas, clienteId: cliente ? Number(cliente) : null, combinarExistencia: combinar }));
    } catch {
      setError('No se pudo preparar la lista. Intenta de nuevo.');
    }
  });

  return (
    <div className="rtm-copiable-bloque" data-testid="copiar-lista">
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Marca
          <select className="rtm-campo" value={marca} onChange={(e) => setMarca(e.target.value)} data-testid="lista-marca"><option value="">Todas</option>{marcas.map((m) => <option key={m} value={m}>{marcaMayus(m)}</option>)}</select>
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
          {r.texto
            ? <TarjetaWhatsApp titulo="Enviar lista por WhatsApp" mensaje={r.texto} testidMensaje="lista-texto" testidCopiar="lista-copiar" />
            : <p className="rtm-nota" data-testid="lista-texto">No hay nada disponible con esos filtros.</p>}
          {r.sinPrecio.length > 0 && <p className="rtm-nota">Sin precio de este cliente: {r.sinPrecio.join(', ')}.</p>}
        </>
      )}
    </div>
  );
}
