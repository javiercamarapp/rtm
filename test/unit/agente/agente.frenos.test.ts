// Carril FRENOS del bot de Telegram (decisiones del dueno, 14-nov): sin tarjeta de confirmacion; el bot pregunta lo que falte; interruptor de escritura (/lectura y /escritura);
// antiduplicado por contenido; cobro mayor a lo que debe = pregunta; eco rico; deshacer 10 minutos para todos; sin topes ocultos (lotes por partes); lease de updates;
// migracion del grupo a supergrupo. Cada prueba es una CONVERSACION simulada: mensaje del socio, preguntas del bot, respuestas, registro y mensaje final.
import { describe, it, expect, vi } from 'vitest';
import { escenario, pago, pedido, unaAccion, IDS } from './ayudas';
import { respuesta } from '@/infra/agente/llm_simulado';
import type { Intencion } from '@/dominio/agente/intenciones';
import { manejarWebhook } from '@/infra/agente/telegram_webhook';
import { partirMensaje } from '@/dominio/agente/partes';
import { esMontoAbreviado } from '@/dominio/agente/monto_abreviado';

const gasto = (centavos: number, quien: 'angelo' | 'javier' = 'angelo'): Intencion => ({ tipo: 'gasto', gasto: 'uber', monto_centavos: centavos, pagado_por: quien, descripcion: null, fuente_cita: 'cita' });

describe('sin tarjeta: el bot registra cuando tiene todos los datos y pregunta lo que falta', () => {
  it('el cobro completo se registra directo, con eco rico (cliente, cuenta, saldos de la base) y boton Deshacer', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]])), unaAccion(pago('Cliente Norte', 300_000, 'Efectivo'))]);
    e.negocio.guardas.exceso = true;
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    await e.socio('angelo', 'Cliente Norte pago 3,000 en efectivo');
    const eco = e.ultimoGrupo();
    expect(e.textosGrupo().join('\n')).not.toContain('Resumen para confirmar');
    expect(eco.texto).toContain('Registrado');
    expect(eco.texto).toContain('Aplicado a:');
    expect(eco.texto).toContain('Cliente: Cliente Norte');
    expect(eco.texto).toContain('Cuenta: Efectivo');
    expect(eco.texto).toContain('Saldo del cliente antes: $7,000.00');
    expect(eco.texto).toContain('Saldo del cliente despues: $4,000.00');
    expect(eco.botones?.[0]?.[0]?.texto).toBe('Deshacer');
    expect(e.negocio.saldoCliente('c1')).toBe(400_000n);
  });

  it('si falta la cuenta, PREGUNTA con botones y solo escribe al contestar', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000, null))]);
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('a que cuenta entro el pago');
    expect(q.botones?.flat().map((b) => b.texto)).toContain('Isaac');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 2);
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.ultimoGrupo().texto).toContain('Cuenta: Isaac');
  });

  it('un monto escrito con "mil" se repite con la cifra completa antes de registrar', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 700_000))]);
    await e.socio('angelo', 'Cliente Norte pago 7 mil');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    expect(e.ultimoGrupo().texto).toContain('cifra completa');
    expect(esMontoAbreviado('pago 7 mil', 700_000n)).toBe(true);
    expect(esMontoAbreviado('pago 7,000', 700_000n)).toBe(false);
    expect(esMontoAbreviado('pago 7 mil, o sea 7000', 700_000n)).toBe(false);
  });
});

