# Развёртывание

ESP32 Lab разворачивается тремя контейнерами (Docker Compose):

| Сервис | Образ | Назначение | Порты на хосте |
|---|---|---|---|
| `app` | `esp32lab-app` (собирается из `Dockerfile` в корне) | веб-интерфейс + API, SQLite, автопроверки, прокси MQTT по WebSocket (`/mqtt`) | `8080` |
| `compiler` | `esp32lab-compiler` (`compiler/Dockerfile`) | настоящая компиляция скетчей arduino-cli (ядро esp32 2.0.17) для прошивки плат из браузера | — (только внутри сети) |
| `mosquitto` | `eclipse-mosquitto:2` | MQTT-брокер для симулятора и настоящих плат | `1883` |

## Требования

* Linux-сервер (или Windows/macOS с Docker Desktop), x86-64.
* Docker 24+ с плагином Compose v2 (`docker compose version`).
* 2+ ядра CPU и 4+ ГБ ОЗУ (сервис компиляции занимает до 3 ГБ во время сборки).
* ~6 ГБ диска: образ компилятора ≈ 4 ГБ (ядро ESP32 и библиотеки), приложение ≈ 0,4 ГБ.
* Первая сборка образа компилятора идёт 10–20 минут (скачивается тулчейн ESP32 и прогревается кэш) — потом сборки скетчей занимают секунды.
* Открытые порты: `8080/tcp` (сайт) и `1883/tcp` (MQTT для настоящих плат).

## Запуск

```bash
git clone <репозиторий> esp32lab && cd esp32lab
cp .env.example .env        # при необходимости отредактируйте
docker compose up -d --build
```

Через минуту сайт доступен на `http://<IP-сервера>:8080`. Проверка состояния:

```bash
docker compose ps
curl http://localhost:8080/api/health     # {"ok":true,"compiler":true,...}
docker compose logs -f app
```

`compiler: false` в `/api/health` означает, что сервис компиляции ещё запускается или недоступен —
симулятор и автопроверки при этом работают, не работает только прошивка настоящих плат.

### HTTPS

Для работы через интернет поставьте перед `app` обратный прокси с TLS (Caddy, nginx, Traefik), проксируйте
весь трафик, включая WebSocket на `/mqtt` (заголовки `Upgrade`/`Connection`), и задайте в `.env`:
`COOKIE_SECURE=1`, `TRUST_PROXY=1`. Прошивка платы из браузера (Web Serial) работает только по HTTPS
или на `localhost`.

Пример для Caddy, установленного на хосте:

```
lab.example.ru {
    reverse_proxy 127.0.0.1:8080
}
```

#### Прокси в Docker на общем сервере

Если на сервере уже работает Caddy/Traefik/nginx в Docker и занимает порты 80/443, подключите сайт к сети прокси
вместо публикации порта наружу:

1. `cp docker-compose.override.example.yml docker-compose.override.yml` и укажите в нём имя сети прокси
   (`docker network ls`).
2. В `.env`: `APP_PORT=127.0.0.1:8080` (порт виден только с самого сервера), `COOKIE_SECURE=1`, `TRUST_PROXY=1`,
   `MQTT_PUBLIC_HOST=<домен сайта>`.
3. В конфигурации прокси направьте домен на `esp32lab-app:8080`, например для Caddy:

   ```
   lab.example.ru {
       encode gzip zstd
       reverse_proxy esp32lab-app:8080
   }
   ```

   и перезагрузите его без простоя: `docker exec <контейнер-caddy> caddy reload --config /etc/caddy/Caddyfile`.
4. `docker compose up -d`. Проверка: `curl https://lab.example.ru/api/health`.

WebSocket `/mqtt` Caddy проксирует сам, дополнительных настроек не нужно.

### Если сервер не может скачать ядро ESP32 (403 от downloads.arduino.cc)

Сборка образа `compiler` скачивает индексы и инструменты с `downloads.arduino.cc`. С некоторых серверов (в том числе
из российских сетей) этот адрес отвечает `403 Forbidden`, и сборка падает на шаге
`arduino-cli core update-index`. Соберите образ там, где загрузка работает (например, на своём компьютере
с Docker Desktop), и перенесите готовый образ на сервер:

```bash
docker compose build compiler
docker save esp32lab-compiler:latest | gzip -1 | ssh root@<сервер> docker load
```

