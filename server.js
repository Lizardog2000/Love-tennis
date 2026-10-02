const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const WIDTH = 500;
const HEIGHT = 500;

const PADDLE_WIDTH = 18;
const PADDLE_HEIGHT = 120;
const PADDLE_MARGIN = 20;

const BALL_RADIUS = 14;
const BALL_SPEED_X = 6;
const MAX_BALL_SPEED_Y = 6;

const WIN_SCORE = 11;

const rooms = new Map();

function randomRoomCode() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

function createRoom() {
  let code;

  do {
    code = randomRoomCode();
  } while (rooms.has(code));

  const room = {
    code,
    clients: new Set(),

    players: {
      left: null,
      right: null
    },

    paddles: {
      left: HEIGHT / 2,
      right: HEIGHT / 2
    },

    score: {
      left: 0,
      right: 0
    },

    servingPlayer: "left",
    servesDone: 0,

    ballMoving: false,

    ball: {
      x: 0,
      y: HEIGHT / 2,
      vx: 0,
      vy: 0
    },

    gameOver: false
  };

  rooms.set(code, room);
  resetBall(room);

  return room;
}

function resetBall(room) {
  const player = room.servingPlayer;

  room.ballMoving = false;
  room.ball.vx = 0;
  room.ball.vy = 0;

  if (player === "left") {
    room.ball.x =
      PADDLE_MARGIN +
      PADDLE_WIDTH +
      BALL_RADIUS;

    room.ball.y = room.paddles.left;
  } else {
    room.ball.x =
      WIDTH -
      PADDLE_MARGIN -
      PADDLE_WIDTH -
      BALL_RADIUS;

    room.ball.y = room.paddles.right;
  }
}

function clampPaddle(y) {
  const min = PADDLE_HEIGHT / 2;
  const max = HEIGHT - PADDLE_HEIGHT / 2;

  return Math.max(min, Math.min(max, y));
}

