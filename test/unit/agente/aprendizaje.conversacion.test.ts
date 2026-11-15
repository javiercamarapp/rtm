// Conversaciones simuladas del carril aprendizaje y alta asistida: mensaje del socio, preguntas del bot, respuestas, registro y mensaje final al grupo.
// Sin red: agente en memoria, LLM guionado, transporte falso de Telegram y puerto de aprendizaje en memoria. NINGUN mensaje real sale a Telegram.
import { describe, expect, it } from 'vitest';
import { respuesta } from '@/infra/agente/llm_simulado';
import { PuertoAprendizajeMemoria } from '@/infra/agente/aprendizaje_memoria';
import { ModuloAprendizaje } from '@/aplicacion/agente/aprendizaje';
import type { Intencion } from '@/dominio/agente/intenciones';
import { escenario } from './ayudas';

const aliasEnsenar = (alias: string, oficial: string, clase: 'cliente' | 'sabor' | 'modelo' | 'marca' | 'proveedor' = 'cliente'): Intencion => ({ tipo: 'alias_ensenar', clase, alias_texto: alias, oficial_texto: oficial, fuente_cita: `${alias} es ${oficial}` });

function con(acciones: Intencion[][], puerto = new PuertoAprendizajeMemoria()) {
  const e = escenario(acciones.map((a) => respuesta(a)), { aprendizaje: puerto });
  return { e, puerto };
}

