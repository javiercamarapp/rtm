-- Carril APRENDIZAJE Y ALTA ASISTIDA (bot de Telegram), parte 1: tablas. ADITIVA: solo tablas, indices y datos semilla neutros; no se toca ninguna funcion ni tabla existente.
-- Decision del dueno (14-nov): el aprendizaje cambia DATOS (alias, jerga, ejemplos anonimizados), nunca modelos; un alias solo se guarda con la confirmacion de un socio.
-- Nada de lo que se aprende contiene dinero, telefonos ni nombres reales de personas: los ejemplos se guardan anonimizados (ver agente.ejemplo_registrar).

-- Alias de marcas (las otras clases ya tienen su tabla: cliente_alias, sabor_alias, modelo_alias, proveedor_alias).
create table catalogo.marca_alias (
  id bigint generated always as identity primary key,
  alias_norm text not null unique check (alias_norm = catalogo.normalizar(alias_norm) and alias_norm <> ''),
  marca_id bigint not null references catalogo.marca (id)
);
alter table catalogo.marca_alias enable row level security;
alter table catalogo.marca_alias force row level security;
revoke all on catalogo.marca_alias from public, anon, authenticated;

-- Plazo habitual de pago de un cliente (dias): lo da el socio al dar de alta; el bot lo SUGIERE al preguntar el plazo de un credito, nunca lo aplica solo.
create table catalogo.cliente_plazo_habitual (
  cliente_id bigint primary key references catalogo.cliente (id),
  dias int not null check (dias between 0 and 365),
  fijado_por text,
  fijado_at timestamptz not null default clock_timestamp()
);
alter table catalogo.cliente_plazo_habitual enable row level security;
alter table catalogo.cliente_plazo_habitual force row level security;
revoke all on catalogo.cliente_plazo_habitual from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Memoria del servidor: la pregunta que el bot dejo abierta en un chat. El id de una pregunta SIEMPRE sale de aqui, jamas del modelo de IA.
-- Una sola pregunta abierta por chat (la nueva cancela la anterior). "si", "ok" o "dale" solo cuentan como respuesta si hay una abierta y vigente.
-- ---------------------------------------------------------------------------
create table agente.pregunta_pendiente (
  id bigint generated always as identity primary key,
  chat_id bigint not null,
  tipo text not null check (tipo in ('sabor_duplicado', 'alias', 'recargo')),
  ref_id bigint not null,
  texto text not null,
  datos jsonb not null default '{}'::jsonb check (jsonb_typeof(datos) = 'object'),
  abierta_por text check (abierta_por in ('angelo', 'javier', 'sistema')),
  mensaje_id bigint,
  estado text not null default 'abierta' check (estado in ('abierta', 'contestada', 'cancelada', 'expirada')),
  creada_at timestamptz not null default clock_timestamp(),
  expira_at timestamptz not null,
  cerrada_at timestamptz,
  check ((estado = 'abierta') = (cerrada_at is null))
);
create unique index pregunta_pendiente_abierta_uq on agente.pregunta_pendiente (chat_id) where estado = 'abierta';
alter table agente.pregunta_pendiente enable row level security;
alter table agente.pregunta_pendiente force row level security;
revoke all on agente.pregunta_pendiente from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Alias: la pregunta, el negativo y lo aprendido (con quien lo confirmo).
-- ---------------------------------------------------------------------------
create table agente.alias_pregunta (
  id bigint generated always as identity primary key,
  clase text not null check (clase in ('cliente', 'sabor', 'modelo', 'marca', 'proveedor')),
  alias_texto text not null,
  alias_norm text not null check (alias_norm <> ''),
  destino_id bigint not null,
  destino_nombre text not null,
  propuesto_por text not null check (propuesto_por in ('angelo', 'javier')),
  estado text not null default 'pendiente' check (estado in ('pendiente', 'guardado', 'negado')),
  respondido_por text check (respondido_por in ('angelo', 'javier')),
  respondido_at timestamptz,
  creada_at timestamptz not null default clock_timestamp(),
  check ((estado = 'pendiente') = (respondido_at is null))
);
create unique index alias_pregunta_pendiente_uq on agente.alias_pregunta (clase, alias_norm, destino_id) where estado = 'pendiente';
alter table agente.alias_pregunta enable row level security;
alter table agente.alias_pregunta force row level security;
revoke all on agente.alias_pregunta from public, anon, authenticated;

-- Negativo: "no, no es lo mismo". Ese par (clase, alias, destino) no se vuelve a preguntar.
create table agente.alias_negativo (
  clase text not null check (clase in ('cliente', 'sabor', 'modelo', 'marca', 'proveedor')),
  alias_norm text not null,
  destino_id bigint not null,
  negado_por text not null check (negado_por in ('angelo', 'javier')),
  creado_at timestamptz not null default clock_timestamp(),
  primary key (clase, alias_norm, destino_id)
);
alter table agente.alias_negativo enable row level security;
alter table agente.alias_negativo force row level security;
revoke all on agente.alias_negativo from public, anon, authenticated;