describe('interruptor de escritura: /lectura y /escritura', () => {
  it('apagado, NADA escribe: responde "solo lectura desde HH:MM", las consultas y el deshacer siguen', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 100_000))]);
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    const eco = e.ultimoGrupo();
    expect(e.negocio.numeroDeHechos()).toBe(1);
    await e.socio('javier', '/lectura');
    expect(e.ultimoGrupo().texto).toContain('Solo lectura activado por Javier');
    await e.socio('angelo', 'Cliente Norte pago 1,000 otra vez');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.ultimoGrupo().texto).toContain('Estoy en solo lectura desde');
    await e.socio('angelo', '/pago Cliente Norte | 500 | efectivo');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    await e.socio('angelo', '/stock jupiter');
    expect(e.ultimoGrupo().texto).not.toContain('solo lectura');
    // deshacer es una reversa: sigue disponible
    await e.pulsar(IDS.angelo, IDS.grupoSocios, eco, 0);
    expect(e.ultimoGrupo().texto).toContain('Deshecho');
    expect(e.negocio.saldoCliente('c1')).toBe(0n);
  });

  it('/escritura lo reactiva y avisa al grupo quien lo hizo; solo los socios lo cambian', async () => {
    const e = escenario();
    await e.socio('angelo', '/lectura');
    await e.omar('/escritura');
    expect((await e.almacen.escrituraEstado()).activa).toBe(false);
    await e.socio('angelo', '/escritura');
    expect(e.ultimoGrupo().texto).toContain('Escritura ACTIVADA por Angelo');
    expect((await e.almacen.escrituraEstado()).activa).toBe(true);
    await e.socio('angelo', '/escritura');
    expect(e.ultimoGrupo().texto).toContain('ya estaba activa');
  });

  it('apagado automatico por anomalia: solo apaga, avisa al grupo y la reactivacion es de un socio', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000))]);
    e.almacen.umbralAnomalia = 2;
    vi.spyOn(e.negocio, 'ejecutar').mockRejectedValue(new Error('base caida'));
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    await e.socio('angelo', 'Cliente Norte pago 1,000 segundo intento');
    expect((await e.almacen.escrituraEstado()).activa).toBe(false);
    expect((await e.almacen.escrituraEstado()).por).toBe('sistema');
    expect(e.textosGrupo().join('\n')).toContain('Apague la escritura por seguridad');
    vi.restoreAllMocks();
    await e.socio('angelo', 'Cliente Norte pago 1,000 tercer intento');
    expect(e.ultimoGrupo().texto).toContain('Estoy en solo lectura');
    await e.socio('javier', '/escritura');
    expect((await e.almacen.escrituraEstado()).activa).toBe(true);
  });
});

describe('antiduplicado por contenido (10 minutos, tambien el otro socio)', () => {
  it('el mismo cobro del otro socio se PREGUNTA ("ya se registro"); si es otro, se registra', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 100_000))]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    e.reloj.avanzarMin(3);
    await e.socio('javier', 'Cliente Norte pago 1,000 (lo mando Javier)');
    expect(e.negocio.numeroDeHechos()).toBe(1);
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('Ya se registro un movimiento igual por Angelo');
    expect(q.texto).toContain('Registrado antes');
    expect(q.botones?.[0]?.map((b) => b.texto)).toEqual(['Si, es otro', 'No, cancelar']);
    await e.pulsar(IDS.javier, IDS.grupoSocios, q, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(2);
  });

  it('pasados 10 minutos ya no es duplicado, y un hecho deshecho tampoco cuenta', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 100_000))]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    const eco = e.ultimoGrupo();
    await e.pulsar(IDS.angelo, IDS.grupoSocios, eco, 0);
    await e.socio('angelo', 'Cliente Norte pago 1,000 de nuevo');
    expect(e.negocio.numeroDeHechos()).toBe(3);
    e.reloj.avanzarMin(11);
    await e.socio('angelo', 'Cliente Norte pago 1,000 mas tarde');
    expect(e.ultimoGrupo().texto).toContain('Registrado');
  });

  it('el reintento con la misma clave (mismo update) nunca es duplicado', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000))]);
    e.negocio.guardas.duplicados = true;
    await e.socio('angelo', 'Cliente Norte pago 1,000', { updateId: 500, messageId: 500 });
    const r = await e.socio('angelo', 'Cliente Norte pago 1,000', { updateId: 500, messageId: 500 });
    expect(r).toEqual({ estado: 'duplicado', motivo: 'update' });
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
});

describe('cobro mayor a lo que debe el cliente: se resuelve como pregunta, no como tope', () => {
  it('pregunta si es anticipo; solo con el si se registra; un cobro que cabe no pregunta; sin tope de monto', async () => {
    const e = escenario([unaAccion(pedido('Cliente Norte', [['jupiter', 28]])), unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 99_999_999_999))]);
    e.negocio.guardas.exceso = true;
    await e.socio('angelo', 'Cliente Norte 28 jupiter');
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    expect(e.ultimoGrupo().texto).toContain('Registrado');
    await e.socio('angelo', 'Cliente Norte pago 999,999,999.99');
    const q = e.ultimoGrupo();
    expect(q.texto).toContain('mayor que lo que debe el cliente');
    expect(q.texto).toContain('Lo que debe el cliente: $6,000.00');
    expect(e.negocio.numeroDeHechos()).toBe(2);
    await e.pulsar(IDS.angelo, IDS.grupoSocios, q, 0, 0);
    expect(e.negocio.numeroDeHechos()).toBe(3);
    expect(e.negocio.saldoCliente('c1')).toBe(600_000n - 99_999_999_999n);
  });

  it('no responder o cancelar no registra nada', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 99_999_999))]);
    e.negocio.guardas.exceso = true;
    await e.socio('angelo', 'Cliente Norte pago 999,999.99');
    await e.pulsar(IDS.angelo, IDS.grupoSocios, e.ultimoGrupo(), 0, 1);
    expect(e.negocio.numeroDeHechos()).toBe(0);
  });
});

