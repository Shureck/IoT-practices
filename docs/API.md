# API сервера ESP32 Lab

Все ответы — JSON. Авторизация — httpOnly-cookie `sid` (JWT, 30 дней). Ошибки: `{ "error": "текст на русском" }`
с кодом 400/401/403/404/409/429/500. Все тела запросов валидируются (zod).

Типы `CircuitDoc`, `CheckResult` — из `@esp32lab/sim`; `Practice` — из `@esp32lab/content`.

## Служебное

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/health` | `{ ok: true, compiler: boolean, version }` — `compiler` = доступен ли сервис компиляции |
| GET | `/api/config` | `{ mqttWsUrl: "/mqtt", mqttTcpHost, mqttTcpPort, demo: boolean }` |

## Аутентификация

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/auth/register` | `{ name, email, password, role: 'student'\|'teacher', groupCode?, teacherCode? }` | `{ user }` + cookie |
| POST | `/api/auth/login` | `{ email, password }` | `{ user }` + cookie |
| POST | `/api/auth/logout` | — | `{ ok: true }` |
| GET | `/api/me` | — | `{ user }` или 401 |
| PATCH | `/api/me` | `{ name?, password?, oldPassword?, groupCode? }` | `{ user }` |

`user = { id, name, email, role: 'student'|'teacher', groupId: number|null, groupName: string|null, xp, createdAt }`

* Пароль ≥ 6 символов, email приводится к нижнему регистру.
* Учитель регистрируется только с `teacherCode`, равным переменной окружения `TEACHER_INVITE`.
* `groupCode` — код группы (6 символов, без учёта регистра); неверный код → 400.

## Практики (публичные данные, без решений)

| Метод | Путь | Ответ |
|---|---|---|
| GET | `/api/practices` | `{ modules: Module[], practices: PublicPractice[], achievements: Achievement[], story }` |
| GET | `/api/practices/:id` | `{ practice: PublicPractice }` |

`PublicPractice` = `publicPractice(p)` из `@esp32lab/content` (без `solution`, проверки только `{id,title}`, у квиза нет `correct/explain`).
Эндпоинты публичные (без авторизации).

## Проверка и сдача

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| POST | `/api/check` | `{ practiceId, code, circuit }` | `{ compile: { ok, diagnostics }, results: CheckResult[] }` — без записи в БД. Нужна авторизация. Лимит 20/мин |
| POST | `/api/submissions` | `{ practiceId, code, circuit, hintsUsed: number, quizAnswers?: number[][] }` | `{ submission, xpGained, newAchievements: string[] }` |
| GET | `/api/submissions?practiceId=` | — | `{ submissions: SubmissionSummary[] }` (свои) |
| GET | `/api/submissions/:id` | — | `{ submission }` (своя или учитель группы) |

* Для `kind === 'quiz'`: сервер считает долю верных ответов; `passed` если ≥ `passScore ?? 0.7`; в `results` — по одному элементу на вопрос
  `{ id, title: текст вопроса, ok, message: explain }`.
* Для остальных — `Harness.run(code, circuit, practice.checks, { net: practice.net })`. Таймаут 60 с.
* `submission = { id, practiceId, status: 'passed'|'failed', score (0..1 — доля пройденных проверок), results, hintsUsed, grade: number|null, comment: string|null, createdAt, reviewedAt }`
* XP начисляется при **первой** успешной сдаче: `xp = practice.xp`, −10 % за каждую подсказку (минимум 50 %).
* Достижения выдаются сервером: `first-check`, `module-N` (все практики модуля N сданы), `all-cases`, `no-hints` (кейс сдан с hintsUsed = 0), `night-owl` (сдача 00:00–05:00 по Москве).

