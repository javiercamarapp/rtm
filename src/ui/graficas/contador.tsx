'use client';

// A05 contador de cifra. Con movimiento completo la cifra sube hasta su valor (600 ms, salida suave); con reducido o apagado
// se pinta el valor final de inmediato. Los lectores de pantalla reciben siempre el valor final (el conteo no se anuncia).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DURACIONES_MS } from '../movimiento';
import { useAnimacionActiva } from '../movimiento/cliente';
import { interpolar } from './geo';
import { textoCifra, type TipoCifra } from './formato';

interface Props {
  /** `moneda` en centavos enteros; `piezas` y `entero` enteros. */
  valor: number;
  tipo?: TipoCifra;
  decimales?: number;
  className?: string;
}

const useEfectoVisual = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function Contador({ valor, tipo = 'entero', decimales = 0, className }: Props) {
  const anima = useAnimacionActiva();
  const [mostrado, setMostrado] = useState(valor);
  const previo = useRef<number | null>(null);

  useEfectoVisual(() => {
    const desde = previo.current ?? 0;
    previo.current = valor;
    if (!anima || desde === valor) {
      setMostrado(valor);
      return;
    }
    let cuadro = 0;
    let inicio: number | null = null;
    setMostrado(desde);
    const paso = (ts: number) => {
      inicio ??= ts;
      const t = (ts - inicio) / DURACIONES_MS.maximo;
      if (t >= 1) {
        setMostrado(valor);
        return;
      }
      setMostrado(interpolar(desde, valor, t));
      cuadro = window.requestAnimationFrame(paso);
    };
    cuadro = window.requestAnimationFrame(paso);
    return () => window.cancelAnimationFrame(cuadro);
  }, [valor, anima]);

  const final = textoCifra(valor, tipo, decimales);
  return (
    <span className={className ? `rtm-g-contador rtm-num ${className}` : 'rtm-g-contador rtm-num'} data-cifra={tipo}>
      <span aria-hidden="true">{textoCifra(mostrado, tipo, decimales)}</span>
      <span className="rtm-solo-lectores">{final}</span>
    </span>
  );
}
