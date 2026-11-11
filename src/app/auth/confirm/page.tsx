// Plan alterno del enlace magico en iPhone: el correo apunta aqui con ?token_hash=...&type=...&next=...
// El GET NO consume el enlace; lo consume el boton (POST). Sin PKCE: funciona aunque el correo se abra en otro navegador que el que lo pidio.
import type { Metadata } from 'next';
import Link from 'next/link';
import { MARCA } from '@/config/marca';
import { Logo } from '@/ui/logo/logo';
import { confirmarAcceso } from './acciones';

export const metadata: Metadata = { title: 'Confirmar acceso' };
export const dynamic = 'force-dynamic';

export default async function Pagina({ searchParams }: { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> }) {
  const sp = await searchParams;
  const valido = !!sp.token_hash && (sp.type === 'magiclink' || sp.type === 'email');
  return (
    <main className="rtm-confirmar">
      <div className="rtm-confirmar-tarjeta">
        <Logo alto={26} />
        {valido ? (
          <>
            <h1 className="rtm-confirmar-titulo">Entrar a <em>{MARCA.nombre}</em></h1>
            <p>Pulsa el botón para terminar de entrar. Si no pediste este enlace, ciérralo sin pulsar nada.</p>
            <form action={confirmarAcceso}>
              <input type="hidden" name="token_hash" value={sp.token_hash} />
              <input type="hidden" name="type" value={sp.type} />
              <input type="hidden" name="next" value={sp.next ?? '/'} />
              <button type="submit" className="rtm-boton rtm-boton-primario rtm-confirmar-boton" data-testid="confirmar-acceso">Entrar</button>
            </form>
          </>
        ) : (
          <>
            <h1 className="rtm-confirmar-titulo">Enlace <em>incompleto</em></h1>
            <p>Este enlace no trae lo necesario para entrar. Pide uno nuevo con tu correo.</p>
            <Link className="rtm-boton" href="/login">Ir al inicio de sesión</Link>
          </>
        )}
      </div>
    </main>
  );
}
