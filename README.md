# AutoList

AutoList is a small vehicle marketplace with a password-protected inventory manager. Listings are stored in `data/cars.json` and appear on the public storefront as soon as they are saved.

## Run locally

1. Install Node.js 18 or later.
2. Run `npm start` from this folder.
3. Open `http://localhost:3000` for the storefront or `http://localhost:3000/admin` to manage inventory.
4. The first visit to `/admin` asks you to create an admin password. It is stored as a salted hash in the ignored `.env` file.

The server listens on `127.0.0.1` and is intended for local use. Do not commit `.env` or expose this development server directly to the internet. Public vehicle images are supplied as HTTPS image URLs.