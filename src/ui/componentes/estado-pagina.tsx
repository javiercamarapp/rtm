import Link from 'next/link';

/** Pantalla de carga: esqueleto con la forma de una pagina (titular y tres bloques). Sin animacion propia: solo tokens. */
export function PaginaCargando({ etiqueta = 'Cargando' }: { etiqueta?: string }) {
  return (
    <div className="rtm-cargando" role="status" aria-live="polite" aria-busy="true" data-testid="pagina-cargando">
      <span className="rtm-solo-lectores">{etiqueta}</span>
      <span className="rtm-esqueleto rtm-cargando-eyebrow" aria-hidden="true" />
      <span className="rtm-esqueleto rtm-cargando-titular" aria-hidden="true" />
      <span className="rtm-esqueleto rtm-cargando-bloque" aria-hidden="true" />
      <span className="rtm-esqueleto rtm-cargando-bloque" aria-hidden="true" />
      <span className="rtm-esqueleto rtm-cargando-bloque" aria-hidden="true" />
    </div>
  );
}

interface ErrorProps {
  /** Referencia corta del servidor (digest) para que un socio la dicte; nunca el mensaje interno. */
  referencia?: string | null;
  onReintentar: () => void;
  titulo?: string;
}

/** Error recuperable: dice que paso en palabras sencillas, ofrece reintentar y una salida al inicio. */
export function PaginaError({ referencia, onReintentar, titulo = 'No se pudo cargar esta pantalla' }: ErrorProps) {
  return (
    <section className="rtm-vacio" role="alert" data-testid="pagina-error">
      <h2>{titulo}</h2>
      <p>Pasó algo inesperado al pedir los datos. No se perdió nada de lo ya guardado. Intenta de nuevo; si sigue igual, avisa a Javier con la referencia.</p>
      {referencia && <p className="rtm-nota rtm-mono">Referencia: {referencia}</p>}
      <div className="rtm-acciones-fila">
        <button type="button" className="rtm-boton rtm-boton-primario" onClick={onReintentar} data-testid="reintentar">Reintentar</button>
        <Link className="rtm-boton" href="/">Ir al inicio</Link>
      </div>
    </section>
  );
}

/** 404 sobrio: dice que no existe y lleva al inicio. */
export function PaginaNoEncontrada({ volver = { href: '/', texto: 'Ir al inicio' } }: { volver?: { href: string; texto: string } }) {
  return (
    <section className="rtm-vacio" data-testid="pagina-no-encontrada">
      <h2>No encontramos esa página</h2>
      <p>La dirección no existe o el registro ya no está disponible. Revisa que el enlace esté completo.</p>
      <div className="rtm-acciones-fila">
        <Link className="rtm-boton rtm-boton-primario" href={volver.href}>{volver.texto}</Link>
      </div>
    </section>
  );
}
