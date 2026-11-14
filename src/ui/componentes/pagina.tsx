import Link from 'next/link';
import type { ReactNode } from 'react';
import { indiceEscalonado } from '../movimiento';
import { Ayuda } from './ayuda';

interface EncabezadoProps {
  eyebrow?: string;
  /** Titular nuevo. Si falta se arma con antes + enfasis + despues (legado, texto plano sin cursiva). */
  titulo?: string;
  antes?: string;
  enfasis?: string;
  despues?: string;
  /** Una linea de 120 caracteres como maximo; lo demas va en `ayuda`. `contexto` es el nombre anterior. */
  descripcion?: string;
  contexto?: string;
  /** Texto largo que no cabe en la descripcion: se muestra en un details cerrado debajo de la linea (nada se pierde). */
  ayuda?: ReactNode;
  /** Resumen del details de `ayuda` (por omision "Cómo se lee"). */
  ayudaResumen?: string;
  acciones?: ReactNode;
  /** Detalle: enlace "Volver a ...". */
  migaja?: { href: string; texto: string };
}

/** Anatomia de pagina v2: migaja opcional, eyebrow, titular de 24/600, descripcion de una linea y acciones a la derecha (una sola primaria). */
export function EncabezadoPagina({ eyebrow, titulo, antes, enfasis, despues, descripcion, contexto, ayuda, ayudaResumen, acciones, migaja }: EncabezadoProps) {
  const texto = titulo ?? [antes, enfasis, despues].filter(Boolean).join(' ');
  const linea = descripcion ?? contexto;
  return (
    <header className="rtm-encabezado rtm-entra rtm-i-0">
      <div className="rtm-encabezado-copia">
        {migaja && <Link className="rtm-migaja" href={migaja.href}>← {migaja.texto}</Link>}
        {eyebrow && <p className="rtm-eyebrow">{eyebrow}</p>}
        <h1 className="rtm-titular">{texto}</h1>
        {linea && <p className="rtm-contexto">{linea}</p>}
        {ayuda && <Ayuda resumen={ayudaResumen}>{ayuda}</Ayuda>}
      </div>
      {acciones && <div className="rtm-encabezado-acciones">{acciones}</div>}
    </header>
  );
}

/** Contenedor de pagina con ancho segun el tipo de pantalla y ritmo de 12 px entre bloques. */
export function Pagina({ ancho = 'normal', children }: { ancho?: 'tablero' | 'normal' | 'formulario' | 'nota'; children: ReactNode }) {
  return <div className="rtm-pagina-v2" data-ancho={ancho}>{children}</div>;
}

interface TarjetaProps {
  titulo?: string;
  descripcion?: string;
  acciones?: ReactNode;
  /** Sin relleno: para tablas a sangre. */
  plana?: boolean;
  /** Tarjeta enlace: sube 1 px al pasar el cursor. */
  elevable?: boolean;
  como?: 'section' | 'article' | 'div';
  className?: string;
  children: ReactNode;
}

/** Tarjeta base: borde de 1 px, radio 12, sin sombra ni degradado; cabecera con titulo, descripcion y acciones. */
export function Tarjeta({ titulo, descripcion, acciones, plana, elevable, como: Etiqueta = 'section', className = '', children }: TarjetaProps) {
  return (
    <Etiqueta className={`rtm-tarjeta-v2 ${className}`.trim()} data-plana={plana || undefined} data-elevable={elevable || undefined} aria-label={titulo}>
      {(titulo || acciones) && (
        <header className="rtm-tarjeta-v2-cab">
          <div>
            {titulo && <h2>{titulo}</h2>}
            {descripcion && <p>{descripcion}</p>}
          </div>
          {acciones && <div className="rtm-tarjeta-v2-acc">{acciones}</div>}
        </header>
      )}
      {children}
    </Etiqueta>
  );
}

/** Rejilla de 12 columnas con alturas igualadas; apila a una columna en <= 1000 px. */
export function Rejilla({ dividir, alinear = 'estirar', children }: { dividir: '12' | '8-4' | '4-8' | '6-6' | '9-3' | '4-4-4' | '3-3-3-3'; alinear?: 'estirar' | 'inicio'; children: ReactNode }) {
  return <div className="rtm-rejilla" data-dividir={dividir} data-alinear={alinear}>{children}</div>;
}

/** Estado vacio con explicacion y, si la hay, una accion. Nunca un cero inventado. */
export function EstadoVacio({ titulo, texto, children, indice = 1 }: { titulo: string; texto: string; children?: ReactNode; indice?: number }) {
  return (
    <section className={`rtm-vacio rtm-entra rtm-i-${indiceEscalonado(indice)}`} aria-labelledby="vacio-titulo">
      <h2 id="vacio-titulo">{titulo}</h2>
      <p>{texto}</p>
      {children}
    </section>
  );
}

/** Error recuperable con accion de reintento. La ausencia de dato nunca se pinta como error. */
export function EstadoError({ texto, accion }: { texto: string; accion?: ReactNode }) {
  return (
    <div className="rtm-estado-error" role="alert">
      <strong>No se pudo cargar</strong>
      <p>{texto}</p>
      {accion}
    </div>
  );
}
