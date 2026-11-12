import { MARCAS } from '@/dominio/marcas';

/** Logo oficial sin alterar: dos <img> (uno por tema) y la clase decide cual se ve. Sin archivo, solo el nombre en texto. Altura fija; el ancho sigue la proporcion. */
export function LogoMarca({ slug, nombre, alto = 20 }: { slug: string | null; nombre: string; alto?: 18 | 20 | 22 }) {
  const m = slug ? MARCAS[slug] : undefined;
  if (!m) return <span className="rtm-marca rtm-marca-texto">{nombre}</span>;
  const base = `/marcas/${m.slug}`;
  if (m.icono) {
    return (
      <span className="rtm-marca">
        <img src={`${base}/${m.icono}`} alt="" width={alto} height={alto} className={`rtm-marca-h${alto}`} />
        <span className="rtm-marca-texto">{m.nombre}</span>
      </span>
    );
  }
  const ancho = Math.round(alto * m.proporcion);
  return (
    <span className="rtm-marca" role="img" aria-label={`Logo de ${m.nombre}`}>
      <img className={`rtm-marca-claro rtm-marca-h${alto}`} src={`${base}/${m.claro}`} alt="" height={alto} width={ancho} />
      <img className={`rtm-marca-oscuro rtm-marca-h${alto}`} src={`${base}/${m.oscuro}`} alt="" height={alto} width={ancho} />
    </span>
  );
}