create table agente.alias_aprendido (
  id bigint generated always as identity primary key,
  pregunta_id bigint not null references agente.alias_pregunta (id),
  clase text not null,
  alias_norm text not null,
  destino_id bigint not null,
  confirmado_por text not null check (confirmado_por in ('angelo', 'javier')),
  creado_at timestamptz not null default clock_timestamp(),
  revertido_at timestamptz,
  revertido_por text check (revertido_por in ('angelo', 'javier'))
);
create index alias_aprendido_reciente_idx on agente.alias_aprendido (creado_at desc);
alter table agente.alias_aprendido enable row level security;
alter table agente.alias_aprendido force row level security;
revoke all on agente.alias_aprendido from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Jerga mexicana y abreviaturas propias de los socios. Es un diccionario de DATOS que entra al prompt como contexto acotado (por busqueda), nunca completo.
-- `sentido` es una pista para el extractor (no ejecuta nada): que operacion o campo suele significar.
-- ---------------------------------------------------------------------------
create table agente.jerga (
  termino_norm text primary key check (termino_norm = catalogo.normalizar(termino_norm) and termino_norm <> ''),
  termino text not null,
  tipo text not null check (tipo in ('jerga', 'abreviatura')),
  significado text not null check (char_length(significado) between 2 and 120),
  origen text not null default 'semilla' check (origen in ('semilla', 'socio', 'correccion')),
  activo boolean not null default true,
  creada_por text check (creada_por in ('angelo', 'javier')),
  creada_at timestamptz not null default clock_timestamp()
);
alter table agente.jerga enable row level security;
alter table agente.jerga force row level security;
revoke all on agente.jerga from public, anon, authenticated;

-- Semilla neutra (jerga comun del negocio; ningun nombre ni cifra real). Las abreviaturas propias se agregan con agente.jerga_agregar.
insert into agente.jerga (termino_norm, termino, tipo, significado) values
  ('ya cayo', 'ya cayo', 'jerga', 'llego el pago de un cliente (cobro)'),
  ('me cayo la lana', 'me cayo la lana', 'jerga', 'llego el pago de un cliente (cobro)'),
  ('me depositaron', 'me depositaron', 'jerga', 'llego el pago de un cliente (cobro)'),
  ('apuntale', 'apuntale', 'jerga', 'registrar un pedido para el cliente nombrado'),
  ('pasale', 'pasale', 'jerga', 'registrar un pedido para el cliente nombrado'),
  ('fiado', 'fiado', 'jerga', 'venta a credito: exige plazo'),
  ('a credito', 'a credito', 'jerga', 'venta a credito: exige plazo'),
  ('de contado', 'de contado', 'jerga', 'venta pagada al momento'),
  ('lana', 'lana', 'jerga', 'dinero'),
  ('luz', 'luz', 'jerga', 'mil pesos solo si el socio escribe la cifra completa; si no, se pregunta'),
  ('puse lana', 'puse lana', 'jerga', 'aportacion de un socio'),
  ('tumba el pedido', 'tumba el pedido', 'jerga', 'cancelar un pedido'),
  ('por cobrar', 'por cobrar', 'jerga', 'consulta de cuentas por cobrar'),
  ('pz', 'pz', 'abreviatura', 'piezas'),
  ('pzs', 'pzs', 'abreviatura', 'piezas'),
  ('transfer', 'transfer', 'abreviatura', 'transferencia'),
  ('efvo', 'efvo', 'abreviatura', 'efectivo'),
  ('dropi', 'dropi', 'abreviatura', 'dropshipping');

-- Correcciones del socio ("no, era Memo Lopez"): alimentan el diccionario. Con dos correcciones iguales se SUGIERE un alias (nunca se guarda solo).
create table agente.correccion_aprendida (
  clase text not null check (clase in ('cliente', 'sabor', 'modelo', 'marca', 'proveedor')),
  dicho_norm text not null check (dicho_norm <> ''),
  destino_id bigint not null,
  veces int not null default 1 check (veces >= 1),
  ultima_por text check (ultima_por in ('angelo', 'javier')),
  ultima_at timestamptz not null default clock_timestamp(),
  primary key (clase, dicho_norm, destino_id)
);
alter table agente.correccion_aprendida enable row level security;
alter table agente.correccion_aprendida force row level security;
revoke all on agente.correccion_aprendida from public, anon, authenticated;

-- Ejemplos propios ANONIMIZADOS (texto sin nombres, sin cifras y sin contactos: solo estructura y jerga). Se usan como contexto del extractor.
-- Un ejemplo solo vale si su operacion NO se deshizo dentro de la ventana de 10 minutos (la lectura lo verifica contra agente.hecho y agente.huella).
create table agente.ejemplo (
  id bigint generated always as identity primary key,
  operacion text not null check (operacion ~ '^[a-z_]{3,40}$'),
  texto_anonimo text not null check (char_length(texto_anonimo) between 5 and 200 and texto_anonimo !~ '[0-9]'),
  palabras text[] not null default '{}',
  folio text,
  autor text check (autor in ('angelo', 'javier')),
  clave_idem text not null unique,
  creado_at timestamptz not null default clock_timestamp()
);
create index ejemplo_palabras_idx on agente.ejemplo using gin (palabras);
alter table agente.ejemplo enable row level security;
alter table agente.ejemplo force row level security;
revoke all on agente.ejemplo from public, anon, authenticated;
