import type { Metadata } from 'next';
import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import { inventarioDeSocio } from '@/composicion/inventario';
import { PALABRA_COBERTURA, TONO_COBERTURA, textoDias } from '@/dominio/inventario/cobertura';
import { BarList } from '@/ui/componentes/datos';
import { ChipEstado } from '@/ui/componentes/controles';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { TRAMOS, acumularPorTramo, tramoDe } from '../../_a2/antiguedad';
import { dec, diasEntre, fecha, m, partePct, pctTexto, periodo, pz, pzs, fechaCorta, textoParam, tonoChip, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Antigüedad y rotación' };

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodo(sp, 90);
  const q = textoParam(sp.q)?.toLowerCase() ?? null;
  const [inv, det] = await Promise.all([(await inventarioDeSocio()).completo(), (await datosDeSocio()).detalleInventario(per.ini, per.fin)]);
  const dS = new Map(det.sabores.map((d) => [d.sku_id, d]));
  const todas = inv.modelos.flatMap((x) => x.sabores.map((s) => {
    const d = dS.get(s.sku_id);
    const dias = d?.ultima_entrada ? diasEntre(d.ultima_entrada, inv.hoy) : null;
    const diasSal = d?.ultima_salida ? diasEntre(d.ultima_salida, inv.hoy) : null;
    const media = ((d?.piezas_inicial ?? 0) + s.piezas) / 2;
    return { id: `${x.modelo_id}-${s.sku_id}`, marca: x.marca, modelo: x.modelo, mid: x.modelo_id, ...s, dias, diasSal, entradas: d?.entradas ?? 0, salidas: d?.salidas ?? 0, rot: media > 0 ? (d?.salidas ?? 0) / media : null };
  }));
  const filas = todas.filter((f) => f.piezas > 0 && (!q || `${f.modelo} ${f.sabor}`.toLowerCase().includes(q))).sort((a, b) => (b.dias ?? -1) - (a.dias ?? -1) || Number(b.valor_cent - a.valor_cent));
  const ac = acumularPorTramo(filas.map((f) => ({ dias: f.dias, piezas: f.piezas, valor: f.valor_cent })));
  const totalPz = filas.reduce((a, f) => a + f.piezas, 0);
  const totalV = filas.reduce((a, f) => a + f.valor_cent, 0n);
  const viejas = ac.tramos.get('90+')!;
  const sd = filas.length === 0;
  const conRot = filas.filter((f) => f.rot !== null);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Inventario · antigüedad y rotación" titulo={sd ? 'Sin existencias para medir antigüedad' : `${pctTexto(partePct(viejas.piezas, totalPz)) ?? '0 %'} de las piezas tienen más de 90 días`} descripcion="Días desde la última entrada de compra de cada sabor, rotación del periodo y valor por tramo." />
      <FiltrosUrl etiquetaAria="Filtros" restablecer="/inventario/antiguedad">
        <Campo etiqueta="Periodo de rotación"><select name="dias" defaultValue={String(per.dias ?? '90')}><option value="30">30 días</option><option value="90">90 días</option><option value="180">180 días</option></select></Campo>
        <Campo etiqueta="Buscar"><input type="search" name="q" placeholder="Modelo o sabor" defaultValue={q ?? ''} data-noauto="" /></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen de antigüedad" celdas={[
        { id: 's', etiqueta: 'Sabores con existencia', valor: sd ? null : String(filas.length), categoria: 1, nota: sd ? undefined : `${pz(totalPz)} piezas` },
        { id: 'v', etiqueta: 'Valor a costo', valor: sd ? null : m(totalV), categoria: 2, nota: 'Costo del modelo' },
        { id: 'o', etiqueta: 'Más de 90 días', valor: sd ? null : pz(viejas.piezas), categoria: 3, nota: sd ? undefined : `${m(viejas.valor)} · ${viejas.sabores} sabores` },
        { id: 'sm', etiqueta: 'Sin entrada registrada', valor: sd ? null : String(ac.sinDato.sabores), categoria: 4, nota: 'Sin entrada de compra en el libro' },
        { id: 'r', etiqueta: 'Rotación media', valor: conRot.length === 0 ? null : `${dec(conRot.reduce((a, f) => a + f.rot!, 0) / conRot.length, 2)} veces`, categoria: 5, nota: `Periodo ${fecha(det.ini)} al ${fecha(det.fin)}` },
      ]} />
      {!sd && (
        <Rejilla dividir="6-6">
          <Tarjeta titulo="Piezas por tramo de antigüedad" descripcion="Parte de las piezas en existencia"><BarList etiquetaAria="Piezas por tramo" items={[...TRAMOS.map((t) => ({ id: t.id, etiqueta: t.etiqueta, texto: pz(ac.tramos.get(t.id)!.piezas) ?? '', pct: partePct(ac.tramos.get(t.id)!.piezas, totalPz) })), ...(ac.sinDato.sabores ? [{ id: 'sd', etiqueta: 'Sin entrada registrada', texto: pz(ac.sinDato.piezas) ?? '', pct: null }] : [])]} /></Tarjeta>
          <Tarjeta titulo="Valor por tramo de antigüedad" descripcion="Parte del valor a costo"><BarList etiquetaAria="Valor por tramo" items={TRAMOS.map((t) => ({ id: t.id, etiqueta: t.etiqueta, texto: m(ac.tramos.get(t.id)!.valor) ?? '', pct: partePct(ac.tramos.get(t.id)!.valor, totalV) }))} /></Tarjeta>
        </Rejilla>
      )}
      <Tarjeta plana className="rtm-a2-tabla" titulo="Por sabor" descripcion="Orden: más antiguo primero">
        <DataTable
          etiqueta="Antigüedad y rotación por sabor" clave={(f) => f.id} filas={filas} densidad="densa" pegajosa primeraFija plana
          vacio={{ titulo: 'Sin existencias', texto: 'Aparece con la primera compra recibida y contada.' }}
          columnas={[
            { id: 's', titulo: 'Modelo › sabor', ancho: 'l', celda: (f) => <><Link href={`/inventario/kardex/sabor?modelo=${f.mid}&sku=${f.sku_id}`}>{f.sabor}</Link><span className="rtm-a2-nota"> · {f.modelo}</span></> },
            { id: 'p', titulo: 'Existencia', numerica: true, ancho: 's', celda: (f) => pzs(f.piezas) },
            { id: 'ue', titulo: 'Última entrada', ancho: 'm', celda: (f) => fechaCorta(dS.get(f.sku_id)?.ultima_entrada) ?? <SinDato /> },
            { id: 'd', titulo: 'Días', numerica: true, ancho: 's', celda: (f) => (f.dias === null ? <SinDato /> : String(f.dias)) },
            { id: 't', titulo: 'Tramo', ancho: 'm', celda: (f) => (f.dias === null ? <SinDato /> : tramoDe(f.dias).etiqueta) },
            { id: 'us', titulo: 'Días sin salida', numerica: true, ancho: 'm', celda: (f) => (f.diasSal === null ? <SinDato /> : String(f.diasSal)) },
            { id: 'v', titulo: 'Valor a costo', numerica: true, ancho: 'm', celda: (f) => m(f.valor_cent) },
            { id: 'en', titulo: 'Entradas', numerica: true, ancho: 's', celda: (f) => pzs(f.entradas) },
            { id: 'sa', titulo: 'Salidas', numerica: true, ancho: 's', celda: (f) => pzs(f.salidas) },
            { id: 'ro', titulo: 'Rotación', numerica: true, ancho: 's', celda: (f) => (f.rot === null ? <SinDato /> : dec(f.rot, 2)) },
            { id: 'c', titulo: 'Cobertura', numerica: true, ancho: 's', celda: (f) => (f.cobertura_dias === null ? <SinDato /> : textoDias(f.cobertura_dias)) },
            { id: 'e', titulo: 'Semáforo', ancho: 'l', celda: (f) => (f.estado ? <ChipEstado tono={tonoChip(TONO_COBERTURA[f.estado])}>{PALABRA_COBERTURA[f.estado]}</ChipEstado> : <SinDato />) },
          ]}
          totales={{ etiqueta: `Total (${filas.length} sabores)`, celdas: { p: pz(totalPz), v: m(totalV), en: pz(filas.reduce((a, f) => a + f.entradas, 0)), sa: pz(filas.reduce((a, f) => a + f.salidas, 0)) } }}
        />
      </Tarjeta>
      <p className="rtm-a2-nota">La antigüedad es por <strong>última entrada de compra</strong>: el costo es promedio móvil, no por lotes (no es PEPS). Rotación = salidas del periodo entre la existencia media (inicial y actual). Un sabor sin entrada de compra en el libro dice «Sin dato».</p>
    </Pagina>
  );
}
