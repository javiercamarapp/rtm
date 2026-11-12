'use client';

import { useState } from 'react';
import { bigintACentavos } from '@/dominio/operacion/json';
import { useAccion, centavosDeTexto } from '../operacion/usar-accion';

export function AnularCargo({ cargoId, fecha }: { cargoId: number; fecha: string }) {
  const { correr, ocupado, error } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  if (!abierto) return <button type="button" className="rtm-boton" onClick={() => setAbierto(true)} data-testid={`anular-${cargoId}`}>Anular</button>;
  return (
    <form className="rtm-acciones-fila" onSubmit={(e) => { e.preventDefault(); correr('costos_anular_cargo', { p_cargo_id: cargoId, p_fecha: fecha, p_nota: motivo }); }}>
      <input className="rtm-campo" placeholder="Motivo (obligatorio)" value={motivo} onChange={(e) => setMotivo(e.target.value)} aria-label="Motivo de la anulación" data-testid="anular-motivo" />
      <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado || motivo.trim() === ''} data-testid="anular-confirmar">Confirmar anulación</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </form>
  );
}

export function FormularioReembolso({ aSocio, pendienteCent, hoy }: { aSocio: 'javier' | 'angelo'; pendienteCent: bigint; hoy: string }) {
  const { correr, ocupado, error } = useAccion();
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy);
  const [medio, setMedio] = useState('transferencia');
  const [paso, setPaso] = useState<1 | 2>(1);
  const cent = centavosDeTexto(monto);
  const invalido = cent === null || cent === 0 || BigInt(cent) > pendienteCent;
  return (
    <form className="rtm-form" data-testid="form-reembolso" onSubmit={(e) => { e.preventDefault(); if (paso === 1) return setPaso(2); correr('costos_registrar_reembolso', { p_a_socio: aSocio, p_fondos_de: aSocio === 'javier' ? 'angelo' : 'javier', p_monto_cent: cent, p_fecha: fecha, p_medio: medio, p_comprobante_sha256: null }, () => { setMonto(''); setPaso(1); }); }}>
      <div className="rtm-form-fila">
        <label className="rtm-etiqueta-campo">Monto del reembolso<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={monto} onChange={(e) => { setMonto(e.target.value); setPaso(1); }} data-testid="reembolso-monto" /></label>
        <label className="rtm-etiqueta-campo">Fecha<input className="rtm-campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
        <label className="rtm-etiqueta-campo">Medio
          <select className="rtm-campo" value={medio} onChange={(e) => setMedio(e.target.value)}><option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option></select>
        </label>
        <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado || invalido} data-testid="reembolso-guardar">{paso === 1 ? 'Revisar' : 'Confirmar reembolso'}</button>
      </div>
      {paso === 2 && cent !== null && <p role="status">Se reembolsan ${(BigInt(cent) / 100n).toLocaleString('en-US')}.{(BigInt(cent) % 100n).toString().padStart(2, '0')} de lo pendiente; el cargo original no cambia. Confirma para guardarlo.</p>}
      {error && <p className="rtm-error" role="alert">{error}</p>}
    </form>
  );
}

export function FormularioTipoCambio({ hoy }: { hoy: string }) {
  const { correr, ocupado, error } = useAccion();
  const [fecha, setFecha] = useState(hoy);
  const [tc, setTc] = useState('');
  const micro = /^\d{1,3}(\.\d{1,6})?$/.test(tc) ? BigInt(tc.split('.')[0]!) * 1_000_000n + BigInt((tc.split('.')[1] ?? '').padEnd(6, '0')) : null;
  return (
    <form className="rtm-form-fila" onSubmit={(e) => { e.preventDefault(); if (micro) correr('costos_registrar_tipo_cambio', { p_fecha: fecha, p_tc_micro: bigintACentavos(micro), p_fuente: 'manual' }); }} data-testid="form-tc">
      <label className="rtm-etiqueta-campo">Fecha<input className="rtm-campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} /></label>
      <label className="rtm-etiqueta-campo">MXN por USD (del recibo)<input className="rtm-campo rtm-campo-num" inputMode="decimal" value={tc} onChange={(e) => setTc(e.target.value)} data-testid="tc-valor" /></label>
      <button type="submit" className="rtm-boton" disabled={ocupado || micro === null} data-testid="tc-guardar">Guardar tipo de cambio</button>
      {error && <span className="rtm-error" role="alert">{error}</span>}
    </form>
  );
}
