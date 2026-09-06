# Comprimir vídeo · Video Compress for Eagle

<!-- section:overview -->
## Descripción breve

Un complemento de transcodificación local para comprimir vídeos por lotes en Eagle. Carga automáticamente los vídeos seleccionados, los vuelve a codificar con FFmpeg y, si lo deseas, sustituye el elemento original de Eagle al terminar.

- Todo el procesamiento ocurre localmente. No se suben archivos de vídeo ni se envían metadatos a ningún servidor.
- Salida H.265/HEVC por defecto, con opciones H.264, AV1, VP9 y solo remultiplexado.
- Tres modos de compresión: calidad primero (CRF), tasa de bits objetivo y tamaño de archivo objetivo (H.264/H.265 con codificación en dos pasadas).
- La estimación de tamaño en modo CRF se basa en codificaciones de muestra reales, por lo que la interfaz muestra un intervalo en lugar de una cifra exacta engañosa.
- Controles de resolución, velocidad de fotogramas, audio, velocidad de codificación, concurrencia y tratamiento de fuentes de 10 bits.
- Detecta fuentes HDR y conserva sus metadatos de color al recodificar; marca los archivos ya comprimidos para evitar una segunda pasada con pérdida por descuido.
- La copia de seguridad está desactivada por defecto y no puede activarse hasta elegir una carpeta de destino.
- Los ajustes se conservan, la interfaz sigue el tema de Eagle y hay ocho idiomas disponibles.

<!-- section:usage -->
## Instrucciones de uso

**Requisitos**: Eagle con la dependencia FFmpeg disponible. Si no está accesible, se recurre a una instalación local de FFmpeg / FFprobe. La plataforma verificada actualmente es macOS.

**Flujo básico**

1. Selecciona uno o varios vídeos en Eagle.
2. Abre **Comprimir vídeo**. Los vídeos seleccionados se importan automáticamente a la lista de tareas.
3. Elige el códec y el modo de compresión. El valor predeterminado es H.265 con CRF 28.
4. Revisa el tamaño original, el tamaño de salida estimado y el resumen del cambio de almacenamiento.
5. Si quieres conservar el archivo original, elige primero una carpeta de copia de seguridad y luego activa la copia.
6. Haz clic en **Iniciar compresión** y confirma.

**Cómo elegir el modo**

| Modo | Recomendado para | Comportamiento del tamaño |
| --- | --- | --- |
| Calidad primero (CRF) | Uso general, calidad visual constante | El tamaño final depende de la complejidad de la fuente; se muestra un intervalo estimado a partir de muestras |
| Tasa de bits objetivo | Cuando ya conoces la tasa de bits | Se calcula a partir de la duración, la tasa de bits de vídeo y los ajustes de audio |
| Tamaño de archivo objetivo | Presupuesto de tamaño estricto | H.264/H.265 usan dos pasadas para acercarse al objetivo; la sobrecarga del contenedor y del audio puede causar una pequeña diferencia |

**Colores del cambio de almacenamiento**: verde significa menor que el original, rojo significa mayor, y el color de texto normal indica que apenas hay cambio o que el intervalo estimado cruza el tamaño original.

**Otras notas**

- Puedes pulsar **Detener y cancelar** en cualquier momento. Los procesos FFmpeg en curso se terminan, las tareas no iniciadas se marcan como canceladas de inmediato y los originales no se ven afectados.
- Si cambias la selección en Eagle y vuelves a abrir el complemento durante una ejecución, te preguntará si cancelar la acción, sustituir la cola actual o añadir a ella. El trabajo en curso nunca se descarta en silencio.
- Sustituir el archivo original implica pérdida y es irreversible. Conserva siempre una copia independiente del material irremplazable.

<!-- section:changelog -->
## Historial de versiones

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
