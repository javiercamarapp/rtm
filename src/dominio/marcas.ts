// Logos de los servicios que cobran por el sistema (ver docs/logos-servicios.md para procedencia y notas de marca registrada).
// Un solo archivo por servicio, siempre el ISOTIPO (simbolo) y no el logotipo horizontal; se muestran dentro de un avatar circular de fondo claro fijo.
export interface LogoDeServicio {
  /** Archivo dentro de /logos/. */
  readonly archivo: string;
  /** 'oficial': simbolo publicado por la empresa. 'generico': icono neutro porque el servicio no es de un proveedor unico o no se conoce. */
  readonly origen: 'oficial' | 'generico';
  /** El simbolo ya es un circulo o un cuadrado que llena su campo: se muestra sin margen interno. */
  readonly sangrado?: boolean;
}

/** Por slug de servicio de costos.servicio (y, como respaldo, por logo_slug). */
export const LOGOS_SERVICIO: Readonly<Record<string, LogoDeServicio>> = {
  github: { archivo: 'github.svg', origen: 'oficial' },
  openrouter: { archivo: 'openrouter.svg', origen: 'oficial' },
  openrouter_comision: { archivo: 'openrouter.svg', origen: 'oficial' },
  resend: { archivo: 'resend.svg', origen: 'oficial' },
  supabase: { archivo: 'supabase.svg', origen: 'oficial' },
  vercel: { archivo: 'vercel.svg', origen: 'oficial' },
  telegram: { archivo: 'telegram.svg', origen: 'oficial', sangrado: true },
  higgsfield: { archivo: 'higgsfield.webp', origen: 'oficial', sangrado: true },
  claude_max: { archivo: 'claude.svg', origen: 'oficial' },
  anthropic: { archivo: 'claude.svg', origen: 'oficial' },
  dominio: { archivo: 'vercel.svg', origen: 'oficial' },
  transcripcion: { archivo: 'transcripcion.svg', origen: 'generico' },
};

/** Logo de un servicio: primero por su slug y, si no esta, por el logo_slug que trae la base. Sin coincidencia: null (el avatar usa monograma). */
export function logoDeServicio(servicioSlug: string | null | undefined, logoSlug?: string | null): LogoDeServicio | null {
  return (servicioSlug ? LOGOS_SERVICIO[servicioSlug] : undefined) ?? (logoSlug ? LOGOS_SERVICIO[logoSlug] : undefined) ?? null;
}

export const PIE_DE_MARCAS = 'Las marcas pertenecen a sus titulares; se muestran solo para identificar el servicio, sin implicar patrocinio. Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries. Supabase es marca de Supabase Inc. GitHub, Invertocat y Octocat son marcas registradas de GitHub, Inc. Claude y Anthropic son marcas de Anthropic, PBC; Telegram es marca de Telegram FZ-LLC; OpenRouter, Resend y Higgsfield son marcas de sus respectivos titulares.';