describe('alias que el bot aprende', () => {
  it('"Memo es Guillermo Torres": pregunta, y solo con el si de un socio lo guarda con aviso al grupo', async () => {
    const { e, puerto } = con([[aliasEnsenar('Memo', 'Guillermo Torres')]]);
    await e.socio('angelo', 'Memo es Guillermo Torres, ¿si?');
    expect(e.ultimoGrupo().texto).toBe('¿"Memo" es lo mismo que Guillermo Torres? Si respondes que si, lo recordare como otro nombre de Guillermo Torres. Responde si o no.');
    expect(puerto.aliases).toHaveLength(0);
    await e.socio('javier', 'dale');
    expect(e.ultimoGrupo().texto).toContain('Javier confirmo: "Memo" queda como otro nombre de Guillermo Torres');
    expect(puerto.aliases).toMatchObject([{ clase: 'cliente', alias: 'Memo', oficial: 'Guillermo Torres', por: 'javier' }]);
    expect(e.llmGuionado.llamadas).toBe(1);
  });

  it('con "no" registra el negativo y no vuelve a preguntar lo mismo', async () => {
    const { e, puerto } = con([[aliasEnsenar('Memo', 'Guillermo Torres')], [aliasEnsenar('Memo', 'Guillermo Torres')]]);
    await e.socio('angelo', 'Memo es Guillermo Torres, ¿si?');
    await e.socio('javier', 'no');
    expect(e.ultimoGrupo().texto).toContain('Javier dijo que "Memo" no es lo mismo que Guillermo Torres. No lo vuelvo a preguntar.');
    expect(puerto.aliases).toHaveLength(0);
    await e.socio('angelo', 'te repito: Memo es Guillermo Torres, ¿si?');
    expect(e.ultimoGrupo().texto).toContain('ya dijo que "Memo" no es lo mismo');
  });

  it('un "ok" o "ya" sin pregunta pendiente NO cuenta como respuesta y no guarda nada', async () => {
    const { e, puerto } = con([[{ tipo: 'ninguna' }]]);
    const antes = e.grupo().length;
    await e.socio('javier', 'ok');
    await e.socio('javier', 'ya');
    expect(puerto.aliases).toHaveLength(0);
    expect(e.grupo().length).toBe(antes);
  });

  it('un oficial que no existe no guarda nada y lo dice', async () => {
    const { e, puerto } = con([[aliasEnsenar('Fulano', 'Zutano Inexistente')]]);
    await e.socio('angelo', 'Fulano es Zutano Inexistente, ¿si?');
    expect(e.ultimoGrupo().texto).toContain('No encontre "Zutano Inexistente" en el catalogo. No guarde nada.');
    expect(puerto.aliases).toHaveLength(0);
  });

  it('el alias de un sabor o de una marca se muestra en MAYUSCULAS', async () => {
    const { e } = con([[aliasEnsenar('la verde', 'Passion Fruit', 'sabor')]]);
    await e.socio('angelo', 'la verde es passion fruit, ¿si?');
    expect(e.ultimoGrupo().texto).toContain('"LA VERDE" es lo mismo que PASSION FRUIT');
  });

  it('deshacer alias dentro de 10 minutos; pasado ese tiempo ya no desde Telegram', async () => {
    const { e, puerto } = con([[aliasEnsenar('Memo', 'Guillermo Torres')]]);
    await e.socio('angelo', 'Memo es Guillermo Torres, ¿si?');
    await e.socio('javier', 'si');
    await e.socio('angelo', 'deshacer alias');
    expect(e.ultimoGrupo().texto).toContain('deshizo el alias "Memo"');
    expect(puerto.aliases[0]!.revertido).toBe(true);

    const b = con([[aliasEnsenar('Memo', 'Guillermo Torres')]]);
    await b.e.socio('angelo', 'Memo es Guillermo Torres, ¿si?');
    await b.e.socio('javier', 'si');
    b.e.reloj.avanzarMin(11);
    await b.e.socio('angelo', 'deshacer alias');
    expect(b.e.ultimoGrupo().texto).toContain('mas de 10 minutos');
    expect(b.puerto.aliases[0]!.revertido).toBe(false);
  });

  it('en solo lectura no se aprende nada y el bot lo explica', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.escrituraActiva = false;
    const { e } = con([[aliasEnsenar('Memo', 'Guillermo Torres')]], puerto);
    await e.socio('angelo', 'jerga: el guero = el cliente del norte');
    expect(e.ultimoGrupo().texto).toContain('solo lectura');
    expect(puerto.jerga).toHaveLength(1);
  });

  it('la jerga propia se ensena con un atajo y avisa al grupo', async () => {
    const { e, puerto } = con([[{ tipo: 'ninguna' }]]);
    await e.socio('javier', 'jerga: el guero = el cliente del norte');
    expect(e.ultimoGrupo().texto).toBe('Javier enseno: "el guero" significa el cliente del norte.');
    expect(puerto.jerga.at(-1)).toMatchObject({ termino: 'el guero' });
  });

  it('el contexto aprendido (alias y jerga mencionados) entra al prompt del extractor, acotado, y no el catalogo completo', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.aliases.push({ clase: 'cliente', alias: 'Memo', oficial: 'Guillermo Torres', por: 'javier', en: 0, revertido: false });
    for (let i = 0; i < 300; i++) puerto.aliases.push({ clase: 'cliente', alias: `apodo${i}`, oficial: `Cliente ${i}`, por: 'javier', en: 0, revertido: false });
    const { e } = con([[{ tipo: 'ninguna' }]], puerto);
    await e.socio('angelo', 'ya cayo la lana de Memo, 1,000');
    const u = e.llmGuionado.peticiones[0]!.usuario;
    expect(u).toContain('contexto_aprendido');
    expect(u).toContain('cliente:memo=Guillermo Torres');
    expect(u).toContain('ya cayo=llego el pago');
    expect(u).not.toContain('apodo7');
  });
});

