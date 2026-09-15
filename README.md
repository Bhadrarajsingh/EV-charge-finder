# ⚡ EV Charge Finder India

An interactive web application designed to help electric vehicle (2-wheelers and 4-wheelers) owners across India locate nearby, vehicle-compatible charging stations. 

Unlike generic station finders, this application matches your specific EV model's connector standard (Type 2, CCS2, LECCS, Ather, etc.) to ensure you only travel to compatible chargers.

---

## ✨ Features

- **3-Step Guided Flow**: Select your EV &rarr; Specify location &rarr; Explore compatible chargers.
- **India-Specific Vehicle Database**: Includes connectors for Tata, Mahindra, MG, BYD, Ola Electric, Ather, Hero Vida, TVS, and more.
- **Strict Connector Filtering**: Matches the vehicle's standard directly against Open Charge Map POI connector protocols.
- **Interactive Dark Map**: Built with Google Maps JavaScript API and styled for nighttime and high-contrast readability.
- **Turn-by-Turn In-Map Routing**: Integrates the Google Routes API to trace driving directions directly inside the viewport.
- **Amenity & POI Lookup**: Surfaces nearby restaurants, restrooms, cafes, and hotels using Google Places API.

---

## 🛠️ Built With

- **HTML5 & Vanilla CSS3**: Modern glassmorphism UI, custom CSS variables, and full mobile-first responsiveness.
- **Vanilla JavaScript (ES6+)**: Zero framework bloat, native Geolocation API, and asynchronous REST APIs.
- **APIs Used**:
  - [Open Charge Map API](https://openchargemap.io/): Global EV charging station data.
  - [Google Maps JavaScript API & Routes API](https://developers.google.com/maps): Map rendering, interactive markers, and route polyline calculation.
  - [Google Places API (New)](https://developers.google.com/maps/documentation/places/web-service/op-overview): Nearby points of interest and operational metadata.
  - [Nominatim (OpenStreetMap)](https://nominatim.openstreetmap.org/): Query-based city and locality geocoding fallback.

---

## 🚀 Getting Started

### Prerequisites

You will need:
1. A modern web browser.
2. A local HTTP server (such as VS Code's **Live Server** extension, or `python -m http.server 8000`).

### Configuration & Setup

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/](https://github.com/)<your-username>/ev-charge-finder-india.git
   cd ev-charge-finder-india
   ```

2. **Configure API Keys:**
   - In `index.html`, update the Google Maps script tag with your restricted API key:
     ```html
     <script src="[https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_KEY&callback=initMap&v=weekly&loading=async](https://maps.googleapis.com/maps/api/js?key=YOUR_GOOGLE_KEY&callback=initMap&v=weekly&loading=async)" defer></script>
     ```
   - In `script.js`, replace the Open Charge Map key inside `CONFIG`:
     ```javascript
     const CONFIG = {
       OCMAP_KEY: 'YOUR_OCMAP_API_KEY',
       // ...
     };
     ```

3. **Run Locally:**
   Open `index.html` with Live Server or run:
   ```bash
   npx serve .
   ```

---

## 📱 Supported Vehicles (Sample)

| Type | Brands | Connectors Supported |
| :--- | :--- | :--- |
| **Cars** | Tata, MG, Mahindra, BYD, Hyundai, Kia, BMW, Volvo | Type 2 (AC), CCS2 (DC) |
| **Bikes / Scooters** | Ola Electric, Ather, Hero Vida, TVS, Bajaj, Revolt | LECCS, Type 7, Proprietary |

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more details.
