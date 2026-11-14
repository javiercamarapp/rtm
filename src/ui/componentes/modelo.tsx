import type { ReactNode } from 'react';
import { rutaFotoModelo } from '@/dominio/catalogo/fotos-modelos';

export type TamanoModelo = 'xs' | 's' | 'm';

const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Nombre completo para el texto alternativo: no repite la marca si el modelo ya la trae. */
export function nombreCompletoModelo(modelo: string, marca?: string | null): string {
  if (!marca || marca === 'Sin marca' || norm(modelo).startsWith(norm(marca))) return modelo;
  return `${marca} ${modelo}`;
}

const iniciales = (marca: string | null | undefined, modelo: string): string => {
  const base = marca && marca !== 'Sin marca' ? marca : modelo;
  const p = base.trim().split(/\s+/).filter(Boolean);
  return (p.length > 1 ? (p[0]?.[0] ?? '') + (p[1]?.[0] ?? '') : (p[0] ?? '').slice(0, 2)).toUpperCase() || '·';
};

/** Miniatura unica de un modelo: misma proporcion (4:5), fondo neutro, recorte uniforme y carga diferida en TODAS las pantallas.
 *  La foto se busca por nombre canonico (fotos-modelos.ts). Sin foto muestra un estado vacio sobrio con el monograma de la marca. */
export function ModeloMiniatura({ modelo, marca, tam = 's', testid }: { modelo: string; marca?: string | null; tam?: TamanoModelo; testid?: string }) {
  const ruta = rutaFotoModelo(modelo);
  const nombre = nombreCompletoModelo(modelo, marca);
  return ruta ? (
    <span className="rtm-modelo-foto" data-tam={tam} data-testid={testid}>
      {/* Archivo estatico versionado en public/modelos: no pasa por el optimizador de imagenes (sin costo en Vercel). */}
      <img src={ruta} alt={`Foto de ${nombre}`} loading="lazy" decoding="async" width={640} height={800} />
    </span>
  ) : (
    <span className="rtm-modelo-foto" data-tam={tam} data-vacia="" role="img" aria-label={`Sin foto de ${nombre}`} data-testid={testid}>
      <span aria-hidden="true">{iniciales(marca, modelo)}</span>
      {tam === 'm' && <small aria-hidden="true">Sin foto</small>}
    </span>
  );
}

/** Tarjeta de modelo: miniatura, marca en gris, nombre y un espacio para datos (piezas, estado, precio). Una sola pieza para todas las pantallas. */
export function ModeloTarjeta({ modelo, marca, tam = 's', detalle, acciones, testid }: { modelo: string; marca?: string | null; tam?: TamanoModelo; detalle?: ReactNode; acciones?: ReactNode; testid?: string }) {
  return (
    <div className="rtm-modelo-tarjeta" data-tam={tam} data-testid={testid}>
      <ModeloMiniatura modelo={modelo} marca={marca} tam={tam} />
      <span className="rtm-modelo-texto">
        {marca && marca !== 'Sin marca' && <small>{marca}</small>}
        <strong>{modelo}</strong>
        {detalle && <span className="rtm-modelo-detalle">{detalle}</span>}
      </span>
      {acciones && <span className="rtm-modelo-acciones">{acciones}</span>}
    </div>
  );
}
