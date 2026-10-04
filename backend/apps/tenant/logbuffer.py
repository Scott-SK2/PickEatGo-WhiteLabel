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
_records = deque(maxlen=MAX_RECORDS)
_lock = threading.Lock()


class MemoryLogHandler(logging.Handler):
    def emit(self, record):
        try:
            entry = {
                "time": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="seconds"),
                "level": record.levelname,
                "logger": record.name,
                "message": self.format(record)[:500],
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