describe('deshacer 10 minutos para todos', () => {
  it('el autor deshace dentro de 10 minutos, con eco del efecto revertido; pasados, ni el autor', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000)), unaAccion(pago('Cliente Norte', 100_100))]);
    await e.socio('angelo', 'Cliente Norte pago 1,000');
    await e.socio('angelo', 'deshaz eso (/deshacer)');
    await e.socio('angelo', '/deshacer');
    expect(e.ultimoGrupo().texto).toContain('Efecto revertido');
    expect(e.ultimoGrupo().texto).toContain('Monto: $1,000.00');
    await e.socio('angelo', 'Cliente Norte pago 1,001');
    e.reloj.avanzarMin(11);
    await e.socio('angelo', '/deshacer');
    expect(e.ultimoGrupo().texto).toContain('Pasaron mas de 10 minutos');
    expect(e.negocio.saldoCliente('c1')).toBe(-100_100n);
  });
});

describe('sin topes ocultos: lotes por partes y aviso final', () => {
  it('40 lineas (mas de 6 acciones, mas de una parte): se registran TODAS y el aviso lo dice', async () => {
    const lineas = Array.from({ length: 40 }, (_, i) => `Gasto uber ${101 + i}`);
    const parte1 = respuesta(lineas.slice(0, 20).map((_, i) => gasto((101 + i) * 100)));
    const parte2 = respuesta(lineas.slice(20).map((_, i) => gasto((121 + i) * 100)));
    const e = escenario([parte1, parte2]);
    await e.socio('angelo', lineas.join('\n'));
    expect(e.llmGuionado.llamadas).toBe(2);
    expect(e.negocio.numeroDeHechos()).toBe(40);
    expect(e.ultimoGrupo().texto).toBe('Recibi 40 lineas: registre 40, pregunte 0, no entendi 0. Lo procese en 2 partes.');
  });

  it('un mensaje largo ya no se recorta a 2,000 caracteres: la ultima linea llega al modelo', async () => {
    const lineas = Array.from({ length: 24 }, (_, i) => `Gasto uber ${201 + i} ${'x'.repeat(90)}`);
    const e = escenario([respuesta([gasto(20100)]), respuesta([gasto(22400)])]);
    await e.socio('angelo', lineas.join('\n'));
    expect(lineas.join('\n').length).toBeGreaterThan(2000);
    expect(e.llmGuionado.peticiones.map((p) => p.usuario).join('\n')).toContain('Gasto uber 224');
  });

  it('ocho cobros en un mensaje (mas de seis) se procesan todos', async () => {
    const acciones = Array.from({ length: 8 }, (_, i) => pago('Cliente Norte', (11 + i) * 100));
    const e = escenario([respuesta(acciones)]);
    await e.socio('angelo', ['Norte pago 11', 'Norte pago 12', 'Norte pago 13', 'Norte pago 14', 'Norte pago 15', 'Norte pago 16', 'Norte pago 17', 'Norte pago 18'].join('\n'));
    expect(e.negocio.numeroDeHechos()).toBe(8);
    expect(e.ultimoGrupo().texto).toContain('Recibi 8 lineas: registre 8, pregunte 0, no entendi 0');
  });

  it('partirMensaje no pierde ni parte lineas', () => {
    const texto = Array.from({ length: 45 }, (_, i) => `linea ${i}`).join('\n');
    const partes = partirMensaje(texto, 20, 1500);
    expect(partes.map((p) => p.lineas)).toEqual([20, 20, 5]);
    expect(partes.map((p) => p.texto).join('\n')).toBe(texto);
  });

  it('un monto de mas de un millon de pesos ya pasa el esquema (sin tope de 1,000,000)', async () => {
    const e = escenario([unaAccion(gasto(250_000_000))]);
    await e.socio('angelo', 'gasto uber 2,500,000');
    expect(e.negocio.numeroDeHechos()).toBe(1);
  });
});

