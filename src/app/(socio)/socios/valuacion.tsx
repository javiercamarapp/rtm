import '@/ui/estilos/socios-valuacion.css';
import type { ReactNode } from 'react';
import { etiquetaMesCapital } from '@/dominio/capital/etiquetas';
import { alertaRetiros, fraseIgualar, notaDiferencias, puntosSerie, otroSocio, TEXTO_VALUACION_SUBE, type CuentaSociosValuacion, type FilaSocioValuacion, type Socio } from '@/dominio/socios/valuacion';
import { CifraComprobada } from '@/ui/componentes/cifra';
import { Tarjeta } from '@/ui/componentes/pagina';
import { AreaSerie, Contador } from '@/ui/graficas';
import { Estado, m, pct } from '../_a3/util';

const quien = (socio: Socio, yo: Socio | null) => (socio === yo ? 'tú' : socio);

/** Una tarjeta por socio: valuacion actual (cifra heroe animada), dos rubros claros, lo que resta y la composicion. */
export function TarjetaValuacionSocio({ f, yo }: { f: FilaSocioValuacion; yo: Socio | null }) {
  const propio = f.socio === yo;
  const pos = f.capital_aportado_cent + f.utilidades_acumuladas_cent;
  const pCap = pct(f.capital_aportado_cent, pos) ?? 0;
  const pUt = pos > 0n ? 100 - pCap : 0;
  const ver = propio ? 'tu' : 'su';
  return (
    <Tarjeta como="article" titulo={`${f.socio}${propio ? ' (tú)' : ''}`} className="sv-tarjeta">
      <div data-testid={`valuacion-${f.socio}`}>
        <p className="sv-etiqueta">Valuación actual</p>
        <p className="sv-heroe" data-testid={`valuacion-cifra-${f.socio}`}><Contador valor={Number(f.valuacion_cent)} tipo="moneda" /></p>
      </div>
      <ul className="sv-rubros" aria-label={`Desglose de la valuación de ${f.socio}`}>
        <li><span>Capital aportado ({propio ? 'lo que invertiste' : 'lo que invirtió'})</span><span data-testid={`capital-${f.socio}`}><CifraComprobada texto={m(f.capital_aportado_cent)} cifra={`historial:invertido:${f.socio}`} comprobacion="cuadra" /></span></li>
        <li><span>Utilidades acumuladas<small>Siempre 50 % y 50 %</small></span><span data-testid={`utilidades-${f.socio}`}><CifraComprobada texto={m(f.utilidades_acumuladas_cent)} cifra={`historial:utilidad:${f.socio}`} comprobacion="cuadra" /></span></li>
        <li className="sv-resta"><span>Retirado ({propio ? 'lo que te has pagado' : 'lo que se ha pagado'})<small>Resta</small></span><span data-testid={`retirado-${f.socio}`}><CifraComprobada texto={m(f.retirado_cent)} cifra={`historial:retirado:${f.socio}`} comprobacion="cuadra" /></span></li>
        {f.fondos_en_poder_cent > 0n && <li className="sv-resta"><span>Fondos de la sociedad en {ver} poder<small>Resta: dinero de la sociedad que aún no entrega</small></span><span data-testid={`fondos-${f.socio}`}>{m(f.fondos_en_poder_cent)}</span></li>}
        <li className="sv-total"><span>Valuación actual</span><span><CifraComprobada texto={m(f.valuacion_cent)} cifra={`historial:valor:${f.socio}`} comprobacion="cuadra" /></span></li>
      </ul>
      <div role="img" aria-label={`Composición: capital aportado ${pCap.toFixed(0)} %, utilidades acumuladas ${pUt.toFixed(0)} %`}>
        <div className="sv-barra"><span data-k="capital" style={{ width: `${pCap}%` }} /><span data-k="utilidad" style={{ width: `${pUt}%` }} /></div>
        <div className="sv-leyenda"><span><i data-k="capital" />Capital aportado</span><span><i data-k="utilidad" />Utilidades acumuladas</span></div>
      </div>
    </Tarjeta>
  );
}

export function ComparativaValuaciones({ c, yo }: { c: CuentaSociosValuacion; yo: Socio | null }) {
  const k = c.comparacion;
  const frase = fraseIgualar(c, m);
  const alerta = alertaRetiros(c, m);
  const nota = notaDiferencias(c, m);
  return (
    <Tarjeta titulo="Comparación entre los dos" descripcion="Siempre 50 % y 50 %: la inversión debe ser parecida, así que se comparan valuaciones" acciones={<Estado tono={k.igualados ? 'ok' : 'atencion'}>{k.igualados ? 'Igualados' : 'Por igualar'}</Estado>}>
      <ul className="sv-rubros" aria-label="Comparación de valuaciones">
        <li><span>Diferencia de valuación</span><span data-testid="dif-valuacion"><CifraComprobada texto={m(k.diferencia_valuacion_cent)} cifra={`historial:valor:${k.mayor ?? 'Javier'}`} comprobacion="cuadra" /></span></li>
        <li><span>Diferencia de aportación<small>Aportado menos fondos en poder: la inversión neta de cada uno</small></span><span data-testid="dif-aportacion"><CifraComprobada texto={m(k.diferencia_aportacion_cent)} cifra={`historial:neta:${k.turno_aportacion_neta ?? 'Angelo'}`} comprobacion="cuadra" /></span></li>
        <li><span>Le toca aportar</span><span data-testid="le-toca">{k.le_toca_aportar ? `${k.le_toca_aportar === yo ? 'Te toca a ti' : k.le_toca_aportar}: ${m(k.aportar_para_igualar_cent)}` : 'Nadie, están igualados'}</span></li>
      </ul>
      <p className="sv-frase" data-testid="frase-igualar">{frase.texto}</p>
      {nota && <p className="sv-explica" data-testid="nota-diferencias">{nota}</p>}
      {alerta && <p className="sv-alerta" role="alert" data-testid="alerta-retiros">{alerta}</p>}
      <p className="sv-explica" data-testid="texto-sube">{TEXTO_VALUACION_SUBE} La valuación es lo que invertiste más las utilidades acumuladas, menos lo que te has pagado.</p>
    </Tarjeta>
  );
}

