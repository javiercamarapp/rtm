import Link from 'next/link';
import { datosDeSocio } from '@/composicion/datos';
import { inventarioDeSocio } from '@/composicion/inventario';
import type { FilaKardex } from '@/dominio/datos/tipos';
import { etiquetaFechaHora } from '@/dominio/formato';
import { BarList } from '@/ui/componentes/datos';
import { DataTable, type Columna } from '@/ui/componentes/data-table';
import { EstadoTexto, SinDato } from '@/ui/componentes/estado-texto';
import { FilaRatios, KpiLinea } from '@/ui/componentes/kpi';
import { EncabezadoPagina, Pagina, Rejilla, Tarjeta } from '@/ui/componentes/pagina';
import { Paginador } from '@/ui/componentes/datos';
import { Pestanas } from '@/ui/componentes/controles';
import { AreaSerie, ColumnasPeriodo } from '@/ui/graficas';
import { Campo, FiltrosUrl } from './filtros-url';
import { TIPO_MOV, dec, enlace, enteroParam, fecha, fechaParam, hoyNeg, m, pz, pzs, fechaCorta, semanaEtiqueta, textoParam, type Params } from './util';

const PASO = 200;
type Fila = { clave: string; inicial: true; piezas: number; valor: bigint; costo: bigint | null } | { clave: string; inicial?: false; k: FilaKardex };

const TABS: { id: string; etiqueta: string }[] = [
  { id: 'entrada_compra', etiqueta: 'Entradas de compra' }, { id: 'salida_pedido', etiqueta: 'Salidas de pedido' }, { id: 'salida_toma_omar', etiqueta: 'Tomas de Omar' },
  { id: 'merma', etiqueta: 'Mermas' }, { id: 'ajuste_conteo', etiqueta: 'Ajustes de conteo' }, { id: 'devolucion', etiqueta: 'Devoluciones' }, { id: 'reversa', etiqueta: 'Reversas' },
];

