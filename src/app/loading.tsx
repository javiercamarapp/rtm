import { PaginaCargando } from '@/ui/componentes/estado-pagina';

export default function Cargando() {
  return (
    <main className="rtm-documento" id="contenido">
      <PaginaCargando etiqueta="Cargando RTM" />
    </main>
  );
}
