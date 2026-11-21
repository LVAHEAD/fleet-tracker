"""История отдыхов водителя (v3.355): коллекция driver_rests, документ на водителя (driver_id).
Mapon отдаёт окно ~28 дн.; завершённые отдыхи дописываем сюда и храним 60 дн., чтобы Truck Info видел дальше окна.
Документ: {rests: [{start, end, src: [..]}], since: ts начала покрытия, saved_at}. При FLEET_STORE=memory — в памяти."""
import os

from fetat.clients.firestore import fs_get, fs_set

RESTS_COLL = "driver_rests"


class RestsFS:
    def get(self, driver_id):
        return fs_get(RESTS_COLL, str(driver_id))

    def put(self, driver_id, rec):
        fs_set(RESTS_COLL, str(driver_id), rec)


class RestsMem:
    def __init__(self):
        self.docs = {}

    def get(self, driver_id):
        d = self.docs.get(str(driver_id))
        return dict(d) if d else None

    def put(self, driver_id, rec):
        self.docs[str(driver_id)] = dict(rec)


RESTS_STORE = RestsMem() if os.environ.get("FLEET_STORE") == "memory" else RestsFS()
