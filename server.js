require('dotenv').config();
const express = require('express');
const app = express();  
const http = require('http');
const path = require('path');
const axios = require('axios');
const { Server } = require('socket.io');
const ACTIONS = require('./src/Actions');

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('build'));
app.use((req, res, next) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const userSocketMap = {};
const rooms = new Map();

function getAllConnectedClients(roomId) {
    return Array.from(io.sockets.adapter.rooms.get(roomId) || []).map(
        (socketId) => {
            return {
                socketId,
                username: userSocketMap[socketId],
            };
        }
    );
}

io.on('connection', (socket) => {
    console.log('socket connected', socket.id);

    socket.on(ACTIONS.JOIN, ({ roomId, username }) => {
        userSocketMap[socket.id] = username;
        socket.join(roomId);
        if (!rooms.has(roomId)) rooms.set(roomId, { output: "" });

        const clients = getAllConnectedClients(roomId);
        clients.forEach(({ socketId }) => {
            io.to(socketId).emit(ACTIONS.JOINED, {
                clients,
                username,
                socketId: socket.id,
            });
        });
    });

    socket.on(ACTIONS.CODE_CHANGE, ({ roomId, code }) => {
        socket.in(roomId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on(ACTIONS.SYNC_CODE, ({ socketId, code }) => {
        io.to(socketId).emit(ACTIONS.CODE_CHANGE, { code });
    });

    socket.on("typing", ({ roomId, userName }) => {
        socket.to(roomId).emit("userTyping", userName);
    });

    socket.on("languageChange", ({ roomId, language }) => {
        io.to(roomId).emit("languageUpdate", language);
    });

    socket.on("compileCode", async ({ roomId, code, language, version }) => {
        if (rooms.has(roomId)) {
            try {
                const response = await axios.post(
                    "https://emkc.org/api/v2/piston/execute",
                    {
                        language,
                        version,
                        files: [
                            {
                                content: code,
                            },
                        ],
                    }
                );
                const room = rooms.get(roomId);
                room.output = response.data.run.output;
                io.to(roomId).emit("codeResponse", response.data);
            } catch (error) {
                io.to(roomId).emit("codeResponse", {
                    run: { output: "Error compiling code." },
                });
            }
        }
    });

    socket.on('disconnecting', () => {
        const socketRooms = [...socket.rooms];
        socketRooms.forEach((roomId) => {
            socket.in(roomId).emit(ACTIONS.DISCONNECTED, {
                socketId: socket.id,
                username: userSocketMap[socket.id],
            });
        });
        delete userSocketMap[socket.id];
    });
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => console.log(`Listening on port ${PORT}`));
