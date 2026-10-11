# DFT Lab Suite

Plataforma científica para aprender DFT, preparar estructuras y analizar resultados de SIESTA. Esta base conserva la aplicación existente y documenta su evolución hacia campañas de cálculo locales y en HPC, con QRAFT-HPC y HubbardFlow.

**Estado:** frontend JavaScript con módulos ES, compilación con esbuild y pruebas de lectores y cristalografía. La arquitectura V2.1 y la integración de los motores son propuestas; este repositorio todavía no implementa un servicio de cálculo distribuido ni una interfaz React.

## Inicio

Requisito de desarrollo: Node.js 24.18.0 y Git. CI usa esa misma versión en Windows y Linux.

```sh
cd app
npm ci
cd ..
node scripts/verify-original-baseline.mjs
node scripts/verify.mjs
```

La verificación ejecuta las suites existentes y compila `app/dist/dftlab.html` y `app/dist/dftlab_artifact.html`. El primer archivo puede abrirse directamente en el navegador. Los resultados de compilación no se versionan; CI los conserva como artefactos durante 14 días.

La compilación actual emite tres advertencias heredadas sobre `import.meta` en el bundle IIFE de Moyo. Las pruebas de referencias y el build no equivalen a una prueba de todas las vistas del HTML: la compatibilidad offline y la ejecución en navegador deben verificarse también durante la migración.

## Originales y migración

La etiqueta [`baseline-v1`](https://github.com/Jairomcarmona/dftlab-suite/tree/baseline-v1) conserva los 480 archivos originales incluidos, sin normalización de bytes. El [manifiesto](docs/migration/original-file-manifest.json) registra sus SHA-256. Se excluyeron dependencias instaladas, cachés, compilados y el Git interno que no tenía commits. [Detalle de conservación y migración](docs/migration/README.md).

Los prototipos, cálculos de referencia y pseudopotenciales son material de migración y validación; su inclusión no acredita compatibilidad con todos los motores ni redistribución pública. No se ha asignado una licencia nueva al conjunto; deben revisarse las licencias y procedencias de cada componente antes de publicarlo o distribuirlo.

## Arquitectura y trabajo

- [Propuesta maestra V2.1](PROPUESTA_MAESTRA_DFTLAB_V2.md), [integración de motores](INTEGRACION_DFTLAB_QRAFT_HUBBARDFLOW.md) y [auditoría adversarial](AUDITORIA_ADVERSARIAL_ARQUITECTURA_PRODUCCION.md).
- [Plan de implementación para Claude Code](PLAN_IMPLEMENTACION_CLAUDE_CODE.md).
- [ADR-013: migración gradual de la interfaz a React y TypeScript](docs/adr/ADR-013-react-typescript-ui.md), propuesta pendiente de implementar y validar.
- [Reglas compartidas de desarrollo](docs/development/WORKING_RULES.md), utilizadas por `AGENTS.md` y `CLAUDE.md`.

El flujo previsto utiliza ramas cortas y pull requests contra `main`. La CI se ejecuta en cada push a `main` y cada PR. Este bootstrap se creó directamente en `main`; a partir de él los cambios deben ser concretos, revisables y verificados.

**Limitación verificada el 2026-10-10:** GitHub rechazó activar la protección de `main` con HTTP 403, indicando que para este repositorio privado se requiere GitHub Pro o cambiar su visibilidad a pública. El repositorio se conserva privado y la rama todavía no está protegida. CI está configurada, pero GitHub no exige que pase para hacer push o merge. Se dejó la [configuración preparada](docs/development/github-main-protection.json) para activar los dos checks y PR obligatoria cuando esté disponible esa capacidad; cero aprobaciones evita bloquear al único colaborador. Con un equipo, deberá revisarse la política de aprobaciones.

Comando para aplicar la configuración cuando la cuenta permita protección en este repositorio:

```sh
gh api --method PUT repos/Jairomcarmona/dftlab-suite/branches/main/protection --input docs/development/github-main-protection.json
```
