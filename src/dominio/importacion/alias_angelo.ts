// Alias de modelos del documento de Angelo, seccion "Alias de modelos". Valen SOLO dentro de la lista de Angelo.
// Son reglas de nombres del catalogo (no datos de dinero ni de clientes). El importador comprueba que cada destino exista
// en la tabla de costos del documento; si no, falla. Un alias que choque con el nombre de un modelo de la lista de Javier
// se importa como AMBIGUO (el sistema pregunta), nunca como equivalencia.
export interface ReglaAlias { alias: string; destinos: string[]; nota: string }

export const ALIAS_MODELOS_ANGELO: readonly ReglaAlias[] = [
  { alias: 'Waka 50', destinos: ['Waka Icon 50K', 'Waka Blast 50K', 'Waka Jupiter 50K'], nota: 'El precio del cliente aplica a los tres; el costo depende de cual sale. Obliga a preguntar.' },
  { alias: 'Waka Sopro', destinos: ['Waka Sopro 30K'], nota: 'Waka Sopro = Titan = Waka 30 = Pro 30K' },
  { alias: 'Titan', destinos: ['Waka Sopro 30K'], nota: 'Waka Sopro = Titan = Waka 30 = Pro 30K' },
  { alias: 'Pro 30K', destinos: ['Waka Sopro 30K'], nota: 'Waka Sopro = Titan = Waka 30 = Pro 30K' },
  { alias: 'Sopro 15000', destinos: ['Waka DM 15K'], nota: 'Sopro 15000 = DM 15K' },
  { alias: 'Burst', destinos: ['Waka Burst 36K'], nota: 'Burst sin marca = Waka Burst 36K' },
  { alias: 'Waka 100', destinos: ['Waka Optimus 100K'], nota: 'Waka 100 = Optimus' },
  { alias: 'Waka 40', destinos: ['Waka Elite 40K'], nota: 'Waka 40 = Elite' },
  { alias: 'Waka 33', destinos: ['Waka Blade 33K'], nota: 'Waka 33 = Blade' },
  { alias: 'Waka 12', destinos: ['Waka Slim 12K'], nota: 'Waka 12 = Slim' },
  { alias: 'Waka 10', destinos: ['Waka GO 10K'], nota: 'Waka 10 = GO' },
  { alias: 'Box Pro', destinos: ['IPLAY Box Pro 15K'], nota: 'Box Pro = IPLAY Box Pro 15K' },
  { alias: 'IPLAY 50', destinos: ['IPLAY Box Pro Max 50K'], nota: 'IPLAY 50 / Box Pro Max = IPLAY Box Pro Max 50K' },
  { alias: 'Box Pro Max', destinos: ['IPLAY Box Pro Max 50K'], nota: 'IPLAY 50 / Box Pro Max = IPLAY Box Pro Max 50K' },
  { alias: 'Geek', destinos: ['Geek Bar 2GO 50K'], nota: 'Geek / Geek Bar = Geek Bar 2GO 50K' },
  { alias: 'Geek Bar', destinos: ['Geek Bar 2GO 50K'], nota: 'Geek / Geek Bar = Geek Bar 2GO 50K' },
  { alias: 'EBC 40K', destinos: ['Elfbar BC Pro 40K'], nota: 'EBC 40K = Elfbar BC Pro 40K' },
  { alias: 'Elux', destinos: ['Elux 50K'], nota: 'Elux = Elux 50K' },
  { alias: 'Maskking 100', destinos: ['Maskking Extre 100K'], nota: 'Maskking 100 = Extre 100K' },
  { alias: 'Maskking 40', destinos: ['Maskking Ice X 40K'], nota: 'Maskking 40 = Ice X 40K' },
  { alias: 'Nexa 40K', destinos: ['Nexa Ultra 40K'], nota: 'Nexa 40K = Nexa Ultra 40K' },
];

/** Prefijos de marca (mas largos primero). Un nombre sin prefijo conocido queda en la marca "Sin marca". */
export const MARCAS = ['Flavor Beast', 'Funky Republic', 'Lost Mary', 'Pillow Talk', 'Geek Bar', 'Extre Bar', 'Maskking', 'Uno Mas', 'Equator', 'Elfbar', 'Rifbar', 'Adjust', 'Fasta', 'IPLAY', 'South', 'Nexa', 'Elux', 'Dojo', 'Waka'] as const;
