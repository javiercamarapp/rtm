// Galeria interna del catalogo de componentes del rediseno. Datos ILUSTRATIVOS (ningun cliente, proveedor ni cifra real del negocio).
import { formatearMoneda, formatearPiezas } from '@/dominio/formato';
import { Aviso, BarraFiltros, CeldaPersona, Chip, ChipEstado, Segmentado, Pestanas } from '@/ui/componentes/controles';
import { BarList, LineaTiempo, ListaClaveValor, ListaHallazgos, Pasos } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie, ColumnasPeriodo, EscalaSalud } from '@/ui/graficas';

const m = (pesos: number) => formatearMoneda(BigInt(pesos) * 100n);
const pz = (n: number) => formatearPiezas(n);

const SEMANAS = [
  { id: 's1', etiqueta: 'S1', valor: 412, parcial: false },
  { id: 's2', etiqueta: 'S2', valor: 468, parcial: false },
  { id: 's3', etiqueta: 'S3', valor: 390, parcial: false },
  { id: 's4', etiqueta: 'S4', valor: 520, parcial: false },
  { id: 's5', etiqueta: 'S5', valor: 488, parcial: false },
  { id: 's6', etiqueta: 'S6', valor: 604, parcial: false },
  { id: 's7', etiqueta: 'S7', valor: 561, parcial: false },
  { id: 's8', etiqueta: 'S8', valor: 322, parcial: true },
];

interface Mov { id: string; fecha: string; concepto: string; sabor: string; modelo: string; entra: number; sale: number; existencia: number; valor: number }
const MOVS: Mov[] = [
  { id: '1', fecha: '05 oct', concepto: 'Compra', sabor: 'Sabor 1', modelo: 'Modelo A', entra: 120, sale: 0, existencia: 120, valor: 13800 },
  { id: '2', fecha: '07 oct', concepto: 'Venta', sabor: 'Sabor 1', modelo: 'Modelo A', entra: 0, sale: 45, existencia: 75, valor: 8625 },
  { id: '3', fecha: '09 oct', concepto: 'Compra', sabor: 'Sabor 2', modelo: 'Modelo A', entra: 80, sale: 0, existencia: 155, valor: 17825 },
  { id: '4', fecha: '12 oct', concepto: 'Venta', sabor: 'Sabor 2', modelo: 'Modelo A', entra: 0, sale: 80, existencia: 75, valor: 8625 },
  { id: '5', fecha: '14 oct', concepto: 'Venta', sabor: 'Sabor 1', modelo: 'Modelo B', entra: 0, sale: 12, existencia: -12, valor: 0 },
  { id: '6', fecha: '15 oct', concepto: 'Compra', sabor: 'Sabor 3', modelo: 'Modelo B', entra: 60, sale: 0, existencia: 48, valor: 5520 },
  { id: '7', fecha: '19 oct', concepto: 'Venta', sabor: 'Sabor 3', modelo: 'Modelo B', entra: 0, sale: 48, existencia: 0, valor: 0 },
];

