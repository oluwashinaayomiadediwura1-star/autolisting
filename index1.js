let vehicles = [];

const state = { make: "", keyword: "", maxSearchPrice: "", minPrice: "", maxPrice: "", mileage: "", body: "", fuel: "", savedOnly: false, sort: "recommended" };
const saved = new Set(JSON.parse(localStorage.getItem("autolist-saved") || "[]"));
const $ = (selector) => document.querySelector(selector);
const grid = $("#vehicle-grid");
const formatMoney = (value) => "$" + value.toLocaleString("en-US");
const photoUrl = (image, width = 720) => image.startsWith("photo-")
	? `https://images.unsplash.com/${image}?auto=format&fit=crop&w=${width}&q=82`
	: image;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);

async function loadVehicles() {
	const response = await fetch("/api/cars");
	if (!response.ok) throw new Error("Could not load inventory.");
	vehicles = await response.json();
	initializeFilters();
	updateFilterControls();
	render();
}

function initializeFilters() {
	const makes = [...new Set(vehicles.map((vehicle) => vehicle.make))].sort();
	for (const make of makes) {
		const option = document.createElement("option");
		option.value = make;
		option.textContent = make;
		$("#make-select").append(option);
	}

	for (const type of ["SUV", "Sedan", "Coupe", "Wagon"]) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "body-chip";
		button.textContent = type;
		button.setAttribute("aria-pressed", "false");
		button.addEventListener("click", () => {
			state.body = state.body === type ? "" : type;
			updateFilterControls();
			render();
		});
		$("#body-options").append(button);
	}

	for (const type of ["Gasoline", "Hybrid", "Electric"]) {
		const label = document.createElement("label");
		label.className = "check-option";
		const input = document.createElement("input");
		input.type = "radio";
		input.name = "fuel-type";
		input.value = type;
		input.addEventListener("change", () => {
			state.fuel = input.checked ? type : "";
			render();
		});
		label.append(input, document.createTextNode(type));
		$("#fuel-options").append(label);
	}
}

function getFilteredVehicles() {
	let results = vehicles.filter((vehicle) => {
		const searchText = `${vehicle.make} ${vehicle.model} ${vehicle.trim} ${vehicle.body} ${vehicle.fuel}`.toLowerCase();
		return (!state.make || vehicle.make === state.make)
			&& (!state.keyword || searchText.includes(state.keyword.toLowerCase().trim()))
			&& (!state.maxSearchPrice || vehicle.price <= Number(state.maxSearchPrice))
			&& (!state.minPrice || vehicle.price >= Number(state.minPrice))
			&& (!state.maxPrice || vehicle.price <= Number(state.maxPrice))
			&& (!state.mileage || vehicle.mileage <= Number(state.mileage))
			&& (!state.body || vehicle.body === state.body)
			&& (!state.fuel || vehicle.fuel === state.fuel)
			&& (!state.savedOnly || saved.has(vehicle.id));
	});

	const sorts = {
		"price-low": (a, b) => a.price - b.price,
		"price-high": (a, b) => b.price - a.price,
		"year-new": (a, b) => b.year - a.year,
		"mileage-low": (a, b) => a.mileage - b.mileage
	};
	if (sorts[state.sort]) results = results.sort(sorts[state.sort]);
	return results;
}

function createVehicleCard(vehicle) {
	const card = document.createElement("article");
	card.className = "vehicle-card";
	const imageWrap = document.createElement("div");
	imageWrap.className = "vehicle-image-wrap";
	const image = document.createElement("img");
	image.className = "vehicle-image";
	image.src = photoUrl(vehicle.image);
	image.alt = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	image.loading = "lazy";
	imageWrap.append(image);

	const badge = document.createElement("span");
	badge.className = `vehicle-badge${vehicle.badge === "Great price" ? " good-price" : ""}`;
	badge.textContent = vehicle.badge;
	imageWrap.append(badge);

	const favorite = document.createElement("button");
	favorite.type = "button";
	favorite.className = `favorite-button${saved.has(vehicle.id) ? " saved" : ""}`;
	favorite.setAttribute("aria-label", saved.has(vehicle.id) ? "Remove from saved cars" : "Save this car");
	favorite.setAttribute("aria-pressed", String(saved.has(vehicle.id)));
	favorite.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 8.7c0 4.1-8.8 10.3-8.8 10.3S3.2 12.8 3.2 8.7a4.5 4.5 0 0 1 8.8-1.2 4.5 4.5 0 0 1 8.8 1.2Z"/></svg>';
	favorite.addEventListener("click", () => toggleSaved(vehicle.id));
	imageWrap.append(favorite);
	card.append(imageWrap);

	const info = document.createElement("div");
	info.className = "vehicle-info";
	info.innerHTML = `<p class="vehicle-year">${vehicle.year} <span class="spec-dot"></span> ${escapeHtml(vehicle.location)}</p><h3 class="vehicle-name">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</h3><p class="vehicle-trim">${escapeHtml(vehicle.trim)}</p><p class="vehicle-specs"><span>${vehicle.mileage.toLocaleString("en-US")} mi</span><span class="spec-dot"></span><span>${escapeHtml(vehicle.body)}</span><span class="spec-dot"></span><span>${escapeHtml(vehicle.fuel)}</span></p>`;

	const bottom = document.createElement("div");
	bottom.className = "vehicle-card-bottom";
	const priceBlock = document.createElement("div");
	priceBlock.innerHTML = `<p class="vehicle-price">${formatMoney(vehicle.price)}</p><p class="vehicle-price-label">No hidden fees</p>`;
	const details = document.createElement("button");
	details.type = "button";
	details.className = "details-button";
	details.textContent = "View details";
	details.addEventListener("click", () => showDetails(vehicle));
	bottom.append(priceBlock, details);
	info.append(bottom);
	card.append(info);
	return card;
}

