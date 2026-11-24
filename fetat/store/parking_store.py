"""Заметки о паркингах (v3.381): коллекция parking_notes, документ на место (ячейка сетки ~300 м).
Документ: {lat, lng, ok: yes|no|"", pay: paid|free|"", tags: [...], text, by, at}. FLEET_STORE=memory — в памяти (тесты)."""
import os

from fetat.clients.firestore import fs_query, fs_set

PARKING_COLL = "parking_notes"


class ParkingFS:
    def put(self, nid, rec):
        fs_set(PARKING_COLL, str(nid), rec)

    def all(self):
        return {str(d.get("_id") or d.get("id")): d for d in fs_query(PARKING_COLL)}


class ParkingMem:
    def __init__(self):
        self.docs = {}

    def put(self, nid, rec):
        self.docs[str(nid)] = dict(rec)

    def all(self):
        return {k: dict(v) for k, v in self.docs.items()}


PARKING = ParkingMem() if os.environ.get("FLEET_STORE") == "memory" else ParkingFS()
