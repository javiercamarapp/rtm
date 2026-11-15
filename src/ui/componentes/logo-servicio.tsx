'use client';
import { useEffect, useRef, useState } from 'react';
import { logoDeServicio } from '@/dominio/marcas';
import { inicialesServicio } from '@/dominio/costos/lista-servicios';

export interface PropsLogoServicio {
  /** Slug del servicio (costos.servicio.slug). */
  slug: string | null | undefined;
  /** logo_slug de la base, solo como respaldo cuando el slug no tiene logo propio. */
  logoSlug?: string | null;
  nombre: string;
  /** Diametro en px: 36 en listas y tablas, 40 en encabezados. */
  tamano?: 36 | 40;
  /** Dibuja el nombre al lado, alineado al centro vertical del avatar. */
  conNombre?: boolean;
}

/** Avatar circular de un servicio o proveedor (como una foto de perfil): simbolo oficial centrado y contenido sobre fondo claro fijo con anillo fino.
 *  Si falta el archivo o no carga, muestra un monograma sobrio. Mismo tamano y alineacion en todas las pantallas. */
export function LogoServicio({ slug, logoSlug = null, nombre, tamano = 36, conNombre = false }: PropsLogoServicio) {
  const logo = logoDeServicio(slug, logoSlug);
  const [roto, setRoto] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // Si la imagen fallo antes de hidratar, el evento onError ya paso: se revisa el estado real del elemento.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setRoto(true);
  }, []);
  const mostrarImagen = !!logo && !roto;
  const avatar = mostrarImagen ? (
    <span className="rtm-logo-serv" data-tamano={tamano} data-sangrado={logo.sangrado || undefined} data-origen={logo.origen}>
      <img ref={img} src={`/logos/${logo.archivo}`} alt={`Logo de ${nombre}`} width={tamano} height={tamano} loading="lazy" decoding="async" onError={() => setRoto(true)} />
    </span>
  ) : (
    <span className="rtm-logo-serv rtm-logo-serv-mono" data-tamano={tamano} role="img" aria-label={`Logo de ${nombre}`}>
      <span aria-hidden="true">{inicialesServicio(nombre)}</span>
    </span>
  );
  if (!conNombre) return avatar;
  return (
    <span className="rtm-logo-serv-fila">
      {avatar}
      <span className="rtm-logo-serv-nombre">{nombre}</span>
    </span>
  );
}
