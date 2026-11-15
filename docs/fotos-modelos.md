# Fotos de modelos

Fotos de los 87 modelos activos del catalogo (lista leida de solo lectura de `catalogo.modelo` el 14-nov). Datos en `src/dominio/catalogo/fotos-modelos.ts` (cada modelo con su ruta de foto o `null` explicito, y su confianza); la misma tabla alimenta el catalogo, el inventario, pedidos, compras y el tablero del proveedor. Hay dos carpetas y un archivo nunca se duplica: `public/proveedores/karen/<clave>.webp` (fotos de la tienda del proveedor, 24 usadas de 49 descargadas) y `public/modelos/<slug>.webp` (fotos propias, 12). Todo es webp, 4:5 o proporcion original, ancho maximo 800 px, menos de 150 KB, sin metadatos. La prueba `test/unit/catalogo/fotos_modelos.test.ts` verifica que todo modelo tenga foto o declare que no la tiene, que cada archivo exista, sea webp y pese menos de 150 KB, y que este documento lo liste.

Cobertura al 14-nov: 64 de 87 modelos con foto (49 exactas, 15 probables por confirmar) y 23 sin foto. Los 17 nuevos salen del diccionario de alias Waka confirmado por el dueno.

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

- Adjust 40K (Adjust, id 109, probable): `adjust-40k.webp` - origen https://cdn11.bigcommerce.com/s-nlylv/images/stencil/2560w/products/2581/9229/AdjustMyCool40K_02-800x800__33099.1726867720.jpg?c=2 (pagina https://perfectvape.com/adjust-mycool-40k/; descargada el 2026-11-15)

- Dojo 40K (Dojo, id 110, probable): `dojo-40k.webp` - origen https://cdn.shopify.com/s/files/1/0755/1028/4521/files/sphere-s-02-1.webp (pagina https://www.dojovape.com/products/sphere-s; descargada el 2026-11-15)

- Elfbar 40K (Elfbar, id 150, probable): `elfbar-40k.webp` - origen https://uvapeshop.com/cdn/shop/files/elf-bar-mixart-40k-disposable-vape-device-blue-razz-ice-20ml_512x512.jpg?v=1765474516 (pagina https://uvapeshop.com/collections/elf-bar-mixart-40k-disposables; descargada el 2026-11-15)