describe('sabores parecidos por Telegram', () => {
  function conCola() {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.colaSabores = [{ id: 1, a: 'Passionfruit', b: 'Passion Fruit', estado: 'pendiente' }, { id: 2, a: 'Kiwi Dragonfruit', b: 'Kiwi Dragon Fruit', estado: 'pendiente' }];
    return con([[{ tipo: 'ninguna' }]], puerto);
  }
  it('"duplicados pendientes": pregunta; un "dale" la contesta, el bot avisa al grupo y pregunta la siguiente', async () => {
    const { e, puerto } = conCola();
    await e.socio('angelo', 'duplicados pendientes');
    expect(e.ultimoGrupo().texto).toBe('¿"PASSIONFRUIT" es lo mismo que "PASSION FRUIT"? Responde si o no. (Hay 1 mas por revisar.)');
    await e.socio('javier', 'dale');
    const g = e.textosGrupo();
    expect(g.at(-2)).toBe('Javier unió los sabores "Passionfruit" y "Passion Fruit": queda "Passion Fruit". Para deshacerlo: "deshacer unión".');
    expect(g.at(-1)).toBe('¿"KIWI DRAGONFRUIT" es lo mismo que "KIWI DRAGON FRUIT"? Responde si o no.');
    expect(puerto.colaSabores[0]!.estado).toBe('unido');
  });
  it('"no, son distintos" guarda el negativo; una respuesta que no se entiende se repregunta sin unir', async () => {
    const { e, puerto } = conCola();
    await e.socio('angelo', 'duplicados pendientes');
    await e.socio('javier', 'mmm');
    expect(e.textosGrupo().at(-2)).toContain('No entendí si es lo mismo o no');
    expect(puerto.colaSabores[0]!.estado).toBe('pendiente');
    await e.socio('javier', 'no, son distintos');
    expect(e.textosGrupo().at(-2)).toContain('son sabores distintos');
    expect(puerto.colaSabores[0]!.estado).toBe('distinto');
  });
  it('sin pregunta abierta un "si" no une nada', async () => {
    const { e, puerto } = conCola();
    await e.socio('javier', 'si');
    expect(puerto.colaSabores.every((x) => x.estado === 'pendiente')).toBe(true);
  });
  it('si el modelo extrae sabor_respuesta, la pregunta sale de la memoria del servidor (no del modelo)', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.colaSabores = [{ id: 7, a: 'Passionfruit', b: 'Passion Fruit', estado: 'pendiente' }];
    const { e } = con([[{ tipo: 'sabor_respuesta', respuesta: 'si' }]], puerto);
    await e.socio('angelo', 'duplicados pendientes');
    await e.socio('javier', 'pues si, ¿no?, son lo mismo creo');
    expect(e.textosGrupo().at(-1)).toContain('unió los sabores');
    expect(puerto.colaSabores[0]!.estado).toBe('unido');
  });
  it('deshacer union dentro de 10 minutos; despues, desde el software', async () => {
    const { e, puerto } = conCola();
    await e.socio('angelo', 'duplicados pendientes');
    await e.socio('javier', 'si');
    await e.socio('javier', 'deshacer unión');
    expect(e.textosGrupo().at(-1)).toContain('deshizo la unión');
    expect(puerto.uniones[0]!.deshecha).toBe(true);
    await e.socio('javier', 'si'); // la pregunta siguiente (kiwi) sigue abierta
    e.reloj.avanzarMin(11);
    await e.socio('javier', 'deshacer unión');
    expect(e.textosGrupo().at(-1)).toContain('mas de 10 minutos');
  });
});

