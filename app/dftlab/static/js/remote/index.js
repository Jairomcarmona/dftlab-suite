// Punto de extensión para conexión remota (terminal SSH a un clúster, envío de trabajos, descarga de salidas).
// NO implementado en v1. Ver ARQUITECTURA.md §8.
//
// Un navegador no puede abrir conexiones SSH ni TCP. La futura terminal necesitará un puente local
// (scripts/dftlab_bridge.*) que sirva la app en http://127.0.0.1:<puerto> y traduzca WebSocket ↔ SSH.
// Abierta desde file:// o desde el artifact publicado, la app no tiene puente y todo lo remoto queda oculto.
//
// Contrato que implementará el puente; las vistas solo usan estas funciones:
//   remote.available            → boolean: hay puente en esta sesión
//   remote.connect(host)        → Promise<Session>, host = {alias, hostname, user, port}
//   session.terminal(el)        → monta una terminal interactiva (xterm.js en vendor/) dentro de el
//   session.put(path, text)     → sube un archivo (p. ej. el .fdf y el .sh de fdfgen.js)
//   session.get(path)           → Promise<ArrayBuffer>, para pasar a siesta/index.js parseMany()
//   session.run(cmd)            → Promise<{stdout, stderr, code}>, p. ej. sbatch, squeue
//   session.close()
// Las credenciales nunca se guardan en la página ni en localStorage: las maneja el puente (ssh-agent, ~/.ssh/config).

export const remote = {
  available: false,
  async connect() { throw new Error('DFT Lab v1 no tiene conexión remota: hace falta el puente local (ARQUITECTURA.md §8).'); },
};
