import { MARCAS } from '@/dominio/marcas';

/** Logo oficial sin alterar: dos <img> (uno por tema) y la clase decide cual se ve. Sin archivo, solo el nombre en texto. Altura fija; el ancho sigue la proporcion. */
export function LogoMarca({ slug, nombre, alto = 20 }: { slug: string | null; nombre: string; alto?: number }) {
  const m = slug ? MARCAS[slug] : undefined;
  if (!m) return <span className="rtm-marca rtm-marca-texto">{nombre}</span>;
  const base = `/marcas/${m.slug}`;
  if (m.icono) {
    return (
      <span className="rtm-marca">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}/${m.icono}`} alt="" width={alto} height={alto} style={{ height: alto, width: alto }} />
        <span className="rtm-marca-texto">{m.nombre}</span>
      </span>
    );
  }
  const ancho = Math.round(alto * m.proporcion);
  return (
    <span className="rtm-marca" role="img" aria-label={`Logo de ${m.nombre}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rtm-marca-claro" src={`${base}/${m.claro}`} alt="" height={alto} width={ancho} style={{ height: alto, width: 'auto' }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rtm-marca-oscuro" src={`${base}/${m.oscuro}`} alt="" height={alto} width={ancho} style={{ height: alto, width: 'auto' }} />
    </span>
  );
}
