const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const rooms = new Map();

const WIDTH = 800;
const HEIGHT = 500;

const PADDLE_HEIGHT = 120;
const BALL_RADIUS = 14;

function createRoom() {
  return {
    players: [],
    score: [0, 0],
    gameOver: false,

    // 0 = первый игрок, 1 = второй
    servingPlayer: 0,

    // Сколько подач уже сделал текущий игрок
    servesDone: 0,

    // false = сердечко лежит на ракетке
    // true = сердечко летит
    ballMoving: false,

    ball: {
      x: 31,
      y: 250,
      vx: 0,
      vy: 0
    }
  };
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  room.players.forEach(player => {
    send(player, data);
  });
}

function putBallOnPaddle(room) {
  const player = room.players[room.servingPlayer];

  if (!player) return;

  room.ballMoving = false;

  room.ball.vx = 0;
  room.ball.vy = 0;

  room.ball.y = player.y;

  if (room.servingPlayer === 0) {
    room.ball.x = 31 + BALL_RADIUS;
  } else {
    room.ball.x = WIDTH - 31 - BALL_RADIUS;
  }
}

function startServe(room) {
  const direction =
    room.servingPlayer === 0 ? 1 : -1;

  room.ballMoving = true;

  room.ball.vx = direction * 7;

  // Всегда немного вверх/вниз,
  // но без случайного направления.
  room.ball.vy = -2.5;
}

function nextServe(room) {
  room.servesDone++;

  // После двух подач меняем игрока
  if (room.servesDone >= 2) {
    room.servesDone = 0;
    room.servingPlayer =
      room.servingPlayer === 0 ? 1 : 0;
  }

  putBallOnPaddle(room);
}

function resetAfterPoint(room) {
  // После очка подаёт следующий по очереди игрок
  room.servesDone++;

  if (room.servesDone >= 2) {
    room.servesDone = 0;
    room.servingPlayer =
      room.servingPlayer === 0 ? 1 : 0;
  }

  putBallOnPaddle(room);
}

wss.on("connection", ws => {

  ws.player = null;
  ws.roomId = null;
  ws.y = 250;

  ws.on("message", raw => {

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // =========================
    // СОЗДАНИЕ КОМНАТЫ
    // =========================

    if (data.type === "create") {

      const roomId =
        crypto.randomBytes(3).toString("hex");

      const room = createRoom();

      ws.roomId = roomId;
      ws.player = 0;
      ws.y = 250;

      room.players.push(ws);

      rooms.set(roomId, room);

      send(ws, {
        type: "roomCreated",
        roomId: roomId,
        player: 0
      });

      return;
    }

    // =========================
    // ПОДКЛЮЧЕНИЕ
    // =========================

    if (data.type === "join") {

      const room = rooms.get(data.roomId);

      if (!room) {
        send(ws, {
          type: "error",
          message: "Комната не найдена"
        });

        return;
      }

      if (room.players.length >= 2) {
        send(ws, {
          type: "error",
          message: "Комната уже заполнена"
        });

        return;
      }

      ws.roomId = data.roomId;
      ws.player = 1;
      ws.y = 250;

      room.players.push(ws);

      // Сердечко появляется
      // на первой ракетке
      putBallOnPaddle(room);

      room.players.forEach(player => {

        send(player, {
          type: "start",
          player: player.player,
          servingPlayer: room.servingPlayer,
          score: room.score
        });

      });

      return;
    }

    // =========================
    // ДВИЖЕНИЕ РАКЕТКИ
    // =========================

    if (data.type === "move") {

      const room = rooms.get(ws.roomId);

      if (!room || room.gameOver) return;

      let y = Number(data.y);

      if (!Number.isFinite(y)) return;

      y = Math.max(
        PADDLE_HEIGHT / 2,
        Math.min(
          HEIGHT - PADDLE_HEIGHT / 2,
          y
        )
      );

      ws.y = y;

      // Если сердечко лежит на ракетке,
      // оно двигается вместе с ней
      if (
        !room.ballMoving &&
        room.servingPlayer === ws.player
      ) {
        room.ball.y = ws.y;
      }

      return;
    }

    // =========================
    // ПОДАЧА
    // =========================

    if (data.type === "serve") {

      const room = rooms.get(ws.roomId);

      if (!room || room.gameOver) return;

      if (room.players.length !== 2) return;

      if (room.servingPlayer !== ws.player) return;

      if (room.ballMoving) return;

      startServe(room);

      return;
    }

    // =========================
    // НОВАЯ ИГРА
    // =========================

    if (data.type === "rematch") {

      const room = rooms.get(ws.roomId);

      if (!room || room.players.length !== 2) {
        return;
      }

      room.score = [0, 0];
      room.gameOver = false;

      room.servingPlayer = 0;
      room.servesDone = 0;

      room.players[0].y = 250;
      room.players[1].y = 250;

      putBallOnPaddle(room);

      broadcast(room, {
        type: "restart",
        score: room.score,
        servingPlayer: room.servingPlayer
      });

      return;
    }
  });

  ws.on("close", () => {

    const room = rooms.get(ws.roomId);

    if (!room) return;

    room.players =
      room.players.filter(p => p !== ws);

    if (room.players.length === 0) {
      rooms.delete(ws.roomId);
    }
  });
});