describe('robustez del webhook', () => {
  const upd = (id: number) => ({ update_id: id, message: { message_id: id, from: { id: IDS.angelo }, chat: { id: IDS.grupoSocios, type: 'supergroup' as const }, date: 1, text: 'Cliente Norte pago 1,000' } });

  it('un update que fallo se reprocesa en el barrido y se registra UNA vez; el que esta en curso no se duplica', async () => {
    const e = escenario([unaAccion(pago('Cliente Norte', 100_000))]);
    e.negocio.menudeo.envioActivo = true;
    const espia = vi.spyOn(e.negocio, 'ejecutar').mockRejectedValueOnce(new Error('se cayo'));
    const r1 = await e.agente.procesarUpdate(upd(700));
    expect(r1.estado).toBe('error');
    expect(e.almacen.estadoDeUpdate(700)).toBe('fallido');
    expect(e.negocio.numeroDeHechos()).toBe(0);
    // el reintento de Telegram con el update ya terminado o en curso no duplica
    const b = await e.agente.barrerUpdates();
    expect(b.reprocesados).toBe(1);
    expect(e.negocio.numeroDeHechos()).toBe(1);
    expect(e.almacen.estadoDeUpdate(700)).toBe('terminado');
    expect((await e.agente.procesarUpdate(upd(700))).estado).toBe('duplicado');
    espia.mockRestore();
  });

  it('lease vencido (la funcion murio a mitad): se reprocesa; tras 3 intentos se abandona y se avisa UNA vez', async () => {
    const e = escenario();
    e.negocio.menudeo.envioActivo = true;
    expect(await e.almacen.reclamarUpdate2(800, upd(800))).toBe('nuevo');
    expect(await e.almacen.reclamarUpdate2(800, null)).toBe('duplicado');
    e.almacen.vencerLease(800);
    expect(await e.almacen.reclamarUpdate2(800, null)).toBe('reprocesar');
    e.almacen.vencerLease(800);
    expect(await e.almacen.reclamarUpdate2(800, null)).toBe('reprocesar');
    e.almacen.vencerLease(800);
    expect(await e.almacen.reclamarUpdate2(800, null)).toBe('duplicado');
    const b = await e.agente.barrerUpdates();
    expect(b.abandonados).toBe(1);
    expect(e.ultimoGrupo().texto).toContain('No pude procesar el mensaje');
    expect((await e.agente.barrerUpdates()).abandonados).toBe(0);
  });

  it('con telegram_envio apagado el barrido no hace nada', async () => {
    const e = escenario();
    e.negocio.menudeo.envioActivo = false;
    expect((await e.agente.barrerUpdates()).estado).toBe('omitido');
  });

  it('el webhook responde 200 tras registrar el update y 500 si no pudo registrarlo (Telegram reintenta)', async () => {
    const ok = await manejarWebhook({ cabeceraSecreto: 'secreto-secreto', secretoEsperado: 'secreto-secreto', cuerpo: JSON.stringify({ update_id: 1 }), procesar: async () => ({ estado: 'procesado', acciones: 0 }) });
    expect(ok).toEqual({ status: 200, detalle: 'procesado' });
    const mal = await manejarWebhook({ cabeceraSecreto: 'secreto-secreto', secretoEsperado: 'secreto-secreto', cuerpo: JSON.stringify({ update_id: 1 }), procesar: async () => { throw new Error('base caida'); } });
    expect(mal).toEqual({ status: 500, detalle: 'no_registrado' });
  });

  it('el grupo pasa a supergrupo: se actualiza el id, el bot NO sale y sigue respondiendo en el id nuevo', async () => {
    const e = escenario();
    await e.agente.procesarUpdate({ update_id: 900, message: { message_id: 1, chat: { id: IDS.grupoSocios, type: 'group' }, date: 1, migrate_to_chat_id: -1_001_234 } });
    expect(e.telegram.salidas).toEqual([]);
    expect((await e.almacen.chats()).grupoSocios).toBe(-1_001_234);
    expect(e.telegram.aChat(-1_001_234).map((m) => m.texto).join('\n')).toContain('supergrupo');
    // el primer mensaje del supergrupo trae migrate_from_chat_id: idempotente
    await e.agente.procesarUpdate({ update_id: 901, message: { message_id: 2, chat: { id: -1_001_234, type: 'supergroup' }, date: 1, migrate_from_chat_id: IDS.grupoSocios } });
    expect(e.telegram.salidas).toEqual([]);
    await e.agente.procesarUpdate({ update_id: 902, message: { message_id: 3, from: { id: IDS.angelo }, chat: { id: -1_001_234, type: 'supergroup' }, date: 1, text: '/stock jupiter' } });
    expect(e.telegram.aChat(-1_001_234).length).toBeGreaterThan(1);
    expect(e.telegram.salidas).toEqual([]);
  });

  it('un socio escribiendo desde un grupo no registrado NO saca al bot; un extrano que lo agrega, si', async () => {
    const e = escenario();
    await e.agente.procesarUpdate({ update_id: 910, message: { message_id: 1, from: { id: IDS.angelo }, chat: { id: -777, type: 'supergroup' }, date: 1, text: 'hola 1' } });
    expect(e.telegram.salidas).toEqual([]);
    await e.agente.procesarUpdate({ update_id: 911, message: { message_id: 2, from: { id: IDS.extrano }, chat: { id: -777, type: 'supergroup' }, date: 1, text: 'hola 1' } });
    expect(e.telegram.salidas).toEqual([-777]);
  });
});
