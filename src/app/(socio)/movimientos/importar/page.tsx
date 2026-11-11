import type { Metadata } from 'next';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { Importador } from '../importador';

export const metadata: Metadata = { title: 'Importar movimientos' };

export default function Pagina() {
  return (
    <>
      <EncabezadoPagina
        eyebrow="Movimientos · captura cruda"
        antes="Pega o sube los"
        enfasis="movimientos"
        contexto="Cada fila se guarda tal cual llegó, sin clasificar, con una huella para no duplicarla si vuelves a importar el mismo archivo. Una fila sin clasificar no afecta ningún saldo."
      />
      <Importador />
    </>
  );
}
