const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const root = __dirname;
const dataFile = path.join(root, "data", "cars.json");
const envFile = path.join(root, ".env");
const sessions = new Map();
const loginAttempts = new Map();
const sessionLifetime = 8 * 60 * 60 * 1000;
let loginPasswordSalt;
let loginPasswordHash;

async function loadEnvironment() {
	try {
		const content = await fs.readFile(envFile, "utf8");
		for (const line of content.split(/\r?\n/)) {
			const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
			if (!match || Object.hasOwn(process.env, match[1])) continue;
			const value = match[2].replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted);
			process.env[match[1]] = value;
		}
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
}

function passwordConfigured() {
	return Boolean(loginPasswordHash && loginPasswordSalt);
}

function verifyPassword(password) {
	if (!passwordConfigured()) return false;
	const candidate = crypto.scryptSync(password, loginPasswordSalt, 64);
	return crypto.timingSafeEqual(candidate, loginPasswordHash);
}

function issueSession(response, request, now) {
	const token = crypto.randomBytes(32).toString("hex");
	sessions.set(token, now + sessionLifetime);
	return sendJson(response, 200, { ok: true }, { "Set-Cookie": `autolist_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetime / 1000}${request.socket.encrypted ? "; Secure" : ""}` });
}

function sendJson(response, status, value, extraHeaders = {}) {
	response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders });
	response.end(JSON.stringify(value));
}

function readBody(request) {
	return new Promise((resolve, reject) => {
		let body = "";
		request.setEncoding("utf8");
		request.on("data", (chunk) => {
			body += chunk;
			if (body.length > 100_000) {
				reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
				request.destroy();
			}
		});
		request.on("end", () => {
			try {
				resolve(JSON.parse(body || "{}"));
			} catch {
				reject(Object.assign(new Error("Send valid JSON."), { status: 400 }));
			}
		});
		request.on("error", reject);
	});
}

async function readCars() {
	const cars = JSON.parse(await fs.readFile(dataFile, "utf8"));
	if (!Array.isArray(cars)) throw new Error("Inventory file must contain a JSON array.");
	return cars;
}

let writeQueue = Promise.resolve();
function saveCars(cars) {
	writeQueue = writeQueue.then(async () => {
		const temporaryFile = `${dataFile}.${crypto.randomUUID()}.tmp`;
		await fs.writeFile(temporaryFile, `${JSON.stringify(cars, null, 2)}\n`, "utf8");
		await fs.rename(temporaryFile, dataFile);
	});
	return writeQueue;
}

function sessionId(request) {
	const cookie = request.headers.cookie || "";
	const match = cookie.match(/(?:^|;\s*)autolist_session=([a-f0-9]+)/);
	return match?.[1] || "";
}

function isAuthenticated(request) {
	const token = sessionId(request);
	const expiresAt = sessions.get(token);
	if (!expiresAt) return false;
	if (expiresAt < Date.now()) {
		sessions.delete(token);
		return false;
	}
	sessions.set(token, Date.now() + sessionLifetime);
	return true;
}

function originIsLocal(request) {
	const origin = request.headers.origin;
	if (!origin) return true;
	try {
		return new URL(origin).host === request.headers.host;
	} catch {
		return false;
	}
}

function normalizeCar(input, id) {
	const text = (key, label, maxLength, required = false) => {
		const value = typeof input[key] === "string" ? input[key].trim() : "";
		if (required && !value) throw Object.assign(new Error(`${label} is required.`), { status: 400 });
		if (value.length > maxLength) throw Object.assign(new Error(`${label} must be ${maxLength} characters or fewer.`), { status: 400 });
		return value;
	};
	const number = (key, label, min, max) => {
		const value = Number(input[key]);
		if (!Number.isInteger(value) || value < min || value > max) throw Object.assign(new Error(`${label} must be a whole number between ${min.toLocaleString()} and ${max.toLocaleString()}.`), { status: 400 });
		return value;
	};
	const image = text("image", "Photo URL", 2000, true);
	let parsedImage;
	try {
		parsedImage = new URL(image);
	} catch {
		throw Object.assign(new Error("Photo URL must be a full HTTPS image URL."), { status: 400 });
	}
	if (parsedImage.protocol !== "https:") throw Object.assign(new Error("Photo URL must start with https://."), { status: 400 });
	return {
		id,
		year: number("year", "Year", 1950, 2099),
		make: text("make", "Make", 50, true),
		model: text("model", "Model", 70, true),
		trim: text("trim", "Trim", 100),
		body: text("body", "Body style", 40, true),
		fuel: text("fuel", "Fuel type", 40, true),
		mileage: number("mileage", "Mileage", 0, 2_000_000),
		price: number("price", "Price", 1, 10_000_000),
		badge: text("badge", "Badge", 30) || "Just listed",
		location: text("location", "Location", 100),
		color: text("color", "Color", 50),
		image,
		description: text("description", "Description", 2000)
	};
}

