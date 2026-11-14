import Link from 'next/link';
import { vistaBanner, type BannerIgualacion } from '@/dominio/socios/banner-igualar';
import type { Socio } from '@/dominio/socios/valuacion';
import { etiquetaFecha, formatearMoneda } from '@/dominio/formato';
import { CifraComprobada } from './cifra';
import '@/ui/estilos/banner-igualar.css';

/** Banner de Inicio: "debemos estar igualados de valuacion siempre". Todas las cifras vienen de la base; aqui solo se muestran.
 *  Desaparece solo cuando la base dice igualados (tolerancia de 1 centavo). Para quien esta por debajo es una accion (role alert); para el otro, informativo (role status). */
export function BannerIgualar({ banner, yo }: { banner: BannerIgualacion | null | undefined; yo: Socio | null }) {
  const v = vistaBanner(banner, yo, formatearMoneda, etiquetaFecha);
  if (!v) return null;
  const repone = v.variante === 'repone';
  return (
    <section className="bi-banner" data-variante={v.variante} role={v.rol} aria-labelledby="bi-titulo" data-testid="banner-igualar">
      <div className="bi-cabeza">
        <p className="bi-rotulo" data-testid="banner-rotulo">{v.rotulo}</p>
        <h2 id="bi-titulo" className="bi-titulo" data-testid="banner-titulo">
          {repone ? <>Debes reponer <CifraComprobada texto={v.faltanTexto} cifra={`historial:valor:${banner?.mayor ?? 'Javier'}`} comprobacion="cuadra" /> para igualar valuación</> : v.titulo}
        </h2>
      </div>
      <ul className="bi-partidas" aria-label="Partidas para igualar">
        {v.partidas.map((p) => (
          <li key={p.id} data-testid={`banner-${p.id}`}>
            <span className="bi-texto">{p.texto}</span>
            <span className="bi-monto">{p.monto}</span>
            {repone && <Link className="rtm-boton rtm-boton-chico bi-ir" href={p.href} data-testid={`banner-ir-${p.id}`}>{p.id === 'entregar' ? 'Registrar entrega' : 'Registrar aportación'}</Link>}
          </li>
        ))}
      </ul>
      {v.neteo && <p className="bi-nota" data-testid="banner-neteo">{v.neteo}</p>}
      {v.antiguedad && <p className="bi-nota" data-testid="banner-antiguedad">{v.antiguedad}</p>}
      {v.progreso && (
        <div className="bi-progreso" data-testid="banner-progreso">
          <div className="bi-pista" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v.progreso.pct} aria-label="Avance de la entrega de fondos"><svg className="bi-relleno" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width={v.progreso.pct} height="6" /></svg></div>
          <p className="bi-nota">{v.progreso.texto}</p>
        </div>
      )}
      {v.entregas.length > 0 && (
        <details className="bi-detalle" data-testid="banner-entregas">
          <summary>Entregas registradas ({v.entregas.length})</summary>
          <ul>{v.entregas.map((e, i) => <li key={i}><span>{e.texto}</span><span>{e.monto}</span></li>)}</ul>
        </details>
      )}
      <details className="bi-detalle" data-testid="banner-explica">
        <summary>Explicar este número</summary>
        <p className="bi-nota">{v.explicacion}</p>
      </details>
    </section>
  );
}