// =========================
// ИГРОВОЙ ЦИКЛ
// =========================

setInterval(() => {

  for (const room of rooms.values()) {

    if (room.players.length !== 2) continue;

    if (room.gameOver) continue;

    const left = room.players[0];
    const right = room.players[1];

    const ball = room.ball;

    // =========================
    // СЕРДЕЧКО НА РАКЕТКЕ
    // =========================

    if (!room.ballMoving) {

      putBallOnPaddle(room);

      broadcast(room, {
        type: "state",
        ball: ball,
        players: [
          left.y,
          right.y
        ],
        score: room.score,
        servingPlayer: room.servingPlayer,
        ballMoving: false,
        servesDone: room.servesDone
      });

      continue;
    }

    // =========================
    // ДВИЖЕНИЕ
    // =========================

    ball.x += ball.vx;
    ball.y += ball.vy;


    // Верх
    if (ball.y - BALL_RADIUS <= 0) {

      ball.y = BALL_RADIUS;
      ball.vy *= -1;
    }


    // Низ
    if (ball.y + BALL_RADIUS >= HEIGHT) {

      ball.y = HEIGHT - BALL_RADIUS;
      ball.vy *= -1;
    }


    // =========================
    // ЛЕВАЯ РАКЕТКА
    // =========================

    const leftX = 15;
    const leftRight = 31;

    if (
      ball.vx < 0 &&
      ball.x - BALL_RADIUS <= leftRight &&
      ball.x + BALL_RADIUS >= leftX &&
      ball.y >= left.y - PADDLE_HEIGHT / 2 &&
      ball.y <= left.y + PADDLE_HEIGHT / 2
    ) {

      ball.x = leftRight + BALL_RADIUS;

      ball.vx = Math.abs(ball.vx);

      // Направление немного зависит
      // от места попадания в ракетку
      const hit =
        (ball.y - left.y) /
        (PADDLE_HEIGHT / 2);

      ball.vy = hit * 6;
    }


    // =========================
    // ПРАВАЯ РАКЕТКА
    // =========================

    const rightX = WIDTH - 31;
    const rightRight = WIDTH - 15;

    if (
      ball.vx > 0 &&
      ball.x + BALL_RADIUS >= rightX &&
      ball.x - BALL_RADIUS <= rightRight &&
      ball.y >= right.y - PADDLE_HEIGHT / 2 &&
      ball.y <= right.y + PADDLE_HEIGHT / 2
    ) {

      ball.x = rightX - BALL_RADIUS;

      ball.vx = -Math.abs(ball.vx);

      const hit =
        (ball.y - right.y) /
        (PADDLE_HEIGHT / 2);

      ball.vy = hit * 6;
    }


    // =========================
    // ГОЛ СЛЕВА
    // =========================

    if (ball.x < -BALL_RADIUS) {

      // Очко получает второй игрок
      room.score[1]++;

      if (room.score[1] >= 11) {

        room.gameOver = true;

        broadcast(room, {
          type: "gameOver",
          winner: 1,
          score: room.score
        });

      } else {

        resetAfterPoint(room);
      }
    }


    // =========================
    // ГОЛ СПРАВА
    // =========================

    if (ball.x > WIDTH + BALL_RADIUS) {

      // Очко получает первый игрок
      room.score[0]++;

      if (room.score[0] >= 11) {

        room.gameOver = true;

        broadcast(room, {
          type: "gameOver",
          winner: 0,
          score: room.score
        });

      } else {

        resetAfterPoint(room);
      }
    }


    // =========================
    // ОТПРАВКА СОСТОЯНИЯ
    // =========================

    broadcast(room, {
      type: "state",

      ball: ball,

      players: [
        left.y,
        right.y
      ],

      score: room.score,

      servingPlayer:
        room.servingPlayer,

      ballMoving:
        room.ballMoving,

      servesDone:
        room.servesDone
    });

  }

}, 1000 / 60);


const PORT =
  process.env.PORT || 3000;

server.listen(PORT, () => {

  console.log(
    "Heart Pong server started on port " +
    PORT
  );

});