async function serveFile(response, filename) {
	const extension = path.extname(filename);
	const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
	try {
		const contents = await fs.readFile(filename);
		response.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": "no-cache" });
		response.end(contents);
	} catch {
		response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
		response.end("Not found");
	}
}

async function handleRequest(request, response) {
	const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
	const pathname = decodeURIComponent(url.pathname);
	const method = request.method;
	const adminRoute = pathname.startsWith("/api/admin/");
	if (adminRoute && !originIsLocal(request)) return sendJson(response, 403, { error: "Request origin was rejected." });

	if (pathname === "/api/cars" && method === "GET") {
		try { return sendJson(response, 200, await readCars()); }
		catch (error) { return sendJson(response, 500, { error: error.message }); }
	}

	if (pathname === "/api/admin/setup" && method === "POST") {
		if (request.socket.remoteAddress !== "127.0.0.1" && request.socket.remoteAddress !== "::1" && request.socket.remoteAddress !== "::ffff:127.0.0.1") return sendJson(response, 403, { error: "Initial setup is only available on this computer." });
		if (passwordConfigured()) return sendJson(response, 409, { error: "Admin access has already been set up." });
		let body;
		try { body = await readBody(request); }
		catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
		if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 128 || /[\r\n]/.test(body.password)) return sendJson(response, 400, { error: "Choose a password between 8 and 128 characters." });
		const salt = crypto.randomBytes(16);
		const hash = crypto.scryptSync(body.password, salt, 64);
		const configuration = `ADMIN_PASSWORD_SALT=${salt.toString("hex")}\nADMIN_PASSWORD_HASH=${hash.toString("hex")}\n`;
		try {
			const existing = await fs.readFile(envFile, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
			if (/^\s*ADMIN_PASSWORD\s*=/m.test(existing)) return sendJson(response, 409, { error: "An admin password is already configured in .env. Restart the server to use it." });
			await fs.writeFile(envFile, `${existing.trimEnd()}${existing.trim() ? "\n" : ""}${configuration}`, { mode: 0o600 });
		} catch (error) { return sendJson(response, 500, { error: `Could not save admin credentials: ${error.message}` }); }
		loginPasswordSalt = salt;
		loginPasswordHash = hash;
		return issueSession(response, request, Date.now());
	}

	if (pathname === "/api/admin/login" && method === "POST") {
		const now = Date.now();
		const client = request.socket.remoteAddress || "unknown";
		const attempt = loginAttempts.get(client) || { count: 0, resetAt: now + 15 * 60 * 1000 };
		if (attempt.resetAt < now) { attempt.count = 0; attempt.resetAt = now + 15 * 60 * 1000; }
		if (attempt.count >= 10) return sendJson(response, 429, { error: "Too many attempts. Try again in 15 minutes." });
		let body;
		try { body = await readBody(request); }
		catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
		const provided = typeof body.password === "string" ? body.password : "";
		if (!passwordConfigured() || !verifyPassword(provided)) {
			attempt.count += 1;
			loginAttempts.set(client, attempt);
			return sendJson(response, passwordConfigured() ? 401 : 503, { error: passwordConfigured() ? "That password did not match." : "Create an admin password to get started." });
		}
		loginAttempts.delete(client);
		return issueSession(response, request, now);
	}

	if (pathname === "/api/admin/session" && method === "GET" && !passwordConfigured()) return sendJson(response, 503, { error: "Create an admin password to get started." });
	if (adminRoute && !isAuthenticated(request)) return sendJson(response, 401, { error: "Sign in to manage listings." });

	if (pathname === "/api/admin/session" && method === "GET") return sendJson(response, 200, { authenticated: true });
	if (pathname === "/api/admin/logout" && method === "POST") {
		sessions.delete(sessionId(request));
		return sendJson(response, 200, { ok: true }, { "Set-Cookie": "autolist_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
	}
	if (pathname === "/api/admin/cars" && method === "GET") {
		try { return sendJson(response, 200, await readCars()); }
		catch (error) { return sendJson(response, 500, { error: error.message }); }
	}
	if (pathname === "/api/admin/cars" && method === "POST") {
		try {
			const body = await readBody(request);
			const cars = await readCars();
			const car = normalizeCar(body, crypto.randomUUID());
			cars.unshift(car);
			await saveCars(cars);
			return sendJson(response, 201, car);
		} catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
	}
	const carMatch = pathname.match(/^\/api\/admin\/cars\/([^/]+)$/);
	if (carMatch && method === "PUT") {
		try {
			const cars = await readCars();
			const index = cars.findIndex((car) => car.id === carMatch[1]);
			if (index < 0) return sendJson(response, 404, { error: "That listing no longer exists." });
			const body = await readBody(request);
			cars[index] = normalizeCar(body, cars[index].id);
			await saveCars(cars);
			return sendJson(response, 200, cars[index]);
		} catch (error) { return sendJson(response, error.status || 400, { error: error.message }); }
	}
	if (carMatch && method === "DELETE") {
		try {
			const cars = await readCars();
			const nextCars = cars.filter((car) => car.id !== carMatch[1]);
			if (nextCars.length === cars.length) return sendJson(response, 404, { error: "That listing no longer exists." });
			await saveCars(nextCars);
			return sendJson(response, 200, { ok: true });
		} catch (error) { return sendJson(response, 500, { error: error.message }); }
	}

	if (pathname === "/admin" || pathname === "/admin/") return serveFile(response, path.join(root, "admin.html"));
	if (pathname === "/" || pathname === "/index.html") return serveFile(response, path.join(root, "index.html"));
	const publicAssets = new Map([["/style.css", "style.css"], ["/app.js", "app.js"], ["/admin.css", "admin.css"], ["/admin.js", "admin.js"]]);
	if (publicAssets.has(pathname)) return serveFile(response, path.join(root, publicAssets.get(pathname)));
	response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
	response.end("Not found");
}

async function start() {
	await loadEnvironment();
	if (process.env.ADMIN_PASSWORD_HASH && process.env.ADMIN_PASSWORD_SALT) {
		loginPasswordSalt = Buffer.from(process.env.ADMIN_PASSWORD_SALT, "hex");
		loginPasswordHash = Buffer.from(process.env.ADMIN_PASSWORD_HASH, "hex");
		if (loginPasswordSalt.length !== 16 || loginPasswordHash.length !== 64) throw new Error("Invalid admin password configuration in .env.");
	} else if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 8) {
		loginPasswordSalt = crypto.randomBytes(16);
		loginPasswordHash = crypto.scryptSync(process.env.ADMIN_PASSWORD, loginPasswordSalt, 64);
	}
	await fs.mkdir(path.dirname(dataFile), { recursive: true });
	await readCars();
	const port = Number(process.env.PORT || 3000);
	const server = http.createServer((request, response) => {
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("X-Frame-Options", "DENY");
		response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
		response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https: data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
		handleRequest(request, response).catch((error) => {
			if (!response.headersSent) sendJson(response, 500, { error: "The server could not complete that request." });
			else response.destroy(error);
		});
	});
	server.listen(port, "127.0.0.1", () => {
		console.log(`AutoList is running at http://localhost:${port}`);
		if (!passwordConfigured()) console.log("Open /admin to create your first admin password.");
	});
}

start().catch((error) => {
	console.error(`Could not start AutoList: ${error.message}`);
	process.exitCode = 1;
});