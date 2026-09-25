# Деплой на Cloud Run

## Автодеплой (текущий способ)

Подключён Continuous Deployment через Cloud Build к репозиторию
`LVAHEAD/fleet-tracker` (ветка `main`). Весь процесс:

```bash
git add .
git commit -m "описание изменений"
git push
```

Cloud Build сам соберёт и выкатит новую версию на тот же URL, обычно
за 1-2 минуты. Прогресс можно смотреть в Cloud Run → fleet-eta-tracker →
вкладка Source.

## Ручной деплой (запасной вариант, без git)

```bash
gcloud run deploy fleet-eta-tracker \
  --source . \
  --region europe-west1 \
  --allow-unauthenticated \
  --set-env-vars MAPON_API_KEY=ваш_mapon_ключ,GOOGLE_API_KEY=ваш_google_ключ,HEAD_TRUCK_GROUP_ID=62269
```

## Переменные окружения

Заданы один раз в самом сервисе Cloud Run и сохраняются между
деплоями (автодеплой их не трогает):
- `MAPON_API_KEY`
- `GOOGLE_API_KEY` — используется и для Routes API (сервер), и для
  Maps JavaScript API (браузер)
- `HEAD_TRUCK_GROUP_ID` (по умолчанию 62269)

## Ограничения текущей версии (v1.12)
- Коды регионов (NO01, SE25 и т.п.) работают — справочник зашит в код
  (1096 записей из GPS_Codes.xlsx)
- Карта и маршрут (через Routes API) работают
- Состояние таблицы — localStorage браузера, не общее между устройствами
- Delivery vs ETA — пока просто два независимых поля, без сравнения
  "успевает/не успевает"

## Отложено (пробовали, откатили)
Многопользовательский режим с входом через Google и хранением строк в
Firestore — код был написан (v2.01), но решили пока не вводить.
Если понадобится вернуться — потребуется заново: создать базу Firestore,
дать сервису права roles/datastore.user, настроить OAuth consent screen
и создать OAuth Client ID.

## Коды регионов из GeoNames (v1.27)

Для стран, которых нет в GPS_Codes.xlsx, коды 2-значных зон строятся из
открытого справочника GeoNames (CC BY 4.0). Один раз (и при желании обновить):

    cd ~/fleet-tracker
    python3 tools/build_region_codes.py        # создаёт region_codes_geonames.json
    git add region_codes_geonames.json && git commit -m "GeoNames codes" && git push

Коды из GPS_Codes.xlsx главнее — совпадающие коды из GeoNames не используются.
