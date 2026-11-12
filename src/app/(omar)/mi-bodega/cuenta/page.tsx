import type { Metadata } from 'next';
import { cuentaDeOmar } from '@/composicion/omar';
import { fechaNeg, semanaOmar } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { EncabezadoPagina } from '@/ui/componentes/pagina';
import { BloqueProyeccion, CifrasCuenta, TablaLiquidaciones, TablaPagos, TablaRentaDia, TablaTransacciones } from '@/ui/omar/cuenta';
import { ExportarCuenta } from '@/ui/omar/exportar';

export const metadata: Metadata = { title: 'Mi cuenta' };

export default async function Pagina() {
  const hoy = fechaNeg(new Date());
  const semana = semanaOmar(hoy);
  const c = await cuentaDeOmar(hoy);
  const movs = c.movimientos.estado === 'ok' ? c.movimientos.datos : null;
  return (
    <>
      <EncabezadoPagina eyebrow={`Tu cuenta · semana ${etiquetaFecha(semana.inicio)} al ${etiquetaFecha(semana.fin)}`} antes="Lo que te" enfasis="corresponde" contexto={`Renta por pieza enviada desde tu bodega, tus tomas y tus pagos. La semana en curso se liquida el ${etiquetaFecha(semana.corte)}.`} />
      <section className="rtm-seccion rtm-entra rtm-i-1" aria-label="Cifras de la semana">
        <CifrasCuenta movs={c.movimientos} liqs={c.liquidaciones} semanaIni={semana.inicio} />
      </section>
      <div className="omar-rejilla">
        <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Proyección de tu pago">
          <h2>Proyección de tu pago</h2>
          <BloqueProyeccion proyeccion={c.proyeccion} />
        </section>
        <section className="rtm-seccion rtm-entra rtm-i-2" aria-label="Renta por día">
          <h2>Renta de esta semana, por día</h2>
          {movs ? <TablaRentaDia movs={movs} semanaIni={semana.inicio} /> : <p className="rtm-error" role="alert">No se pudo cargar tu cuenta.</p>}
        </section>
      </div>
      {movs && (
        <div className="omar-rejilla">
          <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Tus transacciones">
            <h2>Tus transacciones</h2>
            <TablaTransacciones movs={movs} />
          </section>
          <section className="rtm-seccion rtm-entra rtm-i-3" aria-label="Pagos">
            <h2>Pagos</h2>
            <TablaPagos movs={movs} />
          </section>
        </div>
      )}
      <section className="rtm-seccion rtm-entra rtm-i-4" aria-label="Liquidaciones">
        <h2>Liquidación semanal</h2>
        <TablaLiquidaciones lectura={c.liquidaciones} />
        <p className="rtm-nota">Neto = renta − tus tomas. Positivo: los socios te pagan. Negativo: tú pagas a los socios.</p>
        {movs && (
          <div className="rtm-acciones-fila">
            <ExportarCuenta nombre={`mi-cuenta-${semana.inicio}.csv`} filas={[
              ['Tipo', 'Fecha', 'Referencia', 'Pieza', 'Piezas', 'Importe'],
              ...movs.map((m) => [m.concepto, m.fecha, m.referencia, m.modelo ?? '', m.piezas === null ? '' : String(m.piezas), formatearMoneda(m.importe)]),
            ]} />
          </div>
        )}
      </section>
    </>
  );
}
