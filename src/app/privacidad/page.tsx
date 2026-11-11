import type { Metadata } from 'next';
import Link from 'next/link';
import { MARCA } from '@/config/marca';

export const metadata: Metadata = { title: 'Aviso de Privacidad' };

export default function Privacidad() {
  return (
    <main className="rtm-documento">
      <h1>Aviso de Privacidad</h1>
      <p><strong>Borrador provisional.</strong> {MARCA.nombre} guarda solo lo necesario para operar la bodega: el correo de cada persona autorizada, su rol y el registro de sus acciones.</p>
      <ul>
        <li>No se guardan teléfonos ni direcciones de clientes de mayoreo.</li>
        <li>Los correos de acceso viven en la base de datos del proyecto y no se comparten con terceros.</li>
        <li>El texto definitivo lo revisará un abogado antes del primer acceso real.</li>
      </ul>
      <p><Link href="/login">Volver al acceso</Link></p>
    </main>
  );
}
