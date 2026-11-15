import { formatearPiezas, nombreVape, saborMayus } from '@/dominio/formato';
import { ModeloMiniatura, nombreCompletoModelo } from './modelo';

/** Un renglon de modelo y sabor. A proposito NO tiene campos de costo ni precio: el componente no puede mostrarlos (Omar y Bodega lo usan igual). */
export interface RenglonSabor { modelo: string; marca?: string | null; sabor: string; piezas: number }

export interface GrupoModelo { modelo: string; marca: string | null; piezas: number; sabores: { sabor: string; piezas: number }[] }

/** Agrupa por modelo (mismo modelo + marca) y ordena por piezas descendente; los sabores repetidos se suman. Solo presenta cifras que ya vienen de la lectura. */
export function agruparPorModelo(renglones: readonly RenglonSabor[]): GrupoModelo[] {
  const grupos = new Map<string, { modelo: string; marca: string | null; sabores: Map<string, number> }>();
  for (const r of renglones) {
    const clave = `${r.marca ?? ''}|${r.modelo}`; // may-ok: clave de agrupacion, no se muestra
    const g = grupos.get(clave) ?? { modelo: r.modelo, marca: r.marca ?? null, sabores: new Map<string, number>() };
    g.sabores.set(r.sabor, (g.sabores.get(r.sabor) ?? 0) + r.piezas);
    grupos.set(clave, g);
  }
  return [...grupos.values()]
    .map((g) => {
      const sabores = [...g.sabores].map(([sabor, piezas]) => ({ sabor, piezas })).sort((a, b) => b.piezas - a.piezas || a.sabor.localeCompare(b.sabor, 'es'));
      return { modelo: g.modelo, marca: g.marca, piezas: sabores.reduce((a, s) => a + s.piezas, 0), sabores };
    })
    .sort((a, b) => b.piezas - a.piezas || a.modelo.localeCompare(b.modelo, 'es'));
}

const textoSabores = (n: number) => `${n} ${n === 1 ? 'sabor' : 'sabores'}`;
const resumen = (g: GrupoModelo) => `${nombreCompletoModelo(nombreVape(g.modelo), g.marca)} · ${formatearPiezas(g.piezas)} · ${textoSabores(g.sabores.length)}`;

function ListaSabores({ g }: { g: GrupoModelo }) {
  return (
    <div className="rtm-ms-scroll" role="group" tabIndex={0} aria-label={`Sabores de ${nombreVape(g.modelo)}`}>
      <ul className="rtm-ms-sabores">
        {g.sabores.map((s) => (
          <li key={s.sabor} title={`${saborMayus(s.sabor)}: ${formatearPiezas(s.piezas)}`}>
            <span className="rtm-ms-sabor">{saborMayus(s.sabor)}</span>
            <span className="rtm-ms-piezas">{formatearPiezas(s.piezas)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CabeceraModelo({ g, tam }: { g: GrupoModelo; tam: 'xs' | 's' }) {
  return (
    <>
      <ModeloMiniatura modelo={g.modelo} marca={g.marca} tam={tam} />
      <span className="rtm-ms-texto">
        <strong className="rtm-ms-nombre">{nombreVape(g.modelo)}</strong>
        <span className="rtm-ms-meta">{formatearPiezas(g.piezas)} · {textoSabores(g.sabores.length)}</span>
      </span>
    </>
  );
}

/** Lista completa: una linea por modelo y sus sabores en sub-lista colapsable (cerrada por omision con mas de `abrirHasta` sabores). */
function Lista({ grupos, abrirHasta }: { grupos: GrupoModelo[]; abrirHasta: number }) {
  return (
    <ul className="rtm-ms-modelos">
      {grupos.map((g) => (
        <li key={`${g.marca ?? ''}|${g.modelo}`}>
          <details className="rtm-ms-modelo" open={g.sabores.length <= abrirHasta}>
            <summary title={resumen(g)}>
              <CabeceraModelo g={g} tam="s" />
              <span className="rtm-ms-chevron" aria-hidden="true" />
            </summary>
            <ListaSabores g={g} />
          </details>
        </li>
      ))}
    </ul>
  );
}

export interface PropsModelosSabores {
  renglones: readonly RenglonSabor[];
  /** 'lista' = bloque completo; 'celda' = una sola linea compacta que se expande en linea (para tablas). */
  variante?: 'lista' | 'celda';
  /** Con mas sabores que esto, la sub-lista de cada modelo arranca cerrada. */
  abrirHasta?: number;
  vacio?: string;
  testid?: string;
}

/**
 * Modelos y sabores de un pedido, orden o paquete. Una pieza para todas las pantallas: miniatura, modelo, total de piezas y numero de sabores,
 * y los sabores en columnas alineadas (cifras tabulares) ordenados por piezas. Solo piezas: nunca costos ni precios.
 */
export function ModelosSabores({ renglones, variante = 'lista', abrirHasta = 4, vacio = 'Sin renglones', testid }: PropsModelosSabores) {
  const grupos = agruparPorModelo(renglones);
  if (grupos.length === 0) return <span className="rtm-ms-vacio" data-testid={testid}>{vacio}</span>;
  if (variante === 'lista') return <div className="rtm-ms" data-variante="lista" data-testid={testid}><Lista grupos={grupos} abrirHasta={abrirHasta} /></div>;
  const [principal, ...resto] = grupos as [GrupoModelo, ...GrupoModelo[]];
  const totalPiezas = grupos.reduce((a, g) => a + g.piezas, 0);
  const totalSabores = grupos.reduce((a, g) => a + g.sabores.length, 0);
  const titulo = grupos.map(resumen).join('\n');
  return (
    <div className="rtm-ms" data-variante="celda" data-testid={testid}>
      <details className="rtm-ms-celda">
        <summary title={titulo} aria-label={`${resto.length ? `${grupos.length} modelos, ${formatearPiezas(totalPiezas)}, ${textoSabores(totalSabores)}` : resumen(principal)}. Ver sabores`}>
          <CabeceraModelo g={principal} tam="xs" />
          {resto.length > 0 && <span className="rtm-ms-mas">+{resto.length} {resto.length === 1 ? 'modelo' : 'modelos'}</span>}
          <span className="rtm-ms-ver" aria-hidden="true"><span data-estado="cerrado">Ver sabores</span><span data-estado="abierto">Ocultar</span></span>
        </summary>
        <Lista grupos={grupos} abrirHasta={abrirHasta} />
      </details>
    </div>
  );
}
