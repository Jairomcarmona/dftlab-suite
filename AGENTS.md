# Instrucciones para Codex y otros colaboradores

Este archivo solo orienta. Las reglas viven en [docs/development/WORKING_RULES.md](docs/development/WORKING_RULES.md) (compartidas con Claude Code) y el estado en [docs/reviews/TRASPASO.md](docs/reviews/TRASPASO.md) y [docs/reviews/REGISTRO_DEUDA.md](docs/reviews/REGISTRO_DEUDA.md). Si algo de aquí contradice esos documentos, mandan ellos. No iniciar una migración completa a React por la sola existencia del ADR propuesto.

## Al empezar una sesión

1. Leer `WORKING_RULES.md` y, de `TRASPASO.md`, «Continuidad con Codex», «Reglas a respetar» y la sección del bloque en curso (rama, carpeta, SHA, pendientes, siguiente paso). El estado está en el repositorio, no en chats anteriores.
2. `git fetch origin` y comprobar con GitHub el estado real de los PR citados; si difiere de la nota, gana GitHub y se corrige la nota.
3. Una rama corta y una carpeta aislada por ticket, desde `origin/main`. Nunca dos agentes en la misma carpeta o rama, ni reutilizar ramas ya fusionadas.

## Qué puede hacer sin pedir revisión

Implementar un ticket que ya tiene ficha completa (§14 de `PLAN_IMPLEMENTACION_CLAUDE_CODE.md`), contrato y vectores/fixtures aceptados, siguiendo exactamente lo que dicen. Añadir pruebas que fallen antes y pasen después. Corregir CI, documentación y regenerados oficiales derivados del cambio.

## Cuándo detenerse y pedir revisión

Parar, dejar el trabajo en commit y escribir en el PR o en un issue qué falta decidir, en lugar de decidirlo, cuando el cambio:

- toque fórmulas, unidades, convenciones, gates científicos, tolerancias, goldens, allowlists o baselines congeladas;
- cree o cambie un schema, contrato, vector normativo, campo, `reason` o versión pública;
- requiera un ADR nuevo o contradiga uno aceptado (`docs/adr/`);
- cambie pins de motores, `engine-versions.lock.json`, `baseline-v1`, protección de ramas, licencias o privacidad;
- dependa de una ficha ambigua o incompleta, o de dos documentos que se contradicen: abrir un issue citando ambos (archivo:línea) y no inventar el mapeo;
- solo podría pasar CI debilitando, saltando o marcando como `xfail` una prueba.

En esos casos, pedir al subagente `validador_cientifico` (`.codex/agents/validador-cientifico.toml`, solo lectura) una revisión de la pregunta concreta. Si responde APROBADO y el cambio ya está dentro de la ficha, continuar; si responde RECHAZADO, corregir; si responde REQUIERE_DECISIÓN_DE_MANUEL, o el cambio sale de la ficha, detenerse y preguntar a Manuel. El validador no sustituye la aprobación de Manuel para contratos, ADR, tolerancias o pins.

Los modelos del hilo principal y del validador se fijan en `.codex/config.toml` y en el archivo del agente; Codex solo los carga si el proyecto está marcado como confiable.

## Al cerrar cada PR

- PR pequeño contra `main`: problema, resultado, contratos afectados, verificación y límites.
- Fusionar solo con los cinco checks en verde sobre la punta: `Verify (ubuntu-24.04)`, `Verify (windows-2022)`, `Platform installed wheel` en ambos sistemas y `Regenerate references (ubuntu-24.04)`. Sin autorización de Manuel no se fusiona.
- Actualizar en `TRASPASO.md` solo la sección propia (rama, SHA, PR, CI, pendientes, siguiente paso) y, si aplica, `REGISTRO_DEUDA.md`. Entradas breves: lo que cambió, no la bitácora completa.
- Comprobaciones locales: `cd app && npm ci`, luego desde la raíz `node scripts/verify-original-baseline.mjs` y `node scripts/verify.mjs`.

## Pocos PR (regla fija de todo el proyecto)

El avance diario va en comentarios del issue de seguimiento o en notas no versionadas, no en un PR por paso. `docs/reviews/TRASPASO.md` se actualiza una sola vez por etapa cerrada, dentro del PR de código de esa etapa, o en un único PR al cerrar un bloque. Nunca se abre un PR documental solo para registrar que otro PR se fusionó. Los arreglos de código relacionados van agrupados en un solo PR. Detalle en `WORKING_RULES.md`.
