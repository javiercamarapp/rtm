import type { Metadata } from 'next';
import { EncabezadoPagina, Pagina } from '@/ui/componentes/pagina';
import { Importador } from '../importador';

export const metadata: Metadata = { title: 'Importar movimientos' };

export default function PaginaImportar() {
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Movimientos · captura cruda"
        titulo="Pega o sube los movimientos"
        descripcion="Cada fila se guarda tal cual llegó, sin clasificar, con una huella para no duplicarla si importas el mismo archivo."
      />
      <Importador />
    </Pagina>
  );
}
