import type { Metadata } from 'next';
import { datosDeSocio } from '@/composicion/datos';
import { textoDias } from '@/dominio/inventario/cobertura';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { SinDato } from '@/ui/componentes/estado-texto';
import { KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { ColumnasPeriodo } from '@/ui/graficas';
import { Campo, FiltrosUrl } from '../../_a2/filtros-url';
import { dec, fecha, m, partePct, pctTexto, periodo, pz, semanaEtiqueta, type Params } from '../../_a2/util';

export const metadata: Metadata = { title: 'Inventario por marca' };

export default async function Pagina_({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const per = periodo(sp, 30);
  const r = await (await datosDeSocio()).resumenMarcas(per.ini, per.fin);
  const total = r.marcas.reduce((a, x) => a + x.valor_cent, 0n);
  const piezas = r.marcas.reduce((a, x) => a + x.piezas, 0);
  const mayor = r.marcas[0] ?? null;
  const menorCob = [...r.marcas].filter((x) => x.cobertura_media_dias !== null).sort((a, b) => a.cobertura_media_dias! - b.cobertura_media_dias!)[0] ?? null;
  const deuda = r.cuentas_proveedor.reduce((a, c) => (c.saldo_cent < 0n ? a - c.saldo_cent : a), 0n);
  const sd = r.marcas.length === 0;
  const pie = `Periodo ${fecha(r.ini)} al ${fecha(r.fin)} · Fuente: libro de movimientos`;
  const maxPz = Math.max(0, ...r.marcas.map((x) => x.piezas));
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow="Inventario · marcas y proveedores" titulo={sd ? 'Todavía no hay existencias por marca' : `${r.marcas.length} marcas en la bodega`} descripcion="Piezas, valor a costo, cobertura y rotación por marca, con su proveedor más reciente y la cuenta con cada proveedor." />
      <FiltrosUrl etiquetaAria="Periodo" restablecer="/inventario/marcas">
        <Campo etiqueta="Periodo"><select name="dias" defaultValue={String(per.dias ?? '30')}><option value="7">7 días</option><option value="30">30 días</option><option value="90">90 días</option></select></Campo>
      </FiltrosUrl>
      <KpiLinea etiquetaAria="Resumen por marca" celdas={[
        { id: 'n', etiqueta: 'Marcas activas', valor: sd ? null : String(r.marcas.length), categoria: 1, nota: sd ? undefined : `${r.marcas.reduce((a, x) => a + x.modelos, 0)} modelos con existencia` },
        { id: 'v', etiqueta: 'Valor total', valor: sd ? null : m(total), categoria: 2, nota: sd ? undefined : `${pz(piezas)} piezas` },
        { id: 'may', etiqueta: 'Marca de mayor valor', valor: mayor ? mayor.marca : null, categoria: 3, nota: mayor ? `${m(mayor.valor_cent)} · ${pctTexto(partePct(mayor.valor_cent, total)) ?? ''}` : undefined },
        { id: 'cov', etiqueta: 'Marca con menor cobertura', valor: menorCob ? menorCob.marca : null, categoria: 4, nota: menorCob ? textoDias(menorCob.cobertura_media_dias) : undefined },
        { id: 'deu', etiqueta: 'Deuda con proveedores', valor: r.cuentas_proveedor.length === 0 ? null : m(deuda), categoria: 5, nota: 'Suma de saldos que se deben' },
      ]} />
      {!sd && (
        <Rejilla dividir="4-4-4">
          <Tarjeta titulo="Valor por marca" descripcion="Parte del valor a costo"><BarList etiquetaAria="Valor por marca" items={r.marcas.map((x) => ({ id: String(x.marca_id), etiqueta: x.marca, texto: m(x.valor_cent) ?? '', pct: partePct(x.valor_cent, total) }))} /></Tarjeta>
          <Tarjeta titulo="Piezas por marca" descripcion="Contra la marca con más piezas"><BarList etiquetaAria="Piezas por marca" items={r.marcas.map((x) => ({ id: String(x.marca_id), etiqueta: x.marca, texto: pz(x.piezas) ?? '', pct: maxPz > 0 ? Math.round((x.piezas / maxPz) * 100) : null }))} mostrarPct={false} /></Tarjeta>
          <Tarjeta titulo="Compras por semana" descripcion="Valor de las entradas de compra">
            {r.compras_semana.length >= 2 ? (
              <ColumnasPeriodo titulo="Compras por semana" descripcion={`Valor de las entradas de compra en ${r.compras_semana.length} semanas.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140} formatoEje={(n) => `$${Math.round(n / 100000)}k`}
                datos={r.compras_semana.map((s) => ({ id: s.semana, etiqueta: semanaEtiqueta(s.semana), valor: Number(s.valor_cent), texto: m(s.valor_cent) ?? '', detalle: `${pz(s.piezas)} piezas` }))} />
            ) : <p className="rtm-a2-nota">Con menos de dos semanas de compras no se dibuja la serie.</p>}
          </Tarjeta>
        </Rejilla>
      )}
      <Tarjeta plana titulo="Por marca" descripcion="Orden por valor descendente">
        <DataTable
          etiqueta="Inventario por marca y proveedor" clave={(x) => x.marca_id} filas={r.marcas} densidad="densa" pegajosa primeraFija plana
          vacio={{ titulo: 'Sin existencias por marca', texto: 'Aparecen con la primera compra recibida y contada.' }}
          columnas={[
            { id: 'm', titulo: 'Marca', ancho: 'l', celda: (x) => x.marca },
            { id: 'p', titulo: 'Proveedor', ancho: 'm', celda: (x) => x.proveedor ?? <SinDato /> },
            { id: 'mo', titulo: 'Modelos', numerica: true, ancho: 's', celda: (x) => `${x.modelos} de ${x.modelos_catalogo}` },
            { id: 'sa', titulo: 'Sabores', numerica: true, ancho: 's', celda: (x) => String(x.sabores) },
            { id: 'pz', titulo: 'Piezas', numerica: true, ancho: 's', celda: (x) => pz(x.piezas) },
            { id: 'v', titulo: 'Valor a costo', numerica: true, ancho: 'l', celda: (x) => m(x.valor_cent) },
            { id: 'cp', titulo: 'Costo promedio', numerica: true, ancho: 'm', celda: (x) => m(x.costo_prom_cent) ?? <SinDato /> },
            { id: 'pc', titulo: '% del inventario', numerica: true, ancho: 's', celda: (x) => pctTexto(partePct(x.valor_cent, total)) ?? <SinDato /> },
            { id: 'c', titulo: 'Cobertura media', numerica: true, ancho: 'm', celda: (x) => (x.cobertura_media_dias === null ? <SinDato /> : textoDias(x.cobertura_media_dias)) },
            { id: 'ro', titulo: 'Rotación', numerica: true, ancho: 's', celda: (x) => (x.rotacion === null ? <SinDato /> : `${dec(x.rotacion, 2)}`) },
            { id: 'en', titulo: 'Entradas', numerica: true, ancho: 's', celda: (x) => pz(x.entradas) },
            { id: 'sl', titulo: 'Salidas', numerica: true, ancho: 's', celda: (x) => pz(x.salidas) },
            { id: 'ue', titulo: 'Última entrada', ancho: 'm', celda: (x) => fecha(x.ultima_entrada) ?? <SinDato /> },
          ]}
          totales={{ etiqueta: 'Total', celdas: { pz: pz(piezas), v: m(total), en: pz(r.marcas.reduce((a, x) => a + x.entradas, 0)), sl: pz(r.marcas.reduce((a, x) => a + x.salidas, 0)), pc: sd ? null : '100 %' } }}
        />
      </Tarjeta>
      <Tarjeta plana titulo="Cuenta con cada proveedor" descripcion="Saldo del libro de proveedores">
        <DataTable etiqueta="Cuenta con proveedores" clave={(c) => c.proveedor} filas={r.cuentas_proveedor} densidad="densa" plana
          vacio={{ titulo: 'Sin proveedores', texto: 'No hay cuentas de proveedor.' }}
          columnas={[{ id: 'p', titulo: 'Proveedor', celda: (c) => c.proveedor }, { id: 's', titulo: 'Saldo', numerica: true, celda: (c) => m(c.saldo_cent) }, { id: 'e', titulo: 'Estado', celda: (c) => c.etiqueta }]} />
      </Tarjeta>
      <p className="rtm-a2-nota">Proveedor = el de la lista de costos más reciente de algún modelo de la marca; si no hay lista, «Sin dato». Rotación = salidas del periodo entre las piezas actuales. Cobertura media = promedio de los modelos con cobertura calculable.</p>
    </Pagina>
  );
}
