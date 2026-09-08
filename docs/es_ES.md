# Comprimir vídeo · Video Compress for Eagle

<!-- section:overview -->
## Descripción breve

Un complemento de transcodificación local para comprimir vídeos por lotes en Eagle. Carga automáticamente los vídeos seleccionados (también puedes arrastrar archivos de vídeo locales a la ventana), los vuelve a codificar con FFmpeg y, si la compresión tiene éxito, sustituye el archivo de la ruta original.

- Todo el procesamiento ocurre localmente. No se suben archivos de vídeo ni se envían metadatos a ningún servidor.
- Salida H.265/HEVC por defecto, con opciones H.264, AV1, VP9 y solo remultiplexado.
- Tres modos de compresión: calidad primero (CRF), tasa de bits objetivo y tamaño de archivo objetivo (H.264/H.265 con codificación en dos pasadas).
- La estimación de tamaño en modo CRF se basa en codificaciones de muestra reales, por lo que la interfaz muestra un intervalo en lugar de una cifra exacta engañosa.
- Controles de resolución, velocidad de fotogramas, audio, velocidad de codificación, concurrencia y tratamiento de fuentes de 10 bits.
- Detecta fuentes HDR y conserva sus metadatos de color al recodificar; marca los archivos ya comprimidos para evitar una segunda pasada con pérdida por descuido.
- Codificación por GPU opcional (NVIDIA NVENC, Intel Quick Sync, AMD AMF), que se usa automáticamente cuando hay hardware compatible y vuelve a la codificación por software en CPU en caso contrario.
- La copia de seguridad está desactivada por defecto y no puede activarse hasta elegir una carpeta de destino. Si la dejas desactivada, no quedará ninguna copia del archivo original.
- Los ajustes se conservan, la interfaz sigue el tema de Eagle y hay ocho idiomas disponibles.

<!-- section:usage -->
## Instrucciones de uso

**Antes de empezar**

Este complemento necesita **tanto** un FFmpeg funcional **como** ffprobe.

- Recomendado: instala el complemento de dependencia «FFmpeg» en Eagle. El complemento lo usará automáticamente.
- También puedes instalar FFmpeg (con ffprobe incluido) en tu sistema; en ese caso se recurre a esa instalación local.
- Si no encuentra ninguno de los dos, no podrá comprimir: la barra de estado avisará de que FFmpeg no está disponible, el registro se desplegará automáticamente y con «Copiar diagnóstico» podrás ver las rutas exploradas.

La plataforma verificada actualmente es macOS.

**Flujo básico**

1. Selecciona uno o varios vídeos en Eagle.
2. Abre **Comprimir vídeo**. Los vídeos seleccionados se importan automáticamente a la lista de tareas. También puedes arrastrar archivos de vídeo locales a la ventana.
3. Elige el códec y el modo de compresión. El valor predeterminado es H.265 con CRF 28.
4. Revisa el tamaño original, el tamaño de salida estimado y el resumen del cambio de almacenamiento.
5. Si quieres conservar el archivo original, elige primero una carpeta de copia de seguridad y luego activa la copia.
6. Haz clic en **Iniciar compresión** y confirma después de leer los avisos de sobrescritura y copia de seguridad del diálogo.

**Cómo elegir el modo**

| Modo | Recomendado para | Comportamiento del tamaño |
| --- | --- | --- |
| Calidad primero (CRF) | Uso general, calidad visual constante | El tamaño final depende de la complejidad de la fuente; se muestra un intervalo estimado a partir de muestras |
| Tasa de bits objetivo | Cuando ya conoces la tasa de bits | Se calcula a partir de la duración, la tasa de bits de vídeo y los ajustes de audio |
| Tamaño de archivo objetivo | Presupuesto de tamaño estricto | H.264/H.265 usan dos pasadas para acercarse al objetivo; la sobrecarga del contenedor y del audio puede causar una pequeña diferencia |

**Cómo elegir la aceleración por hardware**

El selector «Aceleración por hardware» ofrece tres opciones:

| Opción | Comportamiento |
| --- | --- |
| Automático (se detectó …) | Usa la GPU si hay un codificador por hardware utilizable y vuelve a la CPU en caso contrario. Es el valor predeterminado y muestra la familia detectada |
| Forzar codificación por GPU | Solo codificación por hardware; falla si este equipo no tiene ningún codificador utilizable |
| Solo codificación por software en CPU | Codificación por software de principio a fin, el resultado más predecible |

- Se admiten NVIDIA NVENC, Intel Quick Sync Video y AMD AMF. La codificación por hardware suele ser de 3 a 5 veces más rápida y reduce mucho el uso de CPU, con una calidad a igual tasa de bits prácticamente equivalente a la codificación por software.
- VP9 no tiene implementación por hardware y siempre usa la CPU.
- Si la codificación por hardware falla, se reintenta una vez en CPU en lugar de marcar la tarea como fallida de inmediato.
- En macOS, si ninguna de las tres está disponible, el complemento vuelve a la codificación por software. Es el comportamiento esperado.

