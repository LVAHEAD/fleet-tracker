# F.ETA.T — Fleet ETA Tracker

Веб-инструмент диспетчеров. Где машины (Mapon), сколько км и когда приедут (Google Routes API),
когда реально приедут с учётом тахографа (EU 561/2006), что мешает по пути (запреты, паромы).
Владелец — Владимир. Пользователи — он и диспетчеры. Интерфейс на русском.

Стек: Python 3 / Flask, gunicorn (`Procfile`: `gunicorn app:app`, 1 worker × 8 threads — общий кеш в памяти),
Cloud Run `fleet-eta-tracker`, europe-west1, проект `my-n8n-bot-496614`.
Вход — IAP по списку Google-аккаунтов. Общий Флот хранится в Firestore.
Фронтенд — ванильный JS без сборки (`static/`, `templates/index.html`).

## Правила работы (обязательно)

- **`git push` = деплой.** Cloud Build сразу выкатывает `main` на Cloud Run.
  Push только по явной команде **`//кодим`** или **`//деплой`** (одно и то же).
  До команды: готовим изменения локально, коммитим, докладываем и ждём.
- `//обс` — только обсуждение: без кода и деплоя.
- **Всё, о чём договорились в обсуждении, сразу идёт в НекстБилд** (`BACKLOG.md`, коммит без push) — не ждать отдельного `//запомни`.
  Что Владимир отложил («пусть висят») — в хотелки с найденными деталями, не в НекстБилд.
- Версии `vX.YY`: X — ключевое изменение, YY — обычные билды. Ветка **3.x** — модульная структура (рефакторинг завершён в v3.05).
- Каждый билд:
  - поднимает `APP_VERSION` в `fetat/__init__.py`;
  - добавляет запись сверху в `CHANGELOG.md` (тест проверяет, что верхняя запись = `APP_VERSION`);
  - коммитится как `vX.YY: кратко что сделано`.
- Мата и шуток в коде нет. Комментарии и тексты UI — на русском.
- Новые зависимости в `requirements.txt` — только по согласованию.

### Команды Владимира

- `//кодим` / `//деплой` — собрать, проверить, закоммитить и **запушить** (= деплой). «//кодим 3,20» — номер билда.
- `//обс` — только обсуждение (договорённости всё равно записываются в НекстБилд).
- `//нб` — показать НекстБилд и хотелки из `BACKLOG.md`.
- `//запомни …` — общая команда «запомнить»: сразу записать: план/хотелки → `BACKLOG.md`, правила работы и термины → сюда. Коммит без push (уйдёт со следующим `//кодим`).
- `//просто_спросить` — вопрос, не задача: ответить коротко, ничего не делать.
- «Блокнот ФЕТАТ — последние: N» — выгрузка из блокнота приложения: разобрать по пунктам, уточнить непонятное, предложить состав билда.

### Термины

- **Трип** — строка поездки во Флоте вместе с подстроками точек ②③…
- **Хозяин трипа** — диспетчер строки (`disp`), иначе создатель.
- **Справка** — вкладка [.] (в коде `notes`): история версий, состояние адресной базы и базы фрахтов, заметки, полезные ссылки.
  Не путать: **Блокнот** — записи-хотелки с категориями и статусами (панель справа и страница `/notebook`); **База** — Baza Parking, Riga.

### Начало нового чата

Прочитать `BACKLOG.md` и верх `CHANGELOG.md` (текущая версия = `APP_VERSION`). Память Claude по проекту не ведётся — всё живое здесь.

## Структура

Монолит разбит на модули (v3.00–v3.05, `REFACTOR.md`). Что где искать:

