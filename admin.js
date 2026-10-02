const $ = (selector) => document.querySelector(selector);
const form = $("#car-form");
const dialog = $("#editor-dialog");
let inventory = [];
let editingId = "";
let toastTimer;

const money = (amount) => "$" + Number(amount).toLocaleString("en-US");
const imageUrl = (image) => image.startsWith("photo-")
	? `https://images.unsplash.com/${image}?auto=format&fit=crop&w=180&q=75`
	: image;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);

async function api(path, options = {}) {
	const response = await fetch(path, {
		...options,
		headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		if (response.status === 401 && !path.endsWith("/login")) showLogin();
		throw new Error(data.error || "The request could not be completed.");
	}
	return data;
}

function showLogin() {
	$("#admin-app").hidden = true;
	$("#login-view").hidden = false;
	$("#login-form").hidden = false;
	$("#setup-form").hidden = true;
}

function showSetup() {
	$("#admin-app").hidden = true;
	$("#login-view").hidden = false;
	$("#login-form").hidden = true;
	$("#setup-form").hidden = false;
	$(".login-form-wrap h1").textContent = "Make it yours.";
	$(".login-copy").textContent = "Create a password to secure your inventory manager.";
}

function showDashboard() {
	$("#login-view").hidden = true;
	$("#admin-app").hidden = false;
}

function showToast(message) {
	const toast = $("#toast");
	toast.textContent = message;
	toast.classList.add("visible");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => toast.classList.remove("visible"), 2800);
}

function renderInventory() {
	const query = $("#table-search").value.trim().toLowerCase();
	const matching = inventory.filter((car) => `${car.year} ${car.make} ${car.model} ${car.trim}`.toLowerCase().includes(query));
	$("#listing-count").textContent = inventory.length;
	$("#inventory-value").textContent = money(inventory.reduce((total, car) => total + car.price, 0));
	$("#inventory-caption").textContent = `${inventory.length} active ${inventory.length === 1 ? "listing" : "listings"} on your storefront`;
	$("#last-updated").textContent = "Just now";
	$("#table-empty").hidden = matching.length > 0;
	$("#vehicle-rows").innerHTML = matching.map((car) => `<tr><td><div class="vehicle-cell"><img class="vehicle-thumb" src="${escapeHtml(imageUrl(car.image))}" alt="" loading="lazy"><div><p class="vehicle-title">${escapeHtml(car.year)} ${escapeHtml(car.make)} ${escapeHtml(car.model)}</p><p class="vehicle-subtitle">${escapeHtml(car.trim || car.body)} · ${escapeHtml(car.location)}</p></div></div></td><td class="cell-price">${money(car.price)}</td><td>${Number(car.mileage).toLocaleString("en-US")} mi</td><td><span class="status-label">Live</span></td><td><div class="row-actions"><button type="button" data-edit="${escapeHtml(car.id)}">Edit</button><button type="button" class="delete-action" data-delete="${escapeHtml(car.id)}">Delete</button></div></td></tr>`).join("");
}

async function loadInventory() {
	inventory = await api("/api/admin/cars");
	renderInventory();
}

function openEditor(car = null) {
	editingId = car?.id || "";
	form.reset();
	$("#editor-title").textContent = editingId ? "Edit listing" : "Add a car";
	$("#save-car").textContent = editingId ? "Save changes" : "Save listing";
	$("#editor-error").textContent = "";
	if (car) for (const [key, value] of Object.entries(car)) {
		if (key === "id" || !form.elements.namedItem(key)) continue;
		form.elements.namedItem(key).value = value;
	}
	dialog.showModal();
}

async function submitLogin(event) {
	event.preventDefault();
	const button = $("#login-form button");
	const error = $("#login-error");
	button.disabled = true;
	error.textContent = "";
	try {
		await api("/api/admin/login", { method: "POST", body: JSON.stringify({ password: $("#password").value }) });
		$("#password").value = "";
		showDashboard();
		await loadInventory();
	} catch (requestError) {
		error.textContent = requestError.message;
	} finally {
		button.disabled = false;
	}
}

async function submitSetup(event) {
	event.preventDefault();
	const password = $("#new-password").value;
	const error = $("#setup-error");
	const button = $("#setup-form button");
	if (password.length < 8) {
		error.textContent = "Choose a password with at least 8 characters.";
		return;
	}
	if (password !== $("#confirm-password").value) {
		error.textContent = "Those passwords do not match.";
		return;
	}
	button.disabled = true;
	error.textContent = "";
	try {
		await api("/api/admin/setup", { method: "POST", body: JSON.stringify({ password }) });
		$("#new-password").value = "";
		$("#confirm-password").value = "";
		showDashboard();
		await loadInventory();
	} catch (requestError) {
		error.textContent = requestError.message;
	} finally {
		button.disabled = false;
	}
}

async function saveListing(event) {
	event.preventDefault();
	const saveButton = $("#save-car");
	const error = $("#editor-error");
	const values = Object.fromEntries(new FormData(form).entries());
	for (const key of ["year", "price", "mileage"]) values[key] = Number(values[key]);
	saveButton.disabled = true;
	error.textContent = "";
	try {
		await api(editingId ? `/api/admin/cars/${encodeURIComponent(editingId)}` : "/api/admin/cars", {
			method: editingId ? "PUT" : "POST",
			body: JSON.stringify(values)
		});
		dialog.close();
		await loadInventory();
		showToast(editingId ? "Listing updated on your storefront." : "Your car is now listed on the storefront.");
	} catch (requestError) {
		error.textContent = requestError.message;
	} finally {
		saveButton.disabled = false;
	}
}

async function handleInventoryAction(event) {
	const editButton = event.target.closest("[data-edit]");
	if (editButton) {
		const car = inventory.find((item) => item.id === editButton.dataset.edit);
		if (car) openEditor(car);
		return;
	}
	const deleteButton = event.target.closest("[data-delete]");
	if (!deleteButton) return;
	const car = inventory.find((item) => item.id === deleteButton.dataset.delete);
	if (!car || !window.confirm(`Remove the ${car.year} ${car.make} ${car.model} listing?`)) return;
	try {
		await api(`/api/admin/cars/${encodeURIComponent(car.id)}`, { method: "DELETE" });
		await loadInventory();
		showToast("Listing removed from your storefront.");
	} catch (error) {
		showToast(error.message);
	}
}

async function initialize() {
	try {
		await api("/api/admin/session");
		showDashboard();
		await loadInventory();
	} catch (error) {
		if (error.message === "Create an admin password to get started.") return showSetup();
		showLogin();
	}
}

$("#login-form").addEventListener("submit", submitLogin);
$("#setup-form").addEventListener("submit", submitSetup);
$("#logout-button").addEventListener("click", async () => {
	try { await api("/api/admin/logout", { method: "POST" }); } catch {}
	showLogin();
});
$("#add-car").addEventListener("click", () => openEditor());
$("#close-editor").addEventListener("click", () => dialog.close());
$("#cancel-editor").addEventListener("click", () => dialog.close());
form.addEventListener("submit", saveListing);
$("#table-search").addEventListener("input", renderInventory);
$("#vehicle-rows").addEventListener("click", handleInventoryAction);
dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
initialize();