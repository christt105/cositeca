# Cómo añadir una cosita

1. Necesitas una cuenta de GitHub. Si no tienes, créala en
   [github.com](https://github.com) (es gratis).
2. Copia el link del mensaje de Telegram: en el mensaje con el archivo, pulsa
   los tres puntos o mantén pulsado y elige "Copiar enlace".
3. En la web de Cositeca, pulsa "Añadir" (arriba, o "Añadir versión" en la
   página del título si ya existe y quieres sumar otra versión). Si has
   buscado algo y no está, el botón de "¿La añades?" te lleva con la
   búsqueda ya hecha.
4. Escribe el título en el buscador y elige la película o serie en la lista
   (también puedes pegar la URL de TMDB o un id de IMDB que empiece por
   `tt`). Si ya está en la Cositeca te lo avisa y te enseña las versiones
   que tiene, para no repetir.
5. Si quieres, elige otra portada entre las que salen.
6. Rellena el link de Telegram del paso 2, la calidad, la temporada (solo
   series), el audio y los subtítulos que trae el archivo, y etiquetas si
   hace falta (por ejemplo `HDR`). Si el audio o los subtítulos están en un
   idioma que no aparece en la lista, escríbelo en el campo "Otro idioma de
   audio/subtítulos": se añade a la lista para todo el mundo, no hace falta
   pedírselo a nadie.
7. Pulsa "Aceptar". Se abre un formulario de Issue en GitHub con todo
   relleno: revísalo y pulsa "Submit new issue".
8. Un robot revisa la petición en un par de minutos: si todo está bien,
   cierra la Issue y el link queda añadido; si algo falla, te comenta el
   motivo en la propia Issue y puedes editarla para corregirlo.
9. La web tarda un par de minutos más en actualizarse tras el commit.

Si el buscador no está disponible, el botón "Añadir" abre el formulario de
GitHub vacío: necesitarás buscar la película o serie en
[themoviedb.org](https://www.themoviedb.org) y pegar la URL de su página
(por ejemplo `https://www.themoviedb.org/movie/550-fight-club`).

## Editar o borrar un link

En la página del título, cada link tiene "Editar" y "Borrar":

- **Editar** abre un formulario con los valores actuales (link, calidad,
  temporada, audio, subtítulos, etiquetas). Cambia lo que haga falta y pulsa
  "Aceptar": se abre la Issue de GitHub ya rellena, revísala y envíala.
- **Borrar** pide confirmación y abre la Issue de borrado ya rellena.

## Cambiar la portada

En la página del título, pulsa "Cambiar portada", elige una de las que
salen (la primera es la de TMDB, que es la que se usa si no eliges otra) y
pulsa "Aceptar": se abre la Issue ya rellena.

En los tres casos el robot aplica el cambio en un par de minutos y la web
tarda otros pocos en actualizarse.
