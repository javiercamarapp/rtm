import { redirect } from 'next/navigation';
import { destinoSeguro } from '@/dominio/acceso/ruta_segura';
import { mensajeDeError } from '@/dominio/acceso/motivo_login';
import { correoRecordado, ipDentroDelLimite, pedirEnlace, reenviarEnlace } from '@/composicion/acceso';
import { MARCA } from '@/config/marca';
import { Logo, LogoMarca } from '@/ui/logo/logo';
import { LoginArtwork } from '@/ui/login/artwork';
import { respuestaOtp, conPisoDeTiempo } from './respuesta_otp';
import { BotonLogin } from './boton-login';
import { fraunces, instrument, plexMono } from './fuentes';
import './login.css';
import './login-tokens.css';

// Titulo de la pestana: el nombre del menu; la plantilla del layout raiz agrega « · RTM».
export const metadata = { title: 'Iniciar sesión' };

export const dynamic = 'force-dynamic';

// El anti-oraculo vive en `respuesta_otp.ts`: solo un conjunto cerrado de fallos que NO dependen de la cuenta sale como error.
// Ningun correo se da de alta aqui: las cuentas las crea el script local de alta (shouldCreateUser: false en el autenticador).

export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; enviado?: string; reenviado?: string; otro?: string; espera?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const next = destinoSeguro(sp?.next);
  // El correo al que se pidio el enlace, solo para decirlo en la pantalla de «enviado» (lo guardo ESTE navegador al pedirlo).
  const correoEnviado = sp?.enviado ? await correoRecordado() : null;

  async function entrarConEmail(formData: FormData) {
    'use server';
    const dest = destinoSeguro(String(formData.get('next') ?? '/'));
    // Al exceder el limite por IP se responde el error GENERICO, no «vas muy rapido»: la diferencia le diria a quien prueba correos cuando dejo de contar.
    if (!(await ipDentroDelLimite())) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    const email = String(formData.get('email') ?? '').trim();
    if (!email) redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    // La respuesta es identica en TEXTO y en TIEMPO para un correo con cuenta y uno sin ella (piso de 1,500 ms). Los topes por correo
    // y globales viven dentro de `pedirEnlace`: al excederse NO se manda nada y se responde igual que un envio exitoso.
    const { error } = await conPisoDeTiempo(() => pedirEnlace(email, dest));
    if (respuestaOtp(error) === 'error') redirect(`/login?next=${encodeURIComponent(dest)}&error=1`);
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1`);
  }

  // «Reenviar el enlace» de la pantalla de enviado: un enlace nuevo al correo que ESTE navegador pidio, con sus dos frenos.
  // Como el formulario, NO distingue «el correo no tiene cuenta» de «salio».
  async function reenviarEnlaceAccion(formData: FormData) {
    'use server';
    const dest = destinoSeguro(String(formData.get('next') ?? '/'));
    if (!(await correoRecordado())) redirect(`/login?next=${encodeURIComponent(dest)}`);
    const r = await reenviarEnlace(dest);
    redirect(`/login?next=${encodeURIComponent(dest)}&enviado=1&${r === 'reciente' ? 'espera=1' : 'otro=1'}`);
  }

  // Dos columnas: a la IZQUIERDA el panel oscuro con el arte animado (`LoginArtwork`) y a la DERECHA el formulario. El panel solo se
  // muestra desde 1024 px; en el telefono la pantalla es solo el formulario. Sin `style=`: retardos de entrada y tamanos viven en login.css.
  return (
    <main className={`login tema-neutro ${fraunces.variable} ${instrument.variable} ${plexMono.variable}`}>
      {/* ── COLUMNA DEL FORMULARIO ── */}
      <section className="login-column">
        <div className="login-inner">
          <header className="login-entra login-d0 auth-brand">
            <Logo alto={24} />
          </header>

          <div className="login-copy">
            <p className="login-entra login-d1 login-kicker">Acceso</p>
            <h1 className="login-entra login-d2 login-serif login-h1">Bienvenido a {MARCA.nombre}</h1>
            <p className="login-entra login-d3 login-intro">{MARCA.descripcion}</p>

            {/* LA PANTALLA DE «ENVIADO» ES UNA SOLA TARJETA: a quien se mando, que se abre desde este mismo dispositivo y las dos salidas
                (reenviar o usar otro correo). El dedazo en el correo sigue teniendo salida —«Usar otro correo»—, porque el correo sin cuenta
                se responde igual que el enviado y ese es el modo de falla mas comun del enlace magico. */}
            {sp?.enviado ? (
              <>
                <div className="login-entra login-d4 login-divider" />
                <div role="status" className="login-entra login-d5 login-tarjeta">
                  <p className="login-tarjeta-titulo">
                    {sp?.reenviado
                      ? 'Ese enlace ya se había usado o caducado — te mandamos uno nuevo.'
                      : sp?.espera
                        ? 'Ya te mandamos un enlace hace un momento.'
                        : sp?.otro
                          ? 'Te mandamos otro enlace.'
                          : 'Te mandamos un enlace a tu correo.'}
                  </p>
                  {correoEnviado && <p className="login-tarjeta-correo">{correoEnviado}</p>}
                  <p className="login-tarjeta-texto">
                    {sp?.espera
                      ? 'Revisa tu bandeja y la carpeta de spam; podrás pedir otro en unos minutos.'
                      : 'Ábrelo desde este mismo dispositivo y entras. Sirve una vez y caduca en 1 hora.'}
                  </p>
                </div>
                <div className="login-entra login-d6 login-salidas">
                  {correoEnviado && (
                    <form action={reenviarEnlaceAccion}>
                      <input type="hidden" name="next" value={next} />
                      <BotonLogin className="login-btn login-btn-borde" ocupado="Solicitando…">Reenviar el enlace</BotonLogin>
                    </form>
                  )}
                  <a href={`/login?next=${encodeURIComponent(next)}`} className="login-enlace login-enlace-centro">
                    Usar otro correo
                  </a>
                </div>
              </>
            ) : (
              <>
                <div className="login-entra login-d4 login-divider" />

                <form action={entrarConEmail} className="login-entra login-d6 login-email login-email-solo">
                  <input type="hidden" name="next" value={next} />
                  <label htmlFor="login-email" className="sr-only">Tu correo</label>
                  <input
                    id="login-email"
                    name="email"
                    type="email"
                    required
                    placeholder="tu@correo.com"
                    autoComplete="email"
                    className="login-campo"
                  />
                  {/* EL BOTON CON EL GESTO: la marca de RTM asoma dentro de la pildora al pasar el cursor (del color del texto del boton). */}
                  <BotonLogin className="login-btn login-btn-tinta" ocupado="Solicitando…" glifo={(
                    <span aria-hidden className="login-glifo">
                      <LogoMarca alto={17} />
                    </span>
                  )}>
                    Continuar con correo
                  </BotonLogin>
                </form>

                <p className="login-entra login-d7 login-aviso">
                  ¿Tu correo no tiene acceso?{' '}
                  <strong>Pídele a un socio que te dé de alta.</strong>
                </p>
              </>
            )}

            {/* `role="alert"`: quien usa lector de pantalla se entera de que el envio fallo. El TEXTO depende del motivo (`mensajeDeError`). */}
            {sp?.error && <p role="alert" className="login-error">{mensajeDeError(sp.error)}</p>}

            {/* Los DOS, no solo privacidad: aqui es donde se acepta el contrato. */}
            <p className="login-entra login-d8 login-legal">
              Al continuar, aceptas los{' '}
              <a href="/terminos" className="login-enlace">Términos de Servicio</a>{' '}
              y el{' '}
              <a href="/privacidad" className="login-enlace">Aviso de Privacidad</a>{' '}
              de {MARCA.nombre}.
            </p>
          </div>
        </div>
      </section>

      {/* ── EL PANEL DEL ARTE ─────────────────────────────────────────────────
          Oculto por debajo de 1024 px (`display: none` en login.css): en el telefono no hay panel que aplaste el formulario, no se
          descarga el motor del arte y no lo lee un lector de pantalla. El texto es literal de lo que el producto ES: cero cifras, cero promesas. */}
      <aside className="login-visual" aria-label={MARCA.nombre}>
        <div className="login-story-surface">
          <div className="login-story-copy">
            <p className="login-kicker">{MARCA.nombre} · {MARCA.descripcion}</p>
            <h2 className="login-serif">{MARCA.eslogan}</h2>
            <p className="login-story-description">
              Pedidos con su nota, inventario con kárdex y cuentas claras con proveedores, socios y bodega.
            </p>
          </div>
          <LoginArtwork />
        </div>
      </aside>
    </main>
  );
}
