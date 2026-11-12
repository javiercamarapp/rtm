// Marcas de los servicios que cobran por el sistema. Los archivos son los oficiales y no se alteran: se elige la variante monocroma (negra en tema claro, blanca en oscuro).
// Higgsfield no publica kit de marca: solo su icono (que el propio sitio publica) junto al nombre en texto.
export interface MarcaServicio {
  readonly slug: string;
  readonly nombre: string;
  /** Archivos relativos a /marcas/<slug>/. `claro` se usa en tema claro (logo oscuro) y `oscuro` en tema oscuro (logo claro). */
  readonly claro: string | null;
  readonly oscuro: string | null;
  /** Solo icono (sin variante por tema). */
  readonly icono: string | null;
  /** Relacion ancho/alto del viewBox, para fijar el espacio y evitar saltos. */
  readonly proporcion: number;
}

export const MARCAS: Readonly<Record<string, MarcaServicio>> = {
  supabase: { slug: 'supabase', nombre: 'Supabase', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 581 / 113 },
  vercel: { slug: 'vercel', nombre: 'Vercel', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 261 / 52 },
  resend: { slug: 'resend', nombre: 'Resend', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 1978 / 420 },
  openrouter: { slug: 'openrouter', nombre: 'OpenRouter', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 1024 / 169 },
  github: { slug: 'github', nombre: 'GitHub', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 416 / 95 },
  anthropic: { slug: 'anthropic', nombre: 'Anthropic', claro: 'negro.svg', oscuro: 'blanco.svg', icono: null, proporcion: 590 / 68 },
  higgsfield: { slug: 'higgsfield', nombre: 'Higgsfield', claro: null, oscuro: null, icono: 'icono.png', proporcion: 1 },
};

export const PIE_DE_MARCAS = 'Las marcas pertenecen a sus titulares; se muestran solo para identificar el servicio, sin implicar patrocinio. Vercel, the Vercel design, Next.js and related marks, designs and logos are trademarks or registered trademarks of Vercel, Inc. or its affiliates in the US and other countries. Supabase es marca de Supabase Inc. GitHub, Invertocat y Octocat son marcas registradas de GitHub, Inc.';
