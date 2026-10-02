const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;


// ======================================================
// ИГРОВОЕ ПОЛЕ — СТРОГО 500 x 500
// ======================================================

const WIDTH = 500;
const HEIGHT = 500;


// ======================================================
// РАКЕТКИ
// ======================================================

const PADDLE_WIDTH = 18;
const PADDLE_HEIGHT = 120;

const PADDLE_MARGIN = 20;


// ======================================================
// СЕРДЕЧКО
// ======================================================

const BALL_RADIUS = 14;

const BALL_SPEED_X = 6;
const BALL_MAX_SPEED_Y = 6;


// ======================================================
// КОМНАТЫ
// ======================================================

const rooms = new Map();


// ======================================================
// ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ
// ======================================================

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}


// ======================================================
// СОЗДАТЬ КОМНАТУ
// ======================================================

function createRoom() {

  const id = Math.random()
    .toString(36)
    .substring(2, 8)
    .toUpperCase();

  const room = {

    id,

    // Y — это ЦЕНТР ракетки
    players: [
      HEIGHT / 2,
      HEIGHT / 2
    ],

    score: [
      0,
      0
    ],

    // Кто подаёт
    servingPlayer: 0,

    // Сколько подач уже сделал этот игрок
    servesDone: 0,

    // Движется ли сердечко
    ballMoving: false,

    // Закончена ли игра
    gameOver: false,

    ball: {
      x: 0,
      y: HEIGHT / 2,

      vx: 0,
      vy: 0
    },

    clients: []
  };

  rooms.set(id, room);

  putBallOnPaddle(room);

  return room;
}


// ======================================================
// ПОСТАВИТЬ СЕРДЕЧКО ПЕРЕД РАКЕТКОЙ
// ======================================================

function putBallOnPaddle(room) {

  const player =
    room.servingPlayer;

  const paddleY =
    room.players[player];

  room.ball.y = paddleY;


  // --------------------------------------
  // ЛЕВАЯ РАКЕТКА
  // --------------------------------------

  if (player === 0) {

    const paddleRight =
      PADDLE_MARGIN +
      PADDLE_WIDTH;

    room.ball.x =
      paddleRight +
      BALL_RADIUS;

  }


  // --------------------------------------
  // ПРАВАЯ РАКЕТКА
  // --------------------------------------

  else {

    const paddleLeft =
      WIDTH -
      PADDLE_MARGIN -
      PADDLE_WIDTH;

    room.ball.x =
      paddleLeft -
      BALL_RADIUS;
  }


  room.ball.vx = 0;
  room.ball.vy = 0;

  room.ballMoving = false;
}


// ======================================================
// ПОДАЧА
// ======================================================

function serve(room) {

  if (
    room.gameOver ||
    room.ballMoving
  ) {
    return;
  }


  // Левая ракетка → вправо
  if (room.servingPlayer === 0) {

    room.ball.vx =
      BALL_SPEED_X;

    room.ball.vy =
      -2;

  }


  // Правая ракетка → влево
  else {

    room.ball.vx =
      -BALL_SPEED_X;

    room.ball.vy =
      -2;
  }


  room.ballMoving = true;
}


// ======================================================
// ПОСЛЕ ОЧКА
// ======================================================

function afterPoint(room) {

  room.ballMoving = false;

  room.servesDone++;


  /*
    Каждый игрок делает 2 подачи подряд.

    После второй подачи
    переходим к другому игроку.
  */

  if (room.servesDone >= 2) {

    room.servesDone = 0;

    room.servingPlayer =
      room.servingPlayer === 0
        ? 1
        : 0;
  }


  // Жёстко удерживаем обе ракетки внутри поля.

  room.players[0] =
    clamp(
      room.players[0],
      PADDLE_HEIGHT / 2,
      HEIGHT - PADDLE_HEIGHT / 2
    );

  room.players[1] =
    clamp(
      room.players[1],
      PADDLE_HEIGHT / 2,
      HEIGHT - PADDLE_HEIGHT / 2
    );


  putBallOnPaddle(room);
}


// ======================================================
// ОТПРАВИТЬ СОСТОЯНИЕ ВСЕМ ИГРОКАМ
// ======================================================

function broadcast(room) {

  const data = {

    type: "state",

    players: room.players,

    score: room.score,

    servingPlayer:
      room.servingPlayer,

    servesDone:
      room.servesDone,

    ballMoving:
      room.ballMoving,

    ball: room.ball,

    gameOver:
      room.gameOver
  };


  const message =
    JSON.stringify(data);


  room.clients.forEach(
    client => {

      if (
        client.readyState ===
        WebSocket.OPEN
      ) {

        client.send(message);

      }

    }
  );
}


// ======================================================
// ЗАКОНЧИТЬ ИГРУ
// ======================================================

function endGame(room, winner) {

  room.gameOver = true;

  room.ballMoving = false;


  room.clients.forEach(
    client => {

      if (
        client.readyState ===
        WebSocket.OPEN
      ) {

        client.send(
          JSON.stringify({
            type: "gameOver",

            winner,

            score: room.score
          })
        );

      }

    }
  );
}


// ======================================================
// НОВАЯ ИГРА
// ======================================================

function restartGame(room) {

  room.players[0] =
    HEIGHT / 2;

  room.players[1] =
    HEIGHT / 2;

  room.score = [
    0,
    0
  ];

  room.servingPlayer = 0;

  room.servesDone = 0;

  room.gameOver = false;

  room.ballMoving = false;

  putBallOnPaddle(room);

  broadcast(room);
}


// ======================================================
// ПРОВЕРКА СТОЛКНОВЕНИЯ
// ======================================================

function ballHitsPaddle(
  previousX,
  currentX,
  ballY,
  paddleLeft,
  paddleRight,
  paddleTop,
  paddleBottom,
  direction
) {

  const verticalHit =
    ballY + BALL_RADIUS >= paddleTop &&
    ballY - BALL_RADIUS <= paddleBottom;


  if (!verticalHit) {
    return false;
  }


  // Мяч летит вправо
  if (direction === "right") {

    return (
      previousX + BALL_RADIUS <
        paddleLeft &&
      currentX + BALL_RADIUS >=
        paddleLeft
    );
  }


  // Мяч летит влево
  return (
    previousX - BALL_RADIUS >
      paddleRight &&
    currentX - BALL_RADIUS <=
      paddleRight
  );
}


// ======================================================
// ИГРОВОЙ ЦИКЛ
// ======================================================

function gameLoop() {

  rooms.forEach(room => {

    if (
      !room.ballMoving ||
      room.gameOver
    ) {
      return;
    }


    const ball =
      room.ball;


    const previousX =
      ball.x;


    // --------------------------------------
    // Двигаем сердечко
    // --------------------------------------

    ball.x += ball.vx;
    ball.y += ball.vy;


    // --------------------------------------
    // ВЕРХ
    // --------------------------------------

    if (
      ball.y - BALL_RADIUS <= 0
    ) {

      ball.y =
        BALL_RADIUS;

      ball.vy =
        Math.abs(ball.vy);
    }


    // --------------------------------------
    // НИЗ
    // --------------------------------------

    if (
      ball.y + BALL_RADIUS >= HEIGHT
    ) {

      ball.y =
        HEIGHT -
        BALL_RADIUS;

      ball.vy =
        -Math.abs(ball.vy);
    }


    // ==================================================
    // ЛЕВАЯ РАКЕТКА
    // ==================================================

    const leftPaddleLeft =
      PADDLE_MARGIN;

    const leftPaddleRight =
      PADDLE_MARGIN +
      PADDLE_WIDTH;

    const leftPaddleTop =
      room.players[0]
