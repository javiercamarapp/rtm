'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { EXPLICACIONES_CONTEO, type ExplicacionConteo, type HojaConteoSku, type PrevisualizacionConteo } from '@/dominio/inventario/tipos';
import { formatearPiezas } from '@/dominio/formato';
import { cerrarConteoAccion, previsualizarConteoAccion } from '../acciones';

const ETIQUETA: Record<ExplicacionConteo, string> = {
  venta_no_registrada: 'Venta no registrada', toma_no_registrada: 'Toma no registrada', error_de_sabor: 'Error de sabor', reclamo_proveedor: 'Reclamo al proveedor', merma: 'Merma', error_de_conteo: 'Error de conteo',
};

function ahoraLocal(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Conteo ciego: primero se cuenta (sin ver lo que dice el sistema), despues se muestra la diferencia, se explica y se cierra. */
export function HojaConteo({ ubicacion, hoja }: { ubicacion: string; hoja: HojaConteoSku[] }) {
  const [cuentas, setCuentas] = useState<Record<number, string>>({});
  const [cuando, setCuando] = useState('');
  const [previa, setPrevia] = useState<PrevisualizacionConteo | null>(null);
  const [explica, setExplica] = useState<Record<number, ExplicacionConteo | ''>>({});
  const [error, setError] = useState<string | null>(null);
  const [cerrado, setCerrado] = useState<{ conteo_id: number; ajustes: number } | null>(null);
  const [ocupado, empezar] = useTransition();
  const clave = useRef(`web:${crypto.randomUUID()}`);
  useEffect(() => setCuando(ahoraLocal()), []);

  const lineas = hoja.filter((h) => cuentas[h.sku_id] !== undefined && cuentas[h.sku_id] !== '').map((h) => ({ sku_id: h.sku_id, contado: Number(cuentas[h.sku_id]) }));
  const invalidas = lineas.some((l) => !Number.isInteger(l.contado) || l.contado < 0);

  const ver = () => {
    setError(null);
    empezar(async () => {
      try { setPrevia(await previsualizarConteoAccion(ubicacion, lineas)); } catch { setError('No se pudo calcular la diferencia. Revisa las cantidades.'); }
    });
  };
  const cerrar = () => {
    if (!previa) return;
    setError(null);
    empezar(async () => {
      const r = await cerrarConteoAccion(clave.current, ubicacion, new Date(cuando).toISOString(), lineas.map((l) => ({ ...l, explicacion_tipo: explica[l.sku_id] || null })));
      if (r.ok) { clave.current = `web:${crypto.randomUUID()}`; setCerrado(r.datos); } else setError(r.mensaje);
    });
  };

  if (cerrado) {
    return (
      <div className="rtm-tarjeta" role="status" data-testid="conteo-cerrado">
        <h2>Conteo cerrado</h2>
        <p>Se registraron {cerrado.ajustes} {cerrado.ajustes === 1 ? 'ajuste' : 'ajustes'} al costo promedio. Las diferencias sin explicar quedan marcadas “Sin explicar”.</p>
        <a className="rtm-boton" href="/inventario/conteo">Ver conteos</a>
      </div>
    );
  }

  if (previa) {
    const sinExplicar = previa.lineas.filter((l) => l.diferencia !== 0 && !explica[l.sku_id]).length;
    return (
      <div className="rtm-seccion" data-testid="conteo-revision">
        <h2>Diferencias contra el sistema</h2>
        <p className="rtm-nota">
          {previa.con_diferencia === 0 ? 'No hay diferencias.' : `${previa.con_diferencia} ${previa.con_diferencia === 1 ? 'sabor con diferencia' : 'sabores con diferencia'}`}
          {previa.exactitud_bp !== null ? ` · exactitud ${(previa.exactitud_bp / 100).toFixed(2)} %` : ''}. “En la bodega” = disponible según el sistema + vendidas por recoger.
        </p>
        <div className="rtm-dt-caja">
          <div className="rtm-dt" role="table" aria-label="Diferencias del conteo">
            <div className="rtm-dt-grupo" role="rowgroup">
              <div className="rtm-dt-fila rtm-dt-cabecera" role="row">
                {['Modelo y sabor', 'Contado', 'En la bodega (sistema)', 'Diferencia', 'Explicación'].map((t, i) => <div key={t} role="columnheader" className="rtm-dt-celda" data-num={i >= 1 && i <= 3 ? true : undefined}>{t}</div>)}
              </div>
            </div>
            <div className="rtm-dt-grupo" role="rowgroup">
              {previa.lineas.map((l) => (
                <div key={l.sku_id} className="rtm-dt-fila" role="row" data-testid={`dif-${l.sku_id}`}>
                  <div role="cell" className="rtm-dt-celda">{l.modelo} · {l.sabor}</div>
                  <div role="cell" className="rtm-dt-celda" data-num>{formatearPiezas(l.contado)}</div>
                  <div role="cell" className="rtm-dt-celda" data-num>{formatearPiezas(l.esperado)}<br /><span className="rtm-nota">{formatearPiezas(l.disponible_sistema)} + {formatearPiezas(l.vendido_por_recoger)} por recoger</span></div>
                  <div role="cell" className="rtm-dt-celda" data-num>{l.diferencia === 0 ? 'Cuadra' : `${l.diferencia > 0 ? '+' : ''}${formatearPiezas(l.diferencia)}`}</div>
                  <div role="cell" className="rtm-dt-celda">
                    {l.diferencia === 0 ? '' : (
                      <select className="rtm-campo" aria-label={`Explicación de ${l.modelo} ${l.sabor}`} value={explica[l.sku_id] ?? ''} onChange={(e) => setExplica({ ...explica, [l.sku_id]: e.target.value as ExplicacionConteo | '' })}>
                        <option value="">Sin explicar</option>
                        {EXPLICACIONES_CONTEO.map((x) => <option key={x} value={x}>{ETIQUETA[x]}</option>)}
                      </select>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        {sinExplicar > 0 && <p className="rtm-nota">{sinExplicar} {sinExplicar === 1 ? 'diferencia queda' : 'diferencias quedan'} sin explicar; puedes cerrar y explicarlas después con el reclamo o la corrección que corresponda.</p>}
        {error && <p className="rtm-error" role="alert">{error}</p>}
        <div className="rtm-acciones-fila">
          <button type="button" className="rtm-boton" onClick={() => setPrevia(null)} disabled={ocupado}>Volver a contar</button>
          <button type="button" className="rtm-boton rtm-boton-primario" onClick={cerrar} disabled={ocupado} data-testid="conteo-cerrar">{ocupado ? 'Cerrando' : 'Cerrar conteo y ajustar'}</button>
        </div>
      </div>
    );
  }

  const modelos = [...new Set(hoja.map((h) => `${h.marca} · ${h.modelo}`))];
  return (
    <div className="rtm-seccion" data-testid="conteo-hoja">
      <label className="rtm-etiqueta-campo">Fecha y hora del conteo
        <input className="rtm-campo" type="datetime-local" value={cuando} onChange={(e) => setCuando(e.target.value)} data-testid="conteo-cuando" />
      </label>
      {modelos.map((m) => (
        <fieldset key={m} className="rtm-conteo-grupo">
          <legend>{m}</legend>
          {hoja.filter((h) => `${h.marca} · ${h.modelo}` === m).map((h) => (
            <label key={h.sku_id} className="rtm-conteo-fila">
              <span>{h.sabor}</span>
              <input className="rtm-campo rtm-campo-num" inputMode="numeric" pattern="[0-9]*" placeholder="Contadas" value={cuentas[h.sku_id] ?? ''} onChange={(e) => setCuentas({ ...cuentas, [h.sku_id]: e.target.value.replace(/[^0-9]/g, '') })} aria-label={`Piezas contadas de ${h.modelo} ${h.sabor}`} data-testid={`contado-${h.sku_id}`} />
            </label>
          ))}
        </fieldset>
      ))}
      <p className="rtm-nota">Cuenta primero; la diferencia con el sistema aparece después. Deja en blanco lo que no contaste.</p>
      {error && <p className="rtm-error" role="alert">{error}</p>}
      <div className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={ver} disabled={ocupado || lineas.length === 0 || invalidas || cuando === ''} data-testid="conteo-ver">{ocupado ? 'Calculando' : 'Ver diferencias'}</button>
      </div>
    </div>
  );
}
