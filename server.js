const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const path = require("path");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();

function newRoom() {
    let id;

    do {
        id = Math.random()
            .toString(36)
            .substring(2, 8);
    } while (rooms.has(id));

    rooms.set(id, {
        players: [],
        paddles: [50, 50],
        ball: {
            x: 50,
            y: 50,
            vx: 0.45,
            vy: 0.7
        },
        score: [0, 0]
    });

    return id;
}

function send(room, data) {
    for (const player of room.players) {
        if (player.readyState === WebSocket.OPEN) {
            player.send(JSON.stringify(data));
        }
    }
}

function resetBall(room) {
    room.ball.x = 50;
    room.ball.y = 50;

    room.ball.vx =
        Math.random() > 0.5 ? 0.45 : -0.45;

    room.ball.vy =
        Math.random() > 0.5 ? 0.7 : -0.7;
}


wss.on("connection", (ws) => {

    ws.on("message", (message) => {

        let data;

        try {
            data = JSON.parse(message);
        } catch {
            return;
        }


        // СОЗДАНИЕ КОМНАТЫ

        if (data.type === "create") {

            const roomId = newRoom();
            const room = rooms.get(roomId);

            room.players.push(ws);

            ws.roomId = roomId;
            ws.player = 0;

            ws.send(JSON.stringify({
                type: "roomCreated",
                room: roomId,
                player: 0
            }));

            return;
        }


        // ПОДКЛЮЧЕНИЕ К КОМНАТЕ

        if (data.type === "join") {

            const room = rooms.get(data.room);

            if (!room) {

                ws.send(JSON.stringify({
                    type: "error",
                    message: "Комната не найдена"
                }));

                return;
            }

            if (room.players.length >= 2) {

                ws.send(JSON.stringify({
                    type: "error",
                    message: "Комната уже заполнена"
                }));

                return;
            }

            room.players.push(ws);

            ws.roomId = data.room;
            ws.player = 1;

            ws.send(JSON.stringify({
                type: "joined",
                room: data.room,
                player: 1
            }));

            send(room, {
                type: "start"
            });

            return;
        }


        // ДВИЖЕНИЕ РАКЕТКИ

        if (data.type === "paddle") {

            const room = rooms.get(ws.roomId);

            if (!room) return;

            let x = Number(data.x);

            if (!Number.isFinite(x)) return;

            x = Math.max(10, Math.min(90, x));

            room.paddles[ws.player] = x;
        }
    });


    ws.on("close", () => {

        const room = rooms.get(ws.roomId);

        if (!room) return;

        room.players =
            room.players.filter(
                player => player !== ws
            );

        send(room, {
            type: "opponentLeft"
        });

        if (room.players.length === 0) {
            rooms.delete(ws.roomId);
        }
    });
});


// ИГРОВАЯ ФИЗИКА

setInterval(() => {

    for (const room of rooms.values()) {

        if (room.players.length !== 2) {
            continue;
        }

        const ball = room.ball;

        ball.x += ball.vx;
        ball.y += ball.vy;


        // Левая стена

        if (ball.x <= 3) {
            ball.x = 3;
            ball.vx = Math.abs(ball.vx);
        }


        // Правая стена

        if (ball.x >= 97) {
            ball.x = 97;
            ball.vx = -Math.abs(ball.vx);
        }


        const playerBottom =
            room.paddles[0];

        const playerTop =
            room.paddles[1];


        // НИЖНЯЯ РАКЕТКА

        if (
            ball.vy > 0 &&
            ball.y >= 88 &&
            ball.y <= 96 &&
            Math.abs(ball.x - playerBottom) < 12
        ) {

            ball.y = 88;

            ball.vy = -Math.abs(ball.vy);

            ball.vx =
                (ball.x - playerBottom) * 0.08;

            // Не даём мячу лететь почти вертикально

            if (Math.abs(ball.vx) < 0.18) {
                ball.vx =
                    ball.vx < 0 ? -0.18 : 0.18;
            }
        }


        // ВЕРХНЯЯ РАКЕТКА

        if (
            ball.vy < 0 &&
            ball.y <= 12 &&
            ball.y >= 4 &&
            Math.abs(ball.x - playerTop) < 12
        ) {

            ball.y = 12;

            ball.vy = Math.abs(ball.vy);

            ball.vx =
                (ball.x - playerTop) * 0.08;

            if (Math.abs(ball.vx) < 0.18) {
                ball.vx =
                    ball.vx < 0 ? -0.18 : 0.18;
            }
        }


        // ИГРОК СНИЗУ ЗАБИЛ

        if (ball.y < -3) {

            room.score[0]++;

            resetBall(room);
        }


        // ИГРОК СВЕРХУ ЗАБИЛ

        if (ball.y > 103) {

            room.score[1]++;

            resetBall(room);
        }


        // ОТПРАВЛЯЕМ СОСТОЯНИЕ ИГРОКАМ

        send(room, {
            type: "state",

            ball: {
                x: ball.x,
                y: ball.y
            },

            paddles: room.paddles,

            score: room.score
        });
    }

}, 16);


const PORT =
    process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(
        "Pong server started on port " + PORT
    );
});
