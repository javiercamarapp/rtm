// Pulso de 4 chips. Sin libro de eventos todavia: se muestra "Sin dato", nunca un cero inventado.
const CHIPS = ['Por pagar a Isaac', 'Por cobrar', 'Entre socios', 'En bodega'] as const;

export function Pulso() {
  return (
    <>
      {CHIPS.map((etiqueta) => (
        <span key={etiqueta} className="rtm-chip">
          {etiqueta}
          <b>Sin dato</b>
        </span>
      ))}
    </>
  );
}
