import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { serieSemanalDeSocio } from '@/composicion/contabilidad-serie';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Aviso } from '@/ui/componentes/controles';
import { BarList, ListaClaveValor } from '@/ui/componentes/datos';
import { FilaRatios, KpiLinea, type KpiCelda } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { GraficaSemanas } from '../_a3/serie';
import { Estado, Pie, m, pct } from '../_a3/util';
import { SubnavContabilidad } from './subnav';

export const metadata: Metadata = { title: 'Contabilidad' };

export default async function PaginaContabilidad() {
  const hoy = fechaNeg(new Date());
  const [v, serie] = await Promise.all([(await contabilidadDeSocio()).valuacion(hoy), serieSemanalDeSocio(12).catch(() => null)]);
  const dato = v.con_movimientos;
  const cifra = (cent: bigint | null, id: string) => (dato && cent !== null ? <CifraComprobada texto={m(cent)} cifra={id} comprobacion="cuadra" /> : null);
  const idOk = dato && v.identidades.i1.cuadra && v.identidades.i2.cuadra;
  const pasos = [
    { id: 'v01', etiqueta: 'Valuación (activo a costo)', valor: Number(v.v01_valuacion_cent), tipo: 'inicio' as const, texto: m(v.v01_valuacion_cent) },
    { id: 'v02', etiqueta: 'Deudas', valor: -Number(v.v02_deudas_cent), tipo: 'delta' as const, texto: m(-v.v02_deudas_cent, true) },
    { id: 'v06', etiqueta: 'Capital aportado', valor: -Number(v.v06_capital_aportado_cent), tipo: 'delta' as const, texto: m(-v.v06_capital_aportado_cent, true) },
    { id: 'v05', etiqueta: 'Utilidades retenidas', valor: -Number(v.v05_utilidades_retenidas_cent), tipo: 'delta' as const, texto: m(-v.v05_utilidades_retenidas_cent, true) },
    { id: 'v04', etiqueta: 'Utilidad de la empresa', valor: Number(v.v04_utilidad_empresa_cent), tipo: 'total' as const, texto: m(v.v04_utilidad_empresa_cent, true) },
  ];
  const activo = [
    { id: 'inv', etiqueta: 'Inventario a costo', c: v.inventario_cent },
    { id: 'cli', etiqueta: 'Clientes por cobrar', c: v.clientes_cent },
    { id: 'omar', etiqueta: 'Cuenta de Omar', c: v.omar_cent },
    ...(v.l01_liquidez_cent !== null ? [{ id: 'fon', etiqueta: 'Fondos de la sociedad', c: v.l01_liquidez_cent }] : []),
  ];
  const kpis: KpiCelda[] = [
    { id: 'v01', testid: 'v01', etiqueta: 'Valuación (activo a costo)', valor: cifra(v.v01_valuacion_cent, 'conta:v01'), categoria: 1, nota: dato ? `Inventario ${m(v.inventario_cent)} · clientes ${m(v.clientes_cent)}` : 'Sin movimientos todavía' },
    { id: 'v02', testid: 'v02', etiqueta: 'Deudas (pasivo)', valor: cifra(v.v02_deudas_cent, 'conta:v02'), categoria: 4, progreso: dato ? { pct: pct(v.v02_deudas_cent, v.v01_valuacion_cent) ?? 0 } : undefined, nota: dato ? `${pct(v.v02_deudas_cent, v.v01_valuacion_cent)?.toFixed(1) ?? 'Sin dato'} % de la valuación` : undefined },
    { id: 'v03', testid: 'v03', etiqueta: 'Diferencia valuación y deudas', valor: cifra(v.v03_diferencia_cent, 'conta:v03'), categoria: 2, nota: 'Lo que vale la sociedad' },
    { id: 'v04', testid: 'v04', etiqueta: 'Utilidad de la empresa', valor: cifra(v.v04_utilidad_empresa_cent, 'conta:v04'), categoria: 6, nota: 'Diferencia menos capital y retenidas' },
  ];
  const semanas = serie?.semanas ?? [];

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow={`Contabilidad · valuación al ${etiquetaFecha(hoy)}`}
        titulo={`Lo que vale la sociedad: ${dato ? m(v.v03_diferencia_cent) : 'sin dato'}`}
        descripcion="Valuación a costo menos deudas; el inventario nunca se valúa a precio de venta y las utilidades retenidas son capital, no deuda."
      />
      {!dato && <Aviso tono="info" titulo="Sin movimientos todavía.">Las cifras aparecen con el primer asiento; mientras tanto dicen «Sin dato» y nunca un cero inventado.</Aviso>}
      <KpiLinea etiquetaAria="Valuación de la sociedad" celdas={kpis} />
      <FilaRatios
        etiqueta="Capital e identidades"
        items={[
          { etiqueta: 'Capital aportado neto', valor: dato ? <span data-testid="v06"><CifraComprobada texto={m(v.v06_capital_aportado_cent)} cifra="conta:v06" comprobacion="cuadra" /></span> : null },
          { etiqueta: 'Utilidades retenidas', valor: dato ? <span data-testid="v05"><CifraComprobada texto={m(v.v05_utilidades_retenidas_cent)} cifra="conta:v05" comprobacion="cuadra" /></span> : null },
          { etiqueta: 'I-1 (valuación − deudas = capital)', valor: dato ? <Estado tono={v.identidades.i1.cuadra ? 'ok' : 'malo'}>{v.identidades.i1.cuadra ? 'Cuadra' : 'No cuadra'}</Estado> : null },
          { etiqueta: 'I-2 (utilidad = diferencia − capital − retenidas)', valor: dato ? <Estado tono={v.identidades.i2.cuadra ? 'ok' : 'malo'}>{v.identidades.i2.cuadra ? 'Cuadra' : 'No cuadra'}</Estado> : null },
        ]}
      />

      <Rejilla dividir="6-6">
        <Tarjeta titulo="De la valuación a la utilidad" descripcion="Valuación − deudas − capital aportado − utilidades retenidas = utilidad de la empresa" acciones={dato ? <Estado tono={idOk ? 'ok' : 'malo'}>{idOk ? 'Cuadra' : 'No cuadra'}</Estado> : undefined}>
          {dato ? <Cascada titulo="Cascada de la valuación" descripcion={`Valuación ${m(v.v01_valuacion_cent)}, deudas ${m(v.v02_deudas_cent)}, capital ${m(v.v06_capital_aportado_cent)}, retenidas ${m(v.v05_utilidades_retenidas_cent)}; utilidad ${m(v.v04_utilidad_empresa_cent, true)}.`} pasos={pasos} unidad="Pesos" /> : <p className="a3-grafica-vacia"><strong>Sin dato</strong>La cascada aparece con el primer asiento.</p>}
                  {dato && (
            <ListaClaveValor items={[
              { k: 'Valuación', v: m(v.v01_valuacion_cent) },
              { k: 'Deudas', v: m(v.v02_deudas_cent) },
              { k: 'Capital aportado neto', v: m(v.v06_capital_aportado_cent) },
              { k: 'Utilidades retenidas', v: m(v.v05_utilidades_retenidas_cent) },
              { k: 'Utilidad de la empresa', v: <strong>{m(v.v04_utilidad_empresa_cent, true)}</strong> },
            ]} />
          )}
        
        </Tarjeta>
        <div className="a3-pila">
          <Tarjeta titulo="De qué se compone el activo" descripcion="Parte de la valuación">
            {dato ? <BarList etiquetaAria="Composición del activo" items={activo.map((a) => ({ id: a.id, etiqueta: a.etiqueta, texto: m(a.c), pct: pct(a.c, v.v01_valuacion_cent) }))} /> : <p className="a3-grafica-vacia"><strong>Sin dato</strong></p>}
            <Pie>Cada cifra sale del libro de asientos y se comprueba por una segunda vía.</Pie>
          </Tarjeta>
          <Tarjeta titulo="Liquidez" descripcion="El dinero de la sociedad vive en cuentas de los socios">
            <ListaClaveValor items={[
              { k: 'Fondos de la sociedad (L01)', v: <span data-testid="l01">{dato && v.l01_liquidez_cent !== null ? <CifraComprobada texto={m(v.l01_liquidez_cent)} cifra="conta:l01" comprobacion="cuadra" /> : <span className="rtm-sin-dato">Sin dato</span>}</span> },
              { k: 'Fondos más clientes (L02)', v: <span data-testid="l02">{dato && v.l02_liquidez_total_cent !== null ? <CifraComprobada texto={m(v.l02_liquidez_total_cent)} cifra="conta:l02" comprobacion="cuadra" /> : <span className="rtm-sin-dato">Sin dato</span>}</span> },
              { k: 'Pago de la semana a Isaac (L03)', v: <span data-testid="l03">{dato && v.l03_pago_semana_cent !== null ? <CifraComprobada texto={m(v.l03_pago_semana_cent)} cifra="conta:l01" comprobacion="cuadra" /> : <span className="rtm-sin-dato">Sin dato</span>}</span> },
              { k: 'Liquidez después de pago (L04)', v: <span data-testid="l04">{dato && v.l04_despues_de_pago_cent !== null ? <CifraComprobada texto={m(v.l04_despues_de_pago_cent)} cifra="conta:l02" comprobacion="cuadra" /> : <span className="rtm-sin-dato">Sin dato</span>}</span> },
              { k: 'Liquidez conservadora (L04c)', v: <span data-testid="l04c">{dato && v.l04c_conservadora_cent !== null ? <CifraComprobada texto={m(v.l04c_conservadora_cent)} cifra="conta:l01" comprobacion="cuadra" /> : <span className="rtm-sin-dato">Sin dato</span>}</span> },
            ]} />
            <Pie>Mientras no haya movimientos de dinero registrados, la liquidez dice «Sin dato».</Pie>
          </Tarjeta>
        </div>
      </Rejilla>

      <Tarjeta titulo="Utilidad neta por semana" descripcion="Las últimas 12 semanas; la semana en curso va parcial">
          <GraficaSemanas columnas={2} titulo="Utilidad neta por semana" descripcion="Utilidad neta de cada una de las últimas semanas, del estado de resultados." semanas={semanas} valor={(s) => s.utilidad_neta_cent} pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de asientos, estado de resultados semanal`} />
      </Tarjeta>

      <Tarjeta titulo="Ventas netas por semana" descripcion="De lunes a domingo">
        <GraficaSemanas titulo="Ventas netas por semana" descripcion="Ventas netas de cada una de las últimas semanas." semanas={semanas} valor={(s) => s.ventas_netas_cent} pie={`Corte: ${etiquetaFecha(hoy)} · Fuente: libro de asientos`} alto={140} />
      </Tarjeta>
    </Pagina>
  );
}
