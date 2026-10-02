const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

// Игровое поле
const WIDTH = 800;
const HEIGHT = 500;

// Ракетки
const PADDLE_WIDTH = 18;
const PADDLE_HEIGHT = 120;
const PADDLE_MARGIN = 20;

// Мяч
const BALL_RADIUS = 14;
const BALL_SPEED_X = 7;
const BALL_SPEED_Y = 2.5;

const rooms = new Map();

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createRoom() {
  const roomId = Math.random().toString(36).substring(2, 8).toUpperCase();

  const room = {
    id: roomId,

    players: [
      HEIGHT / 2,
      HEIGHT / 2
    ],

    score: [0, 0],

    gameOver: false,

    servingPlayer: 0,
    servesDone: 0,

    ballMoving: false,

    ball: {
      x: PADDLE_MARGIN + PADDLE_WIDTH + BALL_RADIUS,
      y: HEIGHT / 2,
      vx: 0,
      vy: 0
    },

    clients: []
  };

  rooms.set(roomId, room);

  return room;
}

function putBallOnPaddle(room) {
  const player = room.servingPlayer;

  const paddleY = room.players[player];

  room.ball.y = paddleY;

  if (player === 0) {
    // Левая ракетка:
    // мяч стоит СПРАВА от неё
    room.ball.x =
      PADDLE_MARGIN +
      PADDLE_WIDTH +
      BALL_RADIUS;
  } else {
    // Правая ракетка:
    // мяч стоит СЛЕВА от неё
    room.ball.x =
      WIDTH -
      PADDLE_MARGIN -
      PADDLE_WIDTH -
      BALL_RADIUS;
  }

  room.ball.vx = 0;
  room.ball.vy = 0;
  room.ballMoving = false;
}

function startServe(room) {
  if (room.gameOver || room.ballMoving) return;

  const player = room.servingPlayer;

  room.ballMoving = true;

  if (player === 0) {
    // Левая ракетка отправляет мяч вправо
    room.ball.vx = BALL_SPEED_X;
    room.ball.vy = -BALL_SPEED_Y;
  } else {
    // Правая ракетка отправляет мяч влево
    room.ball.vx = -BALL_SPEED_X;
    room.ball.vy = -BALL_SPEED_Y;
  }
}

function resetAfterPoint(room) {
  room.ballMoving = false;

  room.servesDone++;

  // После двух подач подряд переходим к другому игроку
  if (room.servesDone >= 2) {
    room.servesDone = 0;
    room.servingPlayer = room.servingPlayer === 0 ? 1 : 0;
  }

  // Ограничиваем ракетки
  room.players[0] = clamp(
    room.players[0],
    PADDLE_HEIGHT / 2,
    HEIGHT - PADDLE_HEIGHT / 2
  );

  room.players[1] = clamp(
    room.players[1],
    PADDLE_HEIGHT / 2,
    HEIGHT - PADDLE_HEIGHT / 2
  );

  putBallOnPaddle(room);
}