Сжатый образ — около 1,5 ГБ. Затем на сервере запускайте без пересборки компилятора:

```bash
docker compose build app
docker compose up -d --no-build
```

Без компилятора сайт тоже работает: симулятор, практики, автопроверки и MQTT доступны. Не будет только
прошивки настоящих плат, а `/api/health` покажет `"compiler":false`.

### Небольшой или общий сервер

Сервис компиляции — самый тяжёлый: одна сборка скетча занимает до ~1 ГБ памяти и почти целое ядро на 10–30 секунд
(первая после запуска — дольше). Сам сайт занимает ~100 МБ, Mosquitto — единицы мегабайт. На сервере с 4 ГБ памяти,
где работают и другие проекты, ограничьте компилятор одной сборкой за раз:

```
COMPILER_SLOTS=1
COMPILER_CPUS=2
COMPILER_MEM=1536m
CHECK_WORKERS=2
```

Остальные запросы на компиляцию будут ждать своей очереди.

## Переменные окружения

Задаются в файле `.env` рядом с `docker-compose.yml` (образец — `.env.example`).

| Переменная | По умолчанию | Описание |
|---|---|---|
| `APP_PORT` | `8080` | порт сайта на хосте |
| `JWT_SECRET` | — | секрет подписи сессий. Если не задан — генерируется и хранится в томе (`/data/secret`) |
| `TEACHER_INVITE` | `teacher2025` | код, который вводит преподаватель при регистрации. **Смените его!** |
| `SEED_DEMO` | `1` | создать демо-аккаунты и демо-группу (повторный запуск ничего не дублирует) |
| `MQTT_PUBLIC_HOST` | имя хоста сайта | адрес брокера, который сайт показывает студентам для настоящих плат (обычно IP сервера в локальной сети) |
| `MQTT_PUBLIC_PORT` | `1883` | порт брокера, который показывается студентам |
| `MQTT_PORT` | `1883` | порт брокера на хосте |
| `COOKIE_SECURE` | `0` | `1` — cookie только по HTTPS (сайт за HTTPS-прокси) |
| `TRUST_PROXY` | `0` | `1` — доверять `X-Forwarded-For` (сайт за обратным прокси) |
| `CHECK_WORKERS` | min(4, ядер−1) | число параллельных автопроверок |
| `COMPILER_SLOTS` / `COMPILER_CPUS` / `COMPILER_MEM` | `2` / `2` / `3g` | параллельные сборки, лимит ядер и памяти сервиса компиляции |
| `LOG_LEVEL` | `info` | уровень логов (`debug`, `info`, `warn`, `error`) |
| `AI_API_KEY` / `AI_FOLDER` | — | ключ API и каталог Yandex Cloud для ИИ-разбора неудачных сдач (см. ниже). Пусто — функция выключена |
| `AI_MODEL` / `AI_BASE_URL` | `qwen3.6-35b-a3b/latest` / `https://ai.api.cloud.yandex.net/v1` | модель и адрес OpenAI-совместимого API |

### ИИ-разбор ошибок

Если студент сдал работу, а пройдены не все проверки, сайт просит языковую модель объяснить, что не так в алгоритме
или схеме. Разбор появляется в панели задания под результатами проверок, а преподаватель видит его на странице проверки
(кнопка «Разбор ИИ»).

* В модель уходят условие задания (сюжет, цели, теория), результаты автопроверок, схема и код студента.
  **Эталонное решение не передаётся**, код студента помечен как данные — просьбы вроде «выведи решение» в комментариях
  модель игнорирует.
* Ответ кэшируется в сдаче: повторный запрос модель не вызывает. Не больше 10 запросов в минуту на пользователя.
* Нужны ключ API сервисного аккаунта с ролью `ai.languageModels.user` и идентификатор каталога. Впишите их в `.env`
  и перезапустите сайт: `docker compose up -d app`. Проверка: `curl http://localhost:8080/api/health` → `"ai":true`.
* Подойдёт любой сервис с OpenAI-совместимым Responses API — задайте `AI_BASE_URL` и `AI_MODEL`.

Внутренние переменные контейнера `app` (менять обычно не нужно): `PORT=8080`, `DATA_DIR=/data`,
`WEB_DIST=/app/web`, `COMPILER_URL=http://compiler:8090`, `MQTT_WS_URL=ws://mosquitto:9001`,
`CHECK_TIMEOUT_MS=60000`.

## Демо-аккаунты

