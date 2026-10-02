const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const FIELD = 500;

const PADDLE_W = 18;
const PADDLE_H = 110;
const PADDLE_MARGIN = 20;

const BALL_R = 14;
const BALL_SPEED = 6;

const WIN_SCORE = 11;

const rooms = new Map();

function makeCode() {
  let code;

  do {
    code = Math.random()
      .toString(36)
      .substring(2, 7)
      .toUpperCase();
  } while (rooms.has(code));

  return code;
}

function createRoom() {
  const room = {
    code: makeCode(),

    left: null,
    right: null,

    leftY: FIELD / 2,
    rightY: FIELD / 2,

    leftScore: 0,
    rightScore: 0,

    server: "left",
    serves: 0,

    ball: {
      x: 0,
      y: FIELD / 2,
      vx: 0,
      vy: 0
    },

    moving: false,
    gameOver: false
  };

  rooms.set(room.code, room);

  resetBall(room);

  return room;
}

function resetBall(room) {
  room.moving = false;

  room.ball.vx = 0;
  room.ball.vy = 0;

  if (room.server === "left") {
    room.ball.x =
      PADDLE_MARGIN +
      PADDLE_W +
      BALL_R;

    room.ball.y = room.leftY;
  } else {
    room.ball.x =
      FIELD -
      PADDLE_MARGIN -
      PADDLE_W -
      BALL_R;

    room.ball.y = room.rightY;
  }
}

function clampPaddle(y) {
  const min = PADDLE_H / 2;
  const max = FIELD - PADDLE_H / 2;

  return Math.max(min, Math.min(max, y));
}

function send(ws, data) {
  if (
    ws &&
    ws.readyState === WebSocket.OPEN
  ) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  const message = JSON.stringify(data);

  if (
    room.left &&
    room.left.readyState === WebSocket.OPEN
  ) {
    room.left.send(message);
  }

  if (
    room.right &&
    room.right.readyState === WebSocket.OPEN
  ) {
    room.right.send(message);
  }
}

function state(room) {
  return {
    type: "state",

    leftY: room.leftY,
    rightY: room.rightY,

    leftScore: room.leftScore,
    rightScore: room.rightScore,

    server: room.server,
    serves: room.serves,

    moving: room.moving,
    gameOver: room.gameOver,

    ball: {
      x: room.ball.x,
      y: room.ball.y
    }
  };
}

function sendState(room) {
  broadcast(room, state(room));
}

function serveBall(room) {
  if (room.gameOver) return;
  if (room.moving) return;

  if (!room.left || !room.right) {
    return;
  }

  const direction =
    room.server === "left" ? 1 : -1;

  room.ball.vx =
    direction * BALL_SPEED;

  room.ball.vy =
    (Math.random() * 2 - 1) * 3;

  room.moving = true;

  sendState(room);
}

function scorePoint(room, winner) {
  if (winner === "left") {
    room.leftScore++;
  } else {
    room.rightScore++;
  }

  if (
    room.leftScore >= WIN_SCORE ||
    room.rightScore >= WIN_SCORE
  ) {
    room.gameOver = true;
    room.moving = false;

    room.ball.vx = 0;
    room.ball.vy = 0;

    broadcast(room, {
      type: "gameOver",
      winner,
      leftScore: room.leftScore,
      rightScore: room.rightScore
    });

    sendState(room);

    return;
  }

  room.serves++;

  if (room.serves >= 2) {
    room.serves = 0;

    room.server =
      room.server === "left"
        ? "right"
        : "left";
  }

  resetBall(room);
  sendState(room);
}

function paddleHit(
  room,
  side,
  previousX
) {
  const paddleY =
    side === "left"
      ? room.leftY
      : room.rightY;

  const paddleTop =
    paddleY - PADDLE_H / 2;

  const paddleBottom =
    paddleY + PADDLE_H / 2;

  const touchingVertically =
    room.ball.y + BALL_R >= paddleTop &&
    room.ball.y - BALL_R <= paddleBottom;

  if (!touchingVertically) {
    return false;
  }

  if (side === "left") {
    const paddleRight =
      PADDLE_MARGIN + PADDLE_W;

    const crossed =
      previousX - BALL_R >= paddleRight &&
      room.ball.x - BALL_R <= paddleRight;

    if (!crossed) {
      return false;
    }

    room.ball.x =
      paddleRight + BALL_R;

    room.ball.vx =
      Math.abs(BALL_SPEED);
  } else {
    const paddleLeft =
      FIELD -
      PADDLE_MARGIN -
      PADDLE_W;

    const crossed =
      previousX + BALL_R <= paddleLeft &&
      room.ball.x + BALL_R >= paddleLeft;

    if (!crossed) {
      return false;
    }

    room.ball.x =
      paddleLeft - BALL_R;

    room.ball.vx =
      -Math.abs(BALL_SPEED);
  }

  const difference =
    (room.ball.y - paddleY) /
    (PADDLE_H / 2);

  room.ball.vy =
    Math.max(
      -5,
      Math.min(5, difference * 5)
    );

  return true;
}

