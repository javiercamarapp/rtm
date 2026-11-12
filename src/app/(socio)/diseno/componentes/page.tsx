import type { Metadata } from 'next';
import { Galeria } from '@/ui/galeria/galeria';

export const metadata: Metadata = { title: 'Componentes' };

export default function CatalogoComponentes() {
  return <Galeria />;
}
