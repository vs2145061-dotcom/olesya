# 🚀 Olesya Messenger — Запуск с Firebase (бесплатные SMS)

## Что получаете
- **10 000 SMS в месяц бесплатно** через Google Firebase
- Настоящее подтверждение номера телефона (как в Telegram)
- Сессионные токены 30 дней
- Без карты на старте

---

## ШАГ 1 — Создать Firebase проект (5 минут)

1. Откройте **https://console.firebase.google.com**
2. Войдите через Google аккаунт
3. Нажмите **«Создать проект»**
   - Имя: `olesya-messenger` (любое)
   - Google Analytics: можно отключить → **Создать проект**
4. Подождите ~30 секунд — проект создан

---

## ШАГ 2 — Включить Phone Authentication

1. В левом меню: **Build → Authentication**
2. Нажмите **«Начать работу»**
3. Вкладка **«Sign-in method»**
4. Нажмите **«Телефон»** → переключатель **«Включено»** → **«Сохранить»**

---

## ШАГ 3 — Добавить ваш домен в авторизованные

1. В Authentication → вкладка **«Settings»** (Параметры)
2. Раздел **«Авторизованные домены»**
3. Нажмите **«Добавить домен»**
4. Добавьте ваш домен: `ВАШ_ЛОГИН.github.io` (или ваш хостинг)
5. Также добавьте `localhost` (уже должен быть)

> ⚠️ Без этого шага Firebase отклонит reCAPTCHA и SMS не придёт!

---

## ШАГ 4 — Получить конфиг приложения

1. В левом меню: шестерёнка ⚙️ → **«Настройки проекта»**
2. Вкладка **«Общие»** → прокрутите вниз до **«Ваши приложения»**
3. Нажмите иконку **`</>`** (Веб)
4. Псевдоним: `olesya-web` → **«Зарегистрировать приложение»**
5. Скопируйте объект `firebaseConfig` — он выглядит так:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  authDomain: "olesya-messenger-12345.firebaseapp.com",
  projectId: "olesya-messenger-12345",
  storageBucket: "olesya-messenger-12345.firebasestorage.app",
  messagingSenderId: "123456789012",
  appId: "1:123456789012:web:abcdef1234567890abcdef"
};
```

Также запишите отдельно:
- **Идентификатор проекта** (projectId): `olesya-messenger-12345`
- **Web API Key** (apiKey): `AIzaSyXXX...`

---

## ШАГ 5 — Вставить конфиг в index.html

Откройте файл `olesya-messenger.html` в любом текстовом редакторе
(Notepad++, VS Code, TextEdit, nano — любом).

Найдите строки (в начале файла, около строки 635):

```javascript
const FIREBASE_CONFIG = {
  apiKey:            '',   // AIzaSy...
  authDomain:        '',   // ВАШ_ПРОЕКТ.firebaseapp.com
  projectId:         '',   // ВАШ_ПРОЕКТ
  storageBucket:     '',   // ВАШ_ПРОЕКТ.firebasestorage.app
  messagingSenderId: '',   // 12345...
  appId:             ''    // 1:12345:web:...
};
```

Замените пустые строки `''` на ваши значения из Firebase:

```javascript
const FIREBASE_CONFIG = {
  apiKey:            'AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  authDomain:        'olesya-messenger-12345.firebaseapp.com',
  projectId:         'olesya-messenger-12345',
  storageBucket:     'olesya-messenger-12345.firebasestorage.app',
  messagingSenderId: '123456789012',
  appId:             '1:123456789012:web:abcdef1234567890abcdef'
};
```

Сохраните файл.

---

## ШАГ 6 — Развернуть Cloudflare Worker

Этот шаг нужен для синхронизации между устройствами. Если хотите только локальную работу с Firebase SMS — пропустите шаги 6–8 (Firebase работает и без Worker).

### Установить Wrangler (один раз)
```bash
npm install -g wrangler
```

### Войти в Cloudflare
```bash
wrangler login
```

### Обновить схему базы данных
```bash
cd server-cloudflare
wrangler d1 execute olesya-messenger-db --file=schema.sql
```

### Добавить секреты

```bash
# Обязательные:
wrangler secret put SESSION_SECRET
# → введите любую длинную строку (64+ символов)
# → можно сгенерировать: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"

