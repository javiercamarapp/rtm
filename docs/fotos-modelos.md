# Fotos de modelos

Fotos de los 87 modelos activos del catalogo (lista leida de solo lectura de `catalogo.modelo` el 14-nov). Datos en `src/dominio/catalogo/fotos-modelos.ts` (cada modelo con su ruta de foto o `null` explicito, y su confianza); la misma tabla alimenta el catalogo, el inventario, pedidos, compras y el tablero del proveedor. Hay dos carpetas y un archivo nunca se duplica: `public/proveedores/karen/<clave>.webp` (fotos de la tienda del proveedor, 24 usadas de 49 descargadas) y `public/modelos/<slug>.webp` (fotos propias, 12). Todo es webp, 4:5 o proporcion original, ancho maximo 800 px, menos de 150 KB, sin metadatos. La prueba `test/unit/catalogo/fotos_modelos.test.ts` verifica que todo modelo tenga foto o declare que no la tiene, que cada archivo exista, sea webp y pese menos de 150 KB, y que este documento lo liste.

Cobertura al 14-nov: 47 de 87 modelos con foto (32 exactas, 15 probables por confirmar) y 40 sin foto.

## Reglas y limites

- Orden de busqueda: (1) tienda publica del proveedor (49 fotos ya descargadas por `scripts/proveedores/bajar-fotos.mjs`; su direccion es privada y NO se escribe en el repositorio); (2) pagina oficial de la marca; (3) catalogo publico de dameunhit.app (tienda mayorista mexicana; robots.txt permite lo publico, se uso la lectura publica del catalogo y UNA imagen por producto, User-Agent generico, una solicitud por segundo, sin cuenta ni sesion). No se uso ninguna imagen con precios, telefonos, rostros, textos de venta ni marcas de agua de otra tienda; cada imagen se reviso en hoja de contacto.
- Se asigna foto `exacto` cuando el catalogo nombra la misma linea y los mismos puffs. `probable` es la misma linea con nombre sin puffs o variante: queda asignada pero listada en `docs/marcas-por-confirmar.md` para que el dueno la confirme o la cambie. Ante la duda razonable el modelo queda sin foto y la interfaz muestra el estado vacio con el monograma.
- Las fotos de dameunhit.app y de las marcas son imagenes comerciales de terceros usadas internamente para identificar el producto; si algun titular las reclama se reemplazan por fotos propias. Para reprocesar: `node scripts/modelos/preparar-fotos.mjs <carpeta-con-originales>`.
- Busquedas sin resultado util (imagen solo en banners con texto de venta, o sin pagina publica): Maskking Ice X 40K (la pagina oficial solo trae banners con textos), Nexa 35K/50K/Ultra 50K, Elux 50K, Adjust, Dojo, Rifbar, Uno Mas X, Vhill, Funky Republic, Extre Bar, Fasta Kit, Waka Titan, Smash Go, Lost Mary 35K y las variantes sin puffs de Waka (15, 30, 36, 50, 100).

## Fotos propias (public/modelos)

