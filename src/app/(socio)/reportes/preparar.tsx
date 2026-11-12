'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { prepararReporte } from './acciones';

export function PrepararReporte() {
  const router = useRouter();
  const [tipo, setTipo] = useState<'semanal' | 'mensual'>('semanal');
  const [inicio, setInicio] = useState('');
  const [ocupado, empezar] = useTransition();
  const [mensaje, setMensaje] = useState<string | null>(null);
  const preparar = () => empezar(async () => {
    setMensaje(null);
    const r = await prepararReporte(tipo, inicio || null);
    if (!r.ok) setMensaje(r.mensaje);
    else if (!r.salio) setMensaje(r.aviso ?? 'El reporte no sale: falla una comprobación bloqueante.');
    else setMensaje('Reporte preparado.');
    router.refresh();
  });
  return (
    <form className="rtm-form-fila" data-testid="preparar-reporte" onSubmit={(e) => { e.preventDefault(); preparar(); }}>
      <label className="rtm-etiqueta-campo">Tipo
        <select className="rtm-campo" value={tipo} onChange={(e) => setTipo(e.target.value as 'semanal' | 'mensual')} data-testid="reporte-tipo"><option value="semanal">Semanal</option><option value="mensual">Mensual</option></select>
      </label>
      <label className="rtm-etiqueta-campo">Inicio (vacío = el último periodo cerrado)<input className="rtm-campo" type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} data-testid="reporte-inicio" /></label>
      <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado} data-testid="reporte-preparar">{ocupado ? 'Preparando…' : 'Preparar reporte'}</button>
      {mensaje && <span role="status" data-testid="reporte-mensaje">{mensaje}</span>}
    </form>
  );
}
