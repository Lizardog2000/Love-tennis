const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const rooms = new Map();

function createRoom() {
  return {
    players: [],
    score: [0, 0],
    gameOver: false,
    ball: {
      x: 400,
      y: 250,
      vx: 5,
      vy: 3
    }
  };
}

function resetBall(room) {
  room.ball.x = 400;
  room.ball.y = 250;
  room.ball.vx = Math.random() > 0.5 ? 5 : -5;
  room.ball.vy = Math.random() > 0.5 ? 3 : -3;
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  room.players.forEach(player => send(player, data));
}

wss.on("connection", ws => {

  ws.y = 250;
  ws.player = null;
  ws.roomId = null;

  ws.on("message", raw => {

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }

    // СОЗДАТЬ КОМНАТУ
    if (data.type === "create") {

      const roomId = crypto.randomBytes(3).toString("hex");
      const room = createRoom();

      ws.roomId = roomId;
      ws.player = 0;

      room.players.push(ws);
      rooms.set(roomId, room);

      send(ws, {
        type: "roomCreated",
        roomId: roomId,
        player: 0
      });

      return;
    }

    // ВОЙТИ В КОМНАТУ
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

      // КАЖДОМУ ИГРОКУ ОТПРАВЛЯЕМ ЕГО НОМЕР
      room.players.forEach(player => {
        send(player, {
          type: "start",
          player: player.player
        });
      });

      return;
    }

    // ДВИЖЕНИЕ
    if (data.type === "move") {

      const room = rooms.get(ws.roomId);

      if (!room || room.gameOver) return;

      let y = Number(data.y);

      if (!Number.isFinite(y)) return;

      y = Math.max(60, Math.min(440, y));

      ws.y = y;

      return;
    }

    // НОВАЯ ИГРА
    if (data.type === "rematch") {

      const room = rooms.get(ws.roomId);

      if (!room || room.players.length !== 2) return;

      room.score = [0, 0];
      room.gameOver = false;

      room.players[0].y = 250;
      room.players[1].y = 250;

      resetBall(room);

      broadcast(room, {
        type: "restart",
        score: room.score
      });

      return;
    }
  });

  ws.on("close", () => {

    const room = rooms.get(ws.roomId);

    if (!room) return;

    room.players = room.players.filter(p => p !== ws);

    if (room.players.length === 0) {
      rooms.delete(ws.roomId);
    }
  });
});


// ИГРОВОЙ ЦИКЛ
setInterval(() => {

  for (const room of rooms.values()) {

    if (room.players.length !== 2) continue;
    if (room.gameOver) continue;

    const left = room.players[0];
    const right = room.players[1];

    const ball = room.ball;

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Верх и низ
    if (ball.y <= 15 || ball.y >= 485) {
      ball.vy *= -1;
    }

    // ЛЕВАЯ РАКЕТКА
    if (
      ball.vx < 0 &&
      ball.x <= 45 &&
      ball.x >= 25 &&
      ball.y >= left.y - 65 &&
      ball.y <= left.y + 65
    ) {
      ball.x = 45;
      ball.vx = Math.abs(ball.vx) + 0.15;
    }

    // ПРАВАЯ РАКЕТКА
    if (
      ball.vx > 0 &&
      ball.x >= 755 &&
      ball.x <= 775 &&
      ball.y >= right.y - 65 &&
      ball.y <= right.y + 65
    ) {
      ball.x = 755;
      ball.vx = -(Math.abs(ball.vx) + 0.15);
    }

    // ЛЕВЫЙ ГОЛ
    if (ball.x < -20) {

      room.score[1]++;

      if (room.score[1] >= 11) {

        room.gameOver = true;

        broadcast(room, {
          type: "gameOver",
          winner: 1,
          score: room.score
        });

      } else {
        resetBall(room);
      }
    }

    // ПРАВЫЙ ГОЛ
    if (ball.x > 820) {

      room.score[0]++;

      if (room.score[0] >= 11) {

        room.gameOver = true;

        broadcast(room, {
          type: "gameOver",
          winner: 0,
          score: room.score
        });

      } else {
        resetBall(room);
      }
    }

    // СОСТОЯНИЕ ИГРЫ
    broadcast(room, {
      type: "state",
      ball: ball,
      players: [
        left.y,
        right.y
      ],
      score: room.score
    });
  }

}, 1000 / 60);


const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log("Server started on port " + PORT);
});
