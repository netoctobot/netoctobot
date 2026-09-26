@echo off
pybabel extract . -F babel.cfg -o bot/locales/messages.pot
pybabel update -d bot/locales -D messages -i bot/locales/messages.pot
pybabel compile -d bot/locales -D messages
echo تم تحديث جميع ترجمات البوت بنجاح!