export function PanelCuadra({ c }: { c: CuentaSociosValuacion }) {
  const rojas = c.identidades.filter((i) => !i.ok);
  const s2 = c.identidades.find((i) => i.id === 'S2');
  return (
    <Tarjeta titulo="Cuadra" descripcion="Identidades que siempre deben cumplirse" acciones={<Estado tono={rojas.length === 0 ? 'ok' : 'malo'}>{rojas.length === 0 ? 'Todo cuadra' : `${rojas.length} por revisar`}</Estado>}>
      <ul className="sv-cuadra" data-testid="panel-cuadra">
        {c.identidades.map((i) => (
          <li key={i.id} data-testid={`cuadra-${i.id}`} data-ok={i.ok}>
            <span>{i.nombre}</span>
            <Estado tono={i.ok ? 'ok' : i.tipo === 'alerta' ? 'atencion' : 'malo'}>{i.ok ? 'Cuadra' : i.tipo === 'alerta' ? 'Alerta' : 'No cuadra'}</Estado>
            <span className="sv-cuentas">{i.a_nombre} {m(i.a_cent)} · {i.b_nombre} {m(i.b_cent)}</span>
          </li>
        ))}
      </ul>
      {s2 && <p className="sv-explica" data-testid="conciliacion-capital">Suma por socio {m(s2.a_cent)} = capital contable del libro {m(s2.b_cent)}. Más los fondos de la sociedad en poder de socios ({m(c.total.fondos_en_poder_cent)}) y menos las valuaciones personales ({m(c.total.valuacion_cent)}) queda cero: valuaciones personales + fondos = activo ({m(c.balance.total_activo_cent)}) menos pasivo ({m(c.balance.total_pasivo_cent)}).</p>}
    </Tarjeta>
  );
}

export function SerieValuacion({ c, yo }: { c: CuentaSociosValuacion; yo: Socio | null }) {
  const orden: Socio[] = yo ? [yo, otroSocio(yo)] : ['Angelo', 'Javier'];
  return (
    <div className="sv-par" data-testid="serie-valuacion">
      {orden.map((s) => {
        const pts = puntosSerie(c, s);
        const mesTxt = (mes: string) => etiquetaMesCapital(mes);
        return (
          <Tarjeta key={s} titulo={`Valuación de ${quien(s, yo)} por mes`} descripcion="Al cierre de cada mes; sube con las utilidades y baja solo con retiros">
            <AreaSerie titulo={`Valuación de ${s} por mes`} descripcion={`Valuación mensual de ${s}: ${pts.map((p) => `${mesTxt(p.mes)} ${m(BigInt(p.valor))}`).join(', ')}`} unidad="Pesos" procedencia="observado"
              puntos={pts.map((p, i) => ({ id: p.mes, etiqueta: mesTxt(p.mes), valor: p.valor, texto: m(BigInt(p.valor)), parcial: i === pts.length - 1 && c.serie[i]?.parcial }))} />
          </Tarjeta>
        );
      })}
    </div>
  );
}

export function SeccionDeudaProveedores({ c }: { c: CuentaSociosValuacion }) {
  const p = c.proveedores;
  const fila = (k: string, v: ReactNode, t?: string) => <li key={k}><span>{k}</span><span data-testid={t}>{v}</span></li>;
  return (
    <Tarjeta titulo="Deuda con proveedores" descripcion="Posición completa del libro (cuentas de Isaac y Karen), separada de los pedidos de Angelo a costo">
      <ul className="sv-rubros">
        {p.detalle.map((d) => fila(`Se le debe a ${d.proveedor}`, m(d.saldo_cent < 0n ? 0n : d.saldo_cent), `prov-${d.proveedor}`))}
        {fila('Total en cuentas de proveedores', m(p.se_debe_cent), 'prov-total')}
        {p.pedidos_socio_a_costo_cent !== null && fila('Pedidos de Angelo a costo (los paga el socio)', m(p.pedidos_socio_a_costo_cent), 'prov-pedidos-socio')}
        {p.deuda_empresa_cent !== null && <li className="sv-total"><span>Deuda de la empresa</span><span data-testid="prov-empresa">{m(p.deuda_empresa_cent)}</span></li>}
      </ul>
      <p className="sv-explica">{p.nota}</p>
    </Tarjeta>
  );
}
