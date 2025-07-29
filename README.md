<!DOCTYPE html>
<html>
<head>
  <title>Map – ProjectMap</title>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.3/dist/leaflet.css" />
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.css" />

  <style>
    html, body, #map {
      margin: 0;
      padding: 0;
      height: 100%;
    }
    #userStatus {
      position: absolute;
      top: 10px;
      right: 10px;
      z-index: 1000;
      background: white;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 14px;
    }
    .popup-form input, .popup-form select {
      width: 100%;
      margin-bottom: 6px;
    }
    .popup-form button {
      width: 100%;
      margin-top: 6px;
    }
  </style>
</head>
<body>
  <div id="userStatus">Checking login...</div>
  <div id="map"></div>

  <!-- Firebase SDKs -->
  <script src="https://www.gstatic.com/firebasejs/9.24.0/firebase-app-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.24.0/firebase-auth-compat.js"></script>
  <script src="https://www.gstatic.com/firebasejs/9.24.0/firebase-firestore-compat.js"></script>

  <!-- Leaflet and Drawing -->
  <script src="https://unpkg.com/leaflet@1.9.3/dist/leaflet.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet.draw/1.0.4/leaflet.draw.js"></script>

  <!-- App Logic -->
  <script src="app.js"></script>
</body>
</html>