wrangler secret put FIREBASE_PROJECT_ID
# → введите: olesya-messenger-12345  (ваш projectId)

wrangler secret put FIREBASE_WEB_API_KEY
# → введите: AIzaSyXXX...  (ваш apiKey)
```

### Задеплоить
```bash
wrangler deploy
```

Скопируйте URL воркера: `https://olesya-api.ВАШ.workers.dev`

---

## ШАГ 7 — Зашить Worker URL в приложение (опционально)

Найдите в `index.html`:
```javascript
const CLOUD_DEFAULT={ provider:'', workerUrl:'', supabaseUrl:'', supabaseKey:'' };
```

Замените на:
```javascript
const CLOUD_DEFAULT={ provider:'worker', workerUrl:'https://olesya-api.ВАШ.workers.dev', supabaseUrl:'', supabaseKey:'' };
```

---

## ШАГ 8 — Залить на хостинг

### GitHub Pages (рекомендуется)
1. Откройте ваш репозиторий на github.com
2. **Add file → Upload files**
3. Перетащите обновлённый `olesya-messenger.html`
4. Commit changes

Приложение обновится через 1–2 минуты по тому же URL.

---

## ШАГ 9 — Проверить что всё работает

1. Откройте приложение на вашем GitHub Pages URL
2. Введите **реальный номер** вашего телефона (с +7 или +49 и т.д.)
3. Нажмите **«Получить код»**
4. Через 5–30 секунд придёт SMS от Firebase / Google
5. Введите 6-значный код
6. Заполните имя → готово!

> В Настройках (⚙️) вы увидите раздел **«🔥 Firebase»** с зелёной галочкой ✅
> и раздел **«Сервер и синхронизация»** с вашим Worker URL.

---

## Проверка из консоли браузера

Нажмите F12 → Console. При успешной отправке кода увидите:

```
Firebase Phone Auth: verification code sent to +79001234567
```

При ошибке домена:
```
Firebase: Error (auth/unauthorized-domain)
```
→ вернитесь к Шагу 3 и добавьте ваш домен.

---

## Лимиты Firebase (бесплатный план Spark)

| Что | Лимит |
|---|---|
| SMS верификации в месяц | **10 000 бесплатно** |
| Пользователей (MAU) | **50 000 бесплатно** |
| Стоимость после лимита | $0.01–0.06/SMS (зависит от страны) |
| Требование карты | Нет на бесплатном плане |

10 000 SMS/месяц = примерно **333 новых пользователя в день** — более чем достаточно для старта.

---

## Частые проблемы

**«auth/unauthorized-domain»** — не добавили домен в Шаге 3. Добавьте и попробуйте снова.

**«auth/too-many-requests»** — Firebase временно блокирует номер после многих попыток. Подождите 1 час.

**«Firebase SDK не загружен»** — приложение открыто с `file://`. Нужен HTTPS (GitHub Pages, localhost).

**SMS не приходит** — проверьте правильность номера с кодом страны (+7, +49 и т.д.). Некоторые операторы задерживают до 60 секунд.

**Кнопка «Повторить» неактивна 60 секунд** — это намеренно, чтобы не перегружать Firebase.

---

## Структура авторизации (что происходит под капотом)

```
Пользователь вводит номер
         ↓
  Firebase SDK (браузер)
  - создаёт invisible reCAPTCHA
  - шлёт запрос на Firebase серверы
         ↓
  Firebase серверы
  - проверяют reCAPTCHA
  - отправляют SMS через Google Carrier Billing
         ↓
  Пользователь вводит 6-значный код
         ↓
  Firebase SDK проверяет код
  - выдаёт Firebase ID Token (JWT, 1 час)
         ↓
  Приложение шлёт ID Token на ваш Worker
  POST /auth/firebase
         ↓
  Cloudflare Worker
  - проверяет токен через Firebase REST API
  - создаёт/находит пользователя в D1
  - выдаёт ваш session_token (30 дней)
         ↓
  Пользователь авторизован ✅
```
