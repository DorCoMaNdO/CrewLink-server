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
let codeConnectionCount: any = {};

const lobbySettingsVersion = 1;
const defaultLobbySettings = {
	version: lobbySettingsVersion,
	impostorVentChat: true,
	commsSabotageVoice: false
};
let lobbySettings: any = {};
let codePlayerCount: any = {};
//let codePlayerIds: any = {};

app.use(morgan('combined'));
app.use(express.static('offsets'));
/*app.use('/', (_, res) => {
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
});*/

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

		if (!codeConnectionCount[code]) codeConnectionCount[code] = 0;
		codeConnectionCount[code]++;

		logger.info('Total connected to code %s : %d', code, codeConnectionCount[code]);

		if (!lobbySettings[code]) lobbySettings[code] = Object.assign({}, defaultLobbySettings); // Copy default settings

		socket.join(code);

		playerIds.set(socket.id, id);

		socket.to(code).broadcast.emit('join', socket.id, id);

		//logger.info('Join broadcast in room %s: %s %s', code, socket.id, id);

		let socketsInLobby = Object.keys(io.sockets.adapter.rooms[code].sockets);
		let ids: any = {};
		for (let s of socketsInLobby) {
			if (s !== socket.id) {
				ids[s] = playerIds.get(s);
			}
		}
		socket.emit('setIds', ids);

		logger.info('Join reply in room %s: %s %j', code, socket.id, ids);

		/*for (let s of lobbySettings[code]) {
			logger.info('lobbySetting: ' + s + ' - ' + lobbySettings[code][s]);
		}*/
		socket.emit('lobbySettings', lobbySettings[code]); // Send current lobby settings
	});

	socket.on('setLobbySetting', (setting: string, value: any) => { // Lobby setting changed event, fired whenever a setting is changed.
		if (!code || codePlayerCount[code] === undefined) return;
		//if (!code || !codePlayerIds[code]) return;

		if (typeof setting !== 'string' || codePlayerCount[code] > 1) {
		//if (typeof setting !== 'string' || codePlayerIds[code] > 1) {
			logger.error('Socket %s from room %s sent invalid setLobbySetting command', socket.id, code);
			return;
		}

		logger.info('lobbySettings[' + code + '][' + setting + '] = ' + value);

		lobbySettings[code][setting] = value;

		socket.emit('lobbySetting', setting, value);
		socket.to(code).broadcast.emit('lobbySetting', socket.id, setting, value);
	});

	socket.on('lobbyPlayerCount', (c: string, count: number) => { // Track lobby player count, used to determine whether settings should be changed.
		if (!c || typeof code !== 'string' || c === 'MENU') return;

		code = c;

		if (!codePlayerCount[code]) codePlayerCount[code] = 0;

		if (codePlayerCount[code] == count) return;

		codePlayerCount[code] = count;

		logger.info('Total players in code %s : %d', code, codePlayerCount[code]);
	});

	socket.on('id', (id: number) => {
		if (!code) return;

		if (typeof id !== 'number') {
			socket.disconnect();
			logger.error('Socket %s sent invalid id command: %d', socket.id, id);
			return;
		}
		
		//logger.info('id: ' + id);
		/*if (!codePlayerIds[code]) codePlayerIds[code] = {};
		codePlayerIds[code][id] = true;

		logger.info('Total players in code %s : %d', codePlayerIds[code][id]);*/

		playerIds.set(socket.id, id);

		socket.to(code).broadcast.emit('setId', socket.id, id);
		
		//logger.info('ID broadcast to room %s: %s %s', code, socket.id, id);
	});

	function doLeave() {
		if (!code) return;

		const id = playerIds.get(socket.id);
		if (!id) {
			code = null;

			return;
		}

		socket.to(code).broadcast.emit('deleteId', socket.id, id);
		socket.leave(code);

		playerIds.delete(socket.id);
		logger.info('Leave room %s: %s', code, socket.id);

		if (code && codeConnectionCount[code]) {
			codeConnectionCount[code]--;

			logger.info('Total connected to code %s : %d', code, codeConnectionCount[code]);

			if (codeConnectionCount[code] > 0) return;

			if (codePlayerCount[code]) codePlayerCount[code] = undefined;
			//if (codePlayerIds[code]) codePlayerIds[code] = undefined;

			if (lobbySettings[code]) lobbySettings[code] = undefined;
			codeConnectionCount[code] = undefined;
		}

		code = null;
	}

	socket.on('leave', doLeave);

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

	socket.on('disconnecting', () => {
		const id = playerIds.get(socket.id);
		if (!id) return;

		for (const room of Object.keys(socket.rooms)) {
			if (room !== socket.id) {
				socket.to(room).broadcast.emit('deleteId', socket.id, id);
			}
		}
	});

	socket.on('disconnect', () => {
		connectionCount--;

		logger.info('Total connected: %d', connectionCount);
		
		doLeave();

		playerIds.delete(socket.id);
	});
});

server.listen(port);
logger.info('Server listening on port %d', port);