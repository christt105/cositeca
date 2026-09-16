# Cómo añadir una cosita

1. Necesitas una cuenta de GitHub. Si no tienes, créala en
   [github.com](https://github.com) (es gratis).
2. Copia el link del mensaje de Telegram: en el mensaje con el archivo, pulsa
   los tres puntos o mantén pulsado y elige "Copiar enlace".
3. Busca la película o serie en [themoviedb.org](https://www.themoviedb.org)
   y copia la URL de su página (por ejemplo
   `https://www.themoviedb.org/movie/550-fight-club`). Si no está en TMDB,
   también vale un id de IMDB (empieza por `tt`).
4. En la web de Cositeca, pulsa "Añadir" (arriba, o dentro de una tarjeta si
   ya existe el título y quieres sumar otra versión).
5. Se abrirá un formulario de Issue en GitHub. Rellena:
   - **URL de TMDB o id de IMDB**: lo del paso 3.
   - **Calidad**: 1080p o 4K.
   - **Temporada**: solo para series, el número (0 para especiales, `all`
     para la serie completa).
   - **Etiquetas**: opcional, por ejemplo `Latino`.
   - **Link de Telegram**: lo del paso 2.
6. Envía el formulario. Un robot revisa la petición en un par de minutos: si
   todo está bien, cierra la Issue y el link queda añadido; si algo falla, te
   comenta el motivo en la propia Issue y puedes editarla para corregirlo.
7. La web tarda un par de minutos más en actualizarse tras el commit.

## Corregir o borrar un link

Desde la tarjeta del título, pulsa "Corregir un link" y rellena el link
actual y, si quieres cambiarlo, el link nuevo (déjalo vacío para borrarlo).
