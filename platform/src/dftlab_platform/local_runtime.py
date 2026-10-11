"""Private local directories and OS-held locks, independent of heartbeat age."""
from contextlib import contextmanager
import ctypes
import os
from pathlib import Path
import re
import subprocess

from .storage import local_database


def private_directory(path: Path) -> Path:
    path = Path(path).expanduser().absolute()
    if path.is_symlink() or (os.name == "nt" and path.is_junction()):
        raise ValueError("Private state directory must not be a link")
    path = local_database(path / "state.sqlite").parent
    if os.name != "nt":
        if path.stat().st_uid != os.getuid():
            raise PermissionError("Private directory has another owner")
        path.chmod(0o700)
    else:
        result = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, timeout=10, check=True, creationflags=subprocess.CREATE_NO_WINDOW)
        sid = re.search(r"S-1-5-[0-9-]+", result.stdout)
        if sid is None:
            raise PermissionError("Cannot identify the local owner")
        advapi = ctypes.WinDLL("advapi32", use_last_error=True)
        convert = advapi.ConvertStringSecurityDescriptorToSecurityDescriptorW
        convert.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
        convert.restype = ctypes.c_int
        set_security = advapi.SetFileSecurityW
        set_security.argtypes = [ctypes.c_wchar_p, ctypes.c_uint32, ctypes.c_void_p]
        set_security.restype = ctypes.c_int
        descriptor = ctypes.c_void_p()
        # Protected DACL with only the current account; child files inherit it.
        if not convert("D:P(A;OICI;FA;;;"+sid.group()+")", 1, ctypes.byref(descriptor), None):
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            if not set_security(str(path), 0x80000004, descriptor):
                raise ctypes.WinError(ctypes.get_last_error())
        finally:
            free = ctypes.WinDLL("kernel32", use_last_error=True).LocalFree
            free.argtypes = [ctypes.c_void_p]
            free.restype = ctypes.c_void_p
            free(descriptor)
    return path


@contextmanager
def local_lock(path: Path):
    path = Path(path)
    if path.is_symlink():
        raise ValueError("Lock must not be a symlink")
    stream = path.open("a+b")
    try:
        stream.seek(0, 2)
        if stream.tell() == 0:
            stream.write(b"0")
            stream.flush()
        stream.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        # Closing releases the kernel lock even after a killed process. Never
        # unlink the inode while another process might be waiting on it.
        stream.close()
