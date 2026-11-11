// Tipos puros del agente de Telegram. Sin red, sin base, sin reloj: todo entra como parametro.

export type Persona = 'angelo' | 'javier' | 'omar';
/** socio = Angelo o Javier; omar = persona de la bodega (solo tomas y consultas propias). */
export type RolMiembro = 'socio' | 'omar';
export type DestinoChat = 'grupo_socios' | 'privado_omar';

export interface Miembro {
  telegramUserId: number;
  persona: Persona;
  rol: RolMiembro;
}

export interface ChatsRegistrados {
  grupoSocios: number;
  privadoOmar: number;
}

export type FuenteMensaje = 'texto' | 'audio' | 'imagen' | 'reenviado' | 'comando';

/** Cifra que solo puede provenir del servidor (nunca del modelo). */
export type CifraServidor =
  | { tipo: 'pesos'; etiqueta: string; centavos: bigint }
  | { tipo: 'piezas'; etiqueta: string; piezas: number }
  | { tipo: 'folio'; etiqueta: string; folio: string }
  | { tipo: 'texto'; etiqueta: string; texto: string };

export class ErrorAgente extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorAgente';
  }
}

export class ErrorCifraAjena extends ErrorAgente {
  constructor(readonly ajenas: string[]) {
    super('cifra_ajena', `La respuesta contiene cifras que no vienen del servidor (${ajenas.length}).`);
    this.name = 'ErrorCifraAjena';
  }
}

export class ErrorFugaOmar extends ErrorAgente {
  constructor(readonly termino: string) {
    super('fuga_omar', 'Mensaje a Omar con contenido fuera de la lista blanca.');
    this.name = 'ErrorFugaOmar';
  }
}
