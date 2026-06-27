# Деплой backend (Cloudflare) — с R2 «из коробки»

R2-хранилище для медиа уже прописано в `wrangler.toml` (`[[r2_buckets]] binding = "MEDIA"`).
Без него крупные фото/видео/документы могут не дойти до собеседника из-за лимитов БД,
поэтому **создайте R2-бакет сразу**. Всё займёт ~3 минуты.

## Шаги (один раз)

```bash
# 0) установить wrangler и войти
npm i -g wrangler
wrangler login

# 1) база D1 (если ещё не создана) и схема
wrangler d1 execute olesya-messenger-db --file=schema.sql --remote

# 2) ★ R2-бакет для медиа (ОБЯЗАТЕЛЬНО — иначе крупное медиа не доставляется)
wrangler r2 bucket create olesya-messenger-media

# 3) секреты
wrangler secret put SESSION_SECRET        # случайная строка 64+ символов
wrangler secret put FIREBASE_PROJECT_ID    # messenger-olesya123
wrangler secret put FIREBASE_WEB_API_KEY   # Web API Key из Firebase Console
# по желанию:
wrangler secret put ANTHROPIC_API_KEY      # прокси перевода /translate
wrangler secret put SMSC_LOGIN             # SMS для +7 (smsc.ru)
wrangler secret put SMSC_PASSWORD

# 4) деплой
wrangler deploy
```

## Проверка

Откройте `https://<ваш-воркер>.workers.dev/health` — в ответе должно быть:

```json
{ "ok": true, "firebase": true, "media": true, "translate": true, "sms": true }
```

- `media: true` — R2 подключён, крупные фото/видео/кружки/документы доставляются
  через ссылки (экономит место в БД и на сервере). Если `media: false` — выполните шаг 2.
- Приложение само считывает `media` из `/health`: если R2 не подключён и вы шлёте
  крупный файл, появится предупреждение.

## Если R2 пока не нужен

Можно закомментировать блок `[[r2_buckets]]` в `wrangler.toml` — тогда `/media` вернёт
`media_not_configured`, а мелкое медиа уйдёт как base64 (как раньше). Но для надёжной
доставки крупных файлов R2 рекомендуется включить сразу.