describe('alta asistida desde el bot', () => {
  it('cliente nuevo: pregunta tipo, socio dueno y plazo habitual; registra con todo y avisa al grupo', async () => {
    const { e, puerto } = con([[{ tipo: 'cliente_alta', nombre: 'Beto Ramirez', fuente_cita: 'alta cliente Beto Ramirez' }]]);
    await e.socio('angelo', 'dar de alta al cliente Beto Ramirez 1');
    expect(e.ultimoGrupo().texto).toBe('¿Es mayoreo o menudeo?');
    expect(puerto.clientes.some((c) => c.nombre === 'Beto Ramirez')).toBe(false);
    await e.socio('angelo', 'menudeo');
    expect(e.ultimoGrupo().texto).toContain('¿De qué socio es el cliente');
    await e.socio('angelo', 'Javier');
    expect(e.ultimoGrupo().texto).toContain('plazo habitual');
    expect(puerto.clientes.some((c) => c.nombre === 'Beto Ramirez')).toBe(false);
    await e.socio('angelo', '15 días');
    expect(e.ultimoGrupo().texto).toBe('Angelo dio de alta al cliente "Beto Ramirez" (menudeo, de Javier, plazo habitual 15 dias).');
    expect(puerto.clientes.at(-1)).toMatchObject({ nombre: 'Beto Ramirez', duenio: 'javier', plazo: 15 });
  });

  it('cliente muy parecido a otro: pregunta antes de crear y solo con el si lo crea', async () => {
    const { e, puerto } = con([[{ tipo: 'cliente_alta', nombre: 'Ariel Gomes', fuente_cita: 'alta cliente Ariel Gomes' }]]);
    await e.socio('angelo', 'dar de alta al cliente Ariel Gomes 1');
    await e.socio('angelo', 'mayoreo');
    await e.socio('angelo', 'angelo');
    await e.socio('angelo', 'de contado');
    expect(e.ultimoGrupo().texto).toContain('Ya existe "Ariel Gomez", muy parecido a "Ariel Gomes". ¿Es otro cliente distinto y lo creo?');
    expect(puerto.clientes.some((c) => c.nombre === 'Ariel Gomes')).toBe(false);
    await e.socio('angelo', 'si');
    expect(e.ultimoGrupo().texto).toContain('dio de alta al cliente "Ariel Gomes"');
    expect(puerto.clientes.some((c) => c.nombre === 'Ariel Gomes')).toBe(true);
  });

  it('cliente parecido y el socio dice que no: se cancela sin crear', async () => {
    const { e, puerto } = con([[{ tipo: 'cliente_alta', nombre: 'Ariel Gomes', fuente_cita: 'alta cliente Ariel Gomes' }]]);
    await e.socio('angelo', 'dar de alta al cliente Ariel Gomes 1');
    await e.socio('angelo', 'mayoreo');
    await e.socio('angelo', 'angelo');
    await e.socio('angelo', 'de contado');
    await e.socio('angelo', 'no');
    expect(e.ultimoGrupo().texto).toContain('cancelé');
    expect(puerto.clientes.some((c) => c.nombre === 'Ariel Gomes')).toBe(false);
  });

  it('sabor nuevo: Passionfruit se parece a Passion Fruit y se pregunta; Uva Helada se crea', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.aliases.push({ clase: 'modelo', alias: 'nexa', oficial: 'Nexa Ultra 50K', por: 'angelo', en: 0, revertido: false });
    const { e } = con([
      [{ tipo: 'sabor_alta', modelo_texto: 'nexa', sabor_texto: 'Uva Helada', fuente_cita: 'sabor nuevo uva helada de la nexa' }],
      [{ tipo: 'sabor_alta', modelo_texto: 'nexa', sabor_texto: 'Passionfruit', fuente_cita: 'sabor nuevo passionfruit de la nexa' }],
    ], puerto);
    await e.socio('angelo', 'sabor nuevo uva helada de la nexa 1');
    expect(e.ultimoGrupo().texto).toContain('Angelo dio de alta el sabor UVA HELADA para NEXA ULTRA 50K');
    expect(puerto.sabores.get('Nexa Ultra 50K')).toContain('Uva Helada');
    await e.socio('angelo', 'sabor nuevo passionfruit de la nexa 2');
    expect(e.ultimoGrupo().texto).toContain('El sabor "PASSIONFRUIT" se parece a "PASSION FRUIT". ¿Es otro sabor distinto y lo creo?');
    expect(puerto.sabores.get('Nexa Ultra 50K')).not.toContain('Passionfruit');
    await e.socio('angelo', 'no');
    expect(puerto.sabores.get('Nexa Ultra 50K')).not.toContain('Passionfruit');
  });

  it('modelo nuevo SIN costo: no inventa ninguno y avisa que hay que fijarlo', async () => {
    const { e, puerto } = con([[{ tipo: 'modelo_alta', marca_texto: 'Orbe', modelo_texto: 'Zafiro 5K', costo_centavos: null, proveedor_texto: null, fuente_cita: 'modelo nuevo zafiro 5k marca orbe' }]]);
    await e.socio('angelo', 'modelo nuevo zafiro 5k marca orbe 1');
    expect(e.ultimoGrupo().texto).toContain('caladas');
    await e.socio('angelo', '5000');
    expect(e.ultimoGrupo().texto).toContain('Sin costo por ahora');
    await e.socio('angelo', 'Sin costo por ahora');
    expect(e.ultimoGrupo().texto).toBe('Angelo dio de alta el modelo ZAFIRO 5K (marca ORBE, 5000 puffs). Sin costo de lista: hay que fijarlo antes de venderlo.');
    expect(puerto.modelos.at(-1)).toMatchObject({ nombre: 'Zafiro 5K', puffs: 5000, costos: {} });
  });

  it('modelo nuevo CON el costo que dicta el socio: lo guarda tal cual y con su proveedor', async () => {
    const { e, puerto } = con([[{ tipo: 'modelo_alta', marca_texto: 'Orbe', modelo_texto: 'Zafiro 5K', costo_centavos: null, proveedor_texto: null, fuente_cita: 'modelo nuevo zafiro 5k marca orbe' }]]);
    await e.socio('angelo', 'modelo nuevo zafiro 5k marca orbe 1');
    await e.socio('angelo', 'no se');
    await e.socio('angelo', 'Karen');
    expect(e.ultimoGrupo().texto).toContain('costo de lista');
    await e.socio('angelo', '125');
    expect(puerto.modelos.at(-1)).toMatchObject({ nombre: 'Zafiro 5K', puffs: null, costos: { karen: 12500 } });
    expect(e.ultimoGrupo().texto).toContain('Costo de lista con Karen: lo dio el socio.');
  });
});