function render() {
	const results = getFilteredVehicles();
	grid.replaceChildren(...results.map(createVehicleCard));
	$("#results-count").innerHTML = `<strong>${results.length} ${results.length === 1 ? "car" : "cars"}</strong> to explore`;
	$("#empty-state").hidden = results.length > 0;
	grid.hidden = results.length === 0;
	const activeCount = [state.make, state.keyword, state.maxSearchPrice, state.minPrice, state.maxPrice, state.mileage, state.body, state.fuel].filter(Boolean).length;
	$("#filter-count").textContent = activeCount;
	$("#filter-count").hidden = activeCount === 0;
	updateSavedCount();
}

function updateFilterControls() {
	$("#make-select").value = state.make;
	$("#keyword-input").value = state.keyword;
	$("#price-select").value = state.maxSearchPrice;
	$("#min-price").value = state.minPrice;
	$("#max-price").value = state.maxPrice;
	$("#mileage-select").value = state.mileage;
	$("#sort-select").value = state.sort;
	document.querySelectorAll(".body-chip").forEach((button) => {
		const selected = button.textContent === state.body;
		button.classList.toggle("selected", selected);
		button.setAttribute("aria-pressed", String(selected));
	});
	document.querySelectorAll("#fuel-options input").forEach((input) => { input.checked = input.value === state.fuel; });
}

function updateSavedCount() {
	$("#saved-count").textContent = saved.size;
	$("#mobile-saved-count").textContent = saved.size;
}

function toggleSaved(id) {
	if (saved.has(id)) saved.delete(id);
	else saved.add(id);
	localStorage.setItem("autolist-saved", JSON.stringify([...saved]));
	render();
}

function showDetails(vehicle) {
	const content = $("#dialog-content");
	content.replaceChildren();
	const image = document.createElement("img");
	image.className = "dialog-image";
	image.src = photoUrl(vehicle.image, 1100);
	image.alt = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
	const body = document.createElement("div");
	body.className = "dialog-body";
	body.innerHTML = `<p class="vehicle-year">${vehicle.year} · ${escapeHtml(vehicle.location)}</p><h2 id="dialog-title">${escapeHtml(vehicle.make)} ${escapeHtml(vehicle.model)}</h2><p class="dialog-price">${formatMoney(vehicle.price)}</p><div class="dialog-specs"><div><span>Mileage</span><strong>${vehicle.mileage.toLocaleString("en-US")} mi</strong></div><div><span>Powertrain</span><strong>${escapeHtml(vehicle.fuel)}</strong></div><div><span>Body style</span><strong>${escapeHtml(vehicle.body)}</strong></div><div><span>Trim</span><strong>${escapeHtml(vehicle.trim)}</strong></div><div><span>Exterior</span><strong>${escapeHtml(vehicle.color)}</strong></div><div><span>Seller</span><strong>Verified listing</strong></div></div><p class="dialog-description">${escapeHtml(vehicle.description)}</p><a class="dialog-contact" href="mailto:hello@autolist.example?subject=${encodeURIComponent(`I'm interested in the ${vehicle.year} ${vehicle.make} ${vehicle.model}`)}">Contact seller</a>`;
	content.append(image, body);
	$("#vehicle-dialog").showModal();
}

function clearFilters() {
	Object.assign(state, { make: "", keyword: "", maxSearchPrice: "", minPrice: "", maxPrice: "", mileage: "", body: "", fuel: "", savedOnly: false });
	updateFilterControls();
	$("#filters-panel").classList.remove("open");
	$("#filter-toggle").setAttribute("aria-expanded", "false");
	render();
}

loadVehicles().catch(() => {
	$("#results-count").textContent = "Inventory is unavailable. Start the AutoList server and try again.";
	grid.hidden = true;
	$("#empty-state").hidden = false;
	$("#empty-state h3").textContent = "We couldn't load the inventory.";
	$("#empty-state p").textContent = "Please refresh the page after the AutoList server is running.";
});

$("#search-form").addEventListener("submit", (event) => {
	event.preventDefault();
	state.make = $("#make-select").value;
	state.keyword = $("#keyword-input").value;
	state.maxSearchPrice = $("#price-select").value;
	state.savedOnly = false;
	render();
	$("#inventory").scrollIntoView({ behavior: "smooth" });
});
$("#min-price").addEventListener("change", (event) => { state.minPrice = event.target.value; render(); });
$("#max-price").addEventListener("change", (event) => { state.maxPrice = event.target.value; render(); });
$("#mileage-select").addEventListener("change", (event) => { state.mileage = event.target.value; render(); });
$("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; render(); });
$("#clear-filters").addEventListener("click", clearFilters);
$("#mobile-clear").addEventListener("click", clearFilters);
$("#empty-clear").addEventListener("click", clearFilters);
$("#filter-toggle").addEventListener("click", () => {
	const open = $("#filters-panel").classList.toggle("open");
	$("#filter-toggle").setAttribute("aria-expanded", String(open));
});
function showSaved() {
	state.savedOnly = !state.savedOnly;
	if (state.savedOnly && saved.size === 0) state.savedOnly = false;
	render();
	$("#inventory").scrollIntoView({ behavior: "smooth" });
}
$("#saved-nav").addEventListener("click", showSaved);
$("#mobile-saved").addEventListener("click", showSaved);
$("#dialog-close").addEventListener("click", () => $("#vehicle-dialog").close());
$("#vehicle-dialog").addEventListener("click", (event) => {
	if (event.target === $("#vehicle-dialog")) $("#vehicle-dialog").close();
});
