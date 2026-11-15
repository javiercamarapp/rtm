import { PaginaCargando } from '@/ui/componentes/estado-pagina';

/** Arranque de la app y rutas sin su propio loading: logo de RTM centrado sobre el fondo del tema (sin texto). */
export default function Cargando() {
  return (
    <main className="rtm-documento" id="contenido">
      <PaginaCargando etiqueta="Cargando" completa />
    </main>
  );
}