export function Galeria() {
  const totEntra = MOVS.reduce((a, x) => a + x.entra, 0);
  const totSale = MOVS.reduce((a, x) => a + x.sale, 0);
  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow="Diseño · catálogo de componentes"
        titulo="Componentes del rediseño"
        descripcion="Datos ilustrativos. Cada pieza en claro, oscuro y móvil, con los mismos tokens del producto."
        acciones={
          <>
            <Segmentado etiquetaAria="Periodo" opciones={[{ valor: '7', etiqueta: '7 d', href: '#', activa: false }, { valor: '30', etiqueta: '30 d', href: '#', activa: true }, { valor: 'mes', etiqueta: 'Mes', href: '#', activa: false }]} />
            <a className="rtm-boton rtm-boton-primario" href="#">Exportar</a>
          </>
        }
      />
      <Pestanas etiquetaAria="Secciones" items={[{ id: 'a', etiqueta: 'Existencias', href: '#', activa: true }, { id: 'b', etiqueta: 'Compras', href: '#', activa: false, contador: 4 }, { id: 'c', etiqueta: 'Documentos', href: '#', activa: false }]} />
      <BarraFiltros etiquetaAria="Filtros" extras={<Chip>Restablecer</Chip>}>
        <Chip activo href="#">Todos</Chip>
        <Chip categoria={4} href="#">Por reponer</Chip>
        <Chip tono="malo" href="#">Agotados</Chip>
        <Chip tono="ok">Cuadra</Chip>
        <ChipEstado tono="atencion">Por vencer</ChipEstado>
        <ChipEstado tono="apagado">Anulado</ChipEstado>
      </BarraFiltros>
      <Aviso tono="atencion" titulo="Datos parciales.">La semana en curso no está completa: se muestra con trama y sin variación.</Aviso>

      <KpiLinea
        etiquetaAria="Indicadores"
        celdas={[
          { id: 'v', etiqueta: 'Valor del inventario', valor: m(1_610_830), categoria: 1, delta: { texto: '+4.2 %', sentido: 'sube', bueno: true }, spark: { etiquetas: SEMANAS.map((s) => s.etiqueta), valores: SEMANAS.map((s) => s.valor), textos: SEMANAS.map((s) => pz(s.valor)) }, nota: 'A costo promedio' },
          { id: 'c', etiqueta: 'Por cobrar', valor: m(285_435), categoria: 4, delta: { texto: '+12 %', sentido: 'sube', bueno: false }, partes: [{ etiqueta: '0 a 7 d', valor: 40 }, { etiqueta: '8 a 14 d', valor: 30 }, { etiqueta: '15 a 30 d', valor: 20 }, { etiqueta: 'Más de 30 d', valor: 10, estado: 'parcial' }], nota: '20 % vencido' },
          { id: 'p', etiqueta: 'Cobertura media', valor: '18 d', categoria: 6, progreso: { pct: 60, meta: 80 }, nota: 'Meta 24 d' },
          { id: 'x', etiqueta: 'Costo promedio', valor: null, nota: 'Sin movimientos' },
        ]}
      />
      <FilaRatios etiqueta="Razones" items={[{ etiqueta: 'Rotación', valor: '3.2 veces', delta: { texto: '−0.4', sentido: 'baja', bueno: false } }, { etiqueta: 'Margen', valor: '18.5 %' }, { etiqueta: 'Piezas apartadas', valor: pz(140) }, { etiqueta: 'Antigüedad media', valor: null }]} />

      <Rejilla dividir="8-4">
        <Tarjeta titulo="Piezas por semana" descripcion="La semana en curso va con trama">
          <ColumnasPeriodo
            titulo="Piezas vendidas por semana"
            descripcion="Ocho semanas; la última es parcial"
            unidad="Piezas"
            procedencia="observado"
            pie="Corte: 12 nov · Fuente: libro de movimientos"
            datos={SEMANAS.map((s, i) => ({ id: s.id, etiqueta: s.etiqueta, valor: s.valor, texto: pz(s.valor), parcial: s.parcial, variacion: i > 0 && !s.parcial ? `▲ ${pz(s.valor - SEMANAS[i - 1]!.valor)} contra la semana anterior` : undefined }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Valor por marca" descripcion="Parte del valor total">
          <BarList etiquetaAria="Valor por marca" items={[{ id: '1', etiqueta: 'Marca 1', texto: m(745_045), pct: 58 }, { id: '2', etiqueta: 'Marca 2', texto: m(386_600), pct: 30 }, { id: '3', etiqueta: 'Marca 3', texto: m(141_300), pct: 11 }, { id: '4', etiqueta: 'Marca 4', texto: 'Sin dato', pct: null }]} />
        </Tarjeta>
      </Rejilla>

      <Rejilla dividir="6-6">
        <Tarjeta titulo="Existencia en el tiempo">
          <AreaSerie
            titulo="Existencia por semana"
            descripcion="Piezas en la bodega por semana"
            unidad="Piezas"
            procedencia="observado"
            puntos={SEMANAS.map((s) => ({ id: s.id, etiqueta: s.etiqueta, valor: s.valor, texto: pz(s.valor), parcial: s.parcial }))}
          />
        </Tarjeta>
        <Tarjeta titulo="Salud y hallazgos">
          <EscalaSalud etiquetaAria="Salud del inventario" pct={62} texto="Atención" />
          <ListaHallazgos
            etiquetaAria="Hallazgos"
            vacio="Nada que atender"
            items={[
              { id: '1', tono: 'malo', palabra: 'Urgente', titulo: 'Modelo B se acaba en 3 días', detalle: 'Cobertura 3 d contra plazo de 7 d', importe: '−12 pz' },
              { id: '2', tono: 'atencion', palabra: 'Atención', titulo: 'Compra en trayecto atrasada', detalle: 'Faltan 2 días de plazo', importe: m(4_800) },
              { id: '3', tono: 'ok', palabra: 'Listo', titulo: 'Conteo cuadra', detalle: 'Exactitud 99.1 %' },
            ]}
          />
        </Tarjeta>
      </Rejilla>

      <Tarjeta titulo="Kárdex por sabor" descripcion="Libro enterprise: cabecera y primera columna fijas, grupos colapsables, pie de totales" plana>
        <DataTable
          etiqueta="Kárdex ilustrativo"
          densidad="libro"
          pegajosa
          primeraFija
          interactiva={{ busqueda: 'Buscar sabor o concepto', porPagina: 25, exportar: 'kardex-ilustrativo' }}
          filas={MOVS}
          clave={(x) => x.id}
          agrupar={{
            clave: (x) => x.modelo,
            cabecera: (k, fs) => ({ titulo: k, subtotales: { entra: pz(fs.reduce((a, x) => a + x.entra, 0)), sale: pz(fs.reduce((a, x) => a + x.sale, 0)) } }),
          }}
          totales={{ etiqueta: 'Totales (filtro)', celdas: { entra: pz(totEntra), sale: pz(totSale), existencia: pz(totEntra - totSale), valor: m(MOVS.reduce((a, x) => a + x.valor, 0)) } }}
          columnas={[
            { id: 'f', titulo: 'Fecha · concepto', ancho: 'xl', celda: (x) => `${x.fecha} · ${x.concepto}` },
            { id: 's', titulo: 'Sabor', ancho: 'm', celda: (x) => x.sabor },
            { id: 'entra', titulo: 'Cantidad', bloque: 'Entradas', numerica: true, ancho: 's', celda: (x) => (x.entra ? pz(x.entra) : '—') },
            { id: 'sale', titulo: 'Cantidad', bloque: 'Salidas', numerica: true, ancho: 's', celda: (x) => (x.sale ? pz(x.sale) : '—') },
            { id: 'existencia', titulo: 'Cantidad', bloque: 'Existencias', numerica: true, ancho: 's', celda: (x) => pz(x.existencia), resaltar: (x) => (x.existencia < 0 ? 'negativo' : x.existencia === 0 ? 'cero' : null) },
            { id: 'valor', titulo: 'Valor total', bloque: 'Existencias', numerica: true, ancho: 'l', celda: (x) => (x.valor ? m(x.valor) : 'Sin dato') },
          ]}
        />
      </Tarjeta>

      <Rejilla dividir="4-4-4">
        <Tarjeta titulo="Pedido en curso">
          <Pasos etiquetaAria="Avance" actual={2} items={[{ id: 'a', etiqueta: 'Solicitado' }, { id: 'b', etiqueta: 'Aprobado' }, { id: 'c', etiqueta: 'Enviado', detalle: 'Hoy' }, { id: 'd', etiqueta: 'Recibido' }]} />
        </Tarjeta>
        <Tarjeta titulo="Historia">
          <LineaTiempo eventos={[{ id: '1', fecha: '12 nov · 09:10', titulo: 'Pedido confirmado' }, { id: '2', fecha: '12 nov · 11:40', titulo: 'Guía generada', tono: 'ok' }, { id: '3', fecha: '12 nov · 16:00', titulo: 'Diferencia de 2 piezas', detalle: 'Pendiente de resolver', tono: 'atencion' }]} />
        </Tarjeta>
        <Tarjeta titulo="Personas y datos">
          <CeldaPersona nombre="Cliente Ilustrativo" subtitulo="Último pedido hace 3 días" />
          <CeldaPersona nombre="Otra Persona" subtitulo="Saldo al corriente" />
          <ListaClaveValor items={[{ k: 'Plazo', v: '15 días' }, { k: 'Saldo', v: m(12_500) }, { k: 'Estado', v: <ChipEstado tono="ok">Al corriente</ChipEstado> }]} />
        </Tarjeta>
      </Rejilla>
    </Pagina>
  );
}
