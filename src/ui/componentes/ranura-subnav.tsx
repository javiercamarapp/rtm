'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const ID_RANURA = 'rtm-subnav-ranura';

/** Hueco a la derecha de la subnavegacion de una seccion (se pasa como `lateral` de Pestanas en el layout). Las paginas hijas meten ahi sus filtros con `EnSubnav`, para que pestanas y filtros compartan UNA sola linea. */
export function RanuraSubnav() {
  return <div id={ID_RANURA} className="rtm-subnav-ranura" />;
}

/** Lleva sus hijos a la ranura de la subnavegacion del layout. Hasta que la ranura existe (primer pintado en el navegador) no dibuja nada; si el layout no tiene ranura, los hijos quedan donde estan. */
export function EnSubnav({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  const [buscado, setBuscado] = useState(false);
  useEffect(() => { setDestino(document.getElementById(ID_RANURA)); setBuscado(true); }, []);
  if (destino) return createPortal(children, destino);
  return buscado ? <>{children}</> : null;
}
