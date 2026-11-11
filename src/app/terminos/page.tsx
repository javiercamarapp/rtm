import type { Metadata } from 'next';
import Link from 'next/link';
import { MARCA } from '@/config/marca';

export const metadata: Metadata = { title: 'Términos de Servicio' };

export default function Terminos() {
  return (
    <main className="rtm-documento">
      <h1>Términos de Servicio</h1>
      <p><strong>Borrador provisional.</strong> {MARCA.nombre} es una herramienta interna de la sociedad de sus dos socios. El acceso es solo por invitación y por enlace al correo; no hay registro abierto.</p>
      <ul>
        <li>Cada persona usa únicamente su propio acceso y no comparte enlaces.</li>
        <li>Los registros del libro de eventos no se editan ni se borran: se corrigen con un movimiento enlazado.</li>
        <li>El texto definitivo lo revisará un abogado antes del primer acceso real.</li>
      </ul>
      <p><Link href="/login">Volver al acceso</Link></p>
    </main>
  );
}
