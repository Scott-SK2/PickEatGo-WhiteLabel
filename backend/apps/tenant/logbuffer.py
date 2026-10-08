"""
tenant/logbuffer.py — Journal technique récent, conservé en mémoire (fiche d'instance de la console éditeur).

Un gestionnaire `logging` garde les N derniers avertissements et erreurs du processus ;
la console les affiche sans accès au serveur. Rien n'est persisté.
"""
import logging
import threading
from collections import deque
from datetime import datetime, timezone

MAX_RECORDS = 100
MAX_MESSAGE_CHARS = 2000
_records = deque(maxlen=MAX_RECORDS)
_lock = threading.Lock()


class MemoryLogHandler(logging.Handler):
    def emit(self, record):
        try:
            text = self.format(record)          # message + traceback éventuel
            if len(text) > MAX_MESSAGE_CHARS:   # on garde le début et surtout la fin (la cause de l'erreur)
                text = text[:400] + "\n…\n" + text[-(MAX_MESSAGE_CHARS - 400):]
            entry = {
                "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="seconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": text,
            }
        except Exception:
            return
        with _lock:
            _records.append(entry)


def recent(limit=50):
    with _lock:
        items = list(_records)
    return list(reversed(items))[:limit]


def install(level=logging.WARNING):
    """Branche le gestionnaire sur le logger racine (idempotent)."""
    root = logging.getLogger()
    if any(isinstance(h, MemoryLogHandler) for h in root.handlers):
        return
    handler = MemoryLogHandler(level=level)
    handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(handler)
