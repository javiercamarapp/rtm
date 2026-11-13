import { MARCAS } from '@/dominio/marcas';
import { inicialesServicio } from '@/dominio/costos/lista-servicios';

/** Casilla de logo de tamano FIJO (28 px cuadrados, mismo espacio para todos): icono oficial si existe, y si no, monograma sobrio. Los logotipos horizontales se ven en la ficha del servicio. */
export function IconoServicio({ slug, nombre }: { slug: string | null; nombre: string }) {
  const m = slug ? MARCAS[slug] : undefined;
  return (
    <span className="rtm-serv-icono" aria-hidden="true">
      {m?.icono ? <img src={`/marcas/${m.slug}/${m.icono}`} alt="" width={20} height={20} /> : <span className="rtm-serv-monograma">{inicialesServicio(nombre)}</span>}
    </span>
  );
}
