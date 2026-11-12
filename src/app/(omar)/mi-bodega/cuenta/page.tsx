import type { Metadata } from 'next';
import { cuentaDeOmar } from '@/composicion/omar';
import { fechaNeg, semanaOmar } from '@/dominio/calendario';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { Aviso } from '@/ui/componentes/controles';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { BloqueProyeccion, CifrasCuenta, TablaLiquidaciones, TablaPagos, TablaRentaDia, TablaTransacciones } from '@/ui/omar/cuenta';
import { ExportarCuenta } from '@/ui/omar/exportar';

export const metadata: Metadata = { title: 'Mi cuenta' };

export default async function PaginaMiCuenta() {
  const hoy = fechaNeg(new Date());
  const semana = semanaOmar(hoy);
  const c = await cuentaDeOmar(hoy);
  const movs = c.movimientos.estado === 'ok' ? c.movimientos.datos : null;
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina eyebrow={`Tu cuenta · semana ${etiquetaFecha(semana.inicio)} al ${etiquetaFecha(semana.fin)}`} titulo="Lo que te corresponde" descripcion={`Renta por pieza enviada, tus tomas y tus pagos. La semana en curso se liquida el ${etiquetaFecha(semana.corte)}.`} />
      <CifrasCuenta movs={c.movimientos} liqs={c.liquidaciones} semanaIni={semana.inicio} />
      <Rejilla dividir="6-6" alinear="inicio">
        <Tarjeta titulo="Proyección de tu pago" descripcion="Estimación, no un saldo">
          <BloqueProyeccion proyeccion={c.proyeccion} />
        </Tarjeta>
        <Tarjeta plana titulo="Renta de esta semana, por día">
          {movs ? <TablaRentaDia movs={movs} semanaIni={semana.inicio} /> : <Aviso tono="error">No se pudo cargar tu cuenta.</Aviso>}
        </Tarjeta>
      </Rejilla>
      {movs && (
        <Rejilla dividir="6-6" alinear="inicio">
          <Tarjeta plana titulo="Tus transacciones" descripcion="Tus tomas autorizadas">
            <TablaTransacciones movs={movs} />
          </Tarjeta>
          <Tarjeta plana titulo="Pagos">
            <TablaPagos movs={movs} />
          </Tarjeta>
        </Rejilla>
      )}
      <Tarjeta
        plana
        titulo="Liquidación semanal"
        descripcion="Neto = renta − tus tomas. Positivo: los socios te pagan. Negativo: tú pagas a los socios."
        acciones={movs ? (
          <ExportarCuenta nombre={`mi-cuenta-${semana.inicio}.csv`} filas={[
            ['Tipo', 'Fecha', 'Referencia', 'Pieza', 'Piezas', 'Importe'],
            ...movs.map((m) => [m.concepto, m.fecha, m.referencia, m.modelo ?? '', m.piezas === null ? '' : String(m.piezas), formatearMoneda(m.importe)]),
          ]} />
        ) : undefined}
      >
        <TablaLiquidaciones lectura={c.liquidaciones} />
      </Tarjeta>
    </Pagina>
  );
}