| Модуль | Что внутри |
|---|---|
| `app.py` | точка входа gunicorn: `app = create_app()` |
| `fetat/__init__.py` | `APP_VERSION`, `create_app()` — Flask с `root_path` = корень проекта, регистрация Blueprints |
| `fetat/config.py` | переменные окружения, папка `data/`, часовые пояса (Europe/Riga, Europe/Berlin; перевод часов — `utils/timefmt`) |
| `fetat/utils/` | `geo` (haversine, polyline, WKT, GPS), `timefmt`, `text` |
| `fetat/clients/mapon.py` | unit/list, группы, тахограф, daily_activities, объекты, стоянки; семафор на 4 запроса, повтор при «Request limit» |
| `fetat/clients/google_routes.py` | computeRoutes, кеш маршрутов, along-route, счётчик квоты |
| `fetat/clients/geocode.py` | Nominatim / Photon |
| `fetat/clients/sheets.py` | чтение листов «Fleet Tracker — данные» |
| `fetat/clients/firestore.py` | Firestore REST |
| `fetat/clients/nakordoni.py` | фид запретов движения: запросы, кеш, блокировки |
| `fetat/clients/monitoring.py` | счётчик запросов к Routes API (Cloud Monitoring), ряд по 5 мин для `/gusage` |
| `fetat/domain/tacho.py` | простой ETA, тахо-ETA, недельный отдых, лимиты 56/90 ч, `FRESH_SOLO_TACHO` (From → To) |
| `fetat/domain/routing_rules.py` | паромы, Инсбрук, обход Швейцарии, waypoints |
| `fetat/domain/bans.py` | сборка фида запретов, запреты по пути, ночь Австрии для MAN, бренд по VIN, страны по маршруту |
| `fetat/domain/regions.py` | коды регионов (ESxx, NO01…), ближайший код, страна |
| `fetat/domain/points.py` | разбор точки/таргета, ✓ пройдено, «на объекте» |
| `fetat/domain/trailers.py` | реф, сцепка тягач–прицеп |
| `fetat/domain/addresses.py` | адресная база, FIN/EE → База |
| `fetat/domain/freights.py` | база фрахтов, контрактники, похожие рейсы |
| `fetat/domain/dispatchers.py` | лист «Диспетчеры»: инициалы, цвета, кто назначает; список по умолчанию; `can_assign` |
| `fetat/services/fleet_calc.py` | строка Флота: `calc_row(payload) -> (ответ, код)` и блоки `_unit_status`, `_add_trailer_info`, `_apply_points_done`, `_add_tacho`, `_add_route_context`, `_add_code_badges`; следующие точки `calc_extra_stops` |
| `fetat/services/gusage.py` | лог `/gusage`: наш счёт (`routes_stats`) и счёт Google по суткам Google и часам Риги, текст для Claude |
| `fetat/services/route_calc.py` | From → To: `route_calc(payload) -> (ответ, код)`, мультимаршрут с паромами |
| `fetat/store/fleet_store.py` | общий Флот: Firestore / память, права на удаление, 🔒, корзина 7 дней, проверка полей; архив завершённых трипов `fleet_done` (навсегда) |
| `fetat/api/meta.py` | `/`, `/api/me`, `/api/changelog`, `/api/google-usage`, `/gusage`, `/api/google-usage/log`; `current_user_email` (IAP) |
| `fetat/api/mapon.py` | `/api/units`, `/api/truck-info`, `/api/nearest-units`, `/api/mapon-units`, `/api/mapon-objects`, `/api/mapon-check` |
| `fetat/api/calc.py` | `/api/calc`, `/api/route` → services |
| `fetat/api/reference.py` | `/api/region-codes`, `/api/locate`, `/api/addresses`, `/api/freights`, `/api/bans` |
| `fetat/api/fleet.py` | `/api/fleet*`: чтение, sync (смена `disp` — только назначающий), 🔒, корзина, восстановление, импорт; завершить / вернуть / список завершённых (`complete`, `reopen`, `done` — хозяин или назначающий); `/api/dispatchers` |
| `data/` | `region_codes.json`, `region_codes_geonames.json` |
| `tests/` | unittest + фикстуры; код через `A` из `tests/__init__.py` (ищет имя во всех модулях, подмена ставится везде) |

Новый эндпоинт — в подходящий Blueprint (`bp.route`), логика — в services/domain. Внутри обработчика `current_app`, не `app`.
Зависимости идут только вниз: `api → services → domain + clients → utils/config`.
`domain` не импортирует Flask и `requests`: в сеть — только через `fetat.clients`. Следит `tests/test_structure.py`.

## Предметные правила (не ломать)

- **Скорость для расчётов — 70 км/ч.** Время в From → To округляется вверх до 15 мин.
- **Тахограф:**
  - экипаж — до 18 ч вождения в сутки, отдых 9 ч;
  - одиночка — 9 ч вождения (10 ч, пока остались продления — так в коде; вопрос «не считать 10-й час» открыт), отдых 9 или 11 ч по оставшимся сокращениям, первый — по `daily_rest_min` из Mapon;
  - к суточному отдыху +1 ч запаса, к недельному +30 мин, перерыв 45 мин без запаса;
  - недельные 24/45 в тахо-ETA не учитываем (их решают диспетчеры);
  - лимит 56/90 ч — только для одиночки.
- **Маршруты:**
  - Италия ↔ Германия — через Австрию (Инсбрук);
  - Италия ↔ Бенелюкс — никогда через Швейцарию;
  - Норвегия/Швеция: из Италии — Росток–Гедсер + Хельсингёр–Хельсингборг; из ES/PT/Бенелюкс/FR — Путтгарден–Рёдбю + Хельсингёр–Хельсингборг; из Германии — по близости к Ростоку или Путтгардену.
- **Австрия, 22:00–05:00:** у всех MAN нет L-наклейки, у DAF/Volvo она есть. Это только предупреждение 🚫, ETA не сдвигаем.
- **ADR не возим.** ADR-запреты скрыты.
- **FIN/EE как страна = База** (Baza Parking, Riga). Конкретная точка в Эстонии — напрямую.
- Прицепы в Mapon к тягачам не привязаны. Сцепку подтверждает человек.
- Фрахты: «2650+400» — берём только 2650; «6729/5500» — берём первую цену.
  Цены контрактников (SeaBorn, Kesko, GreenFood, Bama) в рыночную оценку не берём.

## Переменные окружения

`MAPON_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_JS_KEY`, `HEAD_TRUCK_GROUP_ID` (62269),
`SHEET_ID`, `ADDRESS_SHEET`, `FREIGHT_SHEET`, `SETTINGS_SHEET`, `DISP_SHEET`,
`FLEET_STORE` (`memory` — для локального запуска без Firestore), `FLEET_ADMINS`, `GOOGLE_CLOUD_PROJECT`.
Заданы в сервисе Cloud Run. Автодеплой их не трогает.

## Проверка перед `//кодим`

- `python -m py_compile` по всем `.py`;
- `python -m unittest discover -s tests` — все зелёные;
- список маршрутов совпадает с эталоном;
- `tests/test_replay.py` совпадает с эталоном. Если поведение меняется намеренно (обычный билд с фичей) — пересобрать эталон: `python3 tests/replay_run.py "$PWD" "$PWD/tests/fixtures/replay_golden.json"` и проверить diff глазами;
- в отчёте Владимиру — что проверить руками после деплоя (чек-лист в `REFACTOR.md`).
