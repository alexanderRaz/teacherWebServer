const { readFile, writeFile } = require('node:fs/promises');
const { unlinkSync, readdirSync } = require('node:fs');
const { extname, join } = require('node:path');
const express = require('express');
const diff = require('diff');
const app = express();
const server = require('node:http').Server(app);
const io = require('socket.io')(server);

const { port, maxLogSize } = require('./config.json');

const techerNamespace = io.of('/teacher');
const studentNamespace = io.of('/student');
//Название текущего проекта
let currentProjectName = '';

const historyFolder = '_history';
//Удаление файлов истории
const arrFiles = readdirSync(historyFolder);
for (let i = 0; i < arrFiles.length; i++) unlinkSync(join(__dirname, historyFolder, arrFiles[i]));

app.use(express.static(join(__dirname, 'public')));

server.listen(port, () => {
  console.log(`Server run in ${port} port`);
});

let arrLog = []; //Список доступных для студента последних изменений кода
let objHistory = {}; //Объект хранения информации о вехах изменений кода

studentNamespace.on('connection', (socket) => {
  //Отправка преподавателю обновлённой статистики количества подключенных студентов
  techerNamespace.emit('statUser', `${studentNamespace.sockets.size} users`);

  //Отправка студенту списка доступных последних изменений кода
  socket.emit('allLog', arrLog);

  socket.on('disconnect', (reason) => {
    //Отправка преподавателю обновлённой статистики количества подключенных студентов
    techerNamespace.emit('statUser', `${studentNamespace.sockets.size} users`);
  });

  socket.on('getFileContent', async ({ timestamp, filename, version }) => {
    //Отправка студенту запрашиваемого файла с указаниями изменений по отношению
    //к предыдущей версии файла при его наличии
    let filePath = formationFilePath(timestamp, filename, version);

    let dataToClient = {
      timestamp,
      filename,
      projectName: currentProjectName,
      addLines: '', //Номера строк, которые отличаются по отношению к предыдущей версии файла
      arrRemoveLines: [], //Массив с номерами строк, после которых были удалены строки из предыдущей версии файла
      version,
    };

    try {
      let fileData = await readFile(filePath, 'utf-8');
      dataToClient.extname = extname(filename);
      dataToClient.fileContent = fileData;
      dataToClient.addLines = objHistory[filename][version].addLines;
      dataToClient.arrRemoveLines = objHistory[filename][version].arrRemoveLines;
      socket.emit('fileContent', dataToClient);
    } catch (err) {
      console.error(err);
      dataToClient.fileContent = 'Error: please refresh the page.';
      return socket.emit('fileContent', dataToClient);
    }
  });
});

techerNamespace.on('connection', (socket) => {
  console.log('Teacher connect server');

  socket.on('disconnect', (reason) => {
    console.log('Teacher disconnect server');
  });

  //Получение информации о файле который изменился
  socket.on('fileFromTeacher', createHistoryMilestone);

  //Получение команды от преподавателя очистить историю изменений
  socket.on('clearHistory', clearHistory);
});

function formationFilePath(timestamp, filename, version) {
  return join(historyFolder, `${timestamp}.${currentProjectName}.${replacerFilename(filename)}.${version}`);
}

function replacerFilename(filename) {
  return filename.replaceAll(/\|/g, '.');
}

//Создание новой вехи истории изменений по информации о файле
async function createHistoryMilestone({ filename, projectName, fileData, isRemoveFile }) {
  if (currentProjectName !== projectName) {
    //Новый проект делаем сброс истории
    clearHistory(projectName);
  }

  let timestamp = Date.now();

  if (isRemoveFile) {
    if (objHistory[filename]) {
      let lastVersion = Object.keys(objHistory[filename]).length - 1;
      addInLogAndSend(timestamp, filename, lastVersion, isRemoveFile);
    }
  } else if (objHistory[filename]) {
    //Новый файл уже есть в истории, значит его надо сравнить с предыдущей версией этого файла
    let objFilenameHistory = objHistory[filename];
    let lastVersion = Object.keys(objFilenameHistory).length - 1;
    let newVersion = lastVersion + 1;
    let newFilePath = formationFilePath(timestamp, filename, newVersion);
    let lastFilePath = formationFilePath(objFilenameHistory[lastVersion].timestamp, filename, lastVersion);

    try {
      await writeFile(newFilePath, fileData, 'utf-8');
    } catch (err) {
      throw err;
    }
    try {
      let oldFileData = await readFile(lastFilePath, 'utf-8');
      createHistoryMilestoneByTwoFiles(oldFileData, fileData, timestamp, filename, newVersion);
      addInLogAndSend(timestamp, filename, newVersion);
    } catch (err) {
      return console.log(err);
    }
  } else {
    //Нет в истории файла создаём
    let newFilePath = formationFilePath(timestamp, filename, 0);
    try {
      await writeFile(newFilePath, fileData, 'utf-8');

      objHistory[filename] = {};
      objHistory[filename][0] = {
        arrRemoveLines: [],
        addLines: '',
        timestamp,
      };
      addInLogAndSend(timestamp, filename, 0);
    } catch (err) {
      throw err;
    }
  }
}

function clearHistory(projectName) {
  //Удаление файлов истории
  let arrFiles = readdirSync(historyFolder);
  for (let i = 0; i < arrFiles.length; i++) unlinkSync(historyFolder + '/' + arrFiles[i]);

  if (projectName) currentProjectName = projectName;

  //Очистка переменных отвечающих за хранения вех истории
  objHistory = {};
  arrLog = [];

  console.log('History clear');
  techerNamespace.emit('clearHistory', 'History clear');
}

/*
 * Процедура определяет номера строк нового файла, которые отличаются по отношению к предыдущей
 * версии файла и записывает эту информацию в объект хранения информации о вехах изменений кода.
 */
function createHistoryMilestoneByTwoFiles(oldFileData, newFileData, timestamp, filename, version) {
  let arr = diff.diffLines(oldFileData, newFileData, { newlineIsToken: false });
  let arrAddLines = [];
  let arrRemoveLines = [];
  let numRow = 1;

  for (let i = 0; i < arr.length; i++) {
    if (arr[i].removed) {
      //Удалённые строки
      arrRemoveLines.push(numRow - 1);
    } else if (arr[i].added) {
      //Новые строки
      if (arr[i].count === 1) {
        arrAddLines.push(numRow);
        numRow++;
      } else {
        arrAddLines.push(numRow + '-' + (numRow + arr[i].count - 1));
        numRow += arr[i].count;
      }
    } else {
      //Изменённые строки
      numRow += arr[i].count;
    }
  }

  objHistory[filename][version] = {
    arrRemoveLines,
    addLines: arrAddLines.join(','),
    timestamp,
  };
}

function addInLogAndSend(timestamp, filename, version, isRemoveFile) {
  let data = { timestamp, version, filename, currentProjectName, isRemoveFile };
  //Фиксация изменении в списке доступных для студента последних изменений кода
  arrLog.push(data);
  //Актуализация размера списка доступных для студента последних изменений кода
  if (arrLog.length > maxLogSize) {
    while (arrLog.length != maxLogSize) arrLog.shift();
  }
  //Отправка информации студенту о доступной новой вехи истории
  studentNamespace.emit('newLog', data);
  //Отправка информации преподавателю о доступной новой вехи истории
  techerNamespace.emit('successAddNewLog', data);
}
