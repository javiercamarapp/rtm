# Marcas y fotos por confirmar (14-nov)

Lista de preguntas para el dueno. Nada de esto se aplico a produccion sin tu respuesta: las marcas "exacto" las ata `scripts/catalogo/atar-marcas.mjs` (despues de aplicar la migracion 20261115800000); las "probable" estan aqui con mi propuesta. Responde "si" por modelo o corrige la marca y se agregan al mapa `scripts/catalogo/marcas-modelos.json` como exactas.

## A. Marcas propuestas (hoy "Sin marca")

| Modelo (id) | Marca propuesta | Confianza | Evidencia |
| --- | --- | --- | --- |
| Instabar 70K (145) | Instabar | exacto (se ata con el script) | El nombre del modelo incluye la marca; el catalogo del proveedor lo lista como 'Instabar Be 70,000' con vendor Instabar. |
| Fifty Bar (146) | Fifty Bar | exacto (se ata con el script) | El catalogo del proveedor lo lista como 'Fifty Bar 20,000' con vendor Fifty Bar (la marca se llama igual que el modelo). |
| Snowwolf (147) | Snowwolf | exacto (se ata con el script) | El catalogo del proveedor lo lista como 'Snowwolf 8,000' con vendor Snowwolf; dameunhit.app lo asigna a la marca Snowwolf. |
| X-Box 50k (138) | IPLAY | exacto (se ata con el script) | X-Box es la linea de iPlay: el catalogo del proveedor trae 'iPlay X-Box Pro Max 50,000' con vendor IPlay y dameunhit.app lo agrupa en la categoria iPlay. |
| PA30000 (136) | Waka | exacto (se ata con el script) | PA#### es la clave de la linea Waka SoPro (resenas publicas de 'WAKA SoPro PA10000'); el catalogo del proveedor trae 'Waka Pro 30,000' con vendor WAKA. |
| Optimus (128) | Waka | probable: confirmar | Existe 'Waka Optimus 100,000' en el proveedor y en el catalogo (id 76); no se encontro otra marca con un modelo Optimus. Falta que el dueno confirme que 'Optimus' suelto es ese. |
| Burst (130) | Waka | probable: confirmar | Hay Waka Burst 36K, pero tambien IPLAY Burst 45K y Fasta Burst: 'Burst' solo es ambiguo. |
| Blade (131) | Waka | probable: confirmar | Waka Blade 33K existe (id 85); 'Blade' suelto no trae marca. |
| Smash Go (133) | Waka | probable: confirmar | Waka Smash es una linea publica de Waka (wakavaping.com); 'Smash Go' no aparece con ese nombre exacto en ningun catalogo. |
| Slim (134) | Waka | probable: confirmar | Waka Slim 12K existe (id 93); 'Slim' suelto no trae marca. |
| Icon (135) | Waka | probable: confirmar | Waka Icon 50K existe (id 77); 'Icon' suelto no trae marca. |
| Elite (137) | Waka | probable: confirmar | Waka Elite 40K existe (id 80); 'Elite' suelto no trae marca. |
| Go (142) | Waka | probable: confirmar | Waka Go 10K existe (id 95); 'Go' suelto no trae marca. |
| Box Pro 15 (139) | IPLAY | probable: confirmar | Parece iPlay X-Box Pro 15K (existe 'IPLAY Box Pro 15K', id 98): posible duplicado. |
| Box Pro Max (140) | IPLAY | probable: confirmar | Parece iPlay X-Box Pro Max 50K (existe 'IPLAY Box Pro Max 50K', id 82): posible duplicado. |

Pregunta clave: los nombres sueltos (Optimus, Burst, Blade, Smash Go, Slim, Icon, Elite, Go) coinciden con lineas de Waka, pero la lista de Javier tambien trae "Waka Go", "Waka Burst", "Waka Icon", "Waka Elite", "Waka Slim" aparte. Si son el mismo producto con dos nombres, conviene unificarlos en vez de solo ponerles marca (esa unificacion de modelos no se hizo).

## B. Fotos asignadas como "probable"

Quedaron con foto para que la interfaz no se vea vacia, pero la foto es de la misma linea y no necesariamente del mismo puffs. Dime cuales cambiar.

| Modelo (id) | Foto asignada |
| --- | --- |
| IPLAY Box 4K (100) | `/proveedores/karen/vape-iplay-x-box.webp` |
| IPLAY Box Pro 15K (98) | `/proveedores/karen/vape-iplay-x-box-pro.webp` |
| Pillow Talk (148) | `/proveedores/karen/pillow-talk-40k.webp` |
| Box Pro 15 (139) | `/proveedores/karen/vape-iplay-x-box-pro.webp` |
| Box Pro Max (140) | `/proveedores/karen/iplay-x-box-pro-max-50-000.webp` |
| PA30000 (136) | `/proveedores/karen/waka-pro-30k.webp` |
| X-Box 50k (138) | `/proveedores/karen/iplay-x-box-pro-max-50-000.webp` |
| Waka Blast (126) | `/modelos/waka-blast-50k.webp` |
| Waka Burst (122) | `/proveedores/karen/waka-burst-36-000.webp` |
| Waka Duo 25K (89) | `/modelos/waka-duo.webp` |
| Waka Elite (124) | `/proveedores/karen/waka-elite-40k.webp` |
| Waka Go (119) | `/proveedores/karen/waka-go-10-000.webp` |
| Waka Jupiter (125) | `/proveedores/karen/waka-jupiter-50k.webp` |
| Waka Slim (127) | `/proveedores/karen/waka-slim-12-000.webp` |
| Waka Sopro 30K (87) | `/proveedores/karen/waka-pro-30k.webp` |

## C. Modelos sin foto y sin evidencia suficiente

- Adjust 40K (id 109)
- Dojo 40K (id 110)
- Elfbar 40K (id 150)
- Elux 50K (id 106)
- Extre Bar 40K (id 115)
- Fasta Burst 37K (id 102)
- Fasta Kit 40K (id 103)
- Funky Republic Fi 3K (id 118)
- iPlay 15K (id 161)
- Lost Mary 35K (id 105)
- Maskking 100K (id 159)
- Maskking Fexo 45K (id 86)
- Maskking Ice X 40K (id 88)
- Nexa 35K (id 112)
- Nexa 50K (id 104)
- Nexa Ultra 50K (id 157)
- Rifbar Pro 40K (id 108)
- Blade (id 131)
- Burst (id 130)
- Elite (id 137)
- Go (id 142)
- Icon (id 135)
- Optimus (id 128)
- Slim (id 134)
- Smash Go (id 133)
- Uno Mas X (id 117)
- Vhill 3K (id 162)
- Waka 100 (id 144)
- Waka 15 (id 132)
- Waka 15K (id 120)
- Waka 30 (id 129)
- Waka 30K (id 151)
- Waka 36 (id 143)
- Waka 36K (id 156)
- Waka 50 (id 141)
- Waka 50K (id 152)
- Waka 60K (id 160)
- Waka DM 15K (id 90)
- Waka Icon (id 123)
- Waka Titan 30K (id 154)

Para los de C: o mandas la foto, o indicas de que linea del proveedor son (por ejemplo Waka 36K, Waka 50K, Waka 100, Nexa 35K/50K).
