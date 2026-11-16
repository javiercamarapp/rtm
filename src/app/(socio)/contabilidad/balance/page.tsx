import type { Metadata } from 'next';
import '@/ui/estilos/socios-valuacion.css';
import Link from 'next/link';
import { valuacionDeSocios } from '@/composicion/valuacion-socios';
import { filasCapitalPorSocio } from '@/dominio/socios/balance';
import { contabilidadDeSocio } from '@/composicion/contabilidad';
import { fechaNeg, sumarDias } from '@/dominio/calendario';
import { esFecha } from '@/dominio/contabilidad/rangos';
import type { Balance, RenglonBalance } from '@/dominio/contabilidad/tipos';
import { etiquetaFecha } from '@/dominio/formato';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { BarraFiltros, Chip } from '@/ui/componentes/controles';
import { BarList } from '@/ui/componentes/datos';
import { DataTable } from '@/ui/componentes/data-table';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Cascada } from '@/ui/graficas';
import { Ayuda } from '@/ui/componentes/ayuda';
import { Estado, Pie, m, pct, suma } from '../../_a3/util';
import { SubnavContabilidad } from '../subnav';

export const metadata: Metadata = { title: 'Balance general' };

type Seccion = 'activo' | 'pasivo' | 'capital';
const monto = (b: Balance | null, s: Seccion, codigo: string): bigint => b?.[s].find((r) => r.codigo === codigo)?.monto_cent ?? 0n;

