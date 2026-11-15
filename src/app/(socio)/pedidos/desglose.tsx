import Link from 'next/link';
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import type { DesglosePedidos, Origen } from '@/dominio/operacion/tipos';
import { SinDato } from '@/ui/componentes/estado-texto';

export type Surtido = 'dropshipping' | 'inventario_merida';

/** Proveedor u origen dentro de cada grupo. Karen junta el envio directo y el que va via Isaac. Es solo una clave de filtro: las cifras vienen de la base. */
export const PROVEEDORES: Record<string, { texto: string; surtido: Surtido; origenes: Origen[] }> = {
  bodega_omar: { texto: 'Bodega Omar', surtido: 'inventario_merida', origenes: ['bodega_omar'] },
  castores: { texto: 'Bodega por Castores', surtido: 'inventario_merida', origenes: ['castores'] },
  karen: { texto: 'Karen', surtido: 'dropshipping', origenes: ['karen_directo', 'karen_via_isaac'] },
  isaac: { texto: 'Isaac', surtido: 'dropshipping', origenes: ['isaac_directo'] },
};
export const TIPOS_VENTA: Record<string, string> = { cliente: 'Venta de cliente', socio_a_costo: 'A costo para socio' };
export const GRUPOS: { clave: Surtido; texto: string }[] = [{ clave: 'inventario_merida', texto: 'Bodega' }, { clave: 'dropshipping', texto: 'Dropshipping' }];

export const buscarFila = (d: DesglosePedidos[], nivel: DesglosePedidos['nivel'], clave: string) => d.find((f) => f.nivel === nivel && f.clave === clave);

/** Filas visibles de un grupo: proveedores (y tipos de venta en dropshipping) que existen en la base. */
export function filasDeGrupo(d: DesglosePedidos[], g: Surtido): { id: string; nivel: 'proveedor' | 'tipo'; clave: string; texto: string; fila: DesglosePedidos }[] {
  const prov = Object.entries(PROVEEDORES).filter(([, v]) => v.surtido === g).flatMap(([k, v]) => { const fila = buscarFila(d, 'proveedor', k); return fila ? [{ id: k, nivel: 'proveedor' as const, clave: k, texto: v.texto, fila }] : []; });
  const tipos = g === 'dropshipping' ? Object.entries(TIPOS_VENTA).flatMap(([k, texto]) => { const fila = buscarFila(d, 'tipo', k); return fila ? [{ id: `tipo-${k}`, nivel: 'tipo' as const, clave: k, texto, fila }] : []; }) : [];
  return [...prov, ...tipos];
}

interface Props {
  desglose: DesglosePedidos[];
  surtido: string; prov: string; tipo: string;
  enlace: (cambios: Record<string, string>) => string;
}

/** Desglose compacto por grupo (Bodega / Dropshipping), en rejilla CSS con roles ARIA (nunca la etiqueta de tabla cruda). Cada renglon filtra la lista de abajo; el activo lleva aria-current. */
export function DesglosePedidosTabla({ desglose, surtido, prov, tipo, enlace }: Props) {
  const grupos = GRUPOS.filter((g) => !surtido || g.clave === surtido);
  return (
    <div className="rtm-desglose-ped" data-testid="desglose-pedidos">
      <div role="table" aria-label="Desglose de pedidos por grupo, proveedor y tipo de venta" className="rtm-desglose-ped-tabla">
        <div role="rowgroup">
          <div role="row" className="rtm-desglose-ped-fila rtm-desglose-ped-cab">
            <div role="columnheader">Origen</div>
            {['Pedidos', 'Piezas', 'Facturado', 'Por cobrar', 'Utilidad'].map((t) => <div key={t} role="columnheader" className="rtm-num">{t}</div>)}
          </div>
        </div>
        {grupos.map((g) => {
          const total = buscarFila(desglose, 'surtido', g.clave);
          const filas = filasDeGrupo(desglose, g.clave);
          return (
            <div role="rowgroup" key={g.clave} data-testid={`desglose-${g.clave}`} className="rtm-desglose-ped-grupo-bloque">
              <div role="row" className="rtm-desglose-ped-fila rtm-desglose-ped-grupo">
                <div role="rowheader"><Link href={enlace({ surtido: g.clave, prov: '', tipo: '' })} aria-current={surtido === g.clave && !prov && !tipo ? 'true' : undefined}>{g.texto}</Link></div>
                {celdas(total)}
              </div>
              {filas.map((r) => {
                const activo = r.nivel === 'proveedor' ? prov === r.clave : tipo === r.clave;
                const href = r.nivel === 'proveedor' ? enlace({ surtido: g.clave, prov: activo ? '' : r.clave, tipo: '' }) : enlace({ surtido: g.clave, tipo: activo ? '' : r.clave, prov: '' });
                return (
                  <div role="row" key={r.id} className="rtm-desglose-ped-fila rtm-desglose-ped-sub" data-nivel={r.nivel}>
                    <div role="rowheader"><Link href={href} aria-current={activo ? 'true' : undefined}>{r.texto}</Link>{r.nivel === 'tipo' && <small> tipo de venta</small>}</div>
                    {celdas(r.fila)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function celdas(f: DesglosePedidos | undefined) {
  if (!f) return <div role="cell" className="rtm-desglose-ped-vacio"><SinDato /></div>;
  return (
    <>
      <div role="cell" className="rtm-num">{f.pedidos}</div>
      <div role="cell" className="rtm-num">{formatearPiezas(f.piezas)}</div>
      <div role="cell" className="rtm-num">{f.enviados ? formatearMoneda(f.facturado_cent) : <SinDato />}</div>
      <div role="cell" className="rtm-num">{f.enviados ? formatearMoneda(f.por_cobrar_cent) : <SinDato />}</div>
      <div role="cell" className="rtm-num">{f.utilidad_cent === null ? <SinDato /> : <>{formatearMoneda(f.utilidad_cent)}{f.utilidad_provisional ? <small> provisional</small> : null}</>}</div>
    </>
  );
}