- Elux 50K (Elux, id 106, probable): `elux-50k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/EluxPro50KGallery.png?v=1771609567 (pagina https://vapordna.com/products/elux-cyberover-pro-50k-50000-puffs-disposable-vape; descargada el 2026-11-15)

- Extre Bar 40K (Extre Bar, id 115, exacto): `extre-bar-40k.webp` - origen https://cdn11.bigcommerce.com/s-2v1qqoz92o/images/stencil/1280x1280/products/1034/2142/EXTREBARDISPOSABLEVAPE-40000PUFFS__73142.1784597344.png?c=1 (pagina https://flyingvape.com/products/extre-bar-disposable-vape-40000-puffs; descargada el 2026-11-15)

- Fasta Burst 37K (Fasta, id 102, probable): `fasta-burst-37k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/FastaBurrstCreamyPerfectPeach.png?v=1776703825 (pagina https://vapordna.com/products/fasta-burrst-v2-37k-37000-puffs-disposable-vape-25ml; descargada el 2026-11-15)

- Fasta Kit 40K (Fasta, id 103, exacto): `fasta-kit-40k.webp` - origen https://image.vapesourcing.com/imagecache/800/images/202601/fasta-40k-kit.jpg (pagina https://vapesourcing.com/fasta-40k-kit.html; descargada el 2026-11-15)

- Funky Republic Fi 3K (Funky Republic, id 118, probable): `funky-republic-fi-3k.webp` - origen https://cdn11.bigcommerce.com/s-4yd3whobzs/images/stencil/1280x1280/products/634/385/Fi3000_Tropical-Delight_600x600_9032ed8d-1d93-427a-9838-212cf6fe5fe6__77169.1786998458.png?c=1 (pagina https://ebcreate.store/products/funky-republic-fi3000-disposable-vape; descargada el 2026-11-15)

- iPlay 15K (IPLAY, id 161, probable): `iplay-15k.webp` - origen https://cdn.shopify.com/s/files/1/0364/8277/7219/files/IPLAY-X-Box-Pro-Disposable-10_000Puffs-WatermelonIce.png?v=1740894499 (pagina https://ajvmxonline.com/products/iplay-x-box-pro-disposable-10-000-puffs-iplay; descargada el 2026-11-15)

- Lost Mary 35K (Lost Mary, id 105, probable): `lost-mary-35k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/LostMaryMT35KGalleryNew.png?v=1764199245 (pagina https://vapordna.com/products/lost-mary-mt35k-turbo-35000-puffs-disposable-vape; descargada el 2026-11-15)

- Maskking 100K (Maskking, id 159, probable): `maskking-100k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/MaskkingExtre100KGallery.png?v=1776726668 (pagina https://vapordna.com/products/maskking-extre-100k-disposable; descargada el 2026-11-15)

- Maskking Fexo 45K (Maskking, id 86, exacto): `maskking-fexo-45k.webp` - origen https://tsvapeb2b.com/wp-content/uploads/2026/05/c337aa40ea0f55e497bb5a17a5321f51-819x1024.png (pagina https://tsvapeb2b.com/product/maskking-fexo-45000-puffs-disposable-vape-360-infinite-display-dual-mesh-coil-wholesale-vape/; descargada el 2026-11-15)

- Maskking Ice X 40K (Maskking, id 88, exacto): `maskking-ice-x-40k.webp` - origen https://cdn.shopify.com/s/files/1/0574/1228/8610/files/maskking-icex-40000-puffs-disposable-vape-wholesale-3786150.jpg?v=1767088938 (pagina https://vapzvape.com/products/maskking-icex-40000-puffs-disposable-vape-wholesale; descargada el 2026-11-15)

- Nexa 35K (Nexa, id 112, probable): `nexa-35k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/NexaPix35KGallery_90b74636-3605-436e-a21b-675f61b1a21a.png?v=1758151690 (pagina https://vapordna.com/products/nexa-pix-35k-35000-puffs-disposable-vape-16ml; descargada el 2026-11-15)

- Nexa 50K (Nexa, id 104, probable): `nexa-50k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/NexaUltraII50kGallery.png?v=1762387595 (pagina https://vapordna.com/products/nexa-ultra-ii-50k-50000-puff-disposable-vape-20ml; descargada el 2026-11-15)

- Nexa Ultra 50K (Nexa, id 157, probable): `nexa-ultra-50k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/NexaUltraII50kGallery.png?v=1762387595 (pagina https://vapordna.com/products/nexa-ultra-ii-50k-50000-puff-disposable-vape-20ml; descargada el 2026-11-15)

- Rifbar Pro 40K (Rifbar, id 108, probable): `rifbar-pro-40k.webp` - origen https://cdn.shopify.com/s/files/1/0127/1821/1131/files/RifBarMixPro40KGallery.png?v=1754953872 (pagina https://vapordna.com/products/rifbar-mixpro-40k-puffs-disposable-vape; descargada el 2026-11-15)

- Optimus (Waka, id 128, probable): `optimus.webp` - origen https://cdn.shopify.com/s/files/1/0364/8277/7219/files/WAKA-Waka-Optimus-100k-Disposable-10_000Puffs-Watermelon.png?v=1779199516 (pagina https://ajvmxonline.com/products/waka-optimus-100k-disposable-100-000-puffs-waka; descargada el 2026-11-15)

- Uno Mas X (Uno Mas, id 117, probable): `uno-mas-x.webp` - origen https://cdn.shopify.com/s/files/1/0613/8472/0630/files/Apple-peach-strawberry-UNO-MAS-X-Stick-Front.png?v=1743985979 (pagina https://giantvapes.com/products/uno-mas-x-10000-disposable; descargada el 2026-11-15)

- Vhill 3K (Vhill, id 162, probable): `vhill-3k.webp` - origen https://cdn.shopify.com/s/files/1/0581/2699/1521/files/0001-2444791225468933782.jpg?v=1744686065 (pagina https://ricovapestore.com/en/products/vhill-v3000; descargada el 2026-11-15)

- Waka 100 (Waka, id 144, probable): `waka-100.webp` - origen https://cdn.shopify.com/s/files/1/0364/8277/7219/files/WAKA-Waka-Optimus-100k-Disposable-10_000Puffs-Blueberry.png?v=1779199511 (pagina https://ajvmxonline.com/products/waka-optimus-100k-disposable-100-000-puffs-waka; descargada el 2026-11-15)

- Waka DM 15K (Waka, id 90, probable): `waka-dm-15k.webp` - origen https://cdn.shopify.com/s/files/1/0081/8855/9413/files/PortadaBatonWEB-2024-07-12T170515.410_1.png?v=1720829273 (pagina https://mrvapes.mx/products/waka-sopro-dm41i-desechable-15000-hits; descargada el 2026-11-15)

- Waka Titan 30K (Waka, id 154, probable): `waka-titan-30k.webp` - origen https://cdn.shopify.com/s/files/1/0081/8855/9413/files/PortadaBatonWEB-2025-02-12T131546.818_1.png?v=1739391749 (pagina https://mrvapes.mx/products/waka-titan-desechable-30-000-hits; descargada el 2026-11-15)

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

## Fotos por alias confirmado (dueno, 14-nov)

El dueno confirmo el diccionario de alias Waka (nombre de los socios = nombre por puffs; `scripts/catalogo/alias-waka.json`): son el mismo producto, asi que estos modelos usan la foto de la tienda de su equivalente. Confianza exacto por esa confirmacion.

- Waka 15K (id 120): `vape-waka-sopro-15-000.webp`
- Waka Icon (id 123): `waka-icon-50-000.webp`
- Waka 30 (id 129): `waka-pro-30k.webp`
- Burst (id 130): `waka-burst-36-000.webp`
- Blade (id 131): `waka-blade-33-000.webp`
- Waka 15 (id 132): `vape-waka-sopro-15-000.webp`
- Smash Go (id 133): `waka-go-10-000.webp`
- Slim (id 134): `waka-slim-12-000.webp`
- Icon (id 135): `waka-icon-50-000.webp`
- Elite (id 137): `waka-elite-40k.webp`
- Waka 50 (id 141): `waka-icon-50-000.webp`
- Go (id 142): `waka-go-10-000.webp`
- Waka 36 (id 143): `waka-burst-36-000.webp`
- Waka 30K (id 151): `waka-pro-30k.webp`
- Waka 50K (id 152): `waka-icon-50-000.webp`
- Waka 36K (id 156): `waka-burst-36-000.webp`
- Waka 60K (id 160): `waka-steel.webp`

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
- Optimus (Sin marca, id 128)
- Uno Mas X (Uno Mas, id 117)
- Vhill 3K (Vhill, id 162)
- Waka 100 (Waka, id 144)
- Waka DM 15K (Waka, id 90)
- Waka Titan 30K (Waka, id 154)