function broadcast(room) {
  const message = JSON.stringify({
    type: "state",

    players: room.players,

    score: room.score,

    servingPlayer: room.servingPlayer,

    servesDone: room.servesDone,

    ballMoving: room.ballMoving,

    ball: room.ball,

    gameOver: room.gameOver
  });

  room.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function finishGame(room, winner) {
  room.gameOver = true;
  room.ballMoving = false;

  const message = JSON.stringify({
    type: "gameOver",
    winner,
    score: room.score
  });

  room.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function resetGame(room) {
  room.players[0] = HEIGHT / 2;
  room.players[1] = HEIGHT / 2;

  room.score = [0, 0];

  room.gameOver = false;

  room.servingPlayer = 0;
  room.servesDone = 0;

  room.ballMoving = false;

  putBallOnPaddle(room);

  broadcast(room);
}

function gameLoop() {
  rooms.forEach((room) => {
    if (!room.ballMoving || room.gameOver) {
      return;
    }

    const ball = room.ball;

    const previousX = ball.x;
    const previousY = ball.y;

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Верхняя граница
    if (ball.y - BALL_RADIUS <= 0) {
      ball.y = BALL_RADIUS;
      ball.vy = Math.abs(ball.vy);
    }

    // Нижняя граница
    if (ball.y + BALL_RADIUS >= HEIGHT) {
      ball.y = HEIGHT - BALL_RADIUS;
      ball.vy = -Math.abs(ball.vy);
    }

    // -----------------------------------
    // Левая ракетка
    // -----------------------------------

    const leftPaddleTop =
      room.players[0] - PADDLE_HEIGHT / 2;

    const leftPaddleBottom =
      room.players[0] + PADDLE_HEIGHT / 2;

    const leftPaddleLeft =
      PADDLE_MARGIN;

    const leftPaddleRight =
      PADDLE_MARGIN + PADDLE_WIDTH;

    const hitLeft =
      ball.vx < 0 &&
      ball.x - BALL_RADIUS <= leftPaddleRight &&
      ball.x + BALL_RADIUS >= leftPaddleLeft &&
      ball.y + BALL_RADIUS >= leftPaddleTop &&
      ball.y - BALL_RADIUS <= leftPaddleBottom;

    if (hitLeft) {
      ball.x = leftPaddleRight + BALL_RADIUS + 1;

      ball.vx = Math.abs(ball.vx);

      // Добавляем направление в зависимости от точки удара
      const difference =
        ball.y - room.players[0];

      ball.vy =
        difference * 0.08;

      if (Math.abs(ball.vy) < 1) {
        ball.vy = ball.vy < 0 ? -1 : 1;
      }
    }

    // -----------------------------------
    // Правая ракетка
    // -----------------------------------

    const rightPaddleRight =
      WIDTH - PADDLE_MARGIN;

    const rightPaddleLeft =
      rightPaddleRight - PADDLE_WIDTH;

    const rightPaddleTop =
      room.players[1] - PADDLE_HEIGHT / 2;

    const rightPaddleBottom =
      room.players[1] + PADDLE_HEIGHT / 2;

    const hitRight =
      ball.vx > 0 &&
      ball.x + BALL_RADIUS >= rightPaddleLeft &&
      ball.x - BALL_RADIUS <= rightPaddleRight &&
      ball.y + BALL_RADIUS >= rightPaddleTop &&
      ball.y - BALL_RADIUS <= rightPaddleBottom;

    if (hitRight) {
      // ВАЖНО:
      // мяч принудительно ставим СЛЕВА от правой ракетки,
      // чтобы он не оказался внутри неё.
      ball.x =
        rightPaddleLeft -
        BALL_RADIUS -
        1;

      ball.vx = -Math.abs(ball.vx);

      const difference =
        ball.y - room.players[1];

      ball.vy =
        difference * 0.08;

      if (Math.abs(ball.vy) < 1) {
        ball.vy = ball.vy < 0 ? -1 : 1;
      }
    }

    // -----------------------------------
    // Гол слева
    // -----------------------------------

    if (ball.x + BALL_RADIUS < 0) {
      room.score[1]++;

      if (room.score[1] >= 11) {
        finishGame(room, 1);
        return;
      }

      resetAfterPoint(room);
    }

    // -----------------------------------
    // Гол справа
    // -----------------------------------

    if (ball.x - BALL_RADIUS > WIDTH) {
      room.score[0]++;

      if (room.score[0] >= 11) {
        finishGame(room, 0);
        return;
      }

      resetAfterPoint(room);
    }

    // -----------------------------------
    // Дополнительная защита:
    // мяч не может оказаться внутри
    // правой ракетки после столкновения
    // -----------------------------------

    if (
      ball.vx < 0 &&
      ball.x + BALL_RADIUS > rightPaddleLeft &&
      ball.x - BALL_RADIUS < rightPaddleRight &&
      ball.y + BALL_RADIUS >= rightPaddleTop &&
      ball.y - BALL_RADIUS <= rightPaddleBottom
    ) {
      ball.x =
        rightPaddleLeft -
        BALL_RADIUS -
        1;

      ball.vx = -Math.abs(ball.vx);
    }

    // Защита для левой ракетки
    if (
      ball.vx > 0 &&
      ball.x - BALL_RADIUS < leftPaddleRight &&
      ball.x + BALL_RADIUS > leftPaddleLeft &&
      ball.y + BALL_RADIUS >= leftPaddleTop &&
      ball.y - BALL_RADIUS <= leftPaddleBottom
    ) {
      ball.x =
        leftPaddleRight +
        BALL_RADIUS +
        1;

      ball.vx = Math.abs(ball.vx);
    }

    broadcast(room);
  });
}

setInterval(gameLoop, 1000 / 60);

// -----------------------------------
// WebSocket
// -----------------------------------

wss.on("connection", (ws) => {
  let currentRoom = null;
  let playerIndex = null;

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      // Создание комнаты
      if (data.type === "create") {
        const room = createRoom();

        room.clients.push(ws);

        currentRoom = room;
        playerIndex = 0;

        putBallOnPaddle(room);

        ws.send(
          JSON.stringify({
            type: "created",
            room: room.id,
            player: 0
          })
        );

        broadcast(room);

        return;
      }

      // Вход в комнату
      if (data.type === "join") {
        const room = rooms.get(
          String(data.room).toUpperCase()
        );

        if (!room) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Комната не найдена"
            })
          );

          return;
        }

        if (room.clients.length >= 2) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Комната уже заполнена"
            })
          );

          return;
        }

        room.clients.push(ws);

        currentRoom = room;
        playerIndex = 1;

        ws.send(
          JSON.stringify({
            type: "joined",
            room: room.id,
            player: 1
          })
        );

        putBallOnPaddle(room);

        broadcast(room);

        return;
      }

      // Движение ракетки
      if (data.type === "move") {
        if (!currentRoom || playerIndex === null) {
          return;
        }

        let y = Number(data.y);

        if (!Number.isFinite(y)) {
          return;
        }

        // НЕЛЬЗЯ дать ракетке выйти
        // за верхнюю или нижнюю границу.
        const minY = PADDLE_HEIGHT / 2;
        const maxY =
          HEIGHT - PADDLE_HEIGHT / 2;

        y = clamp(y, minY, maxY);

        currentRoom.players[playerIndex] = y;

        // Если игрок сейчас подаёт,
        // мяч должен двигаться вместе с ракеткой.
        if (
          !currentRoom.ballMoving &&
          currentRoom.servingPlayer === playerIndex
        ) {
          currentRoom.ball.y = y;

          if (playerIndex === 0) {
            currentRoom.ball.x =
              PADDLE_MARGIN +
              PADDLE_WIDTH +
              BALL_RADIUS;
          } else {
            currentRoom.ball.x =
              WIDTH -
              PADDLE_MARGIN -
              PADDLE_WIDTH -
              BALL_RADIUS;
          }
        }

        broadcast(currentRoom);

        return;
      }

      // Подача
      if (data.type === "serve") {
        if (!currentRoom || playerIndex === null) {
          return;
        }

        if (
          currentRoom.servingPlayer !== playerIndex
        ) {
          return;
        }

        startServe(currentRoom);

        broadcast(currentRoom);

        return;
      }

      // Новая игра
      if (data.type === "rematch") {
        if (!currentRoom) {
          return;
        }

        resetGame(currentRoom);

        return;
      }
    } catch (error) {
      console.log("Ошибка сообщения:", error);
    }
  });

  ws.on("close", () => {
    if (!currentRoom) {
      return;
    }

    currentRoom.clients =
      currentRoom.clients.filter(
        (client) => client !== ws
      );

    if (currentRoom.clients.length === 0) {
      rooms.delete(currentRoom.id);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