- Equator 30K (Equator, id 107, exacto): `equator-30k.webp` - origen https://dameunhit.app/wp-content/uploads/2025/11/EQUATOR-30K-ALFA-5.png (pagina https://dameunhit.app/product/equator-30000/)
- Fasta Burst 35K (Fasta, id 101, exacto): `fasta-burst-35k.webp` - origen https://dameunhit.app/wp-content/uploads/2026/08/FASTA-35K-ALFA-03.png (pagina https://dameunhit.app/product/fasta-35k/)
- Flavor Beast 50K (Flavor Beast, id 94, exacto): `flavor-beast-50k.webp` - origen https://cdn.shopify.com/s/files/1/0655/5012/3179/files/FlavorBeast_USA-XBM50-SEPT2025-Device_SP-SicStrawberry.png?v=1756908527 (pagina https://www.flavorbeast.com/ (dispositivo XBM50 50K recortado de la imagen oficial; se descarto el empaque y el distintivo))
- Geek Bar 2GO 50K (Geek Bar, id 84, exacto): `geek-bar-2go-50k.webp` - origen https://oss.geekbar.com/products/geekbar-2go/mobile/p1.jpg (pagina https://www.geekbar.com/product/2GO.html, indica 50000 puffs)
- Geek Bar Somax 80K (Geek Bar, id 81, exacto): `geek-bar-somax-80k.webp` - origen https://oss.geekbar.com/products/somax-80k/mobile/p1.jpg (pagina https://www.geekbar.com/product/somax-80k.html)
- Lost Mary Ultrasonic (Lost Mary, id 149, exacto): `lost-mary-ultrasonic.webp` - origen https://d31ixytk8zua6i.cloudfront.net/products/ULTRASONIC35K/Ice-Mint.jpg (pagina https://www.lostmary.com/product/ultrasonic-35k.html)
- Maskking Extre 100K (Maskking, id 91, exacto): `maskking-extre-100k.webp` - origen https://dameunhit.app/wp-content/uploads/2026/03/MASKKING-EXTRE-ALFA-03.png (pagina https://dameunhit.app/product/maskking-extre-100k/)
- South 3K (South, id 116, exacto): `south-3k.webp` - origen https://dameunhit.app/wp-content/uploads/2025/11/SOUTH-3000-ALFA-04.png (pagina https://dameunhit.app/product/south-3000/)
- Waka Blast (Waka, id 126, probable): `waka-blast-50k.webp` - origen https://dameunhit.app/wp-content/uploads/2026/06/WAKA-50K-BLAST-ALFA-03.png (pagina https://dameunhit.app/product/waka-blast-50k/)
- Waka Blast 50K (Waka, id 78, exacto): `waka-blast-50k.webp` - origen https://dameunhit.app/wp-content/uploads/2026/06/WAKA-50K-BLAST-ALFA-03.png (pagina https://dameunhit.app/product/waka-blast-50k/)
- Waka Duo 25K (Waka, id 89, probable): `waka-duo.webp` - origen https://dameunhit.app/wp-content/uploads/2025/11/WAKA-DUO-ALFA-01-copia.png (pagina https://dameunhit.app/product/waka-duo/)
- Waka GO Mundialista 10K (Waka, id 96, exacto): `waka-go-mundialista.webp` - origen https://dameunhit.app/wp-content/uploads/2026/08/WAKA-GO-MUNDIALISTA-ALFA-03-copia.png (pagina https://dameunhit.app/product/waka-go-mundialista/)

## Fotos de la tienda del proveedor (public/proveedores/karen)

Origen: catalogo publico de la tienda del proveedor, descargado una sola vez (direccion privada, no se publica aqui).

