'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ChipPulso } from '@/dominio/operacion/pulso';
import { CifraComprobada } from '../componentes/cifra';
import { SinDato } from '../componentes/estado-texto';


/** Un indicador del pulso de la barra: cifra real con "Explicar este numero" cuando la base la sabe explicar; si no, enlace al detalle. Sin datos: "Sin dato", nunca un cero inventado. */
export function ChipDelPulso({ chip }: { chip: ChipPulso }) {
  return (
    <span className="rtm-chip" data-testid={`pulso-${chip.clave}`}>
      {chip.etiqueta}
      <b>
        {chip.texto === null ? (
          chip.href ? <Link className="rtm-chip-enlace" href={chip.href}><SinDato /></Link> : <SinDato />
        ) : chip.cifra ? (
          <CifraComprobada texto={chip.texto} cifra={chip.cifra} comprobacion="cuadra" />
        ) : chip.href ? (
          <Link className="rtm-chip-enlace" href={chip.href} aria-label={`${chip.texto}. Ver el detalle`}>{chip.texto}</Link>
        ) : (
          chip.texto
        )}
      </b>
      {chip.detalle && chip.texto !== null && <span className="rtm-chip-detalle">{chip.detalle}</span>}
    </span>
  );
}

const MS_ROTACION = 5000;
const MS_SALIDA = 160;

/** Indicador que alterna entre dos cuentas (Isaac y Karen) en el mismo lugar de la barra. Rota solo cada ~5 s con animacion suave; se pausa con el puntero o el foco encima; con "reducir movimiento" no rota ni anima y se cambia a mano. Los dos puntos dicen que cuenta se ve y sirven para cambiar (flechas del teclado incluidas). */
export function ChipRotativo({ chip }: { chip: ChipPulso }) {
  const vistas = [chip, ...(chip.alterno ? [chip.alterno] : [])];
  const [idx, setIdx] = useState(0);
  const [fase, setFase] = useState<'quieto' | 'sale' | 'entra'>('quieto');
  const [pausa, setPausa] = useState(false);
  const [reducido, setReducido] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aplicar = () => setReducido(mq.matches);
    aplicar();
    mq.addEventListener('change', aplicar);
    return () => mq.removeEventListener('change', aplicar);
  }, []);
  useEffect(() => () => { if (temporizador.current) clearTimeout(temporizador.current); }, []);

  const irA = useCallback((destino: number) => {
    if (temporizador.current) clearTimeout(temporizador.current);
    if (reducido) { setIdx(destino); setFase('quieto'); return; }
    setFase('sale');
    temporizador.current = setTimeout(() => { setIdx(destino); setFase('entra'); }, MS_SALIDA);
  }, [reducido]);

  const n = vistas.length;
  useEffect(() => {
    if (n < 2 || pausa || reducido) return;
    const t = setInterval(() => irA((idx + 1) % n), MS_ROTACION);
    return () => clearInterval(t);
  }, [n, pausa, reducido, idx, irA]);

  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n < 2) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); irA((idx + 1) % n); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); irA((idx + n - 1) % n); }
  };

  const actual = vistas[idx] ?? chip;
  return (
    <span className="rtm-chip-rotativo" data-testid="pulso-proveedor" onMouseEnter={() => setPausa(true)} onMouseLeave={() => setPausa(false)} onFocus={() => setPausa(true)} onBlur={() => setPausa(false)}>
      <span className="rtm-chip-rotativo-vista" data-fase={fase} aria-live="off"><ChipDelPulso chip={actual} /></span>
      {n > 1 && (
        <span className="rtm-chip-rotativo-puntos" role="group" aria-label="Cuenta que se ve" onKeyDown={teclas}>
          {vistas.map((v, i) => (
            <button key={v.clave} type="button" className="rtm-chip-punto" aria-pressed={i === idx} aria-label={`Ver ${v.etiqueta}`} data-testid={`pulso-punto-${v.clave}`} onClick={() => irA(i)} />
          ))}
        </span>
      )}
    </span>
  );
}

export function Pulso({ chips }: { chips: ChipPulso[] }) {
  return (
    <>
      {chips.map((c) => (c.alterno ? <ChipRotativo key={c.clave} chip={c} /> : <ChipDelPulso key={c.clave} chip={c} />))}
    </>
  );
}