**Colores del cambio de almacenamiento**: verde significa menor que el original, rojo significa mayor, y el color de texto normal indica que apenas hay cambio o que el intervalo estimado cruza el tamaño original.

**Otras notas**

- Puedes pulsar **Detener y cancelar** en cualquier momento. Los procesos FFmpeg en curso se terminan, las tareas no iniciadas se marcan como canceladas de inmediato y los originales no se ven afectados.
- Si cambias la selección en Eagle y vuelves a abrir el complemento durante una ejecución, te preguntará si cancelar la acción, sustituir la cola actual o añadir a ella. El trabajo en curso nunca se descarta en silencio.
- Al elegir «Añadir a la cola de tareas» se pide una segunda confirmación: los archivos añadidos empiezan a comprimirse de inmediato y sustituyen a sus originales. El diálogo enumera los archivos nuevos e indica el estado real de la copia de seguridad de esta ejecución. Durante la compresión no se pueden cambiar los ajustes de copia.

**Sobre la sustitución de archivos**

- Si la compresión tiene éxito, se sustituye el archivo de la ruta original, incluidos los archivos que hayas arrastrado a la ventana. Es una operación con pérdida e irreversible.
- Desactivar «Sincronizar con la biblioteca de Eagle al terminar» **no evita** la sustitución del archivo original. Esa opción no controla la sobrescritura: solo decide si se actualiza el elemento vinculado mediante la API de sustitución de Eagle y se regenera la miniatura, así que no sirve para conservar el original.
- Para conservar el original, elige primero una carpeta con «Elegir ubicación de copia…» y comprueba que «Hacer copia del original antes de comprimir» esté activado. Sin carpeta elegida la casilla está desactivada y no se hace ninguna copia.
- Los archivos que no reducen su tamaño tras la compresión se omiten y el original se mantiene intacto.
- Conserva siempre una copia independiente del material irremplazable.

**Datos que se conservan y cómo eliminarlos**

