# Logos de servicios (Costos del sistema)

Descargados el 14-nov-2026 con un agente de usuario generico, una solicitud por segundo, sin autenticacion, despues de revisar el robots.txt de cada sitio (todos permiten el acceso). Se usa el ISOTIPO (simbolo), no el logotipo horizontal. Un solo archivo por servicio en `public/logos/`; el mapa servicio -> archivo vive en `src/dominio/marcas.ts` (`LOGOS_SERVICIO`) y el componente es `src/ui/componentes/logo-servicio.tsx`.

El avatar es circular con fondo claro fijo en ambos temas (los simbolos son negros o de color), por eso no hay variante por tema. Telegram y Higgsfield llenan el circulo (`sangrado`) porque su simbolo ya es un circulo o un cuadrado de color.

| Servicio (slug) | Archivo | Origen publico | Modificacion |
|---|---|---|---|
| GitHub (`github`) | `github.svg` | https://brand.github.com/GitHub_Logos.zip, `GitHub_Invertocat_Black.svg` (guia: https://brand.github.com/foundations/logo) | Ninguna |
| OpenRouter (`openrouter`, `openrouter_comision`) | `openrouter.svg` | https://openrouter.ai/brand/logos/transparent/glyph/svg/glyph-ink.svg (guia: https://openrouter.ai/brand) | Ninguna |
| Resend (`resend`) | `resend.svg` | https://cdn.resend.com/brand/resend-icon-black.svg (guia: https://resend.com/brand) | Solo el `viewBox` (de 1800x1800 a 450 450 900 900) para quitar el margen vacio del archivo; el dibujo no cambia |
| Supabase (`supabase`) | `supabase.svg` | https://supabase.com/brand-assets/supabase-icon-green-transparent.svg (guia: https://supabase.com/brand) | Ninguna |
| Vercel (`vercel`) | `vercel.svg` | https://vercel.com/geist/brands/assets/vercel-symbol-black.svg (guia: https://vercel.com/geist/brands) | Ninguna |
| Telegram (`telegram`) | `telegram.svg` | https://telegram.org/img/t_logo.svg | Ninguna |
| Higgsfield (`higgsfield`) | `higgsfield.webp` | https://higgsfield.ai/icon.png (icono que el propio sitio publica como favicon; Higgsfield no tiene kit de marca) | PNG de 192 px convertido a webp de 128 px (2.6 KB) |
| Claude Max (`claude_max`; tambien `anthropic`) | `claude.svg` | Kit de prensa de Anthropic, https://www.anthropic.com/press-kit (zip), `Claude Spark - Clay.svg` | Ninguna |
| Dominio (`dominio`) | `dominio.svg` | Icono generico (globo), sin proveedor: el catalogo no dice quien registra el dominio. Trazo propio basado en el icono `globe` de Lucide (licencia ISC, https://lucide.dev) | Es un icono neutro, no una marca |
| Transcripcion de audio (`transcripcion`) | `transcripcion.svg` | Icono generico (microfono): el catalogo solo dice que es audio medido en el libro propio; el modelo (`openai/whisper-large-v3-turbo`) se llama por OpenRouter, asi que no hay proveedor unico. Basado en el icono `mic` de Lucide (ISC) | Es un icono neutro, no una marca |

## Pendientes y limites

- Dominio y Transcripcion de audio muestran un icono neutro. Si el dueno confirma el registrador del dominio, o que la transcripcion se factura a un proveedor concreto, se cambia solo la fila de `LOGOS_SERVICIO` y se agrega el archivo.
- OpenAI (Whisper) no se descargo: openai.com/brand y sus favicon responden con una pagina de verificacion anti-robots y no se la eludio.
- Los archivos se usan tal cual los publica cada empresa (salvo lo indicado). Declaracion del dueno: tiene licencias de uso; no esta verificada.

## Marcas registradas

Las marcas pertenecen a sus titulares y se muestran solo para identificar el servicio, sin implicar patrocinio ni afiliacion. GitHub, Invertocat y Octocat son marcas registradas de GitHub, Inc. Vercel y el triangulo de Vercel son marcas de Vercel, Inc. Supabase es marca de Supabase Inc. Claude y Anthropic son marcas de Anthropic, PBC. Telegram es marca de Telegram FZ-LLC. OpenRouter, Resend y Higgsfield son marcas de sus respectivos titulares. El texto de pie visible en la pagina esta en `PIE_DE_MARCAS`.
