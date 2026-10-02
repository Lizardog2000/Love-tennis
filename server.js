const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static("public"));

const rooms = new Map();

function newRoom() {
  return {
    players: [],
    score: [0, 0],
    ball: {
      x: 400,
      y: 250,
      vx: 5,
      vy: 3
    },
    gameOver: false
  };
}

function resetBall(room) {
  room.ball.x = 400;
  room.ball.y = 250;

  room.ball.vx = Math.random() > 0.5 ? 5 : -5;
  room.ball.vy = (Math.random() > 0.5 ? 1 : -1) * 3;
}

function send(player, data) {
  if (player.readyState === WebSocket.OPEN) {
    player.send(JSON.stringify(data));
  }
}

function broadcast(room, data) {
  room.players.forEach(player => send(player, data));
}

wss.on("connection", ws => {
  ws.on("message", message => {
    let data;

    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    // Создание комнаты
    if (data.type === "create") {
      const roomId = crypto.randomBytes(3).toString("hex");

      const room = newRoom();
      room.players.push(ws);

      ws.roomId = roomId;
      ws.player = 0;

      rooms.set(roomId, room);

      send(ws, {
        type: "roomCreated",
        roomId,
        player: 0
      });

      return;
    }

    // Подключение к комнате
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

      room.players.push(ws);

      ws.roomId = data.roomId;
      ws.player = 1;

      broadcast(room, {
        type: "start"
      });

      return;
    }

    // Движение игрока
    if (data.type === "move") {
      const room = rooms.get(ws.roomId);

      if (!room || room.gameOver) return;

      ws.y = Math.max(
        50,
        Math.min(450, Number(data.y) || 250)
      );

      return;
    }

    // Начать новую игру
    if (data.type === "rematch") {
      const room = rooms.get(ws.roomId);

      if (!room || room.players.length !== 2) return;

      room.score = [0, 0];
      room.gameOver = false;

      room.players.forEach(player => {
        player.y = 250;
      });

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

    room.players = room.players.filter(player => player !== ws);

    if (room.players.length === 0) {
      rooms.delete(ws.roomId);
    }
  });
});

// Игровой цикл
setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.length !== 2) continue;
    if (room.gameOver) continue;

    const ball = room.ball;

    // Движение мяча
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Верх / низ
    if (ball.y <= 20 || ball.y >= 480) {
      ball.vy *= -1;
    }

    const left = room.players[0];
    const right = room.players[1];

    const leftY = left.y || 250;
    const rightY = right.y || 250;

    // Левая ракетка
    if (
      ball.x <= 45 &&
      ball.x >= 25 &&
      ball.y >= leftY - 60 &&
      ball.y <= leftY + 60 &&
      ball.vx < 0
    ) {
      ball.vx *= -1;
      ball.x = 45;
    }

    // Правая ракетка
    if (
      ball.x >= 755 &&
      ball.x <= 775 &&
      ball.y >= rightY - 60 &&
      ball.y <= rightY + 60 &&
      ball.vx > 0
    ) {
      ball.vx *= -1;
      ball.x = 755;
    }

    // Гол правого игрока
    if (ball.x < 0) {
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

    // Гол левого игрока
    if (ball.x > 800) {
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

    // Отправляем состояние игрокам
    broadcast(room, {
      type: "state",
      ball,
      players: [
        left.y || 250,
        right.y || 250
      ],
      score: room.score
    });
  }
}, 1000 / 60);

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
