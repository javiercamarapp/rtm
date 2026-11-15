import type { ReactNode } from 'react';
import { formatearMoneda, formatearPiezas, marcaMayus, nombreVape, saborMayus } from '@/dominio/formato';
import { SinDato } from './estado-texto';
import { ModeloMiniatura } from './modelo';

/** Un renglon de pedido, compra u orden. Los campos de dinero son opcionales: sin `precios` la tabla NUNCA los muestra (bodega y Omar). */
export interface RenglonTabla {
  marca?: string | null;
  modelo: string;
  sabor: string;
  piezas: number;
  /** Precio o costo unitario en centavos. */
  precioCent?: bigint | null;
  /** Importe del renglon en centavos; si falta se calcula como piezas por precio. */
  importeCent?: bigint | null;
  /** Texto en lugar del precio (por ejemplo «De lista»). */
  precioTexto?: string;
  /** Aclaracion corta bajo el sabor (por ejemplo «facturadas 40»). */
  detalle?: string;
  clave?: string;
}

export interface PropsRenglonesTabla {
  renglones: readonly RenglonTabla[];
  /** Nombre accesible de la tabla. */
  etiqueta: string;
  /** Muestra precio unitario e importe. Por omision NO: una vista de bodega o de Omar nunca los recibe. */
  precios?: boolean;
  etiquetaPrecio?: string;
  etiquetaImporte?: string;
  /** Agrupa por marca y modelo con una fila de subtotal por modelo. */
  agrupar?: boolean;
  /** Celda extra al final de cada renglon (por ejemplo «Quitar»). */
  acciones?: (r: RenglonTabla, indice: number) => ReactNode;
  tituloAcciones?: string;
  vacio?: string;
  testid?: string;
}

const importeDe = (r: RenglonTabla): bigint | null => r.importeCent ?? (r.precioCent === null || r.precioCent === undefined ? null : BigInt(r.piezas) * r.precioCent);

function suma(valores: readonly (bigint | null)[]): bigint | null {
  const hay = valores.filter((v): v is bigint => v !== null);
  return hay.length === 0 ? null : hay.reduce((a, v) => a + v, 0n);
}

const dinero = (c: bigint | null) => (c === null ? <SinDato /> : formatearMoneda(c));
const marcaVisible = (m: string | null | undefined) => (m && m !== 'Sin marca' ? marcaMayus(m) : '');

function Cabecera({ precios, etiquetaPrecio, etiquetaImporte, conMarca, acciones, tituloAcciones }: { precios: boolean; etiquetaPrecio: string; etiquetaImporte: string; conMarca: boolean; acciones: boolean; tituloAcciones: string }) {
  return (
    <div role="rowgroup" className="rtm-rt-cabeza">
      <div role="row" className="rtm-rt-fila rtm-rt-cab">
        {conMarca && <div role="columnheader">Marca</div>}
        <div role="columnheader">Modelo</div>
        <div role="columnheader">Sabor</div>
        <div role="columnheader" className="rtm-num">Piezas</div>
        {precios && <div role="columnheader" className="rtm-num">{etiquetaPrecio}</div>}
        {precios && <div role="columnheader" className="rtm-num">{etiquetaImporte}</div>}
        {acciones && <div role="columnheader" className="rtm-rt-acc">{tituloAcciones}</div>}
      </div>
    </div>
  );
}

/**
 * Renglones de un pedido, compra u orden como tabla con el patron del kardex por sabor: columnas alineadas (Marca, Modelo con miniatura, Sabor, Piezas
 * y, solo si se piden, precio unitario e importe), cifras tabulares a la derecha, encabezado fijo, total al pie en el flujo y scroll horizontal controlado en celular.
 * Usa roles ARIA (nunca la etiqueta de tabla cruda). Marcas, modelos y sabores siempre en mayusculas.
 */