- El complemento escribe exactamente dos archivos en tu equipo: los ajustes en `~/Library/Application Support/Eagle 视频压缩/settings.json` y el registro de ejecución en `~/Library/Logs/Eagle 视频压缩/plugin.log`. En Windows ambos están dentro de `%APPDATA%\Eagle 视频压缩\`.
- Ambas rutas aparecen en la parte superior del panel «Registro de ejecución» del complemento, donde puedes verlas y copiarlas directamente.
- «Restablecer ajustes» en la barra superior solo devuelve las opciones a sus valores por defecto; no borra el archivo.
- Desinstalar el complemento no elimina estos archivos. Para una limpieza completa, borra a mano las dos carpetas indicadas.
- Los archivos temporales de la compresión se crean junto al archivo original y se eliminan al terminar la tarea o en el siguiente arranque, así que no se acumulan.

<!-- section:changelog -->
## Historial de versiones

### 1.1.2

- Corregido: los elementos añadidos a una cola en ejecución empezaban a comprimirse y sustituían sus originales de inmediato, mientras el aviso solo mostraba un recuento y los nombres de archivo. Añadir durante una ejecución abre ahora su propio diálogo de confirmación, que enumera los archivos nuevos, indica que se comprimirán al momento y sustituirán los archivos de la ruta original, y muestra el estado real de la copia de seguridad de esta ejecución, con un aviso explícito cuando los originales no se pueden recuperar.
- Corregido: los avisos de sobrescritura, copia de seguridad e irreversibilidad previos a la ejecución estaban fijados en chino simplificado y no aparecían en ningún otro idioma. Ahora provienen de los archivos de idioma, con traducción completa en los ocho idiomas.
- Corregido: la redacción daba a entender que el original solo se sustituía con «Sincronizar con la biblioteca de Eagle al terminar» activado. El archivo de la ruta original se sustituye en ambos casos; esa opción solo decide si la API de sustitución de Eagle actualiza el elemento vinculado y su miniatura. Se han corregido la interfaz y la documentación.
- Mejorado: el paquete se construye ahora a partir de una lista de inclusión y contiene solo el programa, los estilos, el icono, los idiomas y la licencia.
- Mejorado: el nombre y la descripción para la tienda de complementos tienen una fuente única, y los límites de longitud por idioma se comprueban antes de enviarlos.
- Mejorado: las instrucciones de uso empiezan con «Antes de empezar», que indica que hacen falta FFmpeg y ffprobe y qué ocurre si no se encuentra ninguno.
- Corregido: los botones «Iniciar compresión» y «Detener y cancelar» daban un salto lateral en cuanto se calculaban las cifras del resumen. En una ventana estrecha pasaban a una segunda fila mientras el elemento que los empujaba a la derecha se quedaba en la primera, dejándolos pegados a la izquierda. Ahora se alinean a la derecha por sí mismos, haya salto de línea o no.
- Mejorado: el panel de registro muestra ahora la ruta completa del archivo de ajustes y del archivo de registro, y las instrucciones incluyen «Datos que se conservan y cómo eliminarlos», que indica qué queda tras desinstalar y cómo borrarlo.

### 1.1.1

- Corregido: en los archivos con varias pistas de audio solo quedaba una pista después de comprimir. Ahora se conservan todas las pistas tal cual.
- Corregido: si el resultado salía más grande que el original, aun así lo sustituía. Ahora esos archivos se omiten y el original queda intacto.
- Corregido: al cancelar una tarea podía quedar un archivo a medias y dañado. Ahora se pide primero una salida ordenada y solo después se fuerza el final.
- Corregido: los archivos temporales generados durante la compresión aparecían en Eagle como elementos nuevos de la biblioteca.
- Mejorado: importar gran cantidad de elementos ya no bloquea la interfaz; con 100 archivos el trabajo se redujo a aproximadamente 1/144 del anterior.
- Mejorado: la lectura de la información de los archivos es unas 3 veces más rápida; 25 archivos pasaron de 1,3 s a 0,45 s.
- Mejorado: VP9 ahora codifica con varios hilos a la vez; en material 1080p fue unas 2,2 veces más rápido en las pruebas.
- Mejorado: el resultado se aplica mediante un simple renombrado; escribir de vuelta un archivo de 1 GB pasó de unos 1 s a prácticamente nada.
- Mejorado: al comprimir varias tareas a la vez, los hilos de codificación se reparten según un presupuesto global del equipo; el uso total de CPU baja aproximadamente un 6–9 %.
- Añadido: en equipos de 24 núcleos o más, la concurrencia puede ajustarse a 6 u 8.

### 1.1.0

- Se añade codificación por GPU: compatible con NVIDIA NVENC, Intel QSV y AMD AMF. El nuevo selector «Aceleración por hardware» ofrece automático, forzar GPU o solo CPU (automático por defecto, con el nombre de la GPU detectada).
- Se corrige la conversión de la escala de calidad: CRF y QP por hardware son escalas distintas, así que ahora se convierte a `-rc constqp -qp` (+2 en H.264/HEVC, ×3.2 en AV1). Antes el tamaño se desviaba entre un 45 % y un +340 %.
- Si la codificación por hardware falla, se reintenta una vez en CPU. VP9 no tiene implementación por hardware y siempre usa la CPU.
- Con codificación por hardware la concurrencia se limita a 2, y la estimación de tamaño previa tiene en cuenta el codificador seleccionado.
- En material 1080p30, H.265 pasó de unos 28 s y unos 10 núcleos a unos 3 s y menos de un núcleo, con una diferencia de PSNR inferior a 0,12 dB.

### 1.0.2

- Añadida la detección de HDR, con una insignia ámbar en la lista de tareas para HDR10 / HLG / Dolby Vision / HDR10+.
- Los metadatos de color se conservan al recodificar, de modo que una fuente HDR ya no se marca como SDR.
- Añadida una marca de «ya comprimido» escrita en la salida. Al volver a cargar el archivo se muestra cuántas veces y en qué fecha se comprimió. Se puede desactivar en los ajustes. AVI y TS no admiten metadatos arbitrarios, así que en ellos no se escribe nada.
- El resumen indica cuántos archivos de la cola ya han sido comprimidos por este complemento.
- Corregido: elegir H.264 para una fuente HDR destruía la información HDR sin aviso; ahora aparece como advertencia en el resumen.

### 1.0.1

- Corregido: la salida H.265 no se reproducía en Finder, Vista rápida ni QuickTime de macOS (ahora se etiqueta como `hvc1`).
- Corregido: la sustitución del archivo original se hace mediante un archivo intermedio y un renombrado atómico, de modo que una cancelación o un error de E/S no dejan la fuente truncada.
- Corregido: una excepción síncrona de la API de selección de Eagle escapaba de su manejador.
- Corregido: una respuesta tardía de selección podía reabrir un diálogo ya cerrado.
- Añadido: control visible **Detener y cancelar** durante la compresión.
- Añadido: elección triple al reabrir el complemento con una nueva selección de Eagle: cancelar, sustituir la cola o añadir.
- Añadido: se pueden añadir elementos a una cola en ejecución; los procesos libres los recogen.
- Añadido: progreso de la estimación por muestreo con los controles **Analizar todo** y **Detener análisis**.
- Mejorado: el número de procesos se deriva de los núcleos de CPU, el códec y el modo de dos pasadas, con un límite explícito de hilos por códec.
- Mejorado: la salida temporal se escribe junto a la fuente cuando es posible, evitando una copia completa adicional en volúmenes externos o de red.

### 1.0.0

- Primera versión: compresión por lotes, varios códecs y modos de compresión, estimación de tamaño, copia de seguridad y sustitución, y registro de diagnóstico.
