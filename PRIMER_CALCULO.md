# Primer cálculo local

El modo local consulta el historial de finalización de SLURM antes de admitir un envío. La consulta debe funcionar por el puente WSL calificado: si no está disponible, la operación devuelve `REJECTED` con el motivo `ruta de evidencia terminal no disponible`, sin crear un job ni reservar `allocated_cpu_second`.

## WSLInterop temporal

El servicio debe arrancar en Ubuntu/WSL. Si en la misma sesión falta `/proc/sys/fs/binfmt_misc/WSLInterop`, captura primero el estado:

```bash
ls /proc/sys/fs/binfmt_misc
cat /proc/sys/fs/binfmt_misc/WSLInterop
```

Con autorización de Manuel, registra el manejador temporal desde esa sesión:

```bash
echo ':WSLInterop:M::MZ::/init:PF' | sudo tee /proc/sys/fs/binfmt_misc/register
```

Después, repite y conserva las dos capturas:

```bash
ls /proc/sys/fs/binfmt_misc
cat /proc/sys/fs/binfmt_misc/WSLInterop
```

No ejecutes la línea de registro si `WSLInterop` ya existe. El registro vive en `binfmt_misc` y se pierde al reiniciar WSL; tras cada reinicio hay que repetir las capturas y, si falta el manejador, el comando temporal. Mientras falte, el preflight seguirá rechazando los envíos con el motivo indicado. No se modifica `/etc/wsl.conf`, los permisos/ACL ni la configuración del sitio.

El adaptador valida en cada consulta el SHA-256 fijado de `wsl.exe` (`fcd08205b608b5c4831e0dcb1801dd274436cd2c8420815f18ae58a085891a18`) y de `/usr/bin/sacct` (`20632577ca462f7d570feb56adef7c811fbf5911b9b97810a67a497342e97b71`). Solo la llamada de historial `sacct --completion --jobs=<dígitos>` usa root; la consulta de preflight del job 440 no envía trabajo y no constituye evidencia terminal firmada.