## Черновики и прогресс

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/drafts/:practiceId` | — | `{ code, circuit, updatedAt }` или 404 |
| PUT | `/api/drafts/:practiceId` | `{ code, circuit }` | `{ ok: true }` (лимит 256 КБ) |
| GET | `/api/progress` | — | `{ xp, achievements: string[], items: ProgressItem[], assignments: Assignment[] }` |
| POST | `/api/achievements/:id` | — | `{ ok, new: boolean }` — только из списка клиентских: `first-blink`, `burnt-led`, `real-board` |

`ProgressItem = { practiceId, status: 'draft'|'failed'|'passed', bestScore, attempts, xp, grade, comment, lastSubmissionId, submittedAt }`
`Assignment = { id, groupId, practiceId, dueAt }`

## Песочница (проекты)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/projects` | — | `{ projects: [{ id, title, updatedAt, shareToken }] }` |
| POST | `/api/projects` | `{ title, code, circuit }` | `{ project }` |
| GET | `/api/projects/:id` | — | `{ project: { id, title, code, circuit, shareToken, updatedAt } }` |
| PUT | `/api/projects/:id` | `{ title?, code?, circuit? }` | `{ project }` |
| DELETE | `/api/projects/:id` | — | `{ ok: true }` |
| POST | `/api/projects/:id/share` | — | `{ shareToken }` |
| GET | `/api/shared/:token` | — | `{ project: { title, code, circuit, author } }` (без авторизации) |

## Преподаватель (role = teacher)

| Метод | Путь | Тело | Ответ |
|---|---|---|---|
| GET | `/api/teacher/groups` | — | `{ groups: [{ id, name, joinCode, studentCount }] }` |
| POST | `/api/teacher/groups` | `{ name }` | `{ group }` |
| DELETE | `/api/teacher/groups/:id` | — | `{ ok }` |
| GET | `/api/teacher/groups/:id/progress` | — | `{ group, students: [{ id, name, email, xp }], cells: { [studentId]: { [practiceId]: { status, score, grade, submissionId, submittedAt, attempts } } } }` |
| GET | `/api/teacher/submissions?groupId=&practiceId=&studentId=&unreviewed=1` | — | `{ submissions: [... + studentName] }` (последние 200) |
| GET | `/api/teacher/submissions/:id` | — | `{ submission: { ...+ code, circuit, studentName, studentId } }` |
| POST | `/api/teacher/submissions/:id/review` | `{ grade: 2\|3\|4\|5\|null, comment: string }` | `{ ok }` |
| GET | `/api/teacher/practices/:id/solution` | — | `{ code, circuit }` |
| GET | `/api/teacher/assignments?groupId=` | — | `{ assignments }` |
| POST | `/api/teacher/assignments` | `{ groupId, practiceId, dueAt (ISO) }` | `{ assignment }` |
| DELETE | `/api/teacher/assignments/:id` | — | `{ ok }` |

Учитель видит только свои группы.

## Сеть для симулятора

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/net/http` | `{ method, url, headers, body? }` → `{ status, headers, body }`. Виртуальные хосты (`virtualHttp` из sim) обслуживаются локально с общим чатом из БД; остальные — реальный запрос: только http/https, порты 80/443/8080, запрет приватных/loopback/link-local адресов (проверка после DNS), таймаут 8 с, ответ ≤ 512 КБ, лимит 60 запросов/мин на пользователя. Нужна авторизация. Ошибка соединения → `{ status: -1 }` |
| GET | `/api/chat/:room?after=0` | `{ messages: ChatMessage[] }` — для панели «Чат» |
| POST | `/api/chat/:room` | `{ content }` → сообщение от имени пользователя |
| WS | `/mqtt` | WebSocket-прокси к Mosquitto (`MQTT_WS_URL`, по умолчанию `ws://mosquitto:9001`) |

## Компиляция

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/compile` | `{ code }` → ответ сервиса компиляции `{ ok, log, ms, binaries?: [{ name, offset, data(base64) }] }`. Авторизация, 1 одновременная сборка на пользователя, 10/мин. Если сервис недоступен → 503 `{ error: 'Сервис компиляции недоступен' }` |

## Переменные окружения сервера

`PORT=8080`, `DATA_DIR=./data` (SQLite `esp32lab.db`), `JWT_SECRET`, `TEACHER_INVITE=teacher2025`,
`COMPILER_URL=http://compiler:8090`, `MQTT_WS_URL=ws://mosquitto:9001`, `MQTT_PUBLIC_HOST`, `MQTT_PUBLIC_PORT=1883`,
`WEB_DIST=../web/dist`, `SEED_DEMO=1` (создать demo-аккаунты `teacher@demo.local / teacher123`,
`student@demo.local / student123`, группу «Демо-группа» с кодом `DEMO25`).