function send(client, data) {
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  const message = JSON.stringify(data);

  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function roomState(room) {
  return {
    type: "state",

    paddles: {
      left: room.paddles.left,
      right: room.paddles.right
    },

    score: {
      left: room.score.left,
      right: room.score.right
    },

    ball: {
      x: room.ball.x,
      y: room.ball.y,
      vx: room.ball.vx,
      vy: room.ball.vy
    },

    ballMoving: room.ballMoving,
    servingPlayer: room.servingPlayer,
    servesDone: room.servesDone,
    gameOver: room.gameOver
  };
}

function sendState(room) {
  broadcast(room, roomState(room));
}

function startServe(room) {
  if (room.gameOver || room.ballMoving) {
    return;
  }

  if (
    !room.players.left ||
    !room.players.right
  ) {
    return;
  }

  const direction =
    room.servingPlayer === "left"
      ? 1
      : -1;

  const randomVy =
    (Math.random() * 2 - 1) * 3;

  room.ballMoving = true;

  room.ball.vx = direction * BALL_SPEED_X;
  room.ball.vy = randomVy;

  sendState(room);
}

function finishRally(room, scoringPlayer) {
  room.score[scoringPlayer]++;

  if (room.score[scoringPlayer] >= WIN_SCORE) {
    room.gameOver = true;
    room.ballMoving = false;

    room.ball.vx = 0;
    room.ball.vy = 0;

    broadcast(room, {
      type: "gameOver",
      winner: scoringPlayer,
      score: room.score
    });

    sendState(room);
    return;
  }

  room.servesDone++;

  if (room.servesDone >= 2) {
    room.servesDone = 0;

    room.servingPlayer =
      room.servingPlayer === "left"
        ? "right"
        : "left";
  }

  resetBall(room);
  sendState(room);
}

function paddleTop(centerY) {
  return centerY - PADDLE_HEIGHT / 2;
}

function paddleBottom(centerY) {
  return centerY + PADDLE_HEIGHT / 2;
}

function ballCrossedPaddle(
  previousX,
  currentX,
  y,
  paddleCenter,
  paddleX,
  movingRight
) {
  const top = paddleTop(paddleCenter);
  const bottom = paddleBottom(paddleCenter);

  const verticallyInside =
    y + BALL_RADIUS >= top &&
    y - BALL_RADIUS <= bottom;

  if (!verticallyInside) {
    return false;
  }

  if (movingRight) {
    return (
      previousX + BALL_RADIUS <= paddleX &&
      currentX + BALL_RADIUS >= paddleX
    );
  }

  return (
    previousX - BALL_RADIUS >= paddleX &&
    currentX - BALL_RADIUS <= paddleX
  );
}

function hitPaddle(room, side) {
  const paddleY = room.paddles[side];

  const offset =
    (room.ball.y - paddleY) /
    (PADDLE_HEIGHT / 2);

  const newVy =
    Math.max(
      -MAX_BALL_SPEED_Y,
      Math.min(
        MAX_BALL_SPEED_Y,
        offset * MAX_BALL_SPEED_Y
      )
    );

  if (side === "left") {
    const paddleRight =
      PADDLE_MARGIN + PADDLE_WIDTH;

    room.ball.x =
      paddleRight + BALL_RADIUS;

    room.ball.vx = Math.abs(BALL_SPEED_X);
  } else {
    const paddleLeft =
      WIDTH -
      PADDLE_MARGIN -
      PADDLE_WIDTH;

    room.ball.x =
      paddleLeft - BALL_RADIUS;

    room.ball.vx = -Math.abs(BALL_SPEED_X);
  }

  room.ball.vy = newVy;
}

function gameTick(room) {
  if (
    room.gameOver ||
    !room.ballMoving ||
    !room.players.left ||
    !room.players.right
  ) {
    return;
  }

  const previousX = room.ball.x;

  room.ball.x += room.ball.vx;
  room.ball.y += room.ball.vy;

  // Верхняя стенка
  if (
    room.ball.y - BALL_RADIUS <= 0
  ) {
    room.ball.y = BALL_RADIUS;
    room.ball.vy =
      Math.abs(room.ball.vy);
  }

  // Нижняя стенка
  if (
    room.ball.y + BALL_RADIUS >= HEIGHT
  ) {
    room.ball.y =
      HEIGHT - BALL_RADIUS;

    room.ball.vy =
      -Math.abs(room.ball.vy);
  }

  // Левая ракетка
  const leftPaddleX =
    PADDLE_MARGIN + PADDLE_WIDTH;

  if (
    room.ball.vx < 0 &&
    ballCrossedPaddle(
      previousX,
      room.ball.x,
      room.ball.y,
      room.paddles.left,
      leftPaddleX,
      false
    )
  ) {
    hitPaddle(room, "left");
  }

  // Правая ракетка
  const rightPaddleX =
    WIDTH -
    PADDLE_MARGIN -
    PADDLE_WIDTH;

  if (
    room.ball.vx > 0 &&
    ballCrossedPaddle(
      previousX,
      room.ball.x,
      room.ball.y,
      room.paddles.right,
      rightPaddleX,
      true
    )
  ) {
    hitPaddle(room, "right");
  }

  // Мяч ушёл слева
  if (
    room.ball.x + BALL_RADIUS < 0
  ) {
    finishRally(room, "right");
    return;
  }

  // Мяч ушёл справа
  if (
    room.ball.x - BALL_RADIUS > WIDTH
  ) {
    finishRally(room, "left");
    return;
  }

  sendState(room);
}

setInterval(() => {
  for (const room of rooms.values()) {
    gameTick(room);
  }
}, 16);

wss.on("connection", (ws) => {
  let room = null;
  let player = null;

  send(ws, {
    type: "connected"
  });

  ws.on("message", (raw) => {
    let data;

    try {
      data = JSON.parse(raw.toString());
    } catch (error) {
      return;
    }

    // Создание комнаты
    if (data.type === "create") {
      if (room) {
        return;
      }

      room = createRoom();

      player = "left";

      room.players.left = ws;
      room.clients.add(ws);

      send(ws, {
        type: "roomCreated",
        room: room.code,
        player: player
      });

      sendState(room);
      return;
    }

    // Подключение к комнате
    if (data.type === "join") {
      if (room) {
        return;
      }

      const code =
        String(data.room || "")
          .trim()
          .toUpperCase();

      const existingRoom = rooms.get(code);

      if (!existingRoom) {
        send(ws, {
          type: "error",
          message: "Комната не найдена"
        });

        return;
      }

      if (
        existingRoom.players.left &&
        existingRoom.players.right
      ) {
        send(ws, {
          type: "error",
          message: "Комната уже заполнена"
        });

        return;
      }

      room = existingRoom;

      if (!room.players.left) {
        player = "left";
        room.players.left = ws;
      } else {
        player = "right";
        room.players.right = ws;
      }

      room.clients.add(ws);

      send(ws, {
        type: "joined",
        room: room.code,
        player: player
      });

      broadcast(room, {
        type: "players",
        left: Boolean(room.players.left),
        right: Boolean(room.players.right)
      });

      sendState(room);
      return;
    }

    // Движение ракетки
    if (data.type === "move") {
      if (!room || !player) {
        return;
      }

      const y = Number(data.y);

      if (!Number.isFinite(y)) {
        return;
      }

      room.paddles[player] =
        clampPaddle(y);

      // Если подача ещё не началась,
      // сердечко находится у ракетки
      if (!room.ballMoving) {
        resetBall(room);
      }

      sendState(room);
      return;
    }

    // Подача
    if (data.type === "serve") {
      if (!room || !player) {
        return;
      }

      if (player !== room.servingPlayer) {
        return;
      }

      startServe(room);
      return;
    }

    // Новая игра
    if (data.type === "rematch") {
      if (!room) {
        return;
     