/** Kardex enterprise: V1 consolidado (todos los modelos, una marca o un modelo) y V2 por sabor. El valor del sabor es "valor a costo del modelo". */
export async function VistaKardex({ sp, modo }: { sp: Params; modo: 'consolidado' | 'sabor' }) {
  const base = modo === 'sabor' ? '/inventario/kardex/sabor' : '/inventario/kardex';
  const datos = await datosDeSocio();
  const inv = await (await inventarioDeSocio()).completo();
  const conDato = inv.modelos.filter((x) => x.piezas !== null);
  let modeloId = enteroParam(sp.modelo);
  let sku = enteroParam(sp.sku);
  if (modo === 'sabor') {
    modeloId = modeloId ?? conDato.find((x) => x.sabores.length > 0)?.modelo_id ?? null;
    const del = conDato.find((x) => x.modelo_id === modeloId);
    if (!del?.sabores.some((s) => s.sku_id === sku)) sku = del?.sabores[0]?.sku_id ?? null;
  }
  const marca = textoParam(sp.marca);
  const ini = fechaParam(sp.ini); const fin = fechaParam(sp.fin);
  const tipo = textoParam(sp.tipo); const q = textoParam(sp.q);
  const pagina = Math.max(0, (enteroParam(sp.pag) ?? 1) - 1);
  const filtro = { marca, modelo: modeloId, sku, ini, fin, tipo: tipo && TIPO_MOV[tipo] ? tipo : null, q, limite: PASO, desplazamiento: pagina * PASO };
  const k = await datos.kardexConsolidado(filtro);
  const tabsBase = filtro.tipo ? await datos.kardexConsolidado({ ...filtro, tipo: null, limite: 1, desplazamiento: 0 }) : k;

  const modelo = k.modelos.find((x) => x.id === modeloId) ?? null;
  const sabores = conDato.find((x) => x.modelo_id === modeloId)?.sabores ?? [];
  const saborSel = k.sabor;
  const unico = modeloId !== null;
  const titulo = modo === 'sabor' ? (saborSel ? `${saborSel.sabor} de ${saborSel.modelo}` : 'Kárdex por sabor') : modelo ? `Movimientos de ${modelo.nombre}` : marca ? `Kárdex de ${marca}` : 'Kárdex de todos los modelos';
  const exportar = new URLSearchParams(Object.entries({ marca, modelo: modeloId, sku, ini, fin, tipo: filtro.tipo, q }).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([a, v]) => [a, String(v)]));
  const sinMov = k.total === 0 && k.inicial.piezas === 0 && k.totales.n === 0;

  // Filas: primero el saldo inicial (solo en la primera pagina y con fecha de inicio), despues los movimientos en orden cronologico.
  const filas: Fila[] = [];
  if (pagina === 0 && ini) filas.push({ clave: 'ini', inicial: true, piezas: k.inicial.piezas, valor: k.inicial.valor_cent, costo: k.inicial.costo_prom_cent });
  for (const x of k.movimientos) filas.push({ clave: String(x.id), k: x });

  const vS = modo === 'sabor';
  const cel = <T,>(f: Fila, fn: (x: FilaKardex) => T) => (f.inicial ? null : fn(f.k));
  const columnas: Columna<Fila>[] = [
    { id: 'f', titulo: 'Fecha', ancho: 's', prioridadMovil: 'titulo', celda: (f) => (f.inicial ? <strong>Saldo inicial</strong> : <span className="rtm-num" title={etiquetaFechaHora(f.k.hora)}>{fechaCorta(f.k.fecha_neg)}</span>) },
    { id: 't', titulo: 'Concepto', ancho: 'm', prioridadMovil: 'titulo', celda: (f) => (f.inicial ? 'Antes del periodo' : (
      <span className={f.k.es_reversa ? 'rtm-a2-reversa' : 'rtm-a2-etiqueta-tipo'} data-testid={f.k.es_reversa ? 'kardex-reversa' : undefined}>{TIPO_MOV[f.k.tipo] ?? f.k.tipo}</span>
    )) },
    ...(vS ? [] : unico
      ? [{ id: 's', titulo: 'Sabor', ancho: 'm' as const, prioridadMovil: 'detalle' as const, celda: (f: Fila) => cel(f, (x) => x.sabor) }]
      : [{ id: 'mo', titulo: 'Modelo › sabor', ancho: 'l' as const, truncar: 'm' as const, prioridadMovil: 'detalle' as const, celda: (f: Fila) => cel(f, (x) => <span className="rtm-a2-nowrap">{x.modelo}<span className="rtm-a2-nota"> › {x.sabor}</span></span>) }]),
    { id: 'ec', prioridadMovil: 'normal' as const, etiquetaMovil: 'Entra pzs', titulo: 'Piezas', bloque: 'Entradas', numerica: true, ancho: 's', celda: (f) => cel(f, (x) => (x.entra_piezas === null ? '' : pzs(x.entra_piezas))) },
    { id: 'eu', prioridadMovil: 'oculta' as const, ocultarBajo: 1360 as const, titulo: 'V. unit.', bloque: 'Entradas', numerica: true, ancho: 's', celda: (f) => cel(f, (x) => (x.entra_unit_cent === null ? '' : m(x.entra_unit_cent))) },
    { id: 'et', prioridadMovil: 'normal' as const, etiquetaMovil: 'Entra total', titulo: 'Total', bloque: 'Entradas', numerica: true, ancho: 'm', celda: (f) => cel(f, (x) => (x.entra_total_cent === null ? '' : m(x.entra_total_cent))) },
    { id: 'sc', prioridadMovil: 'normal' as const, etiquetaMovil: 'Sale pzs', titulo: 'Piezas', bloque: 'Salidas', numerica: true, ancho: 's', celda: (f) => cel(f, (x) => (x.sale_piezas === null ? '' : pzs(x.sale_piezas))) },
    { id: 'su', prioridadMovil: 'oculta' as const, ocultarBajo: 1360 as const, titulo: 'V. unit.', bloque: 'Salidas', numerica: true, ancho: 's', celda: (f) => cel(f, (x) => (x.sale_unit_cent === null ? '' : m(x.sale_unit_cent))) },
    { id: 'st', prioridadMovil: 'normal' as const, etiquetaMovil: 'Sale total', titulo: 'Total', bloque: 'Salidas', numerica: true, ancho: 'm', celda: (f) => cel(f, (x) => (x.sale_total_cent === null ? '' : m(x.sale_total_cent))) },
    ...(vS ? [
      { id: 'xc', titulo: 'Piezas', prioridadMovil: 'principal' as const, etiquetaMovil: 'Existencia', bloque: 'Existencias del sabor', numerica: true, ancho: 's' as const, resaltar: (f: Fila) => (f.inicial ? null : f.k.saldo_sabor_piezas === 0 ? ('cero' as const) : f.k.saldo_sabor_piezas < 0 ? ('negativo' as const) : null), celda: (f: Fila) => (f.inicial ? pzs(f.piezas) : pzs(f.k.saldo_sabor_piezas)) },
      { id: 'xu', prioridadMovil: 'oculta' as const, titulo: 'Costo mod.', bloque: 'Existencias del sabor', numerica: true, ancho: 's' as const, celda: (f: Fila) => (f.inicial ? m(f.costo) ?? <SinDato /> : (m(f.k.costo_prom_cent) ?? <SinDato />)) },
      { id: 'xt', prioridadMovil: 'normal' as const, etiquetaMovil: 'Exist. valor', titulo: 'Valor a costo', bloque: 'Existencias del sabor', numerica: true, ancho: 'm' as const, celda: (f: Fila) => (f.inicial ? m(f.valor) : (m(f.k.saldo_sabor_valor_cent) ?? <SinDato />)) },
    ] : [
      { id: 'xc', titulo: 'Piezas', prioridadMovil: 'principal' as const, etiquetaMovil: 'Existencia', bloque: 'Existencias', numerica: true, ancho: 's' as const, resaltar: (f: Fila) => (f.inicial ? null : f.k.saldo_piezas === 0 ? ('cero' as const) : f.k.saldo_piezas < 0 ? ('negativo' as const) : null), celda: (f: Fila) => (f.inicial ? pzs(f.piezas) : pzs(f.k.saldo_piezas)) },
      { id: 'xu', prioridadMovil: 'oculta' as const, titulo: 'V. unit.', bloque: 'Existencias', numerica: true, ancho: 's' as const, celda: (f: Fila) => (f.inicial ? m(f.costo) ?? <SinDato /> : (m(f.k.costo_prom_cent) ?? <SinDato />)) },
      { id: 'xt', prioridadMovil: 'normal' as const, etiquetaMovil: 'Exist. valor', titulo: 'Total', bloque: 'Existencias', numerica: true, ancho: 'm' as const, celda: (f: Fila) => (f.inicial ? m(f.valor) : m(f.k.saldo_valor_cent)) },
      { id: 'xs', prioridadMovil: 'normal' as const, titulo: 'Del sabor', numerica: true, ancho: 's' as const, celda: (f: Fila) => cel(f, (x) => pzs(x.saldo_sabor_piezas)) },
    ]),
    { id: 'r', titulo: 'Referencia', ancho: 'm', truncar: 's', prioridadMovil: 'oculta', celda: (f) => cel(f, (x) => <span className="rtm-mono">{x.referencia}{x.reversa_de ? ` · corrige ${x.reversa_de}` : ''}</span>) },
    { id: 'a', titulo: 'Autor', ancho: 'm', truncar: 's', prioridadMovil: 'oculta', celda: (f) => cel(f, (x) => x.autor ?? 'Sistema') },
    { id: 'ms', titulo: 'Mensaje original', ancho: 'xl', truncar: 'm', prioridadMovil: 'oculta', celda: (f) => cel(f, (x) => (x.mensaje_origen ? <span className="rtm-a2-mono-mensaje" title={x.mensaje_origen}>“{x.mensaje_origen}”</span> : '')) },
  ];

  const t = k.totales;
  const kpis = [
    { id: 'ini', etiqueta: 'Existencia inicial', valor: pz(k.inicial.piezas), nota: ini ? `${m(k.inicial.valor_cent)}${k.inicial.costo_prom_cent !== null ? ` · prom. ${m(k.inicial.costo_prom_cent)}` : ''}` : 'Desde el inicio del libro', categoria: 1 as const },
    { id: 'ent', etiqueta: 'Entradas del periodo', valor: pz(t.entradas_piezas), nota: m(t.entradas_valor_cent), categoria: 2 as const },
    { id: 'sal', etiqueta: 'Salidas del periodo', valor: pz(t.salidas_piezas), nota: m(t.salidas_valor_cent), categoria: 3 as const },
    { id: 'fin', etiqueta: 'Existencia final', valor: pz(k.final.piezas), nota: m(k.final.valor_cent), categoria: 4 as const, testid: 'kardex-final' },
    { id: 'cp', etiqueta: vS ? 'Costo del modelo' : 'Costo promedio final', valor: vS ? m(k.movimientos.length ? k.movimientos[k.movimientos.length - 1]!.costo_prom_cent : null) : m(k.final.costo_prom_cent), nota: vS ? 'Valor del sabor a costo del modelo' : 'Promedio móvil', categoria: 5 as const },
    { id: 'ok', etiqueta: 'Comprobación', valor: <EstadoTexto tono={k.comprobacion.cuadra ? 'ok' : 'malo'}>{k.comprobacion.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>, nota: 'Dos vías', categoria: 6 as const },
  ];

  // Series: existencia acumulada por semana (inicial + entradas - salidas) y salidas por semana. Solo aritmetica de piezas ya entregadas por la base.
  const semanas = [...k.semanas].sort((a, b) => a.semana.localeCompare(b.semana));
  let acum = k.inicial.piezas;
  const existencia = semanas.map((s) => { acum += s.entradas_piezas - s.salidas_piezas; return { id: s.semana, etiqueta: semanaEtiqueta(s.semana), valor: acum, texto: pz(acum) ?? '' }; });
  const costos = k.entradas_costo.filter((c) => c.costo_prom_cent !== null);
  const hoyIso = hoyNeg();
  const parcial = (sem: string) => Date.parse(`${sem}T00:00:00Z`) + 7 * 86_400_000 > Date.parse(`${hoyIso}T00:00:00Z`);
  const maxTipo = k.por_tipo.reduce((a, b) => (b.valor_cent > a ? b.valor_cent : a), 0n);
  const paginas = Math.max(1, Math.ceil(k.total / PASO));
  const pie = `Fuente: libro de movimientos · ${k.total} renglones del filtro`;
  const sd = k.final.piezas;

  const tabs = [{ id: '', etiqueta: 'Todos', n: tabsBase.total }, ...TABS.map((x) => ({ ...x, n: tabsBase.por_tipo.find((p) => p.tipo === x.id)?.n ?? 0 })).filter((x) => x.n > 0 || x.id === filtro.tipo)];

  return (
    <Pagina ancho="tablero">
      <EncabezadoPagina
        eyebrow={vS ? 'Inventario · kárdex por sabor' : 'Inventario · kárdex'}
        titulo={titulo}
        descripcion={vS ? 'Entradas, salidas y existencias del sabor. El valor es a costo del modelo: la base guarda piezas por sabor, no su costo.' : 'Entradas, salidas y existencias con cantidad, valor unitario y valor total; costo promedio móvil por modelo.'}
        acciones={<a className="rtm-boton" href={`/inventario/kardex/exportar${exportar.size ? `?${exportar}` : ''}`} data-testid="kardex-exportar">Exportar CSV</a>}
      />
      <FiltrosUrl etiquetaAria="Filtros del kárdex" restablecer={base}>
        {modo === 'consolidado' && (
          <Campo etiqueta="Marca">
            <select name="marca" defaultValue={marca ?? ''}><option value="">Todas</option>{k.marcas.map((x) => <option key={x} value={x}>{x}</option>)}</select>
          </Campo>
        )}
        <Campo etiqueta="Modelo">
          <select name="modelo" defaultValue={modeloId ? String(modeloId) : ''} data-testid="kardex-modelo">
            {modo === 'consolidado' && <option value="">Todos</option>}
            {k.modelos.filter((x) => modo === 'sabor' || !marca || x.marca === marca).map((x) => <option key={x.id} value={x.id}>{x.marca} · {x.nombre}</option>)}
          </select>
        </Campo>
        {unico && (
          <Campo etiqueta="Sabor">
            <select name="sku" defaultValue={sku ? String(sku) : ''}>{modo === 'consolidado' && <option value="">Todos</option>}{sabores.map((s) => <option key={s.sku_id} value={s.sku_id}>{s.sabor}</option>)}</select>
          </Campo>
        )}
        <Campo etiqueta="Desde"><input type="date" name="ini" defaultValue={ini ?? ''} /></Campo>
        <Campo etiqueta="Hasta"><input type="date" name="fin" defaultValue={fin ?? ''} /></Campo>
        <Campo etiqueta="Buscar"><input type="search" name="q" placeholder="Folio, sabor o mensaje" defaultValue={q ?? ''} data-noauto="" /></Campo>
        {filtro.tipo && <input type="hidden" name="tipo" value={filtro.tipo} />}
      </FiltrosUrl>

      <KpiLinea etiquetaAria="Resumen del kárdex" celdas={kpis} />
      <p className="rtm-a2-comprobacion" data-testid="kardex-comprobacion">
        <span>Comprobación por dos vías: {k.comprobacion.via1.toLowerCase()} {m(k.comprobacion.via1_valor_cent)}; {k.comprobacion.via2.toLowerCase()} {m(k.comprobacion.via2_valor_cent)}</span>
        <EstadoTexto tono={k.comprobacion.cuadra ? 'ok' : 'malo'}>{k.comprobacion.cuadra ? 'Cuadra' : 'No cuadra'}</EstadoTexto>
        {k.cuadre_periodo.aplica && <span>· Periodo: inicial más entradas menos salidas = {pz(k.cuadre_periodo.esperado_piezas)} <EstadoTexto tono={k.cuadre_periodo.esperado_piezas === k.cuadre_periodo.final_piezas ? 'ok' : 'malo'}>{k.cuadre_periodo.esperado_piezas === k.cuadre_periodo.final_piezas ? 'Cuadra' : 'No cuadra'}</EstadoTexto></span>}
      </p>
      {saborSel && (
        <FilaRatios etiqueta="Datos del sabor" items={[
          { etiqueta: 'Existencia actual', valor: pz(saborSel.piezas) },
          { etiqueta: 'Del modelo', valor: saborSel.piezas_modelo > 0 ? `${dec((saborSel.piezas / saborSel.piezas_modelo) * 100)} %` : null }, { etiqueta: 'Cobertura', valor: saborSel.cobertura_dias === null ? null : `${dec(saborSel.cobertura_dias)} d` },
          { etiqueta: 'Última entrada', valor: fecha(saborSel.ultima_entrada) }, { etiqueta: 'Última salida', valor: fecha(saborSel.ultima_salida) },
        ]} />
      )}

      {semanas.length >= 2 && (
        <Rejilla dividir="4-4-4">
          <Tarjeta>
            <AreaSerie titulo="Existencia por semana" descripcion={`Existencia en piezas al cierre de ${existencia.length} semanas; ahora ${pz(sd)}.`} unidad="Piezas" procedencia="observado" pie={pie} alto={140}
              puntos={existencia.map((p, i) => ({ ...p, parcial: i === existencia.length - 1 && parcial(semanas[i]!.semana) }))} />
          </Tarjeta>
          <Tarjeta>
            <ColumnasPeriodo titulo="Salidas por semana" descripcion={`Piezas que salieron en ${semanas.length} semanas.`} unidad="Piezas" procedencia="observado" pie={pie} alto={140}
              datos={semanas.map((s, i) => ({ id: s.semana, etiqueta: semanaEtiqueta(s.semana), valor: s.salidas_piezas, texto: pz(s.salidas_piezas) ?? '', parcial: i === semanas.length - 1 && parcial(s.semana), detalle: `Entradas ${pz(s.entradas_piezas)} · ${m(s.entradas_valor_cent)}` }))} />
          </Tarjeta>
          {costos.length >= 2 ? (
            <Tarjeta>
              <AreaSerie titulo="Costo promedio tras cada entrada" descripcion={`Costo promedio del modelo en ${costos.length} entradas de compra.`} unidad="Pesos" procedencia="observado" pie={pie} alto={140}
                puntos={costos.map((c, i) => ({ id: `${c.fecha_neg}-${i}`, etiqueta: fecha(c.fecha_neg) ?? '', valor: Number(c.costo_prom_cent) / 100, texto: m(c.costo_prom_cent) ?? '' }))} />
            </Tarjeta>
          ) : (
            <Tarjeta titulo="Movimiento por tipo" descripcion="Valor absoluto de cada tipo">
              <BarList etiquetaAria="Valor por tipo de movimiento" items={k.por_tipo.map((p) => ({ id: p.tipo, etiqueta: TIPO_MOV[p.tipo] ?? p.tipo, texto: `${pz(p.piezas)} · ${m(p.valor_cent)}`, pct: maxTipo > 0n ? Math.round((Number(p.valor_cent) / Number(maxTipo)) * 100) : null }))} />
            </Tarjeta>
          )}
        </Rejilla>
      )}

      <Tarjeta plana className="rtm-a2-tabla" titulo={vS ? 'Kárdex del sabor' : 'Kárdex'} descripcion={`${t.n} renglones · orden cronológico`}>
        <Pestanas etiquetaAria="Tipo de movimiento" items={tabs.map((x) => ({ id: x.id || 'todos', etiqueta: x.etiqueta, href: enlace(base, sp, { tipo: x.id || null, pag: null }), activa: (filtro.tipo ?? '') === x.id, contador: x.n }))} />
        {sinMov ? (
          <div className="rtm-a2-vacio-tabla">Sin movimientos con este filtro. Cambia las fechas, el sabor o la búsqueda.</div>
        ) : (
          <DataTable
            etiqueta={vS ? 'Kárdex por sabor' : 'Kárdex por modelo y sabor'}
            clave={(f) => f.clave}
            filas={filas}
            densidad="libro" pegajosa primeraFija plana
            columnas={columnas}
            totales={{
              etiqueta: 'Totales',
              celdas: { ec: pzs(t.entradas_piezas), et: m(t.entradas_valor_cent), sc: pzs(t.salidas_piezas), st: m(t.salidas_valor_cent), xc: pzs(k.final.piezas), xt: m(k.final.valor_cent), xu: vS ? m(null) : m(k.final.costo_prom_cent) },
            }}
          />
        )}
        <div className="rtm-a2-pie-tabla">
          <Paginador mostrados={k.movimientos.length} total={k.total} anterior={pagina > 0 ? enlace(base, sp, { pag: pagina === 1 ? null : pagina }) : undefined} siguiente={pagina + 1 < paginas ? enlace(base, sp, { pag: pagina + 2 }) : undefined} />
          <span>Página {pagina + 1} de {paginas} · {PASO} renglones por página · totales del filtro completo</span>
        </div>
      </Tarjeta>
      <p className="rtm-a2-nota">{vS ? <><strong>Valor a costo del modelo.</strong> La base guarda las piezas de cada sabor, no su costo: el valor del sabor es sus piezas por el costo promedio del modelo en ese momento. Una reversa se muestra tachada y enlaza al movimiento que corrige. </> : 'Valor y costo promedio son del modelo; las piezas por sabor se muestran en la columna «Del sabor». Una reversa se muestra tachada. '}Ver el mismo detalle <Link href={vS ? enlace('/inventario/kardex', { modelo: modeloId ? String(modeloId) : '' }, {}) : '/inventario/kardex/sabor'}>{vS ? 'por modelo' : 'por sabor'}</Link>.</p>
    </Pagina>
  );
}
