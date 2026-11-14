import { formatearEntero } from '@/dominio/formato';
import { disponibles, estadoDisponibilidad, hace, iniciales, nombreVisible, type EstadoDisponibilidad, type ModeloTablero } from '@/dominio/proveedores/tablero';

export const TEXTO_DISPONIBILIDAD: Record<EstadoDisponibilidad, string> = { disponible: 'Disponible', poca: 'Poca variedad', agotado: 'Agotado', sin_dato: 'Sin detalle de sabores' };

/** Indicador de disponibilidad: punto + palabra. El color nunca va solo. */
export function IndicadorDisponibilidad({ estado }: { estado: EstadoDisponibilidad }) {
  return <span className="rtm-kr-disp" data-estado={estado}><i aria-hidden="true" />{TEXTO_DISPONIBILIDAD[estado]}</span>;
}

/** Foto uniforme (4:3, contenida). Sin foto: marcador neutro con las iniciales de la marca. Nunca se enlaza una imagen externa. */
export function FotoVape({ src, marca, nombre, tamano = 'normal' }: { src: string | null; marca: string; nombre: string; tamano?: 'normal' | 'grande' }) {
  return (
    <div className="rtm-kr-foto" data-tamano={tamano} data-sin-foto={src ? undefined : true}>
      {src ? (
        /* Imagen local ya optimizada por el script (webp, 800 px); sin loader de Next. */
        <img src={src} alt={`${marca} ${nombre}`} loading="lazy" decoding="async" width={800} height={600} />
      ) : (
        <span aria-hidden="true">{iniciales(marca)}</span>
      )}
    </div>
  );
}

export interface PropsTarjeta {
  modelo: ModeloTablero;
  foto: string | null;
  caladas: boolean;
  ahora: Date;
  abierta: boolean;
  /** Retraso de la entrada escalonada (0 a 11). */
  indice: number;
  onAbrir: (productoId: string) => void;
}

/** Tarjeta de modelo: foto, marca, nombre, sabores disponibles, disponibilidad y nuestra existencia/cobertura. */
export function TarjetaVape({ modelo: m, foto, caladas, ahora, abierta, indice, onAbrir }: PropsTarjeta) {
  const d = disponibles(m);
  const total = m.sabores.length;
  const estado = estadoDisponibilidad(m);
  const nombre = nombreVisible(m, caladas);
  const pct = total ? Math.round((d / total) * 100) : 0;
  return (
    <li className="rtm-kr-item rtm-entra" style={{ ['--rtm-i' as string]: Math.min(indice, 5) }}>
      <button type="button" className="rtm-kr-tarjeta" onClick={() => onAbrir(m.producto_id)} aria-haspopup="dialog" aria-expanded={abierta} data-testid={`modelo-${m.producto_id}`} data-estado={estado}>
        <FotoVape src={foto} marca={m.marca} nombre={nombre} />
        <span className="rtm-kr-insignias">
          {m.nuevo_semana && <b className="rtm-kr-insignia" data-tipo="nuevo">Nuevo</b>}
          {m.vendemos && <b className="rtm-kr-insignia">Lo vendes</b>}
        </span>
        <span className="rtm-kr-marca">{m.marca}{caladas && m.puffs ? ` · ${formatearEntero(m.puffs)} caladas` : ''}</span>
        <strong className="rtm-kr-nombre">{nombre}</strong>
        <span className="rtm-kr-sabores">
          {total ? <><b>{d}</b> de {total} sabores</> : 'Sin sabores leídos'}
          <i className="rtm-kr-barra" aria-hidden="true"><i style={{ width: `${pct}%` }} /></i>
        </span>
        <IndicadorDisponibilidad estado={estado} />
        <span className="rtm-kr-propio">
          {m.canonico_id === null
            ? 'Sin ligar a tu catálogo'
            : m.existencia_propia > 0
              ? <>Tienes <b>{m.existencia_propia}</b> pz{m.cobertura_dias !== null ? <> · alcanzan {m.cobertura_dias} {m.cobertura_dias === 1 ? 'día' : 'días'}</> : null}</>
              : m.vendemos ? 'Sin existencia propia' : 'No lo vendes aún'}
        </span>
        {m.sabores.some((s) => s.cambio_en) && <span className="rtm-kr-cambio">Último cambio {hace(m.sabores.map((s) => s.cambio_en).filter((x): x is string => !!x).sort().at(-1) ?? null, ahora)}</span>}
      </button>
    </li>
  );
}
