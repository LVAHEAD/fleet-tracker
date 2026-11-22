"""История стоянок трака (v3.368): коллекция unit_stops, документ на юнит (unit_id).
Mapon отдаёт route/list за ~31 день; завершённые стоянки (от 1 ч) дописываем сюда и храним 400 дн. — статистика
«где чаще паркуются» (Локатор: зона / город). Документ: {stops: [{s, e, lat, lng, a, c}], saved_at}.
s, e — начало / конец (ts), a — адрес Mapon, c — код ближайшей зоны (ES46…). FLEET_STORE=memory — в памяти (тесты)."""
import os

from fetat.clients.firestore import fs_get, fs_query, fs_set

STOPS_COLL = "unit_stops"


class StopsFS:
    def get(self, unit_id):
        return fs_get(STOPS_COLL, str(unit_id))

    def put(self, unit_id, rec):
        fs_set(STOPS_COLL, str(unit_id), rec)

    def all(self):
        return {str(d.get("_id") or d.get("id")): d for d in fs_query(STOPS_COLL)}


class StopsMem:
    def __init__(self):
        self.docs = {}

    def get(self, unit_id):
        d = self.docs.get(str(unit_id))
        return dict(d) if d else None

    def put(self, unit_id, rec):
        self.docs[str(unit_id)] = dict(rec)

    def all(self):
        return {k: dict(v) for k, v in self.docs.items()}


STOPS_STORE = StopsMem() if os.environ.get("FLEET_STORE") == "memory" else StopsFS()