describe('recargo de credito: lo sugiere el bot, lo decide el socio dueno', () => {
  function conAtraso() {
    const puerto = new PuertoAprendizajeMemoria();
    puerto.pedidosConAtraso.set('AG-003', { cliente: 'Ariel Gomez', duenio: 'angelo', semanas: 2, pendienteTexto: '4,000', aplicado: false });
    return con([[{ tipo: 'recargo_credito', pedido_folio: 'AG-003', cliente_texto: null, fuente_cita: 'AG-003' }]], puerto);
  }
  it('pregunta con el monto de SQL; otro socio no lo aplica; el duenio dice si y se aplica', async () => {
    const { e, puerto } = conAtraso();
    await e.socio('javier', 'cobrale el recargo al AG-003');
    expect(e.ultimoGrupo().texto).toContain('El pedido AG-003 de Ariel Gomez lleva 2 semanas completas de atraso. Recargo sugerido: $4,000');
    expect(e.ultimoGrupo().texto).toContain('Lo decide Angelo, dueno del cliente');
    await e.socio('javier', 'si');
    expect(e.ultimoGrupo().texto).toContain('lo decide Angelo (dueno del cliente)');
    expect(puerto.pedidosConAtraso.get('AG-003')!.aplicado).toBe(false);
    await e.socio('angelo', 'dale');
    expect(e.ultimoGrupo().texto).toBe('Angelo aplico el recargo del pedido AG-003: $4,000 en total (2 semanas completas de atraso, 10 % simple por semana).');
    expect(puerto.pedidosConAtraso.get('AG-003')!.aplicado).toBe(true);
  });
  it('con "no" no se aplica y no se vuelve a sugerir en esa pregunta', async () => {
    const { e, puerto } = conAtraso();
    await e.socio('javier', 'cobrale el recargo al AG-003');
    await e.socio('angelo', 'no');
    expect(e.ultimoGrupo().texto).toBe('Angelo decidio no aplicar el recargo por ahora.');
    expect(puerto.pedidosConAtraso.get('AG-003')!.aplicado).toBe(false);
  });
});

describe('aprendizaje de correcciones y ejemplos', () => {
  it('dos correcciones iguales sugieren (nunca guardan solas) el alias', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    const m = new ModuloAprendizaje(puerto);
    const autor = { telegramUserId: 1, persona: 'angelo' as const, rol: 'socio' as const };
    expect((await m.correccion({ clave: 'k1', autor, chatId: 5, clase: 'cliente', dicho: 'Ariel G', correcto: 'Ariel Gomez' })).textos).toEqual([]);
    const s = await m.correccion({ clave: 'k2', autor, chatId: 5, clase: 'cliente', dicho: 'Ariel G', correcto: 'Ariel Gomez' });
    expect(s.textos[0]).toContain('Ya me corregiste dos veces con "Ariel G". ¿"Ariel G" es lo mismo que Ariel Gomez?');
    expect(puerto.aliases).toHaveLength(0);
  });
  it('el ejemplo guardado esta anonimizado (sin nombres, cifras ni contactos)', async () => {
    const puerto = new PuertoAprendizajeMemoria();
    const m = new ModuloAprendizaje(puerto);
    const autor = { telegramUserId: 1, persona: 'angelo' as const, rol: 'socio' as const };
    await m.aprender({ clave: 'e1', autor, operacion: 'pedido_bodega', texto: 'Apuntale a Memo Garcia 24 pzs de Nexa mango a credito 15 dias, tel 9991234567', folio: 'MG-001', clientes: ['Memo Garcia'], modelos: ['Nexa'], sabores: ['mango'] });
    expect(puerto.ejemplos).toHaveLength(1);
    expect(puerto.ejemplos[0]!.texto).not.toMatch(/[0-9]|memo|garcia|nexa|mango/i);
    expect(puerto.ejemplos[0]!.texto).toContain('apuntale');
  });
});
