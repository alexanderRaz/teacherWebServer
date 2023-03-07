Данная программа является дополнительным материалом к статье на Habr:
«Подождите, не успеваю переписать код …». Я слушал это пару лет и в итоге написал раздатчик изменений кода для студентов.

## teacherWebServer

Web-приложение, располагаемое на хостинге, которое формирует вехи изменения файлов по присланной информации от другой программы и показывает их студенту.

Поддерживаемая платформа NodeJS: v18.x+

### Перед запуском

Необходимо настроить опции в config.json:
- `port` - число, порт запуска web-сервера
- `maxLogSize` - число, размер списка доступных для нового студента последних изменений кода

### Запуск программы

`node app.js`

### Сообщения в консоль

`Server run in N port` - где `N`  номер порта. Успешный запуск web-сервера..

`Teacher connect server` - Установленная на компьютере преподавателя консольная программа, осуществляющая слежение за файлами подключилась к серверу.

`Teacher disconnect server` - Потеряно соединение с консольной программой, осуществляющей слежение за файлами.

`History clear` - Произведена очистка истории изменений файлов проекта. 

## License

[MIT License](http://www.opensource.org/licenses/mit-license.php)