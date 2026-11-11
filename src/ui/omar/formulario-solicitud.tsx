'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState, useTransition } from 'react';
import { maximoPara, modelosDe, saboresDe } from '@/dominio/omar/solicitud';
import type { PiezaDisponible, ResultadoSolicitud } from '@/dominio/omar/tipos';
import { formatearPiezas } from '@/dominio/formato';

export type EnviarSolicitud = (entrada: { clave: string; modelo: string; sabor: string; piezas: number }) => Promise<ResultadoSolicitud>;

interface Props {
  disponible: PiezaDisponible[];
  tope: number;
  caducaHoras: number;
  enviar: EnviarSolicitud;
}

/**
 * Elegir modelo, sabor y cantidad y solicitar. La clave de idempotencia es estable por INTENCION: se renueva solo cuando la solicitud tuvo exito;
 * un doble clic o un reintento tras un corte de red viaja con la misma clave y no duplica nada. Mientras envia, el boton queda ocupado.
 */
export function FormularioSolicitud({ disponible, tope, caducaHoras, enviar }: Props) {
  const router = useRouter();
  const id = useId();
  const modelos = modelosDe(disponible);
  const [modelo, setModelo] = useState(modelos[0] ?? '');
  const sabores = saboresDe(disponible, modelo);
  const [sabor, setSabor] = useState(sabores[0]?.sabor ?? '');
  const [cantidad, setCantidad] = useState('1');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [ocupado, empezar] = useTransition();
  const clave = useRef(`web:${crypto.randomUUID()}`);

  if (modelos.length === 0) {
    return <p className="rtm-nota" data-testid="sin-piezas">No hay piezas en tu bodega para solicitar.</p>;
  }

  const saborValido = sabores.some((s) => s.sabor === sabor) ? sabor : (sabores[0]?.sabor ?? '');
  const maximo = maximoPara(disponible, modelo, saborValido, tope);
  const n = Number(cantidad);

  const alEnviar = (e: React.FormEvent) => {
    e.preventDefault();
    if (ocupado) return;
    setAviso(null);
    empezar(async () => {
      const r = await enviar({ clave: clave.current, modelo, sabor: saborValido, piezas: n });
      if (r.ok) {
        clave.current = `web:${crypto.randomUUID()}`;
        setCantidad('1');
        setAviso({ tipo: 'ok', texto: r.repetido ? `La solicitud ${r.folio} ya estaba enviada.` : `Solicitud ${r.folio} enviada a los socios. Queda pendiente hasta que la autoricen.` });
        router.refresh();
      } else {
        setAviso({ tipo: 'error', texto: r.mensaje });
      }
    });
  };

  return (
    <form className="omar-form" onSubmit={alEnviar} aria-label="Solicitar piezas" data-testid="form-solicitud">
      <label className="rtm-etiqueta-campo" htmlFor={`${id}-m`}>Modelo
        <select id={`${id}-m`} className="rtm-campo" value={modelo} onChange={(e) => { setModelo(e.target.value); setSabor(saboresDe(disponible, e.target.value)[0]?.sabor ?? ''); }}>
          {modelos.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      <label className="rtm-etiqueta-campo" htmlFor={`${id}-s`}>Sabor
        <select id={`${id}-s`} className="rtm-campo" value={saborValido} onChange={(e) => setSabor(e.target.value)}>
          {sabores.map((s) => <option key={s.sabor} value={s.sabor}>{s.sabor} ({formatearPiezas(s.piezas)})</option>)}
        </select>
      </label>
      <label className="rtm-etiqueta-campo" htmlFor={`${id}-c`}>Cantidad (hasta {maximo})
        <input id={`${id}-c`} className="rtm-campo" type="number" inputMode="numeric" min={1} max={maximo} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
      </label>
      <button type="submit" className="rtm-boton rtm-boton-primario" disabled={ocupado || maximo < 1 || !Number.isInteger(n) || n < 1 || n > maximo} aria-busy={ocupado || undefined} data-testid="enviar-solicitud">
        {ocupado ? 'Enviando…' : 'Solicitar'}
      </button>
      <p className="rtm-nota">Cada solicitud admite hasta {tope} piezas y caduca a las {caducaHoras} h si nadie la autoriza.</p>
      {aviso?.tipo === 'ok' && <p className="omar-ok" role="status" data-testid="solicitud-ok">{aviso.texto}</p>}
      {aviso?.tipo === 'error' && <p className="rtm-error" role="alert" data-testid="solicitud-error">{aviso.texto}</p>}
    </form>
  );
}
