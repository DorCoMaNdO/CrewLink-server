import express from 'express';
import { Server } from 'http';
import socketIO from 'socket.io';
import Tracer from 'tracer';
import morgan from 'morgan';

const port = parseInt(process.env.PORT || '9736');

const logger = Tracer.colorConsole({
	format: '{{timestamp}} <{{title}}> {{message}}'
});

const app = express();
const server = new Server(app);
const io = socketIO(server);

const playerIds = new Map<string, number>();

interface Signal {
	data: string;
	to: string;
}

let connectionCount = 0;

app.use(morgan('combined'));
app.use(express.static('offsets'));
app.use('/', (_, res) => {
	const rooms = Object.keys(io.sockets.adapter.rooms).length;
	res.status(200).send(`
		<!doctype html>
		<html>
		<head><title>CrewLink+ Relay Server</title></head>
		<body>
		<p>Currently ${rooms} open room${rooms !== 1 ? 's' : ''} and ${connectionCount} online player${connectionCount !== 1 ? 's' : ''}.</p>
		</body>
		</html>
	`);
});

io.on('connection', (socket: socketIO.Socket) => {
	connectionCount++;
	logger.info("Total connected: %d", connectionCount);
	let code: string | null = null;

	socket.on('join', (c: string, id: number) => {
		if (typeof c !== 'string' || typeof id !== 'number') {
			socket.disconnect();
			logger.error('Socket %s sent invalid join command: %s %d', socket.id, c, id);
			return;
		}
		code = c;
		socket.leaveAll();
		socket.join(code);
		socket.to(code).broadcast.emit('join', socket.id, id);

		let socketsInLobby = Object.keys(io.sockets.adapter.rooms[code].sockets);
		let ids: any = {};
		for (let s of socketsInLobby) {
			if (s !== socket.id)
				ids[s] = playerIds.get(s);
		}
		socket.emit('setIds', ids);
	});

	socket.on('id', (id: number) => {
		if (typeof id !== 'number') {
			socket.disconnect();
			logger.error('Socket %s sent invalid id command: %d', socket.id, id);
			return;
		}
		playerIds.set(socket.id, id);
		socket.to(code).broadcast.emit('setId', socket.id, id);
	})


	socket.on('leave', () => {
		if (code) socket.leave(code);
	})

	socket.on('signal', (signal: Signal) => {
		if (typeof signal !== 'object' || !signal.data || !signal.to || typeof signal.to !== 'string') {
			socket.disconnect();
			logger.error('Socket %s sent invalid signal command: %j', socket.id, signal);
			return;
		}
		const { to, data } = signal;
		io.to(to).emit('signal', {
			data,
			from: socket.id
		});
	});

	socket.on('disconnect', () => {
		connectionCount--;
		logger.info('Total connected: %d', connectionCount);
		playerIds.delete(socket.id);
	})

})

server.listen(port);
logger.info('Server listening on port %d', port);