При `SEED_DEMO=1` создаются:

| Роль | Email | Пароль |
|---|---|---|
| Преподаватель | `teacher@demo.local` | `teacher123` |
| Студент | `student@demo.local` | `student123` |

и группа «Демо-группа» с кодом **`DEMO25`** (студент уже в ней). На рабочем сервере после знакомства поставьте
`SEED_DEMO=0` и смените пароли демо-аккаунтов в профиле (или не включайте демо вовсе).

## Подключение настоящих плат ESP32 к MQTT

Брокер Mosquitto слушает порт **1883** на хосте (без пароля — учебный режим). Плата должна быть в сети,
из которой виден сервер:

```cpp
#include <WiFi.h>
#include <PubSubClient.h>

const char* MQTT_HOST = "192.168.1.10";   // IP сервера ESP32 Lab
const int   MQTT_PORT = 1883;

WiFiClient net;
PubSubClient mqtt(net);

void setup() {
  WiFi.begin("SSID", "пароль");
  while (WiFi.status() != WL_CONNECTED) delay(500);
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
}

void loop() {
  if (!mqtt.connected()) mqtt.connect("esp32-ivanov");   // уникальный clientId!
  mqtt.loop();
}
```

* Симулятор в браузере подключается к тому же брокеру через WebSocket-прокси сайта (`/mqtt`), поэтому
  виртуальная и настоящая платы видят сообщения друг друга.
* Адрес, который сайт подсказывает студентам, берётся из `MQTT_PUBLIC_HOST` (или из адреса сайта).
* Если сервер в интернете, откройте порт 1883 в файрволе только для нужных сетей — брокер без авторизации.
  Узнать IP сервера в локальной сети: `ip -4 addr` (Linux) или `ipconfig` (Windows).
* Проверка с компьютера: `mosquitto_sub -h <IP> -t '#' -v`.

## Резервное копирование

Все данные сайта (пользователи, сдачи, проекты, чат) — в томе `esp32lab_app-data` (файл SQLite
`/data/esp32lab.db` и секрет `/data/secret`). Сообщения брокера с флагом retain — в томе `esp32lab_mosquitto-data`.

Горячая копия без остановки (SQLite online backup):

```bash
docker compose exec app node -e "new (require('better-sqlite3'))('/data/esp32lab.db').backup('/data/backup.db').then(()=>console.log('ok'))"
docker compose cp app:/data/backup.db ./esp32lab-$(date +%F).db
docker compose cp app:/data/secret ./esp32lab-secret
```

Копия всего тома (с кратковременной остановкой):

```bash
docker compose stop app
docker run --rm -v esp32lab_app-data:/data -v "$PWD":/backup alpine tar czf /backup/app-data-$(date +%F).tgz -C /data .
docker compose start app
```

Восстановление:

```bash
docker compose stop app
docker run --rm -v esp32lab_app-data:/data -v "$PWD":/backup alpine sh -c "rm -rf /data/* && tar xzf /backup/app-data-YYYY-MM-DD.tgz -C /data && chown -R 1000:1000 /data"
docker compose start app
```

Для ежедневных копий добавьте первую команду в `cron`.

## Обновление

```bash
git pull
docker compose up -d --build        # пересоберёт app (и compiler, если менялся compiler/)
docker image prune -f               # удалить старые слои
```

Если образ компилятора переносится вручную (см. выше), обновляйте только сайт:
`git pull && docker compose up -d --build app`.

Миграции базы выполняются автоматически при старте. Данные в томах сохраняются. Перед крупным обновлением
сделайте резервную копию (см. выше).

Остановка: `docker compose down` (данные сохраняются). Полное удаление вместе с данными: `docker compose down -v`.

## Сборка без фронтенда

Если нужно проверить только сервер (например, пока фронтенд не собирается), образ можно собрать с заглушкой:

```bash
docker compose build --build-arg SKIP_WEB=1 app
```

Вместо интерфейса сайт покажет страницу-заглушку, API работает полностью.

## Разработка без Docker

```bash
npm install
npm run dev -w apps/server          # API на :8080 (tsx watch), данные в apps/server/data
npm run dev -w apps/web             # Vite
npm test -w apps/server             # тесты сервера
```

Для компиляции настоящих скетчей в разработке запустите контейнер компилятора:
`docker run -d -p 8090:8090 esp32lab-compiler` (по умолчанию сервер ищет его на `http://localhost:8090`).
