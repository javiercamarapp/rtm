import type { Metadata } from 'next';
import { VistaKardex } from '../../../_a2/vista-kardex';
import type { Params } from '../../../_a2/util';

export const metadata: Metadata = { title: 'Kárdex por sabor' };

export default async function Pagina({ searchParams }: { searchParams: Promise<Params> }) {
  return <VistaKardex sp={await searchParams} modo="sabor" />;
}