export default async function PaginaBalance({ searchParams }: { searchParams: Promise<{ hasta?: string }> }) {
  const q = await searchParams;
  const hoy = fechaNeg(new Date());
  const hasta = esFecha(q.hasta) ? q.hasta : hoy;
  const previo = sumarDias(hasta, -7);
  const lector = await contabilidadDeSocio();
  const [b, p, val] = await Promise.all([lector.balance(hasta), lector.balance(previo).catch(() => null), valuacionDeSocios(hasta).catch(() => null)]);
  const hayPrev = p !== null && p.con_movimientos;
  const dato = b.con_movimientos;
  const pasivoMasCapital = b.total_pasivo_cent + b.total_capital_cent;

  const filasDe = (s: Seccion): RenglonBalance[] => {
    const set = new Map<string, string>();
    for (const x of [b, p]) for (const r of x?.[s] ?? []) set.set(r.codigo, r.nombre);
    return [...set.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([codigo, nombre]) => ({ codigo, nombre, monto_cent: monto(b, s, codigo) }));
  };
  const tabla = (s: Seccion, titulo: string, total: bigint, totalPrev: bigint | null, base: bigint, prueba: string, conPct = true) => (
    <Tarjeta plana titulo={titulo} descripcion={`Al ${etiquetaFecha(hasta)}${hayPrev ? ` contra ${etiquetaFecha(previo)}` : ''}`}>
      <div data-testid={prueba}>
        <DataTable
          etiqueta={titulo}
          densidad="libro" plana primeraFija
          clave={(f) => f.codigo}
          filas={filasDe(s)}
          totales={{ etiqueta: `Total ${titulo.toLowerCase()}`, celdas: { m: m(total), a: hayPrev && totalPrev !== null ? m(totalPrev) : 'Sin dato', v: hayPrev && totalPrev !== null ? m(total - totalPrev, true) : 'Sin dato', ...(conPct ? { p: base > 0n ? `${(Number((total * 10000n) / base) / 100).toFixed(1)} %` : 'Sin dato' } : {}) } }}
          vacio={{ titulo: 'Sin saldos', texto: 'Ninguna cuenta de esta sección tiene saldo todavía.' }}
          columnas={[
            { id: 'n', titulo: 'Cuenta', ancho: 'xl', celda: (f) => <><span className="rtm-mono">{f.codigo}</span> {f.nombre}</> },
            { id: 'm', titulo: 'Al corte', bloque: 'Importe', numerica: true, ancho: 'm', celda: (f) => (/^\d{4}$/.test(f.codigo) ? <CifraComprobada texto={m(f.monto_cent)} cifra={`conta:saldo:${f.codigo}:${hasta}`} comprobacion="cuadra" /> : m(f.monto_cent)) },
            { id: 'a', titulo: '7 días antes', bloque: 'Importe', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (hayPrev ? m(monto(p, s, f.codigo)) : <span className="rtm-sin-dato">Sin dato</span>) },
            { id: 'v', titulo: 'Variación', bloque: 'Importe', numerica: true, ancho: 'm', secundaria: true, celda: (f) => (hayPrev ? m(f.monto_cent - monto(p, s, f.codigo), true) : <span className="rtm-sin-dato">Sin dato</span>) },
            ...(conPct ? [{ id: 'p', titulo: '% del activo', numerica: true, ancho: 's' as const, secundaria: true, celda: (f: RenglonBalance) => (b.total_activo_cent > 0n ? `${(Number((f.monto_cent * 10000n) / b.total_activo_cent) / 100).toFixed(1)} %` : 'Sin dato') }] : []),
          ]}
        />
      </div>
    </Tarjeta>
  );
  const pasos = [
    { id: 'a', etiqueta: 'Activo', valor: Number(b.total_activo_cent), tipo: 'inicio' as const, texto: m(b.total_activo_cent) },
    { id: 'p', etiqueta: 'Pasivo', valor: -Number(b.total_pasivo_cent), tipo: 'delta' as const, texto: m(-b.total_pasivo_cent, true) },
    { id: 'k', etiqueta: 'Capital', valor: -Number(b.total_capital_cent), tipo: 'delta' as const, texto: m(-b.total_capital_cent, true) },
    { id: 'd', etiqueta: 'Diferencia', valor: Number(b.diferencia_cent), tipo: 'total' as const, texto: m(b.diferencia_cent, true) },
  ];
  const top = (s: Seccion) => [...b[s]].filter((r) => r.monto_cent !== 0n).sort((x, y) => (x.monto_cent > y.monto_cent ? -1 : 1)).slice(0, 6);

  return (
    <Pagina ancho="tablero">
      <SubnavContabilidad />
      <EncabezadoPagina
        eyebrow={`Contabilidad · balance general al ${etiquetaFecha(hasta)}`}
        titulo={`Activo igual a pasivo más capital: ${dato ? (b.cuadra ? 'cuadra' : 'no cuadra') : 'sin dato'}`}
        descripcion="Inventario a costo; los saldos a favor con un proveedor van en el activo, cada proveedor por separado."
        acciones={
          <form action="/contabilidad/balance" method="get" className="a3-filtros-form" aria-label="Corte del balance">
            <input className="rtm-campo" type="date" name="hasta" defaultValue={hasta} aria-label="Corte al" />
            <button type="submit" className="rtm-boton">Ver corte</button>
          </form>
        }
      />
      <Ayuda resumen="Qué suma el libro a lo que se debe a Isaac y Karen">El libro suma a lo que se debe a Isaac y a Karen el costo de los pedidos a costo del socio de menudeo aún sin pagar; en Proveedores se separan.</Ayuda>
      <BarraFiltros etiquetaAria="Cortes rápidos">
        <Chip href="/contabilidad/balance" activo={hasta === hoy}>Hoy</Chip>
        <Chip href={`/contabilidad/balance?hasta=${sumarDias(hoy, -7)}`} activo={hasta === sumarDias(hoy, -7)}>Hace 7 días</Chip>
        <Chip href={`/contabilidad/balance?hasta=${sumarDias(hoy, -30)}`} activo={hasta === sumarDias(hoy, -30)}>Hace 30 días</Chip>
      </BarraFiltros>
      {!dato ? (
        <DataTable etiqueta="Balance general" clave={() => 0} filas={[]} columnas={[]} vacio={{ titulo: 'Sin dato', texto: 'Aún no hay asientos al corte elegido. El balance aparecerá con el primer movimiento.' }} />
      ) : (
        <>
          <KpiLinea
            etiquetaAria="Indicadores del balance"
            celdas={[
              { id: 'a', etiqueta: 'Total activo', valor: m(b.total_activo_cent), categoria: 1, nota: hayPrev ? `7 días antes ${m(p!.total_activo_cent)}` : 'Sin corte anterior' },
              { id: 'p', etiqueta: 'Total pasivo', valor: m(b.total_pasivo_cent), categoria: 4, progreso: { pct: pct(b.total_pasivo_cent, b.total_activo_cent) ?? 0 }, nota: `${pct(b.total_pasivo_cent, b.total_activo_cent)?.toFixed(1) ?? 'Sin dato'} % del activo` },
              { id: 'k', etiqueta: 'Total capital', valor: m(b.total_capital_cent), categoria: 2, nota: `${pct(b.total_capital_cent, b.total_activo_cent)?.toFixed(1) ?? 'Sin dato'} % del activo` },
              { id: 'd', etiqueta: 'Diferencia (debe ser cero)', valor: m(b.diferencia_cent, true), categoria: 7, nota: <Estado tono={b.cuadra ? 'ok' : 'malo'}>{b.cuadra ? 'Cuadra' : 'No cuadra'}</Estado> },
            ]}
          />
          <FilaRatios
            etiqueta="Estructura"
            items={[
              { etiqueta: 'Pasivo más capital', valor: m(pasivoMasCapital) },
              { etiqueta: 'Pasivo sobre capital', valor: b.total_capital_cent > 0n ? `${(Number((b.total_pasivo_cent * 100n) / b.total_capital_cent) / 100).toFixed(2)} veces` : null },
              { etiqueta: 'Fuera de libros', valor: m(suma(b.fuera_de_libros.map((x) => x.monto_cent))) },
            ]}
          />
          {tabla('activo', 'Activo', b.total_activo_cent, hayPrev ? p!.total_activo_cent : null, b.total_activo_cent, 'balance-activo')}
          <Rejilla dividir="6-6">
            {tabla('pasivo', 'Pasivo', b.total_pasivo_cent, hayPrev ? p!.total_pasivo_cent : null, b.total_activo_cent, 'balance-pasivo', false)}
            {tabla('capital', 'Capital', b.total_capital_cent, hayPrev ? p!.total_capital_cent : null, b.total_activo_cent, 'balance-capital', false)}
          </Rejilla>
          {val && val.cuenta.hay_movimientos && (
            <Tarjeta plana titulo="Capital contable por socio" descripcion={`Al ${etiquetaFecha(hasta)}: cada socio con su capital aportado, sus utilidades acumuladas y sus retiros`} acciones={<Link className="rtm-boton" href="/socios">Cuenta de socios</Link>}>
              <div data-testid="balance-capital-socios">
                <DataTable
                  etiqueta="Capital contable por socio" densidad="densa" plana clave={(f) => f.clave} filas={filasCapitalPorSocio(val.cuenta, val.yo)}
                  columnas={[
                    { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (f) => <span data-testid={`bcs-${f.clave}`} className={f.nivel === 'rubro' ? 'sv-sangria' : f.nivel === 'memo' ? 'sv-memo' : 'sv-negrita'}>{f.etiqueta}</span> },
                    { id: 'm', titulo: 'Importe', numerica: true, ancho: 'm', celda: (f) => (f.cifra ? <CifraComprobada texto={m(f.monto_cent, f.nivel === 'rubro' && f.resta)} cifra={f.cifra} comprobacion="cuadra" /> : m(f.monto_cent)) },
                  ]}
                />
              </div>
              <div className="a3-pie-tarjeta" data-testid="balance-conciliacion-socios">
                <Pie>Suma por socio {m(val.cuenta.total.subtotal_cent)} = capital contable del libro {m(b.total_capital_cent)}: <Estado tono={val.cuenta.total.subtotal_cent === b.total_capital_cent ? 'ok' : 'malo'}>{val.cuenta.total.subtotal_cent === b.total_capital_cent ? 'Cuadra' : 'No cuadra'}</Estado>. Las valuaciones personales ({m(val.cuenta.total.valuacion_cent)}) más los fondos de la sociedad en poder de socios ({m(val.cuenta.total.fondos_en_poder_cent)}) son ese mismo capital contable.</Pie>
              </div>
            </Tarjeta>
          )}
          <Rejilla dividir="4-4-4">
            <Tarjeta titulo="Mayores partidas del activo"><BarList etiquetaAria="Partidas del activo" items={top('activo').map((r) => ({ id: r.codigo, etiqueta: r.nombre, texto: m(r.monto_cent), pct: pct(r.monto_cent, b.total_activo_cent) }))} /></Tarjeta>
            <Tarjeta titulo="Pasivo y capital"><BarList etiquetaAria="Partidas de pasivo y capital" items={[...top('pasivo'), ...top('capital')].slice(0, 6).map((r) => ({ id: r.codigo, etiqueta: r.nombre, texto: m(r.monto_cent), pct: pct(r.monto_cent, pasivoMasCapital) }))} /></Tarjeta>
            <Tarjeta titulo="Identidad contable" descripcion="Activo − pasivo − capital">
              <Cascada titulo="Cascada del balance" descripcion={`Activo ${m(b.total_activo_cent)}, pasivo ${m(b.total_pasivo_cent)}, capital ${m(b.total_capital_cent)}; diferencia ${m(b.diferencia_cent, true)}.`} pasos={pasos} unidad="Pesos" />
              <p className="a3-pie" data-testid="balance-comprobacion"><Estado tono={b.cuadra ? 'ok' : 'malo'}>{b.cuadra ? 'Cuadra' : 'No cuadra'}</Estado>{' '}Activo {m(b.total_activo_cent)} contra pasivo más capital {m(pasivoMasCapital)}. Diferencia {m(b.diferencia_cent)}.</p>
            </Tarjeta>
          </Rejilla>
        </>
      )}
      {b.fuera_de_libros.length > 0 && (
        <Tarjeta plana titulo="Memorando fuera de libros" descripcion="No forman parte del balance de la sociedad">
          <DataTable
            etiqueta="Partidas fuera de la sociedad"
            densidad="densa" plana
            clave={(x) => `${x.socio}-${x.concepto}`}
            filas={b.fuera_de_libros}
            totales={{ etiqueta: 'Total', celdas: { m: m(suma(b.fuera_de_libros.map((x) => x.monto_cent))) } }}
            columnas={[
              { id: 's', titulo: 'Socio', ancho: 'm', celda: (x) => x.socio },
              { id: 'c', titulo: 'Concepto', ancho: 'xl', celda: (x) => x.concepto },
              { id: 'e', titulo: 'Estado', ancho: 'm', secundaria: true, celda: (x) => x.estado.replaceAll('_', ' ') },
              { id: 'm', titulo: 'Monto', numerica: true, ancho: 'm', celda: (x) => m(x.monto_cent) },
            ]}
          />
          <div className="a3-pie-tarjeta"><Pie>Capital contable: aportaciones, retiros, utilidades por distribuir y resultado.</Pie></div>
        </Tarjeta>
      )}
    </Pagina>
  );
}