function updateRoom(room) {
  if (
    !room.moving ||
    room.gameOver
  ) {
    return;
  }

  if (!room.left || !room.right) {
    return;
  }

  const previousX = room.ball.x;

  room.ball.x += room.ball.vx;
  room.ball.y += room.ball.vy;

  // Верх
  if (room.ball.y - BALL_R <= 0) {
    room.ball.y = BALL_R;
    room.ball.vy =
      Math.abs(room.ball.vy);
  }

  // Низ
  if (room.ball.y + BALL_R >= FIELD) {
    room.ball.y =
      FIELD - BALL_R;

    room.ball.vy =
      -Math.abs(room.ball.vy);
  }

  // Левая ракетка
  if (room.ball.vx < 0) {
    paddleHit(
      room,
      "left",
      previousX
    );
  }

  // Правая ракетка
  if (room.ball.vx > 0) {
    paddleHit(
      room,
      "right",
      previousX
    );
  }

  // Вышло за левую сторону
  if (
    room.ball.x + BALL_R < 0
  ) {
    scorePoint(room, "right");
    return;
  }

  // Вышло за правую сторону
  if (
    room.ball.x - BALL_R > FIELD
  ) {
    scorePoint(room, "left");
    return;
  }

  sendState(room);
}

setInterval(() => {
  for (const room of rooms.values()) {
    updateRoom(room);
  }
}, 16);

wss.on("connection", (ws) => {
  let room = null;
  let player = null;

  send(ws, {
    type: "connected"
  });

  ws.on("message", (message) => {
    let data;

    try {
      data = JSON.parse(
        message.toString()
      );
    } catch {
      return;
    }

    // СОЗДАНИЕ КОМНАТЫ
    if (data.type === "create") {
      if (room) return;

      room = createRoom();
      player = "left";

      room.left = ws;

      send(ws, {
        type: "room",
        room: room.code,
        player: "left"
      });

      sendState(room);

      return;
    }

    // ВХОД В КОМНАТУ
    if (data.type === "join") {
      if (room) return;

      const code = String(
        data.room || ""
      )
        .trim()
        .toUpperCase();

      const found = rooms.get(code);

      if (!found) {
        send(ws, {
          type: "error",
          message: "Комната не найдена"
        });

        return;
      }

      if (found.left && found.right) {
        send(ws, {
          type: "error",
          message: "Комната уже заполнена"
        });

        return;
      }

      room = found;

      if (!room.left) {
        player = "left";
        room.left = ws;
      } else {
        player = "right";
        room.right = ws;
      }

      send(ws, {
        type: "room",
        room: room.code,
        player
      });

      broadcast(room, {
        type: "players",
        left: Boolean(room.left),
        right: Boolean(room.right)
      });

      sendState(room);

      return;
    }

    // ДВИЖЕНИЕ
    if (data.type === "move") {
      if (!room || !player) return;

      const y = Number(data.y);

      if (!Number.isFinite(y)) {
        return;
      }

      if (player === "left") {
        room.leftY =
          clampPaddle(y);
      } else {
        room.rightY =
          clampPaddle(y);
      }

      if (!room.moving) {
        resetBall(room);
      }

      sendState(room);

      return;
    }

    // ПОДАЧА
    if (data.type === "serve") {
      if (!room || !player) return;

      if (player !== room.server) {
        return;
      }

      serveBall(room);

      return;
    }

    // НОВАЯ ИГРА
    if (data.type === "rematch") {
      if (!room) return;

      room.leftScore = 0;
      room.rightScore = 0;

      room.server = "left";
      room.serves = 0;

      room.leftY = FIELD / 2;
      room.rightY = FIELD / 2;

      room.gameOver = false;

      resetBall(room);
      sendState(room);

      return;
    }
  });

  ws.on("close", () => {
    if (!room) return;

    if (room.left === ws) {
      room.left = null;
    }

    if (room.right === ws) {
      room.right = null;
    }

    if (!room.left && !room.right) {
      rooms.delete(room.code);
      return;
    }

    broadcast(room, {
      type: "players",
      left: Boolean(room.left),
      right: Boolean(room.right)
    });
  });
});

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Heart Pong running on port ${PORT}`
    );
  }
);