export function RenglonesTabla({ renglones, etiqueta, precios = false, etiquetaPrecio = 'Precio unit.', etiquetaImporte = 'Importe', agrupar = false, acciones, tituloAcciones = 'Acciones', vacio = 'Sin renglones', testid }: PropsRenglonesTabla) {
  if (renglones.length === 0) return <span className="rtm-rt-vacio" data-testid={testid}>{vacio}</span>;
  const conMarca = renglones.some((r) => marcaVisible(r.marca) !== '');
  const conAcciones = acciones !== undefined;
  const totalPiezas = renglones.reduce((a, r) => a + r.piezas, 0);
  const totalImporte = precios ? suma(renglones.map(importeDe)) : null;

  const celdasPrecio = (r: RenglonTabla) => (
    <>
      <div role="cell" className="rtm-num">{r.precioTexto ?? dinero(r.precioCent ?? null)}</div>
      <div role="cell" className="rtm-num">{dinero(importeDe(r))}</div>
    </>
  );

  const fila = (r: RenglonTabla, i: number, enGrupo: boolean) => (
    <div role="row" className="rtm-rt-fila" key={r.clave ?? `${r.marca ?? ''}|${r.modelo}|${r.sabor}|${i}`} data-en-grupo={enGrupo ? '' : undefined}>
      {conMarca && <div role="cell" className="rtm-rt-marca">{enGrupo ? '' : marcaVisible(r.marca)}</div>}
      <div role="cell" className="rtm-rt-modelo">
        {enGrupo ? null : <><ModeloMiniatura modelo={r.modelo} marca={r.marca} tam="xs" /><span>{nombreVape(r.modelo)}</span></>}
      </div>
      <div role="cell" className="rtm-rt-sabor"><span>{saborMayus(r.sabor)}</span>{r.detalle && <small>{r.detalle}</small>}</div>
      <div role="cell" className="rtm-num">{formatearPiezas(r.piezas)}</div>
      {precios && celdasPrecio(r)}
      {conAcciones && <div role="cell" className="rtm-rt-acc">{acciones(r, i)}</div>}
    </div>
  );

  let cuerpo: ReactNode;
  if (agrupar) {
    const grupos = new Map<string, { marca: string | null; modelo: string; filas: { r: RenglonTabla; i: number }[] }>();
    renglones.forEach((r, i) => {
      const k = `${r.marca ?? ''}|${r.modelo}`; // may-ok: clave de agrupacion, no se muestra
      const g = grupos.get(k) ?? { marca: r.marca ?? null, modelo: r.modelo, filas: [] };
      g.filas.push({ r, i });
      grupos.set(k, g);
    });
    cuerpo = [...grupos.entries()].map(([k, g]) => {
      const piezas = g.filas.reduce((a, x) => a + x.r.piezas, 0);
      const importe = precios ? suma(g.filas.map((x) => importeDe(x.r))) : null;
      return (
        <div role="rowgroup" className="rtm-rt-grupo" key={k}>
          <div role="row" className="rtm-rt-fila rtm-rt-subtotal">
            {conMarca && <div role="rowheader" className="rtm-rt-marca">{marcaVisible(g.marca)}</div>}
            <div role="rowheader" className="rtm-rt-modelo"><ModeloMiniatura modelo={g.modelo} marca={g.marca} tam="xs" /><span>{nombreVape(g.modelo)}</span></div>
            <div role="cell" className="rtm-rt-sabor">{g.filas.length} {g.filas.length === 1 ? 'sabor' : 'sabores'}</div>
            <div role="cell" className="rtm-num">{formatearPiezas(piezas)}</div>
            {precios && <div role="cell" className="rtm-num" />}
            {precios && <div role="cell" className="rtm-num">{dinero(importe)}</div>}
            {conAcciones && <div role="cell" className="rtm-rt-acc" />}
          </div>
          {g.filas.map((x) => fila(x.r, x.i, true))}
        </div>
      );
    });
  } else {
    cuerpo = <div role="rowgroup">{renglones.map((r, i) => fila(r, i, false))}</div>;
  }

  return (
    <div className="rtm-rt" data-testid={testid} data-precios={precios ? 'si' : 'no'} data-marca={conMarca ? 'si' : 'no'} data-acciones={conAcciones ? 'si' : 'no'}>
      <div className="rtm-rt-scroll" role="region" tabIndex={0} aria-label={`${etiqueta}, desplazable`}>
        <div role="table" aria-label={etiqueta} aria-rowcount={renglones.length + 2} className="rtm-rt-tabla">
          <Cabecera precios={precios} etiquetaPrecio={etiquetaPrecio} etiquetaImporte={etiquetaImporte} conMarca={conMarca} acciones={conAcciones} tituloAcciones={tituloAcciones} />
          {cuerpo}
          <div role="rowgroup" className="rtm-rt-totales">
            <div role="row" className="rtm-rt-fila rtm-rt-total" data-testid={testid ? `${testid}-total` : undefined}>
              {conMarca && <div role="cell" />}
              <div role="rowheader" className="rtm-rt-rotulo">Total · {renglones.length} {renglones.length === 1 ? 'renglón' : 'renglones'}</div>
              <div role="cell" />
              <div role="cell" className="rtm-num">{formatearPiezas(totalPiezas)}</div>
              {precios && <div role="cell" className="rtm-num" />}
              {precios && <div role="cell" className="rtm-num">{dinero(totalImporte)}</div>}
              {conAcciones && <div role="cell" className="rtm-rt-acc" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
