'use client';

import { useMemo, useState } from 'react';
import type { CatalogosApertura, CategoriaApertura } from '@/dominio/apertura/tipos';
import { centavosDeTexto, useAccion } from '../operacion/usar-accion';

const SOCIOS = ['Angelo', 'Javier'];

/** Alta de una partida de apertura. Los montos viajan como centavos enteros; el costo del inventario se multiplica en la base. */
export function FormularioPartida({ sesion, categoria, catalogos }: { sesion: number; categoria: CategoriaApertura; catalogos: CatalogosApertura }) {
  const { correr, ocupado, error, limpiarError } = useAccion();
  const [socio, setSocio] = useState(SOCIOS[0]!);
  const [cliente, setCliente] = useState(String(catalogos.clientes[0]?.id ?? ''));
  const [proveedor, setProveedor] = useState(String(catalogos.proveedores[0]?.id ?? ''));
  const [modelo, setModelo] = useState(String(catalogos.modelos[0]?.modelo_id ?? ''));
  const [sku, setSku] = useState('');
  const [monto, setMonto] = useState('');
  const [piezas, setPiezas] = useState('');
  const [costo, setCosto] = useState('');
  const [fecha, setFecha] = useState('');
  const [nota, setNota] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const esInventario = categoria.codigo === 'inventario';
  const sabores = useMemo(() => catalogos.modelos.find((m) => String(m.modelo_id) === modelo)?.sabores ?? [], [catalogos, modelo]);
  const skuElegido = sabores.some((s) => String(s.sku_id) === sku) ? sku : String(sabores[0]?.sku_id ?? '');

  const enviar = (ev: React.FormEvent) => {
    ev.preventDefault();
    limpiarError();
    const datos: Record<string, unknown> = {};
    if (categoria.req_socio) datos['socio'] = socio;
    if (categoria.req_cliente) datos['cliente_id'] = Number(cliente);
    if (categoria.req_proveedor) datos['proveedor_id'] = Number(proveedor);
    if (categoria.req_fecha) {
      if (!fecha) return setLocal('Falta la fecha del adeudo.');
      datos['fecha_ref'] = fecha;
    }
    if (esInventario) {
      const c = centavosDeTexto(costo);
      const n = Number(piezas);
      if (!skuElegido || !Number.isInteger(n) || n <= 0) return setLocal('Elige el sabor y escribe las piezas contadas.');
      if (c === null) return setLocal('Escribe el costo unitario, por ejemplo 91.55.');
      datos['sku_id'] = Number(skuElegido);
      datos['piezas'] = n;
      datos['costo_unit_cent'] = c;
    } else {
      const c = centavosDeTexto(monto);
      if (c === null || c === 0) return setLocal('Escribe un monto válido, por ejemplo 9,000.50.');
      datos['monto_cent'] = c;
      if (categoria.codigo === 'deuda_faltante_socio' && piezas) datos['piezas'] = Number(piezas);
    }
    if (nota.trim()) datos['descripcion'] = nota.trim();
    setLocal(null);
    correr('apertura_agregar', { p_sesion: sesion, p_categoria: categoria.codigo, p_datos: datos }, () => { setMonto(''); setPiezas(''); setCosto(''); setNota(''); setFecha(''); });
  };

  return (
    <form className="rtm-form-linea" onSubmit={enviar} aria-label={categoria.nombre} data-testid={`form-${categoria.codigo}`}>
      <div>
        <strong>{categoria.nombre}</strong>
        <p className="rtm-nota">{categoria.ayuda}</p>
      </div>
      {categoria.req_socio && (
        <label className="rtm-etiqueta-campo">Socio
          <select className="rtm-campo" value={socio} onChange={(e) => setSocio(e.target.value)} data-testid="campo-socio">{SOCIOS.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
      )}
      {categoria.req_cliente && (
        <label className="rtm-etiqueta-campo">Cliente
          <select className="rtm-campo" value={cliente} onChange={(e) => setCliente(e.target.value)} data-testid="campo-cliente">{catalogos.clientes.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
        </label>
      )}
      {categoria.req_proveedor && (
        <label className="rtm-etiqueta-campo">Proveedor
          <select className="rtm-campo" value={proveedor} onChange={(e) => setProveedor(e.target.value)} data-testid="campo-proveedor">{catalogos.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </label>
      )}
      {esInventario ? (
        <>
          <label className="rtm-etiqueta-campo">Modelo
            <select className="rtm-campo" value={modelo} onChange={(e) => setModelo(e.target.value)} data-testid="campo-modelo">{catalogos.modelos.map((m) => <option key={m.modelo_id} value={m.modelo_id}>{m.marca} {m.modelo}</option>)}</select>
          </label>
          <label className="rtm-etiqueta-campo">Sabor
            <select className="rtm-campo" value={skuElegido} onChange={(e) => setSku(e.target.value)} data-testid="campo-sabor">{sabores.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor}</option>)}</select>
          </label>
          <label className="rtm-etiqueta-campo">Piezas contadas
            <input className="rtm-campo" inputMode="numeric" value={piezas} onChange={(e) => setPiezas(e.target.value)} data-testid="campo-piezas" />
          </label>
          <label className="rtm-etiqueta-campo">Costo puesto por pieza
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={costo} onChange={(e) => setCosto(e.target.value)} data-testid="campo-costo" />
          </label>
        </>
      ) : (
        <label className="rtm-etiqueta-campo">Monto
          <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => setMonto(e.target.value)} data-testid="campo-monto" />
        </label>
      )}
      {categoria.codigo === 'deuda_faltante_socio' && (
        <label className="rtm-etiqueta-campo">Piezas faltantes (opcional)
          <input className="rtm-campo" inputMode="numeric" value={piezas} onChange={(e) => setPiezas(e.target.value)} data-testid="campo-piezas" />
        </label>
      )}
      {categoria.req_fecha && (
        <label className="rtm-etiqueta-campo">Fecha del adeudo
          <input className="rtm-campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} data-testid="campo-fecha" />
        </label>
      )}
      <label className="rtm-etiqueta-campo">Nota (opcional)
        <input className="rtm-campo" value={nota} onChange={(e) => setNota(e.target.value)} data-testid="campo-nota" />
      </label>
      <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="agregar-partida">{ocupado ? 'Guardando…' : 'Agregar partida'}</button>
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
    </form>
  );
}
