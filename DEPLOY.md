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
gcloud run deploy fleet-eta-tracker --source . --region europe-west1
```

Флаги `--allow-unauthenticated` и `--set-env-vars` **не добавлять**: вход закрыт IAP (см. ниже), а переменные
окружения и ключи уже заданы в сервисе и сохраняются между деплоями. С v3.67 приложение на Cloud Run
не отвечает (403) на запросы без заголовка IAP.

## Переменные окружения

Заданы один раз в самом сервисе Cloud Run (полный список — `ARCH.md`). Ключи в командах и в репозитории не хранятся.

## Коды регионов из GeoNames (v1.27)

Для стран, которых нет в GPS_Codes.xlsx, коды 2-значных зон строятся из
открытого справочника GeoNames (CC BY 4.0). Один раз (и при желании обновить):

    cd ~/fleet-tracker
    python3 tools/build_region_codes.py        # создаёт data/region_codes_geonames.json
    git add data/region_codes_geonames.json && git commit -m "GeoNames codes" && git push

Коды из GPS_Codes.xlsx главнее — совпадающие коды из GeoNames не используются.

## Доступ (IAP, вход через Google) — с v1.85

Пускает только тех, кто в списке IAP. Команды — в Cloud Shell
(проект my-n8n-bot-496614). Доступ начинает работать через ~5–10 минут.

Добавить пользователя:

    gcloud iap web add-iam-policy-binding --member=user:EMAIL@gmail.com \
      --role=roles/iap.httpsResourceAccessor \
      --region=europe-west1 --resource-type=cloud-run --service=fleet-eta-tracker

Убрать пользователя — то же самое, но `remove-iam-policy-binding`.

Кто сейчас в списке:

    gcloud iap web get-iam-policy --region=europe-west1 \
      --resource-type=cloud-run --service=fleet-eta-tracker

Добавлять в "Test users" (Google Auth Platform → Audience) не нужно.
Выключить вход совсем (откат): `gcloud run services update fleet-eta-tracker --region=europe-west1 --no-iap`
