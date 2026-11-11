import type { Metadata } from 'next';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { SubnavContabilidad } from './subnav';

export const metadata: Metadata = { title: 'Contabilidad' };

export default async function Pagina() {
  const hoy = fechaNeg(new Date());
  const v = await (await contabilidadDeSocio()).valuacion(hoy);
  const dato = v.con_movimientos;
  const kpi = (etiqueta: string, cent: bigint | null, cifra: string, prueba: string) => (
    <div className="rtm-kpi" data-testid={prueba}>
      <span>{etiqueta}</span>
      <strong>{dato && cent !== null ? <CifraComprobada texto={formatearMoneda(cent)} cifra={cifra} comprobacion="cuadra" /> : <SinDato />}</strong>
    </div>
  );
  return (
    <>
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow={`Contabilidad · valuación al ${etiquetaFecha(hoy)}`}
        antes="Lo que vale la sociedad:"
        enfasis={dato ? formatearMoneda(v.v03_diferencia_cent) : 'sin dato'}
        contexto="Valuación a costo menos deudas. El inventario nunca se valúa a precio de venta; las utilidades retenidas son capital, no deuda. Cada cifra sale del libro de asientos y se comprueba por una segunda vía."
      />
      <div className="rtm-kpis rtm-entra rtm-i-1">
        {kpi('Valuación (activo a costo)', v.v01_valuacion_cent, 'conta:v01', 'v01')}
        {kpi('Deudas (pasivo)', v.v02_deudas_cent, 'conta:v02', 'v02')}
        {kpi('Diferencia valuación y deudas', v.v03_diferencia_cent, 'conta:v03', 'v03')}
        {kpi('Utilidad de la empresa', v.v04_utilidad_empresa_cent, 'conta:v04', 'v04')}
        {kpi('Capital aportado neto', v.v06_capital_aportado_cent, 'conta:v06', 'v06')}
        {kpi('Utilidades retenidas', v.v05_utilidades_retenidas_cent, 'conta:v05', 'v05')}
      </div>
      <p className="rtm-nota">
        <EstadoTexto tono={!dato ? 'neutro' : v.identidades.i1.cuadra && v.identidades.i2.cuadra ? 'ok' : 'malo'}>
          {!dato ? 'Sin movimientos todavía' : v.identidades.i1.cuadra && v.identidades.i2.cuadra ? 'Las identidades I-1 e I-2 cuadran al centavo' : 'Una identidad contable no cuadra'}
        </EstadoTexto>
        {' '}I-1: valuación menos deudas igual a capital por cuentas. I-2: utilidad igual a diferencia menos capital aportado menos utilidades retenidas.
      </p>

      <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Liquidez">
        <h2>Liquidez</h2>
        <div className="rtm-kpis">
          {kpi('Fondos de la sociedad (L01)', v.l01_liquidez_cent, 'conta:l01', 'l01')}
          {kpi('Fondos más clientes (L02)', v.l02_liquidez_total_cent, 'conta:l02', 'l02')}
          {kpi('Pago de la semana a Isaac (L03)', v.l03_pago_semana_cent, 'conta:l01', 'l03')}
          {kpi('Liquidez después de pago (L04)', v.l04_despues_de_pago_cent, 'conta:l02', 'l04')}
          {kpi('Liquidez conservadora (L04c)', v.l04c_conservadora_cent, 'conta:l01', 'l04c')}
        </div>
        <p className="rtm-nota">
          El dinero de la sociedad vive en cuentas de los socios. Mientras no haya movimientos de dinero registrados, la liquidez dice «Sin dato»: nunca se inventa un cero.
          {' '}Inventario a costo: {dato ? formatearMoneda(v.inventario_cent) : 'sin dato'}. Clientes por cobrar: {dato ? formatearMoneda(v.clientes_cent) : 'sin dato'}. Cuenta de Omar: {dato ? formatearMoneda(v.omar_cent) : 'sin dato'}.
        </p>
      </section>
    </>
  );
}