- Elfbar BC Pro 40K (Elfbar, id 114, exacto): `elfbar-bc-pro-40k.webp`
- Fasta 37K (Fasta, id 121, exacto): `fasta-37-000.webp`
- IPLAY Box 4K (IPLAY, id 100, probable): `vape-iplay-x-box.webp`
- IPLAY Box Pro 15K (IPLAY, id 98, probable): `vape-iplay-x-box-pro.webp`
- IPLAY Box Pro Max 50K (IPLAY, id 82, exacto): `iplay-x-box-pro-max-50-000.webp`
- IPLAY Burst 45K (IPLAY, id 97, exacto): `iplay-burst-45-000.webp`
- IPLAY Max (IPLAY, id 111, exacto): `vape-iplay-max.webp`
- Nexa Pix 35K (Nexa, id 158, exacto): `nexa-pix-35-000.webp`
- Nexa Ultra 40K (Nexa, id 113, exacto): `nexa-ultra-40-000.webp`
- Pillow Talk (Pillow Talk, id 148, probable): `pillow-talk-40k.webp`
- Pillow Talk 40K (Pillow Talk, id 99, exacto): `pillow-talk-40k.webp`
- Box Pro 15 (Sin marca, id 139, probable): `vape-iplay-x-box-pro.webp`
- Box Pro Max (Sin marca, id 140, probable): `iplay-x-box-pro-max-50-000.webp`
- Fifty Bar (Sin marca, id 146, exacto): `fifty-bar.webp`
- Instabar 70K (Sin marca, id 145, exacto): `instabar-be-70-000.webp`
- PA30000 (Sin marca, id 136, probable): `waka-pro-30k.webp`
- Snowwolf (Sin marca, id 147, exacto): `snowwolf.webp`
- X-Box 50k (Sin marca, id 138, probable): `iplay-x-box-pro-max-50-000.webp`
- Waka Blade (Waka, id 153, exacto): `waka-blade-33-000.webp`
- Waka Blade 33K (Waka, id 85, exacto): `waka-blade-33-000.webp`
- Waka Burst (Waka, id 122, probable): `waka-burst-36-000.webp`
- Waka Burst 36K (Waka, id 83, exacto): `waka-burst-36-000.webp`
- Waka Elite (Waka, id 124, probable): `waka-elite-40k.webp`
- Waka Elite 40K (Waka, id 80, exacto): `waka-elite-40k.webp`
- Waka Go (Waka, id 119, probable): `waka-go-10-000.webp`
- Waka GO 10K (Waka, id 95, exacto): `waka-go-10-000.webp`
- Waka Icon 50K (Waka, id 77, exacto): `waka-icon-50-000.webp`
- Waka Icon Slim 20K (Waka, id 92, exacto): `waka-icon-slim.webp`
- Waka Jupiter (Waka, id 125, probable): `waka-jupiter-50k.webp`
- Waka Jupiter 50K (Waka, id 79, exacto): `waka-jupiter-50k.webp`
- Waka Optimus 100K (Waka, id 76, exacto): `waka-optimus.webp`
- Waka Slim (Waka, id 127, probable): `waka-slim-12-000.webp`
- Waka Slim 12K (Waka, id 93, exacto): `waka-slim-12-000.webp`
- Waka So Pro (Waka, id 155, exacto): `vape-waka-sopro-15-000.webp`
- Waka Sopro 30K (Waka, id 87, probable): `waka-pro-30k.webp`

## Modelos sin foto (declarados explicitamente)

- Adjust 40K (Adjust, id 109)
- Dojo 40K (Dojo, id 110)
- Elfbar 40K (Elfbar, id 150)
- Elux 50K (Elux, id 106)
- Extre Bar 40K (Extre Bar, id 115)
- Fasta Burst 37K (Fasta, id 102)
- Fasta Kit 40K (Fasta, id 103)
- Funky Republic Fi 3K (Funky Republic, id 118)
- iPlay 15K (IPLAY, id 161)
- Lost Mary 35K (Lost Mary, id 105)
- Maskking 100K (Maskking, id 159)
- Maskking Fexo 45K (Maskking, id 86)
- Maskking Ice X 40K (Maskking, id 88)
- Nexa 35K (Nexa, id 112)
- Nexa 50K (Nexa, id 104)
- Nexa Ultra 50K (Nexa, id 157)
- Rifbar Pro 40K (Rifbar, id 108)
- Blade (Sin marca, id 131)
- Burst (Sin marca, id 130)
- Elite (Sin marca, id 137)
- Go (Sin marca, id 142)
- Icon (Sin marca, id 135)
- Optimus (Sin marca, id 128)
- Slim (Sin marca, id 134)
- Smash Go (Sin marca, id 133)
- Uno Mas X (Uno Mas, id 117)
- Vhill 3K (Vhill, id 162)
- Waka 100 (Waka, id 144)
- Waka 15 (Waka, id 132)
- Waka 15K (Waka, id 120)
- Waka 30 (Waka, id 129)
- Waka 30K (Waka, id 151)
- Waka 36 (Waka, id 143)
- Waka 36K (Waka, id 156)
- Waka 50 (Waka, id 141)
- Waka 50K (Waka, id 152)
- Waka 60K (Waka, id 160)
- Waka DM 15K (Waka, id 90)
- Waka Icon (Waka, id 123)
- Waka Titan 30K (Waka, id 154)
