'use client';

import { useState } from 'react';
import { validarEvidencia } from '@/dominio/dropshipping/evidencia';
import type { CostoRenglon } from '@/dominio/dropshipping/tipos';
import { centavosDeTexto, useAccion } from '../../../operacion/usar-accion';

function aBase64(f: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] ?? '');
    r.onerror = () => rej(new Error('lectura'));
    r.readAsDataURL(f);
  });
}

/** Captura el costo real por pieza (distinto del catálogo) antes de enviar, con motivo obligatorio y evidencia opcional. El catálogo sigue siendo el valor por omisión. */
export function CapturarCosto({ pedidoId, renglones }: { pedidoId: number; renglones: CostoRenglon[] }) {
  const { correr, ocupado, error } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [modo, setModo] = useState<'todos' | 'renglon'>('todos');
  const [unico, setUnico] = useState('');
  const [porLinea, setPorLinea] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  if (!abierto) return <button type="button" className="rtm-boton" onClick={() => setAbierto(true)} data-testid="capturar-costo">Capturar costo distinto del catálogo</button>;
  const ir = async () => {
    const costos: { linea_id: number; costo_unit_cent: number }[] = [];
    for (const r of renglones) {
      const t = modo === 'todos' ? unico : porLinea[r.linea_id] ?? '';
      if (modo === 'renglon' && !t.trim()) continue;
      const c = centavosDeTexto(t);
      if (c === null || c <= 0) return setLocal('Escribe el costo por pieza, por ejemplo 95 o 95.00.');
      costos.push({ linea_id: r.linea_id, costo_unit_cent: c });
    }
    if (costos.length === 0) return setLocal('Indica el costo de al menos un renglón.');
    if (motivo.trim().length < 5) return setLocal('Escribe el motivo (por ejemplo sobrecobro en disputa con el proveedor).');
    let b64: string | null = null;
    if (archivo) {
      const m = validarEvidencia(archivo.type, archivo.size);
      if (m) return setLocal(m);
      b64 = await aBase64(archivo);
    }
    setLocal(null);
    correr('ds_capturar_costo', { p_pedido: pedidoId, p_costos: costos, p_motivo: motivo.trim(), ...(b64 ? { p_evidencia_b64: b64, p_evidencia_mime: archivo?.type, p_evidencia_nombre: archivo?.name } : {}) }, () => { setAbierto(false); setMotivo(''); setArchivo(null); });
  };
  return (
    <div className="rtm-form" data-testid="form-costo">
      <label className="rtm-etiqueta-campo">Cómo se captura
        <select className="rtm-campo" value={modo} onChange={(e) => setModo(e.target.value as 'todos' | 'renglon')} data-testid="costo-modo"><option value="todos">El mismo costo por pieza para todo el pedido</option><option value="renglon">Un costo por renglón</option></select>
      </label>
      {modo === 'todos' ? (
        <label className="rtm-etiqueta-campo">Costo real por pieza<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={unico} onChange={(e) => setUnico(e.target.value)} data-testid="costo-unico" /></label>
      ) : (
        renglones.map((r) => (
          <label key={r.linea_id} className="rtm-etiqueta-campo">{r.modelo} · {r.sabor} (catálogo {r.costo_catalogo_cent === null ? 'sin dato' : `$${(Number(r.costo_catalogo_cent) / 100).toFixed(2)}`})
            <input className="rtm-campo rtm-campo-num" inputMode="decimal" value={porLinea[r.linea_id] ?? ''} onChange={(e) => setPorLinea((x) => ({ ...x, [r.linea_id]: e.target.value }))} data-testid={`costo-linea-${r.linea_id}`} />
          </label>
        ))
      )}
      <label className="rtm-etiqueta-campo rtm-campo-ancho">Motivo<input className="rtm-campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} data-testid="costo-motivo" /></label>
      <label className="rtm-etiqueta-campo">Evidencia (opcional: imagen o PDF de la factura o el mensaje, hasta 2 MB)<input className="rtm-campo" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} data-testid="costo-evidencia" /></label>
      <p className="rtm-nota">Queda marcado como «costo distinto del catálogo», con su diferencia y su motivo, y entra al registro de diferencias en disputa con el proveedor. La utilidad y los asientos usan este costo.</p>
      {(local || error) && <p className="rtm-error" role="alert">{local ?? error}</p>}
      <span className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" disabled={ocupado} onClick={ir} data-testid="costo-guardar">{ocupado ? 'Guardando' : 'Guardar costo'}</button>
        <button type="button" className="rtm-boton" onClick={() => setAbierto(false)}>Cancelar</button>
      </span>
    </div>
  );
}

/** Resolver o descartar una diferencia en disputa con el proveedor (con nota). */
export function ResolverDiferencia({ capturaId }: { capturaId: number }) {
  const { correr, ocupado, error } = useAccion();
  const [nota, setNota] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const decidir = (estado: 'resuelta' | 'descartada') => { if (nota.trim().length < 3) return setLocal('Escribe cómo se resolvió.'); setLocal(null); correr('ds_resolver_diferencia', { p_captura: capturaId, p_estado: estado, p_nota: nota.trim() }); };
  return (
    <span className="rtm-acciones-fila">
      <input className="rtm-campo" placeholder="Cómo se resolvió" value={nota} onChange={(e) => setNota(e.target.value)} aria-label="Nota de resolución" data-testid={`dif-nota-${capturaId}`} />
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => decidir('resuelta')} data-testid={`dif-resolver-${capturaId}`}>Resuelta</button>
      <button type="button" className="rtm-boton rtm-boton-chico" disabled={ocupado} onClick={() => decidir('descartada')} data-testid={`dif-descartar-${capturaId}`}>Descartar</button>
      {(local || error) && <span className="rtm-error" role="alert">{local ?? error}</span>}
    </span>
  );
